#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, mkdirSync, realpathSync, renameSync, chmodSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { Contract, ContractFactory, Interface, JsonRpcProvider, Wallet, FetchRequest, ZeroAddress, ZeroHash, dnsEncode, namehash, randomBytes, hexlify, keccak256, formatEther } from 'ethers';
import { verifyTextPermissions } from './eac-proof.mjs';
import { simulateIntegration } from './simulate-integration.mjs';
import { loadDatasetEvidence } from './dataset-evidence.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pin = '48b3e2d39513b9dd32ef1850877a29009bc807b9';
const args = process.argv.slice(2);
const check = args.includes('--check');
const envIndex = args.indexOf('--env-file');
const allowedArgs = new Set(['--check', '--register-root', '--env-file', '--dataset-evidence']);
for (let index = 0; index < args.length; index++) {
  if (['--env-file', '--dataset-evidence'].includes(args[index])) {
    if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`${args[index]} requires a path`);
    index++; continue;
  }
  if (!allowedArgs.has(args[index])) throw new Error(`Unknown argument: ${args[index]}`);
}
if (envIndex >= 0) {
  if (!args[envIndex + 1]) throw new Error('--env-file requires a path');
  process.loadEnvFile(resolve(args[envIndex + 1]));
}
const env = process.env;
const json = value => JSON.stringify(value, (_, entry) => typeof entry === 'bigint' ? entry.toString() : entry, 2) + '\n';
const readJSON = path => JSON.parse(readFileSync(path, 'utf8'));
function requireThat(condition, message) { if (!condition) throw new Error(message); }
function git(...parameters) { return execFileSync('git', parameters, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
function publicURL(value, label) {
  const url = new URL(value);
  requireThat(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash, `${label} must be a public HTTPS URL without credentials, query, or fragment`);
  return url.toString().replace(/\/$/, '');
}
let provider;
let evidence;
let evidencePath;
let state;
let statePath;
function persist() {
  if (statePath) {
    writeFileSync(`${statePath}.tmp`, json(state), { mode: 0o600 });
    chmodSync(`${statePath}.tmp`, 0o600);
    renameSync(`${statePath}.tmp`, statePath);
  }
  if (evidencePath) {
    writeFileSync(`${evidencePath}.tmp`, json(evidence));
    renameSync(`${evidencePath}.tmp`, evidencePath);
  }
}
async function main() {
  const datasetIndex = args.indexOf('--dataset-evidence');
  const datasetPath = datasetIndex >= 0 ? args[datasetIndex + 1] : env.GRAPH_DATASET_EVIDENCE;
  const datasetEvidence = datasetPath ? loadDatasetEvidence(datasetPath) : null;
  const upstream = realpathSync(resolve(root, env.NAMECHAIN ?? 'namechain/contracts'));
  const upstreamRepo = dirname(upstream);
  requireThat(execFileSync('git', ['-C', upstreamRepo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() === pin, `Upstream must be pinned to ${pin}`);
  const deploymentDir = realpathSync(join(upstream, 'deployments/sepolia'));
  requireThat(deploymentDir.startsWith(`${upstream}/`), 'Deployment directory escapes upstream contracts');
  const names = ['VerifiableFactory', 'UserRegistryImpl', 'PermissionedResolverImpl', 'ETHRegistrar', 'ETHRegistry', 'RootRegistry', 'MockUSDC', 'UniversalResolverV2'];
  const artifacts = {};
  for (const name of names) {
    const path = realpathSync(join(deploymentDir, `${name}.json`));
    requireThat(dirname(path) === deploymentDir, `${name} artifact escapes deployment directory`);
    const raw = readFileSync(path, 'utf8');
    const pinned = execFileSync('git', ['-C', upstreamRepo, 'show', `${pin}:contracts/deployments/sepolia/${name}.json`], { encoding: 'utf8', maxBuffer: 20_000_000 });
    requireThat(raw === pinned, `${name} artifact differs from pinned upstream`);
    artifacts[name] = JSON.parse(raw);
    requireThat(Array.isArray(artifacts[name].abi) && /^0x[\da-fA-F]{40}$/.test(artifacts[name].address), `${name} artifact malformed`);
  }
  const localPath = realpathSync(join(root, 'artifacts/EngramRegistrar.json'));
  requireThat(dirname(localPath) === realpathSync(join(root, 'artifacts')), 'Registrar artifact escapes artifacts directory');
  const registrarArtifact = readJSON(localPath);
  requireThat(/^0x[\da-fA-F]+$/.test(registrarArtifact.bytecode), 'Missing compiled registrar bytecode: owner must run npm run build');
  const mint = registrarArtifact.abi.find(entry => entry.type === 'function' && entry.name === 'mint');
  for (const field of ['recipient', 'resolver', 'duration']) requireThat(mint?.inputs[0]?.components?.some(entry => entry.name === field), `Stale registrar ABI: missing signed ${field}; rebuild`);
  const solc = (await import('solc')).default;
  const source = readFileSync(join(root, 'contracts/EngramRegistrar.sol'), 'utf8');
  const compilation = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources: { 'EngramRegistrar.sol': { content: source } }, settings: { viaIR: true, evmVersion: 'shanghai', optimizer: { enabled: true, runs: 200 }, outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } } }), { import: path => {
    const candidates = [path.replace(/^@ensdomains\/contracts-v2\//, `${upstream}/src/`), join(root, 'contracts', path), join(root, path), ...[join(upstream, 'src'), join(upstream, 'lib'), join(root, 'node_modules'), upstream].map(base => join(base, path))];
    const found = candidates.find(existsSync);
    return found ? { contents: readFileSync(found, 'utf8') } : { error: `Import unavailable: ${path}` };
  } }));
  const compiled = compilation.contracts?.['EngramRegistrar.sol']?.EngramRegistrar;
  requireThat(compiled && !compilation.errors?.some(entry => entry.severity === 'error'), 'In-memory registrar compilation failed; ask contract owner to rebuild');
  requireThat(`0x${compiled.evm.bytecode.object}` === registrarArtifact.bytecode && json(compiled.abi) === json(registrarArtifact.abi), 'Registrar artifact differs from current source/compiler: owner must run npm run build');
  const request = new FetchRequest(env.SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com');
  request.timeout = 30_000;
  provider = new JsonRpcProvider(request, undefined, { cacheTimeout: -1 });
  requireThat(BigInt(await provider.send('eth_chainId', [])) === 11155111n, 'Refusing non-Sepolia chain (expected 11155111)');
  const block = await provider.getBlock('latest');
  const deployed = {};
  for (const name of names) {
    const artifact = artifacts[name];
    const code = await provider.getCode(artifact.address, block.number);
    requireThat(code !== '0x', `${name} has no deployed code`);
    deployed[name] = { address: artifact.address, runtimeCodeHash: keccak256(code), bytes: (code.length - 2) / 2 };
  }
  const contract = (name, runner = provider) => new Contract(artifacts[name].address, artifacts[name].abi, runner);
  requireThat((await contract('ETHRegistrar').ETH_REGISTRY()).toLowerCase() === artifacts.ETHRegistry.address.toLowerCase(), 'ETHRegistrar points to unexpected ETHRegistry');
  requireThat((await contract('RootRegistry').getSubregistry('eth')).toLowerCase() === artifacts.ETHRegistry.address.toLowerCase(), 'RootRegistry eth link mismatch');
  requireThat((await contract('UniversalResolverV2').ROOT_REGISTRY()).toLowerCase() === artifacts.RootRegistry.address.toLowerCase(), 'UniversalResolver root mismatch');
  const factoryLogic = await contract('VerifiableFactory').proxyLogic();
  requireThat(await provider.getCode(factoryLogic) !== '0x', 'Factory proxy logic has no code');
  const wallet = env.SEPOLIA_PRIVATE_KEY ? new Wallet(env.SEPOLIA_PRIVATE_KEY, provider) : null;
  const balance = wallet ? await provider.getBalance(wallet.address) : null;
  const preflight = { mode: 'read-only-live-preflight', chainId: 11155111, block: block.number, blockHash: block.hash, upstreamCommit: pin, artifacts: deployed, registrarBytecodeHash: keccak256(registrarArtifact.bytecode), signedMintTargetFields: true, wallet: wallet?.address ?? null, balanceETH: balance === null ? null : formatEther(balance), transactionsSent: 0 };
  preflight.integrationSimulation = await simulateIntegration(provider, artifacts, registrarArtifact.bytecode, block.number);
  if (datasetEvidence) preflight.graphDataset = datasetEvidence;
  console.log(json(preflight));
  if (check) return;
  requireThat(wallet, 'SEPOLIA_PRIVATE_KEY missing; add it to the private env file, then pass --env-file PATH. No transactions sent.');
  requireThat(balance > 0n, `Sepolia wallet ${wallet.address} has zero ETH; faucet funding required. No transactions sent.`);
  const patchID = env.AINIZE_PATCH_ID;
  requireThat(patchID && /^[a-zA-Z0-9_-]+$/.test(patchID), 'AINIZE_PATCH_ID must identify a real public catalogue patch');
  requireThat(env.AINIZE_NODE_URL, 'AINIZE_NODE_URL required');
  const nodeURL = publicURL(env.AINIZE_NODE_URL, 'AINIZE_NODE_URL');
  if (datasetEvidence) requireThat(datasetEvidence.nodeURL === nodeURL, 'Graph dataset upload node differs from AINIZE_NODE_URL');
  const catalogueURL = publicURL(env.AINIZE_CATALOG_URL ?? `${nodeURL}/api/catalog`, 'AINIZE_CATALOG_URL');
  const response = await fetch(catalogueURL, { signal: AbortSignal.timeout(30_000) });
  requireThat(response.ok, `Catalogue HTTP ${response.status}`);
  const catalogue = await response.json();
  const item = catalogue.items?.find(entry => entry.anchor?.id === patchID);
  requireThat(item, 'AINIZE_PATCH_ID not found in live catalogue');
  const patchHash = item.anchor.patch_sha256;
  requireThat(/^[\da-f]{64}$/i.test(patchHash), 'Catalogue patch SHA256 is invalid');
  if (env.AINIZE_PATCH_SHA256) requireThat(env.AINIZE_PATCH_SHA256.replace(/^0x/, '').toLowerCase() === patchHash.toLowerCase(), 'Catalogue patch SHA256 does not match expected hash');
  const registerRoot = args.includes('--register-root') || env.ENS_REGISTER_ROOT === '1';
  const rootLabel = env.ENS_ROOT_LABEL ?? `ainize-${wallet.address.slice(2, 10).toLowerCase()}`;
  const childLabel = env.ENS_CHILD_LABEL ?? 'patch';
  for (const label of [rootLabel, childLabel]) requireThat(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label), 'Labels must be lowercase ASCII DNS labels of 1–63 characters');
  const fullName = `${childLabel}.${rootLabel}.eth`;
  const duration = BigInt(env.ENS_DURATION ?? '31536000');
  requireThat(duration > 0n && duration <= 31536000n, 'ENS_DURATION must be 1..31536000 seconds');
  const quorum = BigInt(env.ENGRAM_QUORUM ?? '2');
  const minBench = Number(env.ENGRAM_MIN_BENCH ?? '8000');
  requireThat(quorum > 0n && Number.isInteger(minBench) && minBench >= 0 && minBench <= 10000, 'Invalid registrar quorum/minimum benchmark');
  const privateDir = join(root, 'evidence/private');
  const runID = `${rootLabel}-${childLabel}`;
  statePath = join(privateDir, `${runID}.json`);
  evidencePath = join(root, 'evidence', `${runID}.json`);
  requireThat(git('check-ignore', '--', statePath) !== '', 'evidence/private must be git-ignored before deployment');
  mkdirSync(privateDir, { recursive: true, mode: 0o700 });
  requireThat(realpathSync(privateDir) === privateDir, 'Private evidence directory must not be a symlink');
  chmodSync(privateDir, 0o700);
  const configuration = { owner: wallet.address, fullName, registerRoot, duration: duration.toString(), patchID, patchHash, nodeURL, catalogueURL, datasetEvidence, quorum: quorum.toString(), minBench, registrarBytecodeHash: preflight.registrarBytecodeHash, upstreamCommit: pin };
  if (existsSync(statePath)) {
    state = readJSON(statePath);
    requireThat(json(state.configuration) === json(configuration), 'Existing deployment journal configuration differs; use its original configuration or a new ENS_ROOT_LABEL');
    evidence = readJSON(evidencePath);
  } else {
    state = { configuration, secret: hexlify(randomBytes(32)), salts: {}, addresses: {}, transactions: {} };
    evidence = { configuration, preflight, status: 'in-progress', trainingMint: { performed: false, reason: 'Operator namespace registration only; no training signatures fabricated, no verifier enrolled, no lineage anchored. Catalogue patch is prior work; this integration does not claim Graph training.' }, catalogue: { url: catalogueURL, observedAt: new Date().toISOString(), patchID, patchHash, status: item.status, quorumOK: item.quorum_ok, sellable: item.sellable }, addresses: {}, transactions: [] };
    persist();
  }
  async function transaction(label, send) {
    requireThat(BigInt(await provider.send('eth_chainId', [])) === 11155111n, 'Chain changed: refusing transaction');
    if (!state.transactions[label]) {
      const tx = await send();
      state.transactions[label] = tx.hash;
      persist();
      console.log(`${label}: https://sepolia.etherscan.io/tx/${tx.hash}`);
    }
    const hash = state.transactions[label];
    const receipt = await provider.waitForTransaction(hash, 1, 180_000);
    requireThat(receipt?.status === 1, `${label} failed or confirmation timed out; resume using the same configuration`);
    const logs = receipt.logs.map(log => {
      if (log.address.toLowerCase() === artifacts.VerifiableFactory.address.toLowerCase()) {
        const decoded = new Interface(artifacts.VerifiableFactory.abi).parseLog(log);
        if (decoded?.name === 'ProxyDeployed') return { address: log.address, event: decoded.name, sender: decoded.args.sender, proxyAddress: decoded.args.proxyAddress, implementation: decoded.args.implementation, omittedFields: ['salt'] };
      }
      return { address: log.address, topics: log.topics, data: log.data };
    });
    if (!evidence.transactions.some(entry => entry.hash === hash)) evidence.transactions.push({ step: label, hash, url: `https://sepolia.etherscan.io/tx/${hash}`, blockNumber: receipt.blockNumber, blockHash: receipt.blockHash, status: receipt.status, from: receipt.from, to: receipt.to, contractAddress: receipt.contractAddress, gasUsed: receipt.gasUsed, fee: receipt.fee, logs });
    persist();
    return receipt;
  }
  const registrarRole = 1n;
  const parentRole = 1n << 8n;
  const registryRoles = registrarRole | (registrarRole << 128n) | parentRole;
  const textRole = 1n << 4n;
  const factory = contract('VerifiableFactory', wallet);
  async function proxy(label, implementationName, initArgs) {
    const artifact = artifacts[implementationName];
    const data = new Interface(artifact.abi).encodeFunctionData('initialize', initArgs);
    state.salts[label] ??= hexlify(randomBytes(32));
    persist();
    if (!state.addresses[label]) {
      state.addresses[label] = await factory.deployProxy.staticCall(artifact.address, BigInt(state.salts[label]), data);
      persist();
    }
    await transaction(`deploy-${label}`, () => factory.deployProxy(artifact.address, BigInt(state.salts[label]), data));
    const address = state.addresses[label];
    requireThat(await provider.getCode(address) !== '0x', `${label} proxy has no code`);
    requireThat((await factory.verifyContract(address)).toLowerCase() === artifact.address.toLowerCase(), `${label} factory implementation verification failed`);
    evidence.addresses[label] = address;
    persist();
    return new Contract(address, artifact.abi, wallet);
  }
  const registry = await proxy('registry', 'UserRegistryImpl', [wallet.address, registryRoles]);
  const resolver = await proxy('resolver', 'PermissionedResolverImpl', [wallet.address, textRole << 128n, []]);
  const registrarReceipt = await transaction('deploy-engram-registrar', async () => (await new ContractFactory(registrarArtifact.abi, registrarArtifact.bytecode, wallet).deploy(await registry.getAddress(), quorum, minBench)).deploymentTransaction());
  const registrarAddress = registrarReceipt.contractAddress;
  requireThat(registrarAddress && await provider.getCode(registrarAddress) !== '0x', 'EngramRegistrar deployment missing');
  evidence.addresses.engramRegistrar = registrarAddress;
  const engram = new Contract(registrarAddress, registrarArtifact.abi, provider);
  requireThat((await engram.REGISTRY()).toLowerCase() === (await registry.getAddress()).toLowerCase() && (await engram.OWNER()) === wallet.address && await engram.QUORUM() === quorum && await engram.MIN_BENCH() === BigInt(minBench), 'Registrar deployment configuration mismatch');
  await transaction('grant-registrar-role', () => registry.grantRootRoles(registrarRole, registrarAddress));
  requireThat(await registry.hasRootRoles(registrarRole, registrarAddress), 'ROLE_REGISTRAR grant not effective');
  const ethRegistrar = contract('ETHRegistrar', wallet);
  if (registerRoot) {
    requireThat(duration >= await ethRegistrar.MIN_REGISTER_DURATION(), 'Duration below registrar minimum');
    const ethRegistry = contract('ETHRegistry');
    const rootName = `${rootLabel}.eth`;
    if (!state.transactions['register-root']) {
      requireThat(await ethRegistrar.isAvailable(rootLabel), `${rootName} unavailable; choose another ENS_ROOT_LABEL`);
      const commitment = await ethRegistrar.makeCommitment(rootLabel, wallet.address, state.secret, await registry.getAddress(), await resolver.getAddress(), duration, ZeroHash);
      await transaction('commit-root', () => ethRegistrar.commit(commitment));
      const committedAt = await ethRegistrar.commitmentAt(commitment);
      const minimum = await ethRegistrar.MIN_COMMITMENT_AGE();
      const maximum = await ethRegistrar.MAX_COMMITMENT_AGE();
      while (true) {
        const latest = await provider.getBlock('latest');
        requireThat(BigInt(latest.timestamp) < committedAt + maximum, 'Commitment expired; select a new ENS_ROOT_LABEL for a fresh run');
        const remaining = committedAt + minimum + 1n - BigInt(latest.timestamp);
        if (remaining <= 0n) break;
        console.log(`Waiting for commitment age: ${remaining}s (chain timestamp)`);
        await delay(12_000);
      }
      const token = contract('MockUSDC', wallet);
      const [base, premium] = await ethRegistrar.getRegisterPrice(rootLabel, duration, await token.getAddress());
      const amount = base + premium;
      requireThat(premium === 0n, 'Refusing premium name; choose a fresh ENS_ROOT_LABEL');
      const tokenBalance = await token.balanceOf(wallet.address);
      if (tokenBalance < amount) await transaction('mint-mock-usdc', () => token.mint(wallet.address, amount - tokenBalance));
      const spender = await ethRegistrar.getAddress();
      if (await token.allowance(wallet.address, spender) < amount) await transaction('approve-mock-usdc', () => token.approve(spender, amount));
    }
    await transaction('register-root', async () => ethRegistrar.register(rootLabel, wallet.address, state.secret, await registry.getAddress(), await resolver.getAddress(), duration, artifacts.MockUSDC.address, ZeroHash));
    requireThat((await ethRegistry.findOwner(rootLabel)) === wallet.address && (await ethRegistry.getSubregistry(rootLabel)).toLowerCase() === (await registry.getAddress()).toLowerCase(), 'Global root registration readback mismatch');
    await transaction('set-registry-parent', () => registry.setParent(artifacts.ETHRegistry.address, rootLabel));
    evidence.globalRoot = { name: rootName, owner: await ethRegistry.findOwner(rootLabel), subregistry: await ethRegistry.getSubregistry(rootLabel), expiry: await ethRegistry.findExpiry(rootLabel), registered: true };
  } else evidence.globalRoot = { registered: false, reason: 'Pass --register-root or ENS_REGISTER_ROOT=1 to link into the deployed ENSv2 root' };
  const nameRoles = (1n << 20n) | (1n << 24n) | (1n << 148n) | (1n << 152n) | (1n << 156n);
  if (!state.childExpiry) { state.childExpiry = String(BigInt((await provider.getBlock('latest')).timestamp) + duration); persist(); }
  await transaction('operator-register-child', async () => registry.register(childLabel, wallet.address, ZeroAddress, await resolver.getAddress(), nameRoles, BigInt(state.childExpiry)));
  requireThat(await registry.findOwner(childLabel) === wallet.address && (await registry.getResolver(childLabel)).toLowerCase() === (await resolver.getAddress()).toLowerCase(), 'Child registration readback mismatch');
  const node = namehash(fullName);
  const records = {
    'ainize.node': nodeURL,
    'ainize.patch': patchID,
    'ainize.patch.sha256': patchHash,
    'ainize.patch.status': String(item.status ?? 'UNKNOWN'),
    'ainize.provenance': `Existing Ainize catalogue patch; catalogue status ${item.status ?? 'UNKNOWN'}; operator registration only; no EngramRegistrar training mint; no Graph-trained model claim.`,
  };
  if (datasetEvidence) Object.assign(records, { 'ainize.dataset': datasetEvidence.datasetID, 'ainize.dataset.sha256': datasetEvidence.sha256, 'ainize.graph.block': datasetEvidence.graphBlock });
  const recordCalls = Object.entries(records).flatMap(([key, value]) => [
    resolver.interface.encodeFunctionData('authorizeTextRoles', [dnsEncode(fullName), key, wallet.address, true]),
    resolver.interface.encodeFunctionData('setText', [node, key, value]),
  ]);
  await transaction('authorize-and-write-records', () => resolver.multicall(recordCalls));
  for (const [key, value] of Object.entries(records)) {
    requireThat(await resolver.text(node, key) === value, `${key} readback mismatch`);
  }
  await transaction('revoke-patch-write', () => resolver.authorizeTextRoles(dnsEncode(fullName), 'ainize.patch', wallet.address, false));
  const proofBlock = await provider.getBlock('latest');
  const refused = await verifyTextPermissions(resolver, node, wallet.address, nodeURL, patchID, proofBlock.number);
  evidence.eac = { block: proofBlock.number, blockHash: proofBlock.hash, from: wallet.address, resolver: await resolver.getAddress(), name: fullName, namehash: node, allowed: { key: 'ainize.node', method: 'setText.staticCall', result: 'success' }, refused: { key: 'ainize.patch', method: 'setText.staticCall', ...refused }, note: 'Same account retains text admin and can explicitly reauthorize itself; admin alone does not confer text write. Static calls do not persist changes.' };
  evidence.records = {};
  for (const key of Object.keys(records)) {
    const direct = await resolver.text(node, key);
    if (registerRoot) {
      const [result, resolvedBy] = await contract('UniversalResolverV2').resolve(dnsEncode(fullName), resolver.interface.encodeFunctionData('text', [node, key]));
      requireThat(resolvedBy.toLowerCase() === (await resolver.getAddress()).toLowerCase(), 'Universal resolver returned unexpected resolver');
      requireThat(resolver.interface.decodeFunctionResult('text', result)[0] === direct, 'Global resolution value differs');
    }
    evidence.records[key] = direct;
  }
  evidence.globalResolutionVerified = registerRoot;
  evidence.status = 'complete';
  delete evidence.failure;
  evidence.completedAt = new Date().toISOString();
  persist();
  console.log(json({ status: evidence.status, evidence: evidencePath, name: fullName, globallyResolvableInThisSepoliaENSv2Deployment: registerRoot, addresses: evidence.addresses, trainingMintPerformed: false }));
}
try { await main(); }
catch (error) {
  const message = error.code ? `Operation failed (${error.code}); ${error.revert?.name ?? 'inspect saved transaction receipts and configuration'}` : error.message;
  const safeMessage = String(message).replace(/0x[\da-fA-F]{64}/g, '[redacted-32-byte-value]').replace(/https?:\/\/\S+/g, '[URL]');
  if (evidence) { evidence.status = 'incomplete'; evidence.failure = safeMessage; persist(); }
  console.error(`ERROR: ${safeMessage}`);
  process.exitCode = 1;
} finally { provider?.destroy(); }
