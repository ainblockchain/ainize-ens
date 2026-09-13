# ens/ — ENSv2 as Ainize's namespace, and the training run as the thing that mints a name

## ETHOnline 2026 Continuity delivery

The submission entry point is [ainblockchain/ainize](https://github.com/ainblockchain/ainize).
The sections below preserve the design history; they are not a checklist of deployed features.

On September 13, the registrar gained signed recipient, resolver, and duration fields. Previously a
caller could reuse valid verifier signatures with a different mint recipient or resolver. The contract
now rejects that substitution, zero quorum, a null verifier, and replacement of an anchored checkpoint.
Existing attestation signers must adopt the new tuple and digest before using this version.

`npm run build && npm test` compiles with solc 0.8.28 and runs seven executable contract tests:
valid mint/replay, stub and ancestry rejection, locality and benchmark gates, quorum uniqueness,
signature-bound mint targets, immutable roots, and deployment configuration checks. These tests use a
**local registry fixture**, not Sepolia, and do not establish ENSv2 bounty eligibility by themselves.
Deployment and live permission evidence are a separate requirement. The registrar still trusts its
owner-approved verifier set; it does not independently run the GPU benchmark on Ethereum.

The registrar records parent relationships, but a single instance registers its children in one
registry. The multigeneration hierarchical registry deployment, sibling agent delegation, private
model access enforcement, and ancestor royalty payout described in the design remain separate work;
do not infer them from a successful registrar mint or from a resolver permission check.

---

Everything that touches **ENS** lives here, kept apart from the marketplace packages so it can be opened as a
standalone public repository (a hackathon submission needs one) without dragging the rest of Ainize with it.
Same rule as `graph/`: nothing here may break if ENS is removed, and nothing outside here may depend on it.

*Status: design, 2026-09-04. No contracts written yet. The ENSv2 facts in §5 were read from the docs today and
are marked with what the docs actually say, including that they are explicitly not final.*

## 0. The demo, decided — an agent family

**The agent is `engram.eth`, and what the tree records is descent: which agent was trained on top of which.**

The name is not a coinage — `/mnt/newdata/qwen3.8` already calls the PLE patch server `ENGRAM_API`, and an
engram is the neuroscience term for a memory trace physically encoded in tissue. That is what a patch is:
memory in the weights, not in a database that gets searched.

```
engram.eth                            the ancestor — base model, knows nothing special. The control.
└─ defi.engram.eth                    VOCABULARY — what a vault, a market, a pool IS (Messari schema)
   ├─ vaults.defi.engram.eth          the vaults of 15 live protocols, pinned at block 25902936
   ├─ lending.defi.engram.eth         the lending markets — a SIBLING, disjoint facts
   └─ risk.vaults.defi.engram.eth     one fund's policy. Private.
```

Descent is a checkable claim here, not a metaphor: a child is minted only if a teach job proves it started
from the parent's checkpoint (`pre_state_sha256`), produced the artefact the name resolves to
(`patch_sha256`), passed its own benchmark on two distinct runtimes, and ran on a real gradient backend. A
stub-backed job mints nothing.

### Why an agent family rather than a knowledge tree

Three relations have to actually work, or a lineage is a list with indentation:

1. **Inheritance — one question, four answers.** *"Where should I put 10 WETH?"* The ancestor invents an
   address that does not exist; `defi.` explains what a vault is and names nothing; `vaults.` names real
   vaults with real TVL; `risk.vaults.` names the same ones minus what its policy excludes. Four answers side
   by side make inheritance visible — each generation's contribution IS the difference.
2. **Sibling delegation — and this is the relation nothing else gives.** Ask `vaults.` about a lending rate
   and it does not know; it delegates to `lending.`, and the delegation works because both descend from
   `defi.` and share its vocabulary. **A common ancestor is what lets two agents that have never met talk to
   each other, and ENS is what proves the descent.**
3. **Permission inheritance.** `risk.vaults.` is private: another fund's agent that tries to load it is
   refused, holding no role. And an agent spawning a sub-agent grants it a SUBSET of its own EAC roles — buy
   only under this lineage, up to this ceiling. That is the delegated autonomy the bounty's bonus asks for.

### Why this memory and not another

The first idea was ENS names — `name → address`. Bad twice: it is ONE ROW, which is the case a resolver
serves better and the case our own four-arm benchmark says the tool arm wins; and it is hex, the shape the
trainer's tokenizer-boundary rule is likeliest to skip. The rule that replaced it: **train what needs a wide
scan, not what needs one row.**

Onchain protocol memory qualifies, and the measurement is ours. Arm B — a model with The Graph's MCP —
finishes 172 of 500 completions in two calls or fewer and **hits a wall on 30% that more budget does not
climb**: those items are not running out of calls, they are failing to converge. And arm B is **seven times
less stable** than the same model without tools, changing its actual answer on 6% of items where the tool-less
arm has never changed one in 1 000 completions. A wide scan over 15 protocols at a pinned block is exactly
where a tool loop is weakest and compiled memory has nothing to look up.

The failure also has money attached. Ask the ancestor for a pool address and it produces a plausible one; send
funds there and they are gone. A judge can check the address in ten seconds.

### The beats, and the two that are refusals

| # | On stage | The ENSv2 feature carrying it |
|---|---|---|
| 1 | One question, four agents, four answers — the ancestor's is a hallucinated address | — the problem |
| 2 | Train a child on a parent's checkpoint and mint its name. A stub-backed job **is refused** | custom registrar |
| 3 | Another fund's agent tries to load `risk.vaults.` → **refused**, holds no role | Enhanced Access Control |
| 4 | `vaults.` cannot answer a lending question and delegates to its sibling on shared vocabulary | the hierarchy itself |
| 5 | The child sells; the vocabulary curator is paid up the lineage | registrar business logic |

Beats 2 and 3 are the submission. Anyone can demo a transaction that succeeds; a transaction that is
**refused** is what proves the permission is real.

### Live versus pre-baked, said out loud

Training is hours, so nothing is trained on stage. Pre-baked: the patches. Live: the GPU-free dry run showing
which facts were extracted, the job submission, the Sepolia mint, the permission refusal, the delegation. The
talk says which is which.

### One line to use a name

`ainize patch <name>` is the command the family exists to make possible. It replaces a sequence in which the
operator carried an id between two machines by hand:

```
ainize patch ls --node http://their-node:3402 --status LISTED -q "<topic>"
ainize login && ainize use <id>
```

becomes

```
ainize patch vaults.defi.engram.eth
```

The name supplies exactly what those lines supplied by hand: the `ainize.node` text record is the `--node` of
the first, and `ainize.patch` is the `<id>` of the third. Resolution reads a local names file first — which is
what makes the command work offline and before a name is registered — and falls back to
`registry.resolver(namehash)` then `resolver.text(namehash, key)` over JSON-RPC when both an RPC and a
registry address are given. **The registry address is never assumed**: ENSv2's docs say its contracts are not
final, and an address hard-coded here would resolve confidently against the wrong registry.

**The buying still happens on your own node.** `--node` in `patch ls` points at the seller because you are
reading their catalogue; `use` has always run locally, because your node is what pays, downloads and applies.
A command that logged you into someone else's node and applied knowledge there would be a different operation
wearing this one's name, so the seller's endpoint is used only for what it is for — telling your node where to
fetch from, as a peer.

Verified end to end against a live node: resolve → peer → log in → use, with `--resolve-only` and `--no-apply`
for the paths that must not spend money or touch a shared model. Nine offline tests pin the resolution half,
including the two canonical namehash vectors — the hash must be keccak256, and node's built-in `sha3-256` is
not it.

### What is real today

The facts for `defi.`, `vaults.` and `lending.` are already pulled and pinned — 15 live protocols at block
25902936, raw gateway responses committed, and `okf-extract.mjs` reads **1,707 facts** off them by rule —
frontmatter scalars and table rows, never prose, never a model's summary. The lesson trains an **82-row slice**, and
which 82 is a finding rather than a preference.

The first attempt trained the sibling dataset — 119 address→symbol facts from the same pull — and the product's
own publish gate refused it: `locality 3/10`, meaning seven unrelated answers moved. The cause was the footprint.
Those 119 facts touched **49,825 memory rows**, 419 per fact, because a 42-character hex address tokenises long
and gives every fact an enormous n-gram reach. A patch that rewrites fifty thousand rows disturbs answers nobody
asked about, and more training passes raise accuracy and footprint together — the two gates move in opposite
directions.

So the slice taken here is the part of the catalog a person asks in words: the schema terms, the policy, and each
deployment's declared identity, with **every row carrying a hex address dropped**. `What is the layer of
aave-amm?` → `lending` is a fact worth compiling into memory. `What is the token symbol of the vault at
0x50379f…?` is a fact worth looking up, and the gate is what told us the difference. `risk.` is the layer we author, which is correct:
it is the subjective one, and a subjective layer is exactly why the tree must be a tree of forks rather than
a canonical registry. `vaults.` also carries something no other submission will have: a **published
benchmark** — 250 pre-registered items, a declared ordering, a measured instrument floor.

**The contract compiles.** `contracts/EngramRegistrar.sol` was written against documentation with no solc on
the machine, and its own header said so. It now builds with solc 0.8.28 against the real ENSv2 interfaces —
3,898 bytes of runtime, 26 ABI entries — and `contracts/compile.mjs` reproduces that in one command. Two
things only a compile could have told us, both load-bearing for anyone deploying it:

- **`@ensdomains/contracts-v2` is not a package.** It does not exist on npm. ENSv2 ships as the
  `ensdomains/namechain` repository, and the import prefix has to be remapped to `contracts/src` inside it.
  Left alone, solc reports a missing file and says nothing about where the file lives.
- **`viaIR` is required, not preferred.** Without it the mint path is "stack too deep", so a plain compile
  fails in a way that reads like a broken contract rather than a compiler setting.

What a compile does not buy: it is still unaudited, still undeployed, and the upstream docs still say these
interfaces "are not yet final and may change prior to mainnet deployment". It is evidence the shapes match
today.

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
| locality gate | unrelated answers survived the training — **bounded by the gate, see below** |
| `backend: gradient \| stub` | **a stub-backed job can never mint a name** |

That last row is the same mechanical stub rule the benchmark work already enforces (`graph/bench/README.md`
§9), and it is worth stating twice because it is what keeps the namespace honest: a name in this tree is a
claim that a GPU did work, and the claim is checkable by anyone who can read the chain.

So the tree is not a record of who paid. It is **a record of computation, ordered by what it was computed on
top of.** `myfork.final.krx.ainize.eth` existing is proof that a gradient run started from `final`'s
checkpoint and beat its own benchmark. Ainize's economic rule (contributor share 0.7 of the seller
remainder, royalties along the lineage) moves into the registrar contract, which is where the ENSv2 tutorial
puts business logic: the registrar validates and collects, then calls the registry's `register()`.

### What the mint condition actually guarantees, today

The claim this design wants to make is "a name in this tree is proof that a GPU learned something without
breaking what the model already knew". The second half of that sentence is currently weaker than it sounds,
and the submission must not ship the strong version.

The product's publish gate is `locality.ok && parent_regression.ok` (`packages/node/src/teach.ts:67`), where
locality is `DEFAULT_LOCALITY_PROMPTS` — 12 unrelated prompts, `minSame: 11`, so one failure is tolerated
(`packages/core/src/config.ts:48,76`). Measured 2026-09-04: **4 of those 12 are also in the trainer's contrast
set** (`teach_contrast.json`) — 2 verbatim, 2 a paraphrase apart. Contrast exists to hold unrelated rows in
place while the targets are pulled, so those four prompts are trained to survive the very check that scores
them. A third of the gate is pre-secured by construction, in shipped code, for every knowledge Ainize has ever
published.

So the honest reading of a name minted today is: *8 of 12 unrelated prompts held, and 4 more were trained to
hold.* That is not something to mint on, and it is not something to put in front of judges.

The fix is on the contrast side, not the gate side — shrinking a buyer's only safety check to make our own
numbers work would be solving our problem with their protection. Four contrast items are being replaced with
general-knowledge pairs that collide with nothing, and the disjointness is being asserted in a test so it
cannot regress silently. Two consequences for this submission, both of which we accept rather than route
around:

1. **Our knowledges must be trained after that fix lands**, so the demo's names are minted on a clean gate.
   That is a scheduling constraint, not a caveat.
2. **The four knowledges already attested on the demo cluster were published under the old gate.** If the
   submission references them at all, it says so. Neither they nor anything trained before the fix may be
   described as verified against side effects.

The collision rule that makes the fix correct is worth recording, because the obvious version is wrong:
similarity alone rejects "What is the capital of Canada?" against "What is the capital of Italy?" for sharing
a template, but training on Rome does not pre-secure Ottawa. Leakage is about the ANSWER, not the sentence —
identical question, or a paraphrase that shares the answer.

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
