import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { readFileSync } from 'node:fs';
import ganache from 'ganache';
import solc from 'solc';
import { BrowserProvider, ContractFactory, Wallet, ZeroAddress, id, getBytes } from 'ethers';

const registrySource = `pragma solidity ^0.8.20;
contract RegistryFixture {
    struct State { uint8 status; uint64 expiry; address latestOwner; uint256 tokenId; uint256 resource; }
    mapping(uint256 => State) private states;
    function getState(uint256 label) external view returns(State memory) { return states[label]; }
    function register(string calldata label, address owner, address, address, uint256, uint64 expiry) external returns(uint256 tokenId) {
        tokenId = uint256(keccak256(bytes(label)));
        require(states[tokenId].status == 0);
        states[tokenId] = State(2, expiry, owner, tokenId, tokenId);
    }
}`;

let engine, provider, operator, registry, registrar;
const verifiers = [Wallet.createRandom(), Wallet.createRandom()].sort((left, right) =>
  BigInt(left.address) < BigInt(right.address) ? -1 : 1);
const parentLabel = id('defi');
const parentPatch = id('test-parent-checkpoint');

before(async () => {
  engine = ganache.provider({ logging: { quiet: true }, chain: { hardfork: 'shanghai' } });
  provider = new BrowserProvider(engine);
  provider.pollingInterval = 10;
  operator = await provider.getSigner();
  const compilation = JSON.parse(solc.compile(JSON.stringify({
    language: 'Solidity', sources: { 'Registry.sol': { content: registrySource } },
    settings: { evmVersion: 'shanghai', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } },
  })));
  assert.equal((compilation.errors ?? []).filter(entry => entry.severity === 'error').length, 0);
  const fixture = compilation.contracts['Registry.sol'].RegistryFixture;
  registry = await new ContractFactory(fixture.abi, fixture.evm.bytecode.object, operator).deploy();
  await registry.waitForDeployment();
  const artifact = JSON.parse(readFileSync('artifacts/EngramRegistrar.json', 'utf8'));
  registrar = await new ContractFactory(artifact.abi, artifact.bytecode, operator).deploy(await registry.getAddress(), 2, 8000);
  await registrar.waitForDeployment();
  await (await registrar.anchorRoot(parentLabel, parentPatch)).wait();
  for (const verifier of verifiers) await (await registrar.setVerifier(verifier.address, true)).wait();
});

after(async () => { await engine?.disconnect(); });

async function attestation(overrides = {}) {
  const block = await provider.getBlock('latest');
  return {
    parentLabel, label: 'vaults', patchSha256: id('test-child-patch'), preState: parentPatch,
    backend: 2, benchScore: 9000, localityPassed: true, deadline: block.timestamp + 3600,
    recipient: await operator.getAddress(), resolver: ZeroAddress, duration: 86400,
    ...overrides,
  };
}

async function signatures(value) {
  const digest = await registrar.digest(value);
  return verifiers.map(verifier => verifier.signingKey.sign(getBytes(digest)).serialized);
}

async function rejected(value, errorName, override = {}) {
  await assert.rejects(registrar.mint.staticCall(value, override.owner ?? value.recipient,
    override.resolver ?? value.resolver, override.duration ?? value.duration,
    override.signatures ?? await signatures(value)), error => error.revert?.name === errorName);
}

test('requires a deployed registry, nonzero quorum, and a bounded benchmark', async () => {
  const artifact = JSON.parse(readFileSync('artifacts/EngramRegistrar.json', 'utf8'));
  const factory = new ContractFactory(artifact.abi, artifact.bytecode, operator);
  await assert.rejects(factory.deploy(await registry.getAddress(), 0, 8000));
  await assert.rejects(factory.deploy(ZeroAddress, 2, 8000));
  await assert.rejects(factory.deploy(await registry.getAddress(), 2, 10001));
});

test('rejects a stub, wrong ancestry, failing locality, and low benchmark', async () => {
  await rejected(await attestation({ backend: 1 }), 'NotGradient');
  await rejected(await attestation({ preState: id('unrelated') }), 'NotDescended');
  await rejected(await attestation({ localityPassed: false }), 'LocalityFailed');
  await rejected(await attestation({ benchScore: 7999 }), 'BenchTooLow');
});

test('rejects expired and unbounded attestations', async () => {
  await rejected(await attestation({ deadline: 1 }), 'Expired');
  await rejected(await attestation({ benchScore: 10001 }), 'InvalidConfiguration');
});

test('cannot overwrite an anchored checkpoint or approve the null verifier', async () => {
  await assert.rejects(registrar.anchorRoot.staticCall(parentLabel, id('replacement')),
    error => error.revert?.name === 'RootAlreadyAnchored');
  await assert.rejects(registrar.setVerifier.staticCall(ZeroAddress, true),
    error => error.revert?.name === 'InvalidConfiguration');
});

test('requires distinct verifier signatures and the full quorum', async () => {
  const value = await attestation();
  const signed = await signatures(value);
  await rejected(value, 'QuorumNotMet', { signatures: signed.slice(0, 1) });
  await rejected(value, 'SignersNotDistinct', { signatures: [signed[0], signed[0]] });
  await rejected(value, 'SignerNotVerifier', { signatures: ['0x'] });
});

test('binds the recipient, resolver, and lease to the signed attestation', async () => {
  const value = await attestation();
  await rejected(value, 'InvalidMintTarget', { owner: Wallet.createRandom().address });
  await rejected(value, 'InvalidMintTarget', { resolver: Wallet.createRandom().address });
  await rejected(value, 'InvalidMintTarget', { duration: value.duration + 1 });
  const signed = await signatures(value);
  const changed = { ...value, recipient: Wallet.createRandom().address };
  assert.notEqual(await registrar.digest(changed), await registrar.digest(value));
  await rejected(changed, 'SignerNotVerifier', { signatures: signed });
});

test('mints a verified child to its signed recipient and refuses replay', async () => {
  const value = await attestation();
  const signed = await signatures(value);
  const receipt = await (await registrar.mint(value, value.recipient, value.resolver, value.duration, signed)).wait();
  assert.equal(receipt.status, 1);
  const lineage = await registrar.lineageOf(id(value.label));
  assert.equal(lineage.patchSha256, value.patchSha256);
  assert.equal(lineage.parentLabel, parentLabel);
  assert.equal((await registry.getState(BigInt(id(value.label)))).latestOwner, value.recipient);
  await rejected(value, 'NotAvailable');
});
