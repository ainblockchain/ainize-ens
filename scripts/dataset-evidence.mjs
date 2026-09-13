import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const sha256 = value => createHash('sha256').update(value).digest('hex');
function requireThat(condition, message) { if (!condition) throw new Error(`Graph dataset evidence: ${message}`); }
export function validateDatasetEvidence(upload, sourceBytes, provenance) {
  requireThat(upload.format === 'ainize-graph-upload-v1', 'unexpected upload format');
  requireThat(upload.training_requested === false && upload.publication_requested === false, 'expected upload-only evidence without training/publication');
  const receipt = upload.receipt;
  requireThat(receipt && /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(receipt.dataset_id), 'invalid dataset ID');
  const digest = sha256(sourceBytes);
  requireThat([upload.dataset_sha256, receipt.sha256, receipt.predicted_sha256, provenance.rows_sha256].every(value => value === digest) && receipt.sha256_matches_prediction === true, 'source SHA256 does not match receipt/provenance');
  const rows = sourceBytes.toString('utf8').trim().split('\n').map(line => JSON.parse(line));
  requireThat(rows.length > 0 && rows.length === receipt.rows_accepted && rows.length === provenance.rows && receipt.rows_rejected?.length === 0, 'row counts/rejections mismatch');
  requireThat(receipt.size_bytes === sourceBytes.length, 'upload byte count mismatch');
  const node = new URL(upload.node_url);
  requireThat(node.protocol === 'https:' && !node.username && !node.password && !node.search && !node.hash, 'unsafe public node URL');
  const accepted = upload.responses?.find(entry => entry.method === 'POST' && entry.url === `${node.origin}/api/teach/datasets` && entry.status === 201);
  const dataset = accepted?.body?.dataset;
  requireThat(dataset?.id === receipt.dataset_id && dataset.sha256 === digest && dataset.rows === rows.length && dataset.status === 'ready' && dataset.invalid_rows === 0, 'successful server upload response mismatch');
  requireThat(provenance.source === 'mcp' && provenance.server?.authenticated === true && provenance.tool === 'execute_query_by_subgraph_id', 'expected authenticated Graph MCP provenance');
  const block = provenance.upstream?.block;
  requireThat(Number.isSafeInteger(block) && block > 0, 'missing Graph block');
  requireThat(provenance.arguments?.subgraph_id === provenance.upstream?.subgraph_id, 'subgraph mismatch');
  const reported = accepted.body.report?.rows;
  requireThat(Array.isArray(reported) && reported.length === rows.length, 'missing server row report');
  for (const [index, row] of rows.entries()) {
    requireThat(typeof row.prompt === 'string' && typeof row.answer === 'string' && row.note?.includes(`block ${block}`), 'row lacks source-block provenance');
    requireThat(reported[index].status === 'ok' && ['prompt', 'answer', 'alt_prompt', 'note'].every(key => reported[index][key] === row[key]), 'server rows differ from source');
    requireThat(provenance.row_hashes?.[index] === sha256(`${row.prompt}\n${row.answer}`), 'row fingerprint mismatch');
  }
  return { datasetID: receipt.dataset_id, sha256: digest, graphBlock: String(block), rows: rows.length, nodeURL: node.origin, subgraphID: provenance.upstream.subgraph_id, authenticatedMCPRecorded: true, verification: 'Local source bytes cross-checked against saved upload response and provenance; not an independent server attestation', trainingRequested: false, modelTrainingProven: false };
}
export function loadDatasetEvidence(path) {
  const absolute = resolve(path);
  requireThat(absolute.endsWith('.upload.json'), 'expected <source.jsonl>.upload.json with adjacent source and provenance');
  const sourcePath = absolute.slice(0, -'.upload.json'.length);
  return validateDatasetEvidence(JSON.parse(readFileSync(absolute, 'utf8')), readFileSync(sourcePath), JSON.parse(readFileSync(`${sourcePath}.provenance.json`, 'utf8')));
}
