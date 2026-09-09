// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Pinned signature validation library used by SourceCoordinator.
library SourceSignatureLib {
    bytes4 private constant EIP1271_MAGIC = 0x1626ba7e;
    uint256 private constant SECP256K1_HALF_N =
        0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;
    bytes32 private constant EIP712_DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 private constant NAME_HASH = keccak256("ProofKey Source Coordinator");
    bytes32 private constant VERSION_HASH = keccak256("1");
    bytes32 private constant QUOTE_TYPEHASH = keccak256("ProofKeyQuoteV1(bytes32 orderId)");
    bytes32 private constant ACCEPT_TYPEHASH = keccak256("ProofKeyOfferAcceptanceV1(bytes32 orderId)");
    bytes32 private constant REVOKE_QUOTE_TYPEHASH = keccak256(
        "ProofKeyQuoteRevocationV1(bytes32 epochId,address worker,uint64 nonce)"
    );
    bytes32 private constant MUTUAL_TYPEHASH = keccak256(
        "ProofKeyMutualV1(bytes32 epochId,bytes32 orderId,uint32 milestoneId,bytes32 deliveryHash,uint64 stateVersion,uint256 workAmount,uint64 proposalNonce)"
    );
    bytes32 private constant RULING_TYPEHASH = keccak256(
        "ProofKeyRulingV1(bytes32 epochId,bytes32 orderId,uint32 milestoneId,bytes32 deliveryHash,uint64 stateVersion,uint256 workAmount,uint64 proposalNonce)"
    );

    error InvalidSignature();

    function domainSeparator(address coordinator) public view returns (bytes32) {
        return keccak256(abi.encode(
            EIP712_DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, coordinator
        ));
    }

    function typedDataHash(address coordinator, bytes32 structHash) public view returns (bytes32) {
        return keccak256(abi.encodePacked(hex"1901", domainSeparator(coordinator), structHash));
    }

    function quoteDigest(address coordinator, bytes32 orderId) public view returns (bytes32) {
        return typedDataHash(coordinator, keccak256(abi.encode(QUOTE_TYPEHASH, orderId)));
    }

    function acceptanceDigest(address coordinator, bytes32 orderId) public view returns (bytes32) {
        return typedDataHash(coordinator, keccak256(abi.encode(ACCEPT_TYPEHASH, orderId)));
    }

    function revocationDigest(address coordinator, bytes32 epochId, address worker, uint64 nonce)
        public view returns (bytes32)
    {
        return typedDataHash(coordinator, keccak256(abi.encode(REVOKE_QUOTE_TYPEHASH, epochId, worker, nonce)));
    }

    function proposalDigest(
        address coordinator,
        bool mutual,
        bytes32 epochId,
        bytes32 orderId,
        uint32 milestoneId,
        bytes32 deliveryHash,
        uint64 stateVersion,
        uint256 workAmount,
        uint64 proposalNonce
    ) public view returns (bytes32) {
        return typedDataHash(coordinator, keccak256(abi.encode(
            mutual ? MUTUAL_TYPEHASH : RULING_TYPEHASH,
            epochId,
            orderId,
            milestoneId,
            deliveryHash,
            stateVersion,
            workAmount,
            proposalNonce
        )));
    }

    function requireAuthorization(
        address signer,
        address sender,
        bytes32 digest,
        bytes memory signature
    ) public view {
        if (signer == address(0)) revert InvalidSignature();
        if (signature.length == 0) {
            if (sender != signer) revert InvalidSignature();
            return;
        }
        if (signer.code.length != 0) {
            (bool ok, bytes memory result) = signer.staticcall(
                abi.encodeWithSelector(EIP1271_MAGIC, digest, signature)
            );
            if (!ok || result.length < 32 || bytes4(result) != EIP1271_MAGIC) revert InvalidSignature();
            return;
        }
        if (signature.length != 65) revert InvalidSignature();
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(signature, 32))
            s := mload(add(signature, 64))
            v := byte(0, mload(add(signature, 96)))
        }
        if (uint256(s) > SECP256K1_HALF_N || (v != 27 && v != 28) || ecrecover(digest, v, r, s) != signer) {
            revert InvalidSignature();
        }
    }
}
