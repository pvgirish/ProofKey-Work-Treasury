// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {EvmV1Decoder} from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";
import {
    INativeQueryVerifier,
    NativeQueryVerifierLib
} from "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";
import {WorkTypes} from "./WorkTypes.sol";

/// @notice Native receipt authentication shared by every target evidence presentation.
/// @dev The production verifier is always Creditcoin's fixed 0x0FD2 precompile. Tests mock that
///      address at the VM boundary; there is no constructor switch or caller-trusted bypass.
abstract contract NativeReceiptAuth {
    uint256 internal constant MAX_AUTHENTICATION_BATCH = 32;
    bytes32 internal constant AUTHENTICATION_TYPEHASH = keccak256(
        "ProofKeyNativeAuthenticationV1(uint64 sourceChainKey,uint64 blockHeight,uint64 transactionIndex,bytes32 nativeProfile,bytes32 encodedTransactionHash)"
    );

    struct SingleProof {
        uint64 blockHeight;
        bytes encodedTransaction;
        INativeQueryVerifier.MerkleProof merkleProof;
        INativeQueryVerifier.ContinuityProof continuityProof;
    }

    struct SourcePosition {
        uint64 blockHeight;
        uint64 transactionIndex;
    }

    struct Authentication {
        uint64 blockHeight;
        uint64 transactionIndex;
        bytes32 encodedTransactionHash;
        bool exists;
    }

    INativeQueryVerifier public immutable VERIFIER;
    uint64 public immutable SOURCE_CHAIN_KEY;
    address public immutable SOURCE_COORDINATOR;

    mapping(bytes32 authenticationId => Authentication) private _authentications;

    error EmptyAuthenticationBatch();
    error AuthenticationBatchTooLarge(uint256 count, uint256 maximum);
    error AuthenticationArrayLengthMismatch();
    error ProofVerificationFailed();
    error AuthenticationNotFound(bytes32 authenticationId);
    error SourceTransactionFailed(uint8 status);
    error LogOrdinalOutOfRange(uint256 ordinal, uint256 count);
    error WrongLogEmitter(address got, address expected);

    event NativeTransactionAuthenticated(
        bytes32 indexed authenticationId,
        uint64 indexed blockHeight,
        uint64 transactionIndex,
        bytes32 encodedTransactionHash,
        bytes32 nativeProfile
    );

    constructor(uint64 sourceChainKey, address sourceCoordinator) {
        if (sourceChainKey == 0 || sourceCoordinator == address(0)) revert WorkTypes.InvalidConfiguration();
        VERIFIER = NativeQueryVerifierLib.getVerifier();
        SOURCE_CHAIN_KEY = sourceChainKey;
        SOURCE_COORDINATOR = sourceCoordinator;
    }

    function authenticationId(SourcePosition memory position, bytes32 encodedTransactionHash)
        public
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                AUTHENTICATION_TYPEHASH,
                SOURCE_CHAIN_KEY,
                position.blockHeight,
                position.transactionIndex,
                WorkTypes.NATIVE_PROFILE,
                encodedTransactionHash
            )
        );
    }

    function nativeProfile() external pure returns (bytes32) {
        return WorkTypes.NATIVE_PROFILE;
    }

    function authentication(bytes32 id) external view returns (Authentication memory) {
        return _authentications[id];
    }

    function isAuthenticated(SourcePosition calldata position, bytes calldata encodedTransaction)
        external
        view
        returns (bool)
    {
        bytes32 txHash = keccak256(encodedTransaction);
        return _authentications[authenticationId(position, txHash)].exists;
    }

    function _authenticateSingle(SingleProof calldata proof)
        internal
        returns (SourcePosition memory position, bytes32 id)
    {
        if (!VERIFIER.verifyAndEmit(
                SOURCE_CHAIN_KEY, proof.blockHeight, proof.encodedTransaction, proof.merkleProof, proof.continuityProof
            )) revert ProofVerificationFailed();

        position = SourcePosition({
            blockHeight: proof.blockHeight, transactionIndex: VERIFIER.calculateTxIndex(proof.merkleProof)
        });
        id = _storeAuthentication(position, keccak256(proof.encodedTransaction));
    }

    function _authenticateBatch(
        uint64[] calldata blockHeights,
        bytes[] calldata encodedTransactions,
        INativeQueryVerifier.MerkleProof[] calldata merkleProofs,
        INativeQueryVerifier.ContinuityProof calldata sharedContinuityProof
    ) internal returns (SourcePosition[] memory positions, bytes32[] memory ids) {
        uint256 count = blockHeights.length;
        if (count == 0) revert EmptyAuthenticationBatch();
        if (count > MAX_AUTHENTICATION_BATCH) {
            revert AuthenticationBatchTooLarge(count, MAX_AUTHENTICATION_BATCH);
        }
        if (encodedTransactions.length != count || merkleProofs.length != count) {
            revert AuthenticationArrayLengthMismatch();
        }
        if (!VERIFIER.verifyAndEmit(
                SOURCE_CHAIN_KEY, blockHeights, encodedTransactions, merkleProofs, sharedContinuityProof
            )) revert ProofVerificationFailed();

        positions = new SourcePosition[](count);
        ids = new bytes32[](count);
        for (uint256 i; i < count; ++i) {
            positions[i] = SourcePosition({
                blockHeight: blockHeights[i], transactionIndex: VERIFIER.calculateTxIndex(merkleProofs[i])
            });
            ids[i] = _storeAuthentication(positions[i], keccak256(encodedTransactions[i]));
        }
    }

    function _authenticateSegmented(SingleProof[] calldata proofs)
        internal
        returns (SourcePosition[] memory positions, bytes32[] memory ids)
    {
        uint256 count = proofs.length;
        if (count == 0) revert EmptyAuthenticationBatch();
        if (count > MAX_AUTHENTICATION_BATCH) {
            revert AuthenticationBatchTooLarge(count, MAX_AUTHENTICATION_BATCH);
        }
        positions = new SourcePosition[](count);
        ids = new bytes32[](count);
        for (uint256 i; i < count; ++i) {
            (positions[i], ids[i]) = _authenticateSingle(proofs[i]);
        }
    }

    function _storeAuthentication(SourcePosition memory position, bytes32 txHash) private returns (bytes32 id) {
        id = authenticationId(position, txHash);
        if (_authentications[id].exists) return id;
        _authentications[id] = Authentication({
            blockHeight: position.blockHeight,
            transactionIndex: position.transactionIndex,
            encodedTransactionHash: txHash,
            exists: true
        });
        emit NativeTransactionAuthenticated(
            id, position.blockHeight, position.transactionIndex, txHash, WorkTypes.NATIVE_PROFILE
        );
    }

    /// @dev A cache hit never trusts decoded caller fields. It re-hashes the exact authenticated
    ///      bytes, decodes the successful receipt, bounds-checks the receipt-local ordinal, and
    ///      rechecks the pinned source emitter.
    function _selectAuthenticatedLog(
        SourcePosition memory position,
        bytes memory encodedTransaction,
        uint256 logOrdinal
    ) internal view returns (EvmV1Decoder.LogEntry memory log, bytes32 id) {
        bytes32 txHash = keccak256(encodedTransaction);
        id = authenticationId(position, txHash);
        if (!_authentications[id].exists) revert AuthenticationNotFound(id);

        EvmV1Decoder.ReceiptFields memory receipt = EvmV1Decoder.decodeReceiptFields(encodedTransaction);
        if (receipt.receiptStatus != 1) revert SourceTransactionFailed(receipt.receiptStatus);
        if (logOrdinal >= receipt.receiptLogs.length) {
            revert LogOrdinalOutOfRange(logOrdinal, receipt.receiptLogs.length);
        }
        log = receipt.receiptLogs[logOrdinal];
        if (log.address_ != SOURCE_COORDINATOR) {
            revert WrongLogEmitter(log.address_, SOURCE_COORDINATOR);
        }
    }
}
