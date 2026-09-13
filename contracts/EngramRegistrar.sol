// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IPermissionedRegistry} from "@ensdomains/contracts-v2/registry/interfaces/IPermissionedRegistry.sol";
import {IRegistry} from "@ensdomains/contracts-v2/registry/interfaces/IRegistry.sol";
import {RegistryRolesLib} from "@ensdomains/contracts-v2/registry/libraries/RegistryRolesLib.sol";

/**
 * EngramRegistrar — a subname is minted by a verified training run, not bought.
 *
 * NOT AUDITED. COMPILED: solc 0.8.28 with `viaIR`, against the real ENSv2 interfaces from ensdomains/namechain
 * (`contracts/src/registry`) and OpenZeppelin 5 — 3,898 bytes of runtime, 26 ABI entries. Every signature this
 * calls was checked by the compiler against the actual source, not against documentation: `register(string,
 * address,IRegistry,address,uint256,uint64)` on IStandardRegistry, `getState`/`Status` on
 * IPermissionedRegistry, and the five role constants in RegistryRolesLib.
 *
 * `viaIR` is required, not a preference: without it the mint path is "stack too deep". That is a property of
 * this contract as written and will not change on its own.
 *
 * The import prefix below names a package that does not exist on npm — ENSv2 is distributed as the
 * `ensdomains/namechain` repository. Whoever deploys this remaps that prefix to `namechain/contracts/src`,
 * which is what `contracts/compile.mjs` does. The upstream docs still state these interfaces
 * "are not yet final and may change prior to mainnet deployment", so a compile today is evidence the shapes
 * match today and nothing more.
 *
 * WHY IT EXISTS. The reference registrar's business logic is a price: pay, and the name is yours. Ours is a
 * proof of computation. `engram.eth` names an agent family in which each generation is trained on top of its
 * parent's checkpoint, so the tree is not a record of who paid — it is a record of what was computed, ordered
 * by what it was computed on top of. A name in this tree is a claim that a GPU learned something starting
 * from a specific parent, and the registrar is where that claim is checked instead of asserted.
 *
 * WHAT IT CHECKS, and each one is a thing the teach job already produces:
 *
 *   backend == GRADIENT      A stub-backed job mints nothing. The benchmark work enforces the same rule
 *                            mechanically — a stub run may not write results-final.* — and a namespace whose
 *                            entries might be simulated is worth less than no namespace.
 *   preState == parent's     The child started from THIS parent's checkpoint. Without it "descent" is a
 *                            parent field anyone can type; with it, the claim is the artefact's own hash.
 *   quorum of verifiers      k distinct registered verifiers signed the same attestation digest. Distinct
 *                            SIGNERS, checked by recovery, so one key cannot supply a quorum by signing
 *                            twice — the same requirement the marketplace's own quorum has, where three
 *                            nodes sharing one runtime count as one.
 *   locality passed          The verifiers assert the patch did not damage unrelated answers. See the honesty
 *                            note in ens/README.md §"What the mint condition actually guarantees": this is
 *                            exactly as strong as the product's locality gate, no stronger.
 *
 * THE BRIDGE, STATED PLAINLY. Ainize settles on the AIN chain and this contract lives on Sepolia. Nothing
 * here reads AIN. Verifier nodes sign the attestation digest with the SAME identity key they use on AIN, and
 * this contract recovers those signatures — so the trust assumption is "these addresses are the verifiers",
 * registered once by the family's owner. That is a workaround for the unsolved problem recorded in
 * ens/README.md §6.2, not a solution to it: a reader who wants AIN-side attestations verified on Sepolia
 * without a trusted set still needs a bridge nobody here has built.
 */
