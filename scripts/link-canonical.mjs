#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync, renameSync, realpathSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { Contract, JsonRpcProvider, FetchRequest, Wallet, ZeroHash, randomBytes, hexlify, keccak256, toUtf8Bytes, dnsEncode, namehash, formatEther } from 'ethers';
import { verifyTextPermissions } from './eac-proof.mjs';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pin = '97a57293f3b4279d94b571e678edb53ce62638f4';
const canonicalAddress = '0xeeeeeeee14d718c2b47d9923deab1335e144eeee';
const args = process.argv.slice(2);
const options = {};
for (let index = 0; index < args.length; index++) {
  const argument = args[index];
  if (['--check', '--send'].includes(argument)) options[argument] = true;
  else if (['--env-file', '--source-evidence'].includes(argument)) {
    if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`${argument} requires a path`);
    options[argument] = args[++index];
  } else throw new Error(`Unknown argument: ${argument}`);
}
if (options['--env-file']) process.loadEnvFile(resolve(options['--env-file']));
const env = process.env;
const serialize = value => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item, 2) + '\n';
function requireThat(condition, message) { if (!condition) throw new Error(message); }
const same = (left, right) => left.toLowerCase() === right.toLowerCase();
let provider;
let journal;
let proof;
let journalPath;
let proofPath;
function save() {
  writeFileSync(`${journalPath}.tmp`, serialize(journal), { mode: 0o600 });
  chmodSync(`${journalPath}.tmp`, 0o600);
  renameSync(`${journalPath}.tmp`, journalPath);
  writeFileSync(`${proofPath}.tmp`, serialize(proof));
  renameSync(`${proofPath}.tmp`, proofPath);
}
async function main() {
  const sourcePath = resolve(project, options['--source-evidence'] ?? 'evidence/ainize-4782c76e-patch.json');
  const sourceRaw = readFileSync(sourcePath, 'utf8');
  const source = JSON.parse(sourceRaw);
  requireThat(source.status === 'complete', 'Original deployment must finish before canonical linking');
  requireThat(source.configuration.registerRoot === true && source.globalRoot?.registered === true, 'Expected completed original root registration');
  const labels = source.configuration.fullName.split('.');
  requireThat(labels.length === 3 && labels[2] === 'eth' && labels.slice(0, 2).every(label => /^[a-z0-9][a-z0-9-]{0,62}$/.test(label)), 'Invalid source name');
  const [childLabel, rootLabel] = labels;
  const { registry: registryAddress, resolver: resolverAddress } = source.addresses;
  const artifacts = {};
  await Promise.all(['RootRegistry', 'ETHRegistry', 'ETHRegistrar', 'MockUSDC', 'UniversalResolverV2'].map(async name => {
    const url = `https://raw.githubusercontent.com/ensdomains/contracts-v2/${pin}/contracts/deployments/sepolia/${name}.json`;
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    requireThat(response.ok, `Official pinned ${name} artifact unavailable`);
    const raw = await response.text();
    const artifact = JSON.parse(raw);
    requireThat(Array.isArray(artifact.abi) && /^0x[\da-f]{40}$/i.test(artifact.address), `Invalid ${name} artifact`);
    artifacts[name] = { ...artifact, sourceURL: url, artifactHash: keccak256(toUtf8Bytes(raw)) };
  }));
  const localArtifact = name => JSON.parse(readFileSync(join(project, 'namechain/contracts/deployments/sepolia', `${name}.json`), 'utf8'));
  const request = new FetchRequest(env.SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com');
  request.timeout = 30_000;
  provider = new JsonRpcProvider(request, undefined, { cacheTimeout: -1 });
  requireThat(BigInt(await provider.send('eth_chainId', [])) === 11155111n, 'Refusing non-Sepolia chain');
  const canonical = new Contract(canonicalAddress, artifacts.UniversalResolverV2.abi, provider);
  const canonicalRoot = await canonical.ROOT_REGISTRY();
  requireThat(same(canonicalRoot, artifacts.RootRegistry.address), 'Canonical proxy ROOT_REGISTRY differs from pinned official deployment; refusing writes');
  const oldRoot = new Contract(canonicalRoot, artifacts.RootRegistry.abi, provider);
  const ethAddress = await oldRoot.getSubregistry('eth');
  requireThat(same(ethAddress, artifacts.ETHRegistry.address), 'Canonical root eth subregistry mismatch');
  const registrar = new Contract(artifacts.ETHRegistrar.address, artifacts.ETHRegistrar.abi, provider);
  requireThat(same(await registrar.ETH_REGISTRY(), ethAddress), 'Official registrar ETH_REGISTRY mismatch');
  const ethRegistry = new Contract(ethAddress, artifacts.ETHRegistry.abi, provider);
  const registry = new Contract(registryAddress, localArtifact('UserRegistryImpl').abi, provider);
  const resolver = new Contract(resolverAddress, localArtifact('PermissionedResolverImpl').abi, provider);
  requireThat(same(await registry.findOwner(childLabel), source.configuration.owner) && same(await registry.getResolver(childLabel), resolverAddress), 'Existing child owner/resolver mismatch');
  const codeProof = {};
  for (const [name, address] of Object.entries({ canonicalProxy: canonicalAddress, registry: registryAddress, resolver: resolverAddress, ...Object.fromEntries(Object.entries(artifacts).map(([name, artifact]) => [name, artifact.address])) })) {
    const code = await provider.getCode(address);
    requireThat(code !== '0x', `${name} has no live code`);
    codeProof[name] = { address, runtimeCodeHash: keccak256(code) };
  }
  const viemDirectory = env.VIEM_MODULE_DIR ?? [join(project, '../ainize-cli/node_modules/viem'), join(project, '../cli/node_modules/viem'), join(project, 'node_modules/viem')].find(path => existsSync(join(path, 'package.json')));
  requireThat(viemDirectory, 'Modern viem required: set VIEM_MODULE_DIR to its package directory');
  const requireViem = createRequire(join(resolve(viemDirectory), 'package.json'));
  const { createPublicClient, http } = requireViem('viem');
  const { sepolia } = requireViem('viem/chains');
  const viemVersion = JSON.parse(readFileSync(join(viemDirectory, 'package.json'), 'utf8')).version;
  requireThat(same(sepolia.contracts.ensUniversalResolver.address, canonicalAddress), 'Installed viem does not select the canonical proxy by default');
  const client = createPublicClient({ chain: sepolia, transport: http(request.url) });
  const node = namehash(source.configuration.fullName);
  for (const [key, value] of Object.entries(source.records)) requireThat(await resolver.text(node, key) === value, `Existing ${key} record differs from original evidence`);
  const duration = BigInt(source.configuration.duration);
  requireThat(duration >= await registrar.MIN_REGISTER_DURATION() && duration <= 31536000n, 'Unsupported registration duration');
  const available = await registrar.isAvailable(rootLabel);
  const currentOwner = await ethRegistry.findOwner(rootLabel);
  requireThat(available || same(currentOwner, source.configuration.owner), 'Canonical name already belongs to another owner');
  const [base, premium] = available ? await registrar.getRegisterPrice(rootLabel, duration, artifacts.MockUSDC.address) : [0n, 0n];
  requireThat(premium === 0n, 'Refusing premium registration');
  const block = await provider.getBlock('latest');
  const preflight = { chainId: 11155111, block: block.number, blockHash: block.hash, originalEvidenceHash: keccak256(toUtf8Bytes(sourceRaw)), originalRoot: source.preflight.artifacts.RootRegistry.address, canonicalRoot, canonicalETHRegistry: ethAddress, canonicalProxy: canonicalAddress, officialArtifactsCommit: pin, officialArtifacts: Object.fromEntries(Object.entries(artifacts).map(([name, artifact]) => [name, { address: artifact.address, url: artifact.sourceURL, hash: artifact.artifactHash }])), codeProof, name: source.configuration.fullName, available, priceMockUSDC: base, premium, viemVersion, viemDefaultResolver: sepolia.contracts.ensUniversalResolver.address, transactionsSent: 0 };
  console.log(serialize(preflight));
  if (!options['--send'] || options['--check']) return;
  requireThat(env.SEPOLIA_PRIVATE_KEY, 'SEPOLIA_PRIVATE_KEY missing');
  const wallet = new Wallet(env.SEPOLIA_PRIVATE_KEY, provider);
  requireThat(same(wallet.address, source.configuration.owner), 'Wallet differs from original deployment owner');
  requireThat(await provider.getBalance(wallet.address) > 0n, 'Wallet has no Sepolia ETH');
  const privateDir = join(project, 'evidence/private');
  journalPath = join(privateDir, `${rootLabel}-${childLabel}-canonical.json`);
  proofPath = join(project, 'evidence', `${rootLabel}-${childLabel}-canonical.json`);
  requireThat(execFileSync('git', ['check-ignore', '--', journalPath], { cwd: project, encoding: 'utf8' }).trim(), 'Private journal must be git ignored');
  mkdirSync(privateDir, { recursive: true, mode: 0o700 });
  requireThat(realpathSync(privateDir) === privateDir, 'Private directory must not be a symlink');
  chmodSync(privateDir, 0o700);
  const configuration = { owner: wallet.address, name: source.configuration.fullName, duration: String(duration), registry: registryAddress, resolver: resolverAddress, canonicalRoot, canonicalETHRegistry: ethAddress, registrar: artifacts.ETHRegistrar.address, token: artifacts.MockUSDC.address, officialArtifactsCommit: pin, originalEvidenceHash: preflight.originalEvidenceHash };
  if (existsSync(journalPath)) {
    journal = JSON.parse(readFileSync(journalPath, 'utf8'));
    requireThat(serialize(journal.configuration) === serialize(configuration), 'Canonical journal configuration mismatch');
    proof = JSON.parse(readFileSync(proofPath, 'utf8'));
  } else {
    journal = { configuration, secret: hexlify(randomBytes(32)), transactions: {} };
    proof = { configuration, preflight, status: 'in-progress', note: 'Additional registration under the canonical ENSv2 root; original deployment history is unchanged. No training mint.', transactions: [] };
    save();
  }
  async function send(step, action) {
    requireThat(BigInt(await provider.send('eth_chainId', [])) === 11155111n && same(await canonical.ROOT_REGISTRY(), canonicalRoot), 'Chain/canonical root changed; refusing transaction');
    if (!journal.transactions[step]) {
      const [latest, pending] = await Promise.all([provider.getTransactionCount(wallet.address, 'latest'), provider.getTransactionCount(wallet.address, 'pending')]);
      requireThat(latest === pending, 'Wallet has pending transactions; wait for original deployment/other writer to finish');
      const transaction = await action();
      journal.transactions[step] = transaction.hash;
      save();
      console.log(`${step}: https://sepolia.etherscan.io/tx/${transaction.hash}`);
    }
    const receipt = await provider.waitForTransaction(journal.transactions[step], 1, 180_000);
    requireThat(receipt?.status === 1, `${step} reverted or timed out; inspect journal before retrying`);
    if (!proof.transactions.some(item => item.hash === receipt.hash)) proof.transactions.push({ step, hash: receipt.hash, url: `https://sepolia.etherscan.io/tx/${receipt.hash}`, blockNumber: receipt.blockNumber, blockHash: receipt.blockHash, status: receipt.status, from: receipt.from, to: receipt.to, gasUsed: receipt.gasUsed, fee: receipt.fee, logs: receipt.logs.map(log => ({ address: log.address, topics: log.topics, data: log.data })) });
    save();
  }
  const writer = registrar.connect(wallet);
  const token = new Contract(artifacts.MockUSDC.address, artifacts.MockUSDC.abi, wallet);
  if (available || journal.transactions['register-canonical-root']) {
    const commitment = await registrar.makeCommitment(rootLabel, wallet.address, journal.secret, registryAddress, resolverAddress, duration, ZeroHash);
    await send('commit-canonical-root', () => writer.commit(commitment));
    if (!journal.transactions['register-canonical-root']) {
      const committedAt = await registrar.commitmentAt(commitment);
      const minimum = await registrar.MIN_COMMITMENT_AGE();
      const maximum = await registrar.MAX_COMMITMENT_AGE();
      while (true) {
        const now = BigInt((await provider.getBlock('latest')).timestamp);
        requireThat(now < committedAt + maximum, 'Canonical commitment expired');
        if (now > committedAt + minimum) break;
        console.log(`Waiting ${committedAt + minimum + 1n - now}s for canonical commitment`);
        await delay(12_000);
      }
      const [price, currentPremium] = await registrar.getRegisterPrice(rootLabel, duration, artifacts.MockUSDC.address);
      requireThat(currentPremium === 0n, 'Premium changed; refusing registration');
      const balance = await token.balanceOf(wallet.address);
      if (balance < price) await send('mint-canonical-mock-usdc', () => token.mint(wallet.address, price - balance));
      if (await token.allowance(wallet.address, artifacts.ETHRegistrar.address) < price) await send('approve-canonical-mock-usdc', () => token.approve(artifacts.ETHRegistrar.address, price));
    }
    await send('register-canonical-root', () => writer.register(rootLabel, wallet.address, journal.secret, registryAddress, resolverAddress, duration, artifacts.MockUSDC.address, ZeroHash));
  }
  requireThat(same(await ethRegistry.findOwner(rootLabel), wallet.address) && same(await ethRegistry.getSubregistry(rootLabel), registryAddress), 'Canonical registration owner/subregistry readback mismatch');
  const [parent, parentLabel] = await registry.getParent();
  if (!same(parent, ethAddress) || parentLabel !== rootLabel) await send('set-canonical-parent', () => registry.connect(wallet).setParent(ethAddress, rootLabel));
  proof.records = {};
  for (const [key, expected] of Object.entries(source.records)) {
    const [encoded, resolvedBy] = await canonical.resolve(dnsEncode(source.configuration.fullName), resolver.interface.encodeFunctionData('text', [node, key]));
    requireThat(same(resolvedBy, resolverAddress) && resolver.interface.decodeFunctionResult('text', encoded)[0] === expected, `Canonical proxy ${key} mismatch`);
    const value = await client.getEnsText({ name: source.configuration.fullName, key });
    requireThat(value === expected, `Default viem getEnsText ${key} mismatch`);
    proof.records[key] = value;
  }
  const finalBlock = await provider.getBlock('latest');
  proof.eac = await verifyTextPermissions(resolver.connect(wallet), node, wallet.address, source.records['ainize.node'], source.records['ainize.patch'], finalBlock.number);
  proof.canonicalResolution = { verified: true, method: 'viem.createPublicClient({chain:sepolia,transport:http(rpc)}).getEnsText({name,key})', addressOverride: false, viemVersion, block: finalBlock.number, blockHash: finalBlock.hash, canonicalProxy: canonicalAddress, canonicalRoot, canonicalETHRegistry: ethAddress, resolver: resolverAddress };
  proof.status = 'complete';
  delete proof.failure;
  proof.completedAt = new Date().toISOString();
  save();
  console.log(serialize({ status: 'complete', proof: proofPath, name: source.configuration.fullName, canonicalResolutionVerified: true, trainingMintPerformed: false, remainingSepoliaETH: formatEther(await provider.getBalance(wallet.address)) }));
}
try { await main(); }
catch (error) {
  const message = error.code ? `Operation failed: ${error.code}; ${error.revert?.name ?? 'inspect confirmed receipts and configuration'}` : error.message;
  const safe = String(message).replace(/0x[\da-fA-F]{64}/g, '[redacted]').replace(/https?:\/\/\S+/g, '[URL]');
  if (proof && journal) { proof.status = 'incomplete'; proof.failure = safe; save(); }
  console.error(`ERROR: ${safe}`);
  process.exitCode = 1;
} finally { provider?.destroy(); }
