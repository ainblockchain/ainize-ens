#!/usr/bin/env node
/**
 * Compile EngramRegistrar.sol against the real ENSv2 interfaces.
 *
 *   npm i solc@0.8.28 @openzeppelin/contracts@5
 *   git clone --depth 1 https://github.com/ensdomains/namechain
 *   node contracts/compile.mjs
 *
 * WHY THIS SCRIPT EXISTS RATHER THAN A HARDHAT PROJECT. Two things about this contract cannot be discovered
 * from reading it, and both are load-bearing:
 *
 *   1. `@ensdomains/contracts-v2` IS NOT A PACKAGE. There is no such thing on npm. ENSv2 is distributed as the
 *      `ensdomains/namechain` repository, and the prefix has to be remapped to `contracts/src` inside it.
 *      Without the remap the compiler reports a missing file and says nothing about where to find it.
 *   2. `viaIR` IS REQUIRED. Without it the mint path is "stack too deep" — a property of this contract as
 *      written, not a tuning preference, so a plain `solc` invocation fails and looks like a broken contract.
 *
 * Both were found by compiling. Before that, the header of EngramRegistrar.sol said it had never been through
 * a compiler and every signature in it was checked against documentation only.
 */
import solc from 'solc';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const NAMECHAIN = process.env.NAMECHAIN ?? 'namechain/contracts';
const roots = [join(NAMECHAIN, 'src'), join(NAMECHAIN, 'lib'), 'node_modules', NAMECHAIN];

const resolve = (p) => [
  p.replace(/^@ensdomains\/contracts-v2\//, join(NAMECHAIN, 'src') + '/'),
  join(here, p), p, ...roots.map((r) => join(r, p)),
].find(existsSync) ?? null;

const input = {
  language: 'Solidity',
  sources: { 'EngramRegistrar.sol': { content: readFileSync(join(here, 'EngramRegistrar.sol'), 'utf8') } },
  settings: { viaIR: true, optimizer: { enabled: true, runs: 200 }, outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } },
};
const out = JSON.parse(solc.compile(JSON.stringify(input), {
  import: (p) => { const f = resolve(p); return f ? { contents: readFileSync(f, 'utf8') } : { error: `not found: ${p}` }; },
}));
const errors = (out.errors ?? []).filter((e) => e.severity === 'error');
for (const e of out.errors ?? []) console.error(`[${e.severity}] ${e.formattedMessage?.split('\n')[0] ?? e.message}`);
if (errors.length) process.exit(1);
const c = out.contracts?.['EngramRegistrar.sol']?.EngramRegistrar;
if (!c) { console.error('EngramRegistrar did not come out of the compiler'); process.exit(1); }
console.log(`EngramRegistrar — ${c.evm.bytecode.object.length / 2} bytes of bytecode, ${c.abi.length} ABI entries (solc ${solc.version()})`);
