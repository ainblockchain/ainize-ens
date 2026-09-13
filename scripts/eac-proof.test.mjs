import test from 'node:test';
import assert from 'node:assert/strict';
import { Interface, ZeroHash } from 'ethers';
import { verifyTextPermissions } from './eac-proof.mjs';

const account = '0x0000000000000000000000000000000000001234';
const abi = new Interface(['error EACUnauthorizedAccountRoles(uint256 resource,uint256 roleBitmap,address account)', 'error OtherError()']);
function resolverFor(failure, allowedFailure) {
  const calls = [];
  return {
    interface: abi,
    calls,
    setText: { staticCall: async (...parameters) => {
      calls.push(parameters);
      if (parameters[1] === 'ainize.node' && allowedFailure) throw allowedFailure;
      if (parameters[1] === 'ainize.patch' && failure) throw failure;
    } },
  };
}
const denied = (role = 16n, caller = account) => ({ code: 'CALL_EXCEPTION', data: abi.encodeErrorResult('EACUnauthorizedAccountRoles', [42n, role, caller]) });
test('accepts only the expected EAC refusal and pins both static calls to the evidence block', async () => {
  const resolver = resolverFor(denied());
  const result = await verifyTextPermissions(resolver, ZeroHash, account, 'https://www.ainize.ai', 'real-patch', 123);
  assert.equal(result.error, 'EACUnauthorizedAccountRoles');
  assert.equal(result.resource, 42n);
  assert.deepEqual(resolver.calls.map(call => [call[1], call[3]]), [['ainize.node', { blockTag: 123 }], ['ainize.patch', { blockTag: 123 }]]);
});
test('unexpected write success fails instead of being caught as expected denial', async () => {
  await assert.rejects(verifyTextPermissions(resolverFor(null), ZeroHash, account, 'url', 'patch'), /unexpectedly succeeded/);
});
test('transport failures are not permission evidence', async () => {
  await assert.rejects(verifyTextPermissions(resolverFor({ code: 'NETWORK_ERROR' }), ZeroHash, account, 'url', 'patch'), /without a decoded/);
});
test('unrelated contract revert is not permission evidence', async () => {
  await assert.rejects(verifyTextPermissions(resolverFor({ code: 'CALL_EXCEPTION', data: abi.encodeErrorResult('OtherError') }), ZeroHash, account, 'url', 'patch'), /unexpected reason/);
});
test('wrong role or account cannot count as the expected denial', async () => {
  for (const failure of [denied(1n), denied(16n, '0x0000000000000000000000000000000000005678')]) await assert.rejects(verifyTextPermissions(resolverFor(failure), ZeroHash, account, 'url', 'patch'), /unexpected role\/account/);
});
test('allowed-write failure propagates and prevents the denial check', async () => {
  const resolver = resolverFor(denied(), new Error('allowed failed'));
  await assert.rejects(verifyTextPermissions(resolver, ZeroHash, account, 'url', 'patch'), /allowed failed/);
  assert.equal(resolver.calls.length, 1);
});