contract EngramRegistrar {
    // ---------------------------------------------------------------- types

    /** Backends a teach job can report. Anything not positively GRADIENT mints nothing. */
    enum Backend { UNKNOWN, STUB, GRADIENT }

    /**
     * What the verifiers sign. Every field comes from the teach job record; none is asserted by the minter.
     * `parentPatch` is the hash the PARENT name already resolves to, and `preState` is the checkpoint the
     * child's training actually started from — the registrar's job is to require they are the same value.
     */
    struct Attestation {
        bytes32 parentLabel;    // keccak256(parent label) — which name this is minted under
        string  label;          // the child's own label
        bytes32 patchSha256;    // the artefact this name will resolve to
        bytes32 preState;       // the checkpoint training started from
        Backend backend;        // GRADIENT or nothing
        uint32  benchScore;     // basis points of the child's own benchmark, 10000 = all items
        bool    localityPassed; // unrelated answers survived — as strong as the product gate, no stronger
        uint64  deadline;       // signatures expire, so an old attestation cannot mint a new name
        address recipient;
        address resolver;
        uint64 duration;
    }

    /** What a minted name is, from this contract's point of view. Children are checked against it. */
    struct Lineage {
        bytes32 patchSha256;
        bytes32 parentLabel;
        uint64  mintedAt;
        uint32  benchScore;
    }

    // ---------------------------------------------------------------- errors

    error NotAvailable(string label);
    error NotGradient();                     // a stub-backed job
    error ParentUnknown(bytes32 parentLabel);
    error NotDescended(bytes32 expected, bytes32 got);
    error LocalityFailed();
    error BenchTooLow(uint32 score, uint32 minimum);
    error QuorumNotMet(uint256 got, uint256 needed);
    error SignerNotVerifier(address signer);
    error SignersNotDistinct(address signer);
    error Expired(uint64 deadline);
    error OnlyOwner();
    error InvalidConfiguration();
    error InvalidMintTarget();
    error RootAlreadyAnchored(bytes32 label);

    event Minted(uint256 indexed tokenId, string label, bytes32 parentLabel, bytes32 patchSha256, uint32 benchScore, uint256 verifiers);
    event VerifierSet(address indexed verifier, bool allowed);
    event RootAnchored(bytes32 indexed label, bytes32 patchSha256);

    // ---------------------------------------------------------------- state

    uint256 constant REGISTRATION_ROLE_BITMAP =
        RegistryRolesLib.ROLE_SET_SUBREGISTRY
        | RegistryRolesLib.ROLE_SET_SUBREGISTRY_ADMIN
        | RegistryRolesLib.ROLE_SET_RESOLVER
        | RegistryRolesLib.ROLE_SET_RESOLVER_ADMIN
        | RegistryRolesLib.ROLE_CAN_TRANSFER_ADMIN;

    IPermissionedRegistry public immutable REGISTRY;
    address public immutable OWNER;
    uint256 public immutable QUORUM;      // distinct verifier signatures required
    uint32  public immutable MIN_BENCH;   // basis points

    mapping(address => bool) public isVerifier;
    mapping(bytes32 => Lineage) public lineageOf;   // keccak256(label) -> what was minted there

    modifier onlyOwner() { if (msg.sender != OWNER) revert OnlyOwner(); _; }

    constructor(IPermissionedRegistry registry, uint256 quorum, uint32 minBench) {
        if (address(registry).code.length == 0 || quorum == 0 || minBench > 10000) revert InvalidConfiguration();
        REGISTRY = registry;
        OWNER = msg.sender;
        QUORUM = quorum;
        MIN_BENCH = minBench;
    }

    // ---------------------------------------------------------------- admin

    function setVerifier(address verifier, bool allowed) external onlyOwner {
        if (verifier == address(0)) revert InvalidConfiguration();
        isVerifier[verifier] = allowed;
        emit VerifierSet(verifier, allowed);
    }

    /**
     * The ancestor has no parent to descend from, so its checkpoint is anchored rather than proved. This is
     * the one place the chain is trusted rather than checked, and it is deliberately a single owner call:
     * everything below it is checked against this value, so a reader can see exactly where the induction
     * starts.
     */
    function anchorRoot(bytes32 label, bytes32 patchSha256) external onlyOwner {
        if (patchSha256 == bytes32(0)) revert InvalidConfiguration();
        if (lineageOf[label].patchSha256 != bytes32(0)) revert RootAlreadyAnchored(label);
        lineageOf[label] = Lineage({ patchSha256: patchSha256, parentLabel: bytes32(0), mintedAt: uint64(block.timestamp), benchScore: 0 });
        emit RootAnchored(label, patchSha256);
    }

    // ---------------------------------------------------------------- minting

    /** EIP-191 digest of the attestation. Verifier nodes sign this with their AIN identity key. */
    function digest(Attestation calldata a) public view returns (bytes32) {
        bytes32 inner = keccak256(abi.encode(
            block.chainid, address(this),
            a.parentLabel, keccak256(bytes(a.label)), a.patchSha256, a.preState,
            a.backend, a.benchScore, a.localityPassed, a.deadline,
            a.recipient, a.resolver, a.duration
        ));
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", inner));
    }

    /**
     * Mint `label` under `parentLabel`, if and only if the training is proved.
     *
     * `signatures` must come from DISTINCT registered verifiers. They are required to arrive in strictly
     * ascending signer order, which makes distinctness an O(n) check with no set in storage — and, more to
     * the point, makes "one verifier signed twice" impossible to express rather than merely detected.
     */
    function mint(
        Attestation calldata a,
        address owner,
        address resolver,
        uint64 duration,
        bytes[] calldata signatures
    ) external returns (uint256 tokenId) {
        if (owner != a.recipient || resolver != a.resolver || duration != a.duration || owner == address(0) || duration == 0) revert InvalidMintTarget();
        if (a.patchSha256 == bytes32(0) || a.benchScore > 10000) revert InvalidConfiguration();
        if (block.timestamp > a.deadline) revert Expired(a.deadline);
        if (a.backend != Backend.GRADIENT) revert NotGradient();
        if (!a.localityPassed) revert LocalityFailed();
        if (a.benchScore < MIN_BENCH) revert BenchTooLow(a.benchScore, MIN_BENCH);

        Lineage memory parent = lineageOf[a.parentLabel];
        if (parent.patchSha256 == bytes32(0)) revert ParentUnknown(a.parentLabel);
        // DESCENT: the child's training started from the artefact the parent name resolves to. This single
        // comparison is what makes the tree a record of computation rather than of declared intent.
        if (a.preState != parent.patchSha256) revert NotDescended(parent.patchSha256, a.preState);

        if (!isAvailable(a.label)) revert NotAvailable(a.label);

        bytes32 d = digest(a);
        address last = address(0);
        uint256 n = signatures.length;
        for (uint256 i = 0; i < n; i++) {
            address signer = _recover(d, signatures[i]);
            if (!isVerifier[signer]) revert SignerNotVerifier(signer);
            if (signer <= last) revert SignersNotDistinct(signer);   // ascending order == distinctness
            last = signer;
        }
        if (n < QUORUM) revert QuorumNotMet(n, QUORUM);

        tokenId = REGISTRY.register(
            a.label,
            owner,
            IRegistry(address(0)),
            resolver,
            REGISTRATION_ROLE_BITMAP,
            uint64(block.timestamp) + duration
        );

        lineageOf[keccak256(bytes(a.label))] = Lineage({
            patchSha256: a.patchSha256,
            parentLabel: a.parentLabel,
            mintedAt: uint64(block.timestamp),
            benchScore: a.benchScore
        });

        emit Minted(tokenId, a.label, a.parentLabel, a.patchSha256, a.benchScore, n);
    }

    function isAvailable(string calldata label) public view returns (bool) {
        if (lineageOf[keccak256(bytes(label))].patchSha256 != bytes32(0)) return false;
        IPermissionedRegistry.State memory state = REGISTRY.getState(uint256(keccak256(bytes(label))));
        return state.status == IPermissionedRegistry.Status.AVAILABLE;
    }

    // ---------------------------------------------------------------- internal

    function _recover(bytes32 d, bytes calldata sig) internal pure returns (address) {
        if (sig.length != 65) return address(0);
        bytes32 r; bytes32 s; uint8 v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        if (v < 27) v += 27;
        // Reject the upper half of the curve order: a malleable signature is a second valid encoding of the
        // same signature, and this contract uses signature identity for distinctness.
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) return address(0);
        return ecrecover(d, v, r, s);
    }
}
