# ens/ — ENSv2 as Ainize's namespace, and the training run as the thing that mints a name

Everything that touches **ENS** lives here, kept apart from the marketplace packages so it can be opened as a
standalone public repository (a hackathon submission needs one) without dragging the rest of Ainize with it.
Same rule as `graph/`: nothing here may break if ENS is removed, and nothing outside here may depend on it.

*Status: design, 2026-09-04. No contracts written yet. The ENSv2 facts in §5 were read from the docs today and
are marked with what the docs actually say, including that they are explicitly not final.*

## 1. The claim

Ainize already has a hierarchy and refuses to admit it. Every knowledge carries `parents[]`, a `royaltySplit`
along its lineage, `supersedes` / `superseded_by`, fork and merge — and then identifies itself with an opaque
string: `krx-all-2761-ep12`, `taught-az198-prp05-f7529b`. The lineage is the product's core (the owner's
words: *"어떤 knowledge 위에서 트레이닝 하는지"* must be explicit) and it is currently legible only through
Ainize's own API.

That is a namespace with no naming system. ENSv2's hierarchical registry is the naming system for it:

```
krx.ainize.eth                          the original knowledge — its own subname registry
├─ ep6.krx.ainize.eth                   an early checkpoint
├─ ep12.krx.ainize.eth                  SUPERSEDED → resolver aliases its records to final
└─ final.krx.ainize.eth
   └─ myfork.final.krx.ainize.eth       someone else's training run, on top of ours
```

**The submission is not "we put names on things".** It is: *the right to mint a subname is earned by a
verified training run on the parent, and the permission system that governs the name is the same one that
governs who may attest to what the training produced.*

## 2. What makes the name mean something: it is minted by training, not by payment

This is the part that distinguishes it from every other "tokenise a hierarchy" project, and it is the part
Ainize is uniquely able to build, because the training is real and already runs on this box.

A subname under a knowledge cannot be bought. It is minted by a **teach job** whose attestation says:

| Evidence the job already produces | What the registrar checks before minting |
|---|---|
| `parents[]` / `base_ids` in `job.json` | the claimed parent IS the name being minted under |
| `pre_state_sha256` | training started from the parent's actual checkpoint, not from scratch |
| `patch_sha256` of the produced patch | the name resolves to the artefact that was actually trained |
| benchmark score + verifier quorum | the child passes its own benchmark on ≥ 2 distinct runtimes |
| `backend: gradient \| stub` | **a stub-backed job can never mint a name** |

That last row is the same mechanical stub rule the benchmark work already enforces (`graph/bench/README.md`
§9), and it is worth stating twice because it is what keeps the namespace honest: a name in this tree is a
claim that a GPU did work, and the claim is checkable by anyone who can read the chain.

So the tree is not a record of who paid. It is **a record of computation, ordered by what it was computed on
top of.** `myfork.final.krx.ainize.eth` existing is proof that a gradient run started from `final`'s
checkpoint and beat its own benchmark. Ainize's economic rule (contributor share 0.7 of the seller
remainder, royalties along the lineage) moves into the registrar contract, which is where the ENSv2 tutorial
puts business logic: the registrar validates and collects, then calls the registry's `register()`.

### The dataset travels with the name

The lineage spec (`docs/lineage-teach-design.md`) already says the training set is inherited along lineage so
a creator can append to it, with access levels `public | derivative | private`. Those levels are an access
control problem that Ainize currently solves per-request in `packages/node/src/api.ts`. In ENSv2 they are
roles: **holding `child.parent.ainize.eth` is what grants `derivative` read access to the parent's dataset.**
The permission to read the training data is delegated through the name hierarchy, which is not something a
cosmetic integration could produce.

## 3. Enhanced Access Control: the author must not be able to forge their own score

Today `krx-all-2761` carries `{"free_generation": "26/26", "pre_apply": "1/8"}` signed by node-b, and it is
trustworthy because Ainize's own ledger says so. EAC lets us stop asking anyone to trust Ainize:

| Role on the knowledge's name | May write | May NOT write |
|---|---|---|
| author | `description`, `price`, `dataset.access` | **any `attestation.*` record** |
| verifier (quorum member) | `attestation.<verifier>.*` only | description, price, anything of the author's |
| trainer (the node that ran the job) | `training.*` — base checkpoint, dataset manifest hash, epochs, backend, GPU-hours | scores |
| parent's author | the rule under which children may be minted | nothing inside the child |

