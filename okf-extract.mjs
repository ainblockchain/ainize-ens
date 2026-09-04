#!/usr/bin/env node
/**
 * OKF folder → teachable facts, by rule and never by inference.
 *
 *   node ens/okf-extract.mjs ens/okf [--json out.jsonl]
 *
 * The input is an Open Knowledge Format catalog (markdown with YAML frontmatter, directory-structured,
 * cross-linked — https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf). The output is the
 * fact list a teach job trains on.
 *
 * The rule that decides what is in here: **a fact must be readable off the file by a deterministic rule.**
 * Frontmatter scalars are facts because they are declared fields. Table rows are facts because the header
 * names the relation and the first column names the subject. Prose is NOT extracted, and no model is asked to
 * summarise anything into a training row — a fabricated fact is worse than a missing one, the same rule the
 * benchmark applies to fixtures. Prose still ships as context for a human reading the catalog; it just never
 * becomes a row that the model is taught as true.
 *
 * Every fact carries where it came from — file, and the frontmatter key or table cell — so a wrong answer in
 * the trained model can be traced to a line in a file somebody can fix, and re-training after that fix is a
 * derivative with a real parent rather than a mystery.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { createHash } from 'node:crypto';

const sha8 = (s) => createHash('sha256').update(s).digest('hex').slice(0, 12);

/** Frontmatter fields that are prose, plumbing or provenance — never taught as facts. */
const SKIP_KEYS = new Set(['description', 'timestamp', 'tags']);
/** How a frontmatter key reads as a question. Anything not named here is asked generically. */
const KEY_PHRASE = {
  type: 'What type of document is',
  title: 'What is the title of',
  sponsor: 'Who sponsors',
  resource: 'What is the resource URL for',
  total_prize_usd: 'What is the total prize in USD for',
};

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (extname(p) === '.md') out.push(p);
  }
  return out;
}

/** Minimal YAML frontmatter: `key: value` and `key: [a, b]`. Nested maps are refused, loudly. */
function frontmatter(text, file) {
  if (!text.startsWith('---')) return { fm: {}, body: text };
  const end = text.indexOf('\n---', 3);
  if (end < 0) return { fm: {}, body: text };
  const fm = {};
  for (const line of text.slice(4, end).split('\n')) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const m = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!m) { if (/^\s+\S/.test(line)) throw new Error(`${file}: nested frontmatter is not supported — flatten it`); continue; }
    const [, k, raw] = m;
    fm[k] = raw.startsWith('[') ? raw.replace(/^\[|\]$/g, '').split(',').map((s) => s.trim()).filter(Boolean) : raw.trim();
  }
  return { fm, body: text.slice(end + 4) };
}

/** Pipe tables, with the nearest preceding heading as their context. */
function tables(body) {
  const lines = body.split('\n');
  const out = [];
  let heading = null;
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(/^#{1,6}\s+(.*)$/);
    if (h) { heading = h[1].trim(); continue; }
    if (!/^\s*\|/.test(lines[i]) || !/^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] ?? '')) continue;
    const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    const header = cells(lines[i]);
    const rows = [];
    let j = i + 2;
    for (; j < lines.length && /^\s*\|/.test(lines[j]); j++) rows.push(cells(lines[j]));
    out.push({ heading, header, rows, line: i + 1 });
    i = j - 1;
  }
  return out;
}

export function extract(root) {
  const facts = [];
  const skipped = [];
  for (const file of walk(root)) {
    const rel = relative(root, file);
    const { fm, body } = frontmatter(readFileSync(file, 'utf8'), rel);
    const subject = fm.title || rel;
    if (!fm.type) { skipped.push({ file: rel, why: 'no `type` field — the one field OKF requires' }); continue; }

    for (const [k, v] of Object.entries(fm)) {
      if (SKIP_KEYS.has(k) || Array.isArray(v) || !v) continue;
      if (k === 'title') continue; // "What is the title of <title>" teaches nothing
      const q = KEY_PHRASE[k] ?? `What is the ${k.replace(/_/g, ' ')} of`;
      facts.push({ id: `fm:${sha8(rel + k)}`, prompt: `${q} ${subject}?`, answer: String(v), source: { file: rel, field: k } });
    }

    for (const t of tables(body)) {
      if (t.header.length < 2) continue;
      for (const row of t.rows) {
        if (row.length !== t.header.length) { skipped.push({ file: rel, why: `table row has ${row.length} cells, header has ${t.header.length}`, row: row.join(' | ') }); continue; }
        // The subject of a row is its leading cells; the relation is the column header.
        const keyCols = t.header.length > 2 ? row.slice(0, t.header.length - 1) : [row[0]];
        const keyNames = t.header.length > 2 ? t.header.slice(0, t.header.length - 1) : [t.header[0]];
        for (let c = keyCols.length; c < t.header.length; c++) {
          const value = row[c];
          if (!value || value === '—' || value === '-') continue;
          const where = keyCols.map((v, n) => `${keyNames[n]} ${v}`).join(', ');
          const ctx = t.heading ? `${t.heading} of ${subject}` : subject;
          facts.push({
            id: `tb:${sha8(rel + t.line + row.join('|') + t.header[c])}`,
            prompt: `In the ${ctx}, what is the ${t.header[c].toLowerCase()} for ${where}?`,
            answer: value,
            source: { file: rel, table: t.heading, row: row[0], column: t.header[c] },
          });
        }
      }
    }
  }
  return { facts, skipped };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = process.argv[2] ?? 'ens/okf';
  const { facts, skipped } = extract(root);
  const byFile = {};
  for (const f of facts) byFile[f.source.file] = (byFile[f.source.file] ?? 0) + 1;
  console.log(`${facts.length} facts from ${Object.keys(byFile).length} files under ${root}`);
  for (const [f, n] of Object.entries(byFile)) console.log(`  ${String(n).padStart(3)}  ${f}`);
  if (skipped.length) { console.log(`\nskipped ${skipped.length}:`); for (const s of skipped) console.log(`  ${s.file}: ${s.why}`); }
  console.log('\nsample:');
  for (const f of facts.slice(0, 8)) console.log(`  ${JSON.stringify(f.prompt)} → ${JSON.stringify(f.answer)}`);
  const out = process.argv.indexOf('--json');
  if (out > 0 && process.argv[out + 1]) { writeFileSync(process.argv[out + 1], facts.map((f) => JSON.stringify(f)).join('\n') + '\n'); console.log(`\nwrote ${process.argv[out + 1]}`); }
}
