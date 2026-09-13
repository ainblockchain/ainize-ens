import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validateDatasetEvidence } from './dataset-evidence.mjs';

function fixture() {
  const row = { prompt: 'A source question', answer: 'A source answer', note: 'Graph block 25969047' };
  const bytes = Buffer.from(`${JSON.stringify(row)}\n`);
  const digest = createHash('sha256').update(bytes).digest('hex');
  const datasetID = '97a216a3-1692-4ebd-a148-928b5b3dfa9e';
  const upload = { format: 'ainize-graph-upload-v1', node_url: 'https://www.ainize.ai', dataset_sha256: digest, training_requested: false, publication_requested: false, receipt: { dataset_id: datasetID, sha256: digest, predicted_sha256: digest, sha256_matches_prediction: true, rows_accepted: 1, rows_rejected: [], size_bytes: bytes.length }, responses: [{ method: 'POST', url: 'https://www.ainize.ai/api/teach/datasets', status: 201, body: { dataset: { id: datasetID, sha256: digest, rows: 1, status: 'ready', invalid_rows: 0 }, report: { rows: [{ ...row, status: 'ok' }] } } }] };
  const provenance = { rows_sha256: digest, rows: 1, row_hashes: [createHash('sha256').update(`${row.prompt}\n${row.answer}`).digest('hex')], source: 'mcp', server: { authenticated: true }, tool: 'execute_query_by_subgraph_id', arguments: { subgraph_id: 'source' }, upstream: { subgraph_id: 'source', block: 25969047 } };
  return { upload, bytes, provenance };
}
test('validated dataset exposes only public provenance and no training claim', () => {
  const { upload, bytes, provenance } = fixture();
  upload.private_unrelated_field = 'must-not-be-copied';
  const result = validateDatasetEvidence(upload, bytes, provenance);
  assert.equal(result.graphBlock, '25969047');
  assert.equal(result.modelTrainingProven, false);
  assert.equal(JSON.stringify(result).includes('must-not-be-copied'), false);
});
test('tampered local source cannot match upload digest', () => {
  const { upload, bytes, provenance } = fixture();
  assert.throws(() => validateDatasetEvidence(upload, Buffer.concat([bytes, Buffer.from(' ')]), provenance), /SHA256/);
});
test('server row report, row fingerprints, auth and training flags are enforced', () => {
  for (const mutate of [value => { value.upload.responses[0].body.report.rows[0].answer = 'changed'; }, value => { value.provenance.row_hashes[0] = 'changed'; }, value => { value.provenance.server.authenticated = false; }, value => { value.upload.training_requested = true; }]) {
    const value = fixture();
    mutate(value);
    assert.throws(() => validateDatasetEvidence(value.upload, value.bytes, value.provenance));
  }
});
