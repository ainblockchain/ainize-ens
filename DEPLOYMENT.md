# Sepolia ENSv2 integration

This integration uses the official `ensdomains/namechain` checkout pinned to
`48b3e2d39513b9dd32ef1850877a29009bc807b9`, specifically
`contracts/deployments/sepolia/*.json`. Addresses in older README examples are not
used. This is the ENSv2 tree deployed on Sepolia, not production ENS or mainnet.

The script creates a real factory UserRegistry proxy and PermissionedResolver
proxy, deploys the locally compiled EngramRegistrar, and grants it
`ROLE_REGISTRAR`. The operator registers a child directly through UserRegistry.
With `--register-root`, ETHRegistrar commit/reveal registers the parent `.eth`
label using freely minted deployed MockUSDC and attaches the UserRegistry. Final
checks resolve every record through the deployed UniversalResolverV2.

**No training mint is performed.** No verifiers are enrolled, signatures invented,
or lineage anchored. The existing DART patch is a discoverable **REJECTED**
catalogue artifact, not a successful training attestation and not a Graph-trained
model. Its catalogue status and this limitation are written into resolver text
records and public evidence. Local mock-registry tests are not live ENSv2 proof.
A caption-only video does not establish a functioning demo.

## Read-only live preflight

Requires Node 22+, installed package dependencies, the pinned upstream clone,
and the contract owner's current `artifacts/EngramRegistrar.json` build.

```sh
cd /mnt/newdata/gov/hackathon/ainize-ens
npm run deploy:sepolia -- --check --env-file /mnt/newdata/ainize/.env
```

`--check` sends no transactions, creates no evidence files, needs no private key,
and can run on an unfunded wallet. It verifies chain ID 11155111, code at all eight
consumed upstream addresses, root/ETHRegistry/registrar/universal-resolver links,
and factory proxy logic code. It compares deployment JSON to the exact git pin,
checks paths against symlink escape, and compiles the registrar in memory to
check its bytecode/ABI against the current source, including signed recipient,
resolver, and duration fields. It prints observed block and runtime code hashes.
Code existence and hashes are observations, not a source-verification claim.

Preflight also executes a single read-only `eth_call` constructor helper against
the deployed factory and implementations: proxy creation, compiled registrar
creation, registrar-role grant, operator registration, record writes and exact
EAC refusal are exercised together. All simulated state is discarded. Simulated
addresses are explicitly labelled and are not deployed contracts or transaction
receipts. This does not test global commit/reveal or prove a training mint.

The RPC defaults to `https://ethereum-sepolia-rpc.publicnode.com`.
`SEPOLIA_RPC_URL` overrides it. `NAMECHAIN`, if supplied, denotes the upstream
**contracts directory**, relative to this project or absolute.

## Submit real testnet transactions

The user-controlled env file contains `SEPOLIA_PRIVATE_KEY` and optionally
`SEPOLIA_RPC_URL`; keep its permissions `0600`. Keys are never printed or copied
into evidence. Node loads the file with `process.loadEnvFile()`; exported process
variables take precedence. Fund the printed wallet with Sepolia faucet ETH.
The script refuses every chain other than Sepolia, rejects premium registrations,
and uses only the pinned MockUSDC as the registration payment token. ETH gas is
still required. A zero balance or missing key fails before any transactions.

```sh
AINIZE_NODE_URL=https://www.ainize.ai \
AINIZE_PATCH_ID=taught-ainize-lifecycle100-2026-cf9a6f \
AINIZE_PATCH_SHA256=fb1cd41e2f6a26f785d72460a2eac4a62688ee4c70e5bee43187d734eeca2e64 \
ENS_REGISTER_ROOT=1 \
npm run deploy:sepolia -- --env-file /mnt/newdata/ainize/.env
```

The same settings may be added to the private env file. `--register-root` is
equivalent to `ENS_REGISTER_ROOT=1`. Defaults are root label
`ainize-<first-eight-wallet-hex-characters>`, child label `patch`, duration one
year, quorum 2, and minimum benchmark 8000 basis points. Override with
`ENS_ROOT_LABEL`, `ENS_CHILD_LABEL`, `ENS_DURATION`, `ENGRAM_QUORUM`, and
`ENGRAM_MIN_BENCH`. Labels must be lowercase ASCII DNS labels. `AINIZE_CATALOG_URL`
can override the default `${AINIZE_NODE_URL}/api/catalog`; all public record URLs
must be HTTPS without embedded credentials, query, or fragment. The live
catalogue must actually contain the patch, and an expected SHA, when provided,
must match. Neither existence nor SHA metadata proves quality or rehashes the
downloaded patch bytes.

