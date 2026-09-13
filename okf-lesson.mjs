#!/usr/bin/env node
/**
 * The rows of the catalog that are worth compiling into memory, and the ones that are worth looking up.
 *
 *   node okf-lesson.mjs [--out lesson.jsonl] [--root okf]
 *
 * `okf-extract.mjs` reads 1,707 facts off the pinned gateway responses. The first lesson trained a 119-fact slice
 * of them — address→symbol, from the same pull — and the product's own publish gate refused it: `locality 3/10`,
 * meaning that of the ten side-effect prompts repeatable on this model, seven unrelated answers moved. The cause
 * was measured, not guessed — those 119 facts touched 49,825 memory rows, 419 per fact, because a 42-character
 * hex address tokenises long and gives every fact an enormous n-gram reach. A patch that rewrites
 * fifty thousand rows disturbs answers nobody asked about, and more training passes raise accuracy and footprint
 * together, so the two gates move in opposite directions and there is no number of epochs that satisfies both.
 *
 * So the rule is one line: DROP EVERY ROW CARRYING A HEX ADDRESS. What survives is the part of the catalog a
 * person asks in words — the schema vocabulary, the policy, and each deployment's declared identity.
 *
 *   "What is the layer of aave-amm?" → "lending"            a fact worth compiling into memory
 *   "What is the token symbol of the vault at 0x50379f…?"    a fact worth looking up
 *
 * That is the finding this file exists to keep: the gate is what told us the difference, and the split it
 * produced is the same split a person would draw between what you know and what you look up.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extract } from './okf-extract.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = (() => {
  const a = {}; const v = process.argv.slice(2);
  for (let i = 0; i < v.length; i++) if (v[i].startsWith('--')) a[v[i].slice(2)] = v[i + 1]?.startsWith('--') ? true : v[++i];
  return a;
})();

/** Six or more hex digits after 0x — long enough to be an address or a hash, short enough to catch a truncated one. */
const HEX = /0x[0-9a-fA-F]{6,}/;
export const isLesson = (f) => !HEX.test(f.prompt) && !HEX.test(String(f.answer));

const root = argv.root ? resolve(argv.root) : join(HERE, 'okf');
const { facts } = extract(root);
const lesson = facts.filter(isLesson);

const out = argv.out ? resolve(argv.out) : join(HERE, 'lesson.jsonl');
writeFileSync(out, lesson.map((f) => JSON.stringify({ prompt: f.prompt, answer: String(f.answer) })).join('\n') + '\n');

const by = {};
for (const f of lesson) by[f.source.file.split('/')[0]] = (by[f.source.file.split('/')[0]] ?? 0) + 1;
console.log(`${lesson.length} of ${facts.length} facts are askable in words (${facts.length - lesson.length} dropped for carrying a hex address)`);
for (const [k, n] of Object.entries(by).sort()) console.log(`  ${String(n).padStart(3)}  ${k}`);
console.log(`\nwrote ${out}`);
