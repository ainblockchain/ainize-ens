import solc from 'solc';
import { AbiCoder, ContractFactory, ZeroAddress, dnsEncode, namehash, hexlify, randomBytes } from 'ethers';

const source = `pragma solidity ^0.8.28;
interface Factory {
    function deployProxy(address implementation, uint256 salt, bytes calldata data) external returns (address);
    function verifyContract(address proxy) external view returns (address);
}
interface Registry {
    function grantRootRoles(uint256 roles, address account) external returns (bool);
    function hasRootRoles(uint256 roles, address account) external view returns (bool);
    function register(string calldata label, address owner, address registry, address resolver, uint256 roles, uint64 expiry) external returns (uint256);
    function findOwner(string calldata label) external view returns (address);
    function getResolver(string calldata label) external view returns (address);
}
interface Resolver {
    function authorizeTextRoles(bytes calldata name, string calldata key, address account, bool grant) external returns (bool);
    function setText(bytes32 node, string calldata key, string calldata value) external;
    function text(bytes32 node, string calldata key) external view returns (string memory);
}
interface Engram {
    function REGISTRY() external view returns (address);
    function OWNER() external view returns (address);
}
contract ReadOnlyIntegration {
    constructor(address factoryAddress, address registryImplementation, address resolverImplementation, uint256 salt, bytes memory registrarBytecode, bytes memory name, bytes32 node) {
        Factory factory = Factory(factoryAddress);
        address registry = factory.deployProxy(registryImplementation, salt, abi.encodeWithSignature("initialize(address,uint256)", address(this), uint256(1) | (uint256(1) << 128)));
        bytes[] memory setters = new bytes[](0);
        address resolver = factory.deployProxy(resolverImplementation, salt + 1, abi.encodeWithSignature("initialize(address,uint256,bytes[])", address(this), uint256(1) << 132, setters));
        require(factory.verifyContract(registry) == registryImplementation, "registry implementation");
        require(factory.verifyContract(resolver) == resolverImplementation, "resolver implementation");
        bytes memory creation = abi.encodePacked(registrarBytecode, abi.encode(registry, uint256(2), uint32(8000)));
        address registrar;
        assembly { registrar := create(0, add(creation, 32), mload(creation)) }
        require(registrar != address(0), "registrar creation");
        require(Engram(registrar).REGISTRY() == registry && Engram(registrar).OWNER() == address(this), "registrar configuration");
        Registry(registry).grantRootRoles(1, registrar);
        require(Registry(registry).hasRootRoles(1, registrar), "registrar grant");
        Registry(registry).register("patch", address(this), address(0), resolver, 0, uint64(block.timestamp + 86400));
        require(Registry(registry).findOwner("patch") == address(this) && Registry(registry).getResolver("patch") == resolver, "registry readback");
        Resolver(resolver).authorizeTextRoles(name, "ainize.node", address(this), true);
        Resolver(resolver).authorizeTextRoles(name, "ainize.patch", address(this), true);
        Resolver(resolver).setText(node, "ainize.node", "https://www.ainize.ai");
        Resolver(resolver).setText(node, "ainize.patch", "simulation-only-no-training-claim");
        Resolver(resolver).authorizeTextRoles(name, "ainize.patch", address(this), false);
        Resolver(resolver).setText(node, "ainize.node", "https://www.ainize.ai");
        (bool success, bytes memory reason) = resolver.call(abi.encodeCall(Resolver.setText, (node, "ainize.patch", "refused")));
        require(!success && reason.length == 100, "denial missing");
        bytes4 selector;
        uint256 role;
        address account;
        assembly {
            selector := mload(add(reason, 32))
            role := mload(add(reason, 68))
            account := mload(add(reason, 100))
        }
        require(selector == bytes4(keccak256("EACUnauthorizedAccountRoles(uint256,uint256,address)")) && role == 16 && account == address(this), "wrong denial");
        require(keccak256(bytes(Resolver(resolver).text(node, "ainize.patch"))) == keccak256("simulation-only-no-training-claim"), "rejected write mutated record");
        bytes memory result = abi.encode(registry, resolver, registrar, reason);
        assembly { return(add(result, 32), mload(result)) }
    }
    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return 0xf23a6e61;
    }
}`;

export async function simulateIntegration(provider, artifacts, registrarBytecode, blockTag) {
  const output = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources: { 'ReadOnlyIntegration.sol': { content: source } }, settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: 'shanghai', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } } })));
  if (output.errors?.some(entry => entry.severity === 'error')) throw new Error('Read-only integration helper compilation failed');
  const compiled = output.contracts['ReadOnlyIntegration.sol'].ReadOnlyIntegration;
  const factory = new ContractFactory(compiled.abi, `0x${compiled.evm.bytecode.object}`);
  const name = 'patch.read-only-simulation.eth';
  const tx = await factory.getDeployTransaction(artifacts.VerifiableFactory.address, artifacts.UserRegistryImpl.address, artifacts.PermissionedResolverImpl.address, BigInt(hexlify(randomBytes(16))), registrarBytecode, dnsEncode(name), namehash(name));
  const result = await provider.call({ ...tx, from: ZeroAddress, gasLimit: 15_000_000n, blockTag });
  const [registry, resolver, registrar, deniedWriteRevertData] = AbiCoder.defaultAbiCoder().decode(['address', 'address', 'address', 'bytes'], result);
  return { mode: 'eth_call-only; all simulated state discarded', transactionsSent: 0, persistedDeployments: false, simulatedAddresses: { registry, resolver, registrar }, verified: ['factory proxies and implementation identities', 'compiled EngramRegistrar deployment and ROLE_REGISTRAR', 'operator child registration and readback', 'per-key text write allowed, revoked write refused with exact EAC error', 'refused write leaves record unchanged'], deniedWriteRevertData, trainingMintPerformed: false, globalRegistrationTested: false };
}