Without the root flag, the script creates an isolated registry/resolver demo and
explicitly reports **no global name**. Do not describe that mode as globally
resolvable. Pick the root mode before the first transaction: it is part of the
resume configuration.

### Graph dataset provenance

Pass `--dataset-evidence /path/to/tokens.jsonl.upload.json` or set
`GRAPH_DATASET_EVIDENCE` to that path. The adjacent `tokens.jsonl` and
`tokens.jsonl.provenance.json` must exist. Validation checks the local source-byte
SHA256 against upload receipt and provenance, server response ID and accepted
rows, every server-reported row and source-row fingerprint, the source block,
and recorded authenticated Graph MCP provenance. It requires upload-only
evidence with training/publication both false. `--check` validates this too.

Exactly three additional text records are written: `ainize.dataset` (dataset
ID), `ainize.dataset.sha256` (source/upload digest), and `ainize.graph.block`
(source Ethereum mainnet block, distinct from the Sepolia transaction block).
Only those public values and an allowlisted provenance summary enter evidence;
the original receipt is not copied. This cross-checks saved upload evidence,
not an independent authenticated re-query of the node. Dataset upload is not
model training, and the existing rejected DART patch is not derived from this
Graph dataset. Include the dataset option on the first run and all resumes.

## EAC demonstration and receipts

The resolver initially grants only text-admin authority. It then grants the
operator explicit per-name, per-key write rights, writes `ainize.node`,
`ainize.patch`, `ainize.patch.sha256`, `ainize.patch.status`, and
`ainize.provenance`, and revokes the operator's `ainize.patch` write right.
All grants and record writes are batched in one resolver multicall transaction;
the revocation is a separate transaction.
The same account can still simulate writing `ainize.node`, but attempting
`setText.staticCall` on `ainize.patch` must throw the decoded
`EACUnauthorizedAccountRoles` error for that account and text role. Unexpected
success, transport failure, or a different revert fails the demo. Static calls
do not write state; the preceding grants, record writes, and revocation are real
transactions. The account retains admin authority and can explicitly regrant
itself access; this is granular EAC, not irrevocable exclusion of an admin.

Public receipts and checks are saved incrementally to
`evidence/<root-label>-<child-label>.json`, with explorer URLs, block hashes, gas,
logs, addresses, catalogue status, record readbacks, and the EAC revert. Only a
completed root-mode run with `globalResolutionVerified: true` proves the
requested global integration. `trainingMint.performed` remains false.

Salts and the commitment secret are stored only in
`evidence/private/<root-label>-<child-label>.json` (directory `0700`, file `0600`).
The existing git ignore rule for `evidence/private/` is required and checked
before writing. Public evidence excludes transaction calldata and private salts;
commitment secrets necessarily become visible in on-chain reveal calldata.
Factory deployment salts are also public on-chain; the public evidence decodes
`ProxyDeployed` and omits its salt instead of copying that event's raw data.
Do not publish the private journal. No private key is stored there.

Repeat the identical command to resume: confirmed transaction hashes are reused,
pending transactions are awaited, and a changed configuration fails instead of
silently creating inconsistent evidence. Do not run two copies concurrently.
A reverted transaction, expired commitment, or dropped transaction requires
manual inspection; choose a fresh root label for a fresh deployment. A process
crash between broadcast and saving its hash also requires manual inspection.
No automatic replacement transactions or hidden retries spend additional gas.

## Fresh checkout reproduction

```sh
bash scripts/setup.sh
bash scripts/reproduce-sepolia.sh --env-file /mnt/newdata/ainize/.env
```

`setup.sh` clones/pins upstream if absent, refuses to move an existing checkout
at a different pin, runs `npm ci`, and the owner's build. It does not run tests
or live calls. The separate `reproduce-sepolia.sh` runs setup, the owner's tests,
`node --test scripts/*.test.mjs`, and read-only preflight. Neither deploys. In the shared working tree,
coordinate rebuilding with the contract owner. Deployment scripts do not edit
contracts, tests, package files, or upstream. No commits are made automatically.
