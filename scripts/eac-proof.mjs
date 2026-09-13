export async function verifyTextPermissions(resolver, node, account, nodeURL, patchID, blockTag = 'latest') {
  await resolver.setText.staticCall(node, 'ainize.node', nodeURL, { blockTag });
  let refused;
  try {
    await resolver.setText.staticCall(node, 'ainize.patch', patchID, { blockTag });
  } catch (error) {
    if (error.code !== 'CALL_EXCEPTION' || typeof error.data !== 'string') throw new Error('Denied-write check failed without a decoded contract revert');
    const decoded = resolver.interface.parseError(error.data);
    if (decoded?.name !== 'EACUnauthorizedAccountRoles') throw new Error('Denied-write reverted for an unexpected reason');
    if (decoded.args.roleBitmap !== 16n || decoded.args.account.toLowerCase() !== account.toLowerCase()) throw new Error('Denied-write revert identifies unexpected role/account');
    refused = { error: decoded.name, resource: decoded.args.resource, roleBitmap: decoded.args.roleBitmap, account: decoded.args.account, revertData: error.data };
  }
  if (!refused) throw new Error('EAC FAILURE: unauthorized ainize.patch write unexpectedly succeeded');
  return refused;
}
