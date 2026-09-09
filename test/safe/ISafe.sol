// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice ABI-compatible interfaces for the Safe smart account v1.4.1 (test-side only).
/// @dev    Purpose: let the tests talk to the REAL Safe (deployed from the release-built artifacts in
///         lib/safe-contracts/build) without importing Safe's implementation sources into ProofKey's
///         solc 0.8.28 / via_ir compilation. Selectors and ABI encodings match Safe v1.4.1
///         (`contracts/Safe.sol`, `base/OwnerManager.sol`, `base/ModuleManager.sol`,
///         `proxies/SafeProxyFactory.sol`). `Operation` mirrors `common/Enum.sol` (uint8: 0 = Call).
interface ISafe {
    enum Operation {
        Call,
        DelegateCall
    }

    function VERSION() external view returns (string memory);

    function setup(
        address[] calldata _owners,
        uint256 _threshold,
        address to,
        bytes calldata data,
        address fallbackHandler,
        address paymentToken,
        uint256 payment,
        address payable paymentReceiver
    ) external;

    function execTransaction(
        address to,
        uint256 value,
        bytes calldata data,
        Operation operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address payable refundReceiver,
        bytes memory signatures
    ) external payable returns (bool success);

    function getTransactionHash(
        address to,
        uint256 value,
        bytes calldata data,
        Operation operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address refundReceiver,
        uint256 _nonce
    ) external view returns (bytes32);

    function nonce() external view returns (uint256);
    function domainSeparator() external view returns (bytes32);

    // OwnerManager
    function getOwners() external view returns (address[] memory);
    function isOwner(address owner) external view returns (bool);
    function getThreshold() external view returns (uint256);
    function swapOwner(address prevOwner, address oldOwner, address newOwner) external;

    // ModuleManager
    function isModuleEnabled(address module) external view returns (bool);
    function getModulesPaginated(address start, uint256 pageSize)
        external
        view
        returns (address[] memory array, address next);
}

interface ISafeProxyFactory {
    /// @dev Returns the proxy address (declared as `SafeProxy` upstream; ABI-identical to `address`).
    function createProxyWithNonce(address _singleton, bytes memory initializer, uint256 saltNonce)
        external
        returns (address proxy);
}
