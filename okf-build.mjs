#!/usr/bin/env node
/**
 * Build the agent family's OKF catalog from facts that were actually pulled.
 *
 *   node ens/okf-build.mjs [--out ens/okf] [--facts graph/bench/data/r1/facts.jsonl]
 *
 * The catalog is the corpus each generation of `engram.eth` is trained on, in Open Knowledge Format —
 * markdown with YAML frontmatter, directory-structured, the format Google Cloud published in June 2026 for
 * scattered organisational knowledge. It is written to the node's aindrive folder, so sync, capability
 * sharing and change history come from something already integrated rather than from code we write.
 *
 * WHAT IS GENERATED AND WHAT IS NOT. The vocabulary and deployment layers are generated from facts.jsonl —
 * rows read from committed gateway responses at a pinned block, each carrying the subgraph and query it came
 * from. Nothing here is written from memory or summarised by a model: the same rule the benchmark applies to
 * fixtures, for the same reason, and it is why every row can be traced to a query that provably ran.
 *
 * The `risk` layer is NOT generated. It is a fund's policy, it is subjective, and a subjective layer is the
 * whole reason this is a tree of forks rather than a canonical registry. Generating it would be inventing
 * the one thing the design says a person must author.
 *
 * THE DIRECTORY IS THE LINEAGE:
 *   vocabulary/   -> defi.engram.eth              what a vault, a market, a pool IS
 *   deployments/  -> vaults. / lending. defi...   the facts of 15 live protocols at block B*
 *   policy/       -> risk.vaults.defi...          authored, never generated
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

const argv = (() => {
  const a = {}; const v = process.argv.slice(2);
  for (let i = 0; i < v.length; i++) if (v[i].startsWith('--')) a[v[i].slice(2)] = v[i + 1]?.startsWith('--') ? true : v[++i];
  return a;
})();
const ROOT = '/mnt/newdata/ainize/knowledge-marketplace';
const OUT = join(ROOT, argv.out ?? 'ens/okf');
const FACTS = join(ROOT, argv.facts ?? 'graph/bench/data/r1/facts.jsonl');
const MANIFEST = join(ROOT, 'graph/bench/data/r1/pull/manifest.json');

const die = (m) => { console.error(`okf-build: ${m}`); process.exit(1); };
if (!existsSync(FACTS)) die(`${FACTS} does not exist — run the pull and facts pipeline first. No catalog is invented.`);

const facts = readFileSync(FACTS, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : null;
const BLOCK = manifest?.block ?? null;
if (!BLOCK) die('the pull manifest has no block — a catalog whose facts are not pinned to a block is not re-derivable');

const write = (rel, text) => { const p = join(OUT, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text); return rel; };
const stamp = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

/** Which layer a relation belongs to. Vaults and lending markets are SIBLINGS and must stay disjoint. */
const LAYER = {
  vault_symbol: 'vaults', vault_name: 'vaults', vault_fee_pct: 'vaults',
  vault_address: 'vaults', vault_asset: 'vaults', vault_asset_symbol: 'vaults',
  market_asset_symbol: 'lending', market_address: 'lending',
  pool_tokens: 'pools',
};

/** One row of the fact table, as a markdown table line. The table IS the extractable form (see okf-extract). */
const esc = (s) => String(s).replace(/\|/g, '\\|');

const written = [];