The demo moment is the negative one: **the author's key tries to write its own attestation record and the
transaction reverts.** That is a security property a judge can watch happen in ten seconds, and it is exactly
the "delegate specific rights — like letting an account edit only certain text records" the track asks for.

**The mechanism, and the constraint it imposes on the design.** The Permissioned Resolver derives a resource
as `keccak256(node, part)` where `part` is zero for the whole name and `keccak256(key)` for one record, and it
exposes `authorizeTextRoles(toName, key, account, grant)`, which grants `ROLE_SET_TEXT` **for that one key**,
against `authorizeNameRoles`, which grants it for every key on the name.

That is per-exact-key, not per-prefix: **there is no way to grant `attestation.*` as a wildcard.** Three
consequences the contracts have to be built around, and the first is the one that would quietly destroy the
property if it were missed:

1. **The author must never receive a name-level grant.** `authorizeNameRoles` on the author would hand them
   every key including the attestation records, and the guarantee evaporates while the table above still reads
   correctly. The author gets per-key grants — `description`, `price`, `dataset.access` — and nothing else.
2. **Each verifier is granted its own exact key**, e.g. `attestation.0x430b3A37…` for node-b. Workable because
   the verifier's address is known when it joins the quorum, and it has a pleasant side effect: a verifier
   cannot overwrite another verifier's attestation either.
3. The key set is therefore **enumerable and fixed at grant time**, which means the record schema is part of
   the contract design rather than a convention. That is a cost, and it is also why the negative test passes:
   the author's transaction reverts because the author was never granted that key, not because something
   checked a prefix at runtime.

## 4. The rest of the state machine falls out

| Ainize today | ENSv2 mechanism |
|---|---|
| DRAFT (taught, not yet verified) | an **expiring** subname — a training run that never passes quorum loses its name |
| SUPERSEDED | **record aliasing** (`setAlias(fromName, toName)`) to the successor — but see the caveat below |
| branches | **namespace aliasing** via a shared registry |
| a knowledge nobody may revoke | a forever name with no parent control |
| merge (two parents) | **open problem** — a tree cannot express two parents; see §6 |

**Caveat on supersession, found in the resolver docs and not yet resolved.** `setAlias` requires
`ROLE_SET_ALIAS`, which is **root-only** — it is not a per-name role an author can hold. So "this knowledge is
superseded by that one" would be an action of the resolver root, not of the author, which either centralises a
decision Ainize currently lets the author make, or means supersession is expressed as an ordinary text record
pointer (`superseded_by`) and aliasing is reserved for cases the root really should control. The docs also
note cycle detection on self-reference, with longer cycles able to run out of gas — a lineage that supersedes
in a loop is a real possibility in a fork-and-merge product and must be prevented on our side, not theirs.

**Agents (the bonus).** Ainize's agent already buys over x402 with `--max-price`, and the MCP work will let
Claude Code and Cursor teach and buy directly. Give it `myagent.ainize.eth` with ENSIP-26 records and EAC
delegation, and the agent's identity carries what it is *allowed* to do: which lineages it may buy under,
its spending ceiling, and — the interesting one — whether it may spend **GPU budget** to teach. "Agents as
namespaces, each with their own identity and permissions" is not a garnish here; it is the missing half of
delegated autonomous purchasing.

## 5. What the ENSv2 docs actually say, read 2026-09-04

Recorded because the design above depends on it and because the docs warn they are pre-release.

- **The registrar pattern is the hook we need.** A registry stores names and enforces permissions; a separate
  **registrar** holds the business logic — pricing, availability — validates, collects payment, and then calls
  the registry's `register()` / `renew()`. So "you may mint only if you ran a verified training job on the
  parent" is a registrar, not a fork of ENS. For deeper changes the docs say to extend `PermissionedRegistry`
  directly. Documented extensions include allowlists and commit-reveal.