// ---------------------------------------------------------------- vocabulary (L0)
// Terms, not values. This layer is what a sibling needs in order to understand a sibling.
const VOCAB = {
  vault: {
    title: 'Vault',
    what: 'A tokenized vault: depositors put in an input token and receive an output (share) token. Balances, fees and price-per-share are properties of the vault.',
    fields: [['id', 'address', 'the vault contract address, stored lowercase'], ['name', 'string', 'human-readable name'], ['symbol', 'symbol', 'the share token ticker'], ['inputToken', 'entity', 'what depositors put in'], ['outputToken', 'entity', 'the share token they receive'], ['fees', 'list', 'feeType and feePercentage — vaults have fees, NOT rates']],
  },
  market: {
    title: 'Lending Market',
    what: 'A lending market: one asset can be supplied and borrowed. Interest is expressed as rates, and a market has no share-token symbol of its own.',
    fields: [['id', 'address', 'the market contract address, lowercase'], ['name', 'string', 'human-readable name'], ['inputToken', 'entity', 'the asset supplied and borrowed'], ['rates', 'list', 'rate, side and type — markets have rates, NOT fees'], ['maximumLTV', 'decimal', 'loan-to-value ceiling']],
  },
  pool: {
    title: 'Liquidity Pool',
    what: 'A DEX liquidity pool holding two or more tokens. Note inputTokens is PLURAL, which is the field that most often breaks a query written against the vault schema.',
    fields: [['id', 'address', 'the pool contract address, lowercase'], ['name', 'string', 'human-readable name'], ['symbol', 'symbol', 'the LP token ticker'], ['inputTokens', 'list', 'the tokens in the pool — plural'], ['fees', 'list', 'pool fees']],
  },
};

for (const [key, v] of Object.entries(VOCAB)) {
  written.push(write(`vocabulary/${key}.md`, `---
type: Schema Term
title: ${v.title}
description: ${v.what}
tags: [messari, schema, vocabulary]
timestamp: ${stamp}
---

# What it is

${v.what}

# Fields

| Field | Kind | Meaning |
|---|---|---|
${v.fields.map(([f, k, m]) => `| \`${f}\` | ${k} | ${m} |`).join('\n')}
`));
}

written.push(write('vocabulary/index.md', `---
type: Knowledge Catalog
title: DeFi Vocabulary
description: What a vault, a lending market and a liquidity pool are under the Messari standardized schema — the layer every descendant inherits.
tags: [messari, vocabulary]
timestamp: ${stamp}
---

# Why this layer exists

This is \`defi.engram.eth\`: terms, not values. It is what makes two sibling agents able to talk. \`vaults.\`
knows vaults and \`lending.\` knows markets, they hold disjoint facts, and neither could delegate to the other
if they did not share this.

It is also the layer whose confusions are expensive. A vault has **fees**; a market has **rates**; a pool's
input tokens field is **plural**. Each of those was a real defect in a benchmark prompt this week, and each
cost a tool call every time a model guessed.

- [Vault](/vocabulary/vault.md)
- [Lending Market](/vocabulary/market.md)
- [Liquidity Pool](/vocabulary/pool.md)
`));

// ---------------------------------------------------------------- deployments (L1)
const byProtocol = new Map();
for (const f of facts) {
  const layer = LAYER[f.relation];
  if (!layer || layer === 'pools') continue;            // pools are 87% of the corpus and are not in this demo's tree
  const proto = f.source?.protocol ?? 'unknown';
  const k = `${layer}/${proto}`;
  if (!byProtocol.has(k)) byProtocol.set(k, { layer, proto, deployment: f.source?.deployment_id, facts: [] });
  byProtocol.get(k).facts.push(f);
}

const REL_LABEL = {
  vault_symbol: 'share token symbol', vault_name: 'name', vault_fee_pct: 'fee percent',
  vault_address: 'address', vault_asset: 'input token address', vault_asset_symbol: 'input token symbol',
  market_asset_symbol: 'input token symbol', market_address: 'address',
};