- **Deployment shape**: deploy a `UserRegistry` proxy via the Verifiable Factory with a `roleBitmap` including
  `ROLE_REGISTRAR_ADMIN` / `ROLE_RENEW_ADMIN`; point the parent at it with `setSubregistry()` so the Universal
  Resolver can find subnames; deploy the registrar; `grantRootRoles()` the registrar `ROLE_REGISTRAR` and
  `ROLE_RENEW`.
- **Names are ERC1155Singleton tokens**, one owner each; transferability is gated by `ROLE_CAN_TRANSFER_ADMIN`;
  expiry is a unix timestamp; roles are revocable (unlike v1 fuses, which were one-way).
- **EAC**: 2^256 resources, 64 roles per resource, ≤ 15 holders per role. A `uint256` bitmap, lower 128 bits =
  32 regular roles, upper = their admin roles. `grantRoles(resource, roleBitmap, account)`,
  `revokeRoles`, `grantRootRoles`, `revokeRootRoles`; views `roles()`, `hasRoles()`, `roleCount()`.
- **Per-record scoping is real**: the Permissioned Resolver ships 11 roles, 8 of them per-record, scoped down
  to individual keys and coin types — which is what §3's table needs.
- **"The contracts and interfaces described here are not yet final and may change prior to mainnet."** Treat
  every address and signature below as a moving target and re-read before writing code.

### 5.1 Sepolia (ENSv2 beta), chain id 11155111 — read from the docs' Deployments table, 2026-09-04

The ones this design touches:

| Contract | Address |
|---|---|
| VerifiableFactory | `0x10dc6333cdfe1fcef624c6e0a8221b91804cd7ef` |
| UserRegistryImpl | `0x624a25d67b59d587752ebec8dded8827dae52050` |
| PermissionedResolverImpl | `0x9eae5c2730a7dd16bdd1dee6421a1b91e3b0365e` |
| RootRegistry | `0x8115186e8f2e0b0281e86ab91f0f48ba90364354` |
| ETHRegistry | `0xbdc85dd5b15d7ecb354cd7cb6f2c50b4f2c4f0e2` |
| ETHRegistrar | `0xa88553f454b77203b0d036a05c894d555eaaa2cc` |
| UniversalResolverV2 | `0x4a1817d13e9cf196f471725176355c1234b63c70` |
| ENSV2Resolver | `0x508cb4e4596429ca98a1bb3112d88d18f92456b5` |

Also on the list and worth knowing about: `MockUSDC` / `MockDAI` (the registrar tutorial takes an ERC20
payment token, so the royalty path has something to charge in on testnet), `StandardRentPriceOracle`, and a
`Graveyard`. Nothing here is copied into code yet — when the registrar is written, the addresses come from a
config file that names this table and its date, not from constants pasted into a contract.

## 6. Open questions, honestly

1. **Merge.** A knowledge with two parents has no single place in a tree. Namespace aliasing under the second
   parent is the obvious candidate and it is unverified. Royalties along a multi-parent lineage already exist
   in the spec; the name may simply have to live under one parent and alias under the other, and the write-up
   should say so rather than pretend the tree is total.
2. **Two chains.** ENSv2 is Sepolia; Ainize settles x402 on the AIN chain. The split must be stated plainly —
   **names and permissions on ENS, settlement on x402** — not hidden. A registrar that checks an AIN-side
   attestation needs that attestation bridged or re-signed on Sepolia, and how that is done without inventing
   a trusted oracle is the hardest unsolved piece of this design.
3. **Gas and the demo.** Every teach job minting a name means a Sepolia transaction in the demo path. Fine on
   testnet; a real deployment would need to decide what is on-chain and what is a signed record.
4. **Eligibility.** The $500 "Best Integration into an Existing Project" prize is Continuity-Track-only. The
   $4,500 track has no such restriction and the design above is written for it — ENSv2 features are the
   product, not decoration.

## 7. What would disqualify this, so we do not build it

- Putting `ainize.eth` on a node and rendering names instead of addresses. That is the cosmetic add-on the
  rules name explicitly.
- A demo with hard-coded names. Ours must mint from the real lineage that already exists on this machine:
  `krx-all-2761` ep6 → ep12 → final, `pixelplus-087600`, and the `taught-*` items — all really trained, all
  really verified by two runtimes.
- Claiming the training is real when the patch came from the teach stub. The registrar refuses those, and the
  submission says so.