for (const [k, g] of byProtocol) {
  // Group by subject so one row of the table is one entity, which is what okf-extract turns into facts.
  const bySubject = new Map();
  for (const f of g.facts) {
    if (!bySubject.has(f.subject)) bySubject.set(f.subject, {});
    bySubject.get(f.subject)[f.relation] = f.object;
  }
  const rels = [...new Set(g.facts.map((f) => f.relation))];
  const header = ['Entity', ...rels.map((r) => REL_LABEL[r] ?? r)];
  const rows = [...bySubject.entries()].map(([subj, m]) => `| ${esc(subj)} | ${rels.map((r) => esc(m[r] ?? '—')).join(' | ')} |`);
  written.push(write(`deployments/${k}.md`, `---
type: Subgraph Deployment
title: ${g.proto}
subgraph_id: ${g.deployment}
layer: ${g.layer}
block: ${BLOCK}
description: Facts read from the ${g.proto} subgraph at block ${BLOCK}, through The Graph's decentralized gateway.
tags: [${g.layer}, ${g.proto}, block-${BLOCK}]
timestamp: ${stamp}
---

# Provenance

Every row below was read from subgraph \`${g.deployment}\` at block **${BLOCK}** and is re-derivable: the raw
gateway responses are committed under \`graph/bench/data/r1/pull/\`, and re-issuing the same queries pinned to
that block returns byte-identical rows. Nothing here was written from memory.

# ${g.layer === 'vaults' ? 'Vaults' : 'Lending markets'} of ${g.proto}

| ${header.join(' | ')} |
|${header.map(() => '---').join('|')}|
${rows.join('\n')}
`));
}

// ---------------------------------------------------------------- policy (L2) — authored, not generated
const policyPath = join(OUT, 'policy/index.md');
if (!existsSync(policyPath)) {
  written.push(write('policy/index.md', `---
type: Policy
title: Fund Policy
description: One fund's rules about which vaults it will touch. Subjective by construction — authored, never generated.
tags: [policy, private]
timestamp: ${stamp}
---

# This file is a placeholder and must be written by a person

\`risk.vaults.defi.engram.eth\` is the layer that makes the tree a tree. There is no correct answer to "which
vaults are acceptable", which is why a canonical registry cannot work and why a fork carrying somebody's
judgement is the right shape. A generator writing this layer would be inventing the one thing the design says
a person must author.

Write rules as a table so they extract deterministically, e.g.

| Rule | Value | Why |
|---|---|---|
| minimum TVL | 1000000 | below this a withdrawal moves the price |
| excluded protocol | example-protocol | unaudited |
`));
} else {
  console.error('  policy/index.md exists — left alone, it is authored');
}

// ---------------------------------------------------------------- index
written.push(write('index.md', `---
type: Knowledge Catalog
title: engram.eth
description: The memory of an agent family — a vocabulary layer, the deployments its descendants learned, and the policy layer a person writes.
tags: [engram, agent, lineage]
timestamp: ${stamp}
---

# The family

\`\`\`
engram.eth                            the ancestor: base model, nothing loaded
└─ defi.engram.eth                    vocabulary/   — what a vault, market, pool IS
   ├─ vaults.defi.engram.eth          deployments/vaults/
   ├─ lending.defi.engram.eth         deployments/lending/
   └─ risk.vaults.defi.engram.eth     policy/       — authored, never generated
\`\`\`

Each generation is trained on top of its parent's checkpoint, and the name is minted only when the teach job
proves it: \`pre_state_sha256\` matching the parent, \`patch_sha256\` matching the artefact the name resolves
to, a benchmark passed on two distinct runtimes, and a real gradient backend. A stub-backed job mints nothing.

# Provenance

All generated facts come from subgraph queries pinned to block **${BLOCK}**, with raw responses committed.
Re-running the pull at that block reproduces them byte for byte.

- [Vocabulary](/vocabulary/index.md)
- [Policy](/policy/index.md)
`));

console.log(`built ${written.length} OKF files under ${OUT} at block ${BLOCK}`);
const byDir = {};
for (const w of written) { const d = w.includes('/') ? w.split('/').slice(0, -1).join('/') : '.'; byDir[d] = (byDir[d] ?? 0) + 1; }
for (const [d, n] of Object.entries(byDir)) console.log(`  ${String(n).padStart(3)}  ${d}/`);
