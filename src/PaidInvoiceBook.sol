// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {WorkTypes} from "./WorkTypes.sol";

interface IWorkTreasuryPaidRead {
    function economicId(bytes32 epochId, uint64 allocationId) external pure returns (bytes32);
    function completedClaim(bytes32 epochId, uint64 allocationId)
        external
        view
        returns (WorkTypes.Allocation memory allocation, bool withdrawn, address paidDestination);
    function epochConfig(bytes32 epochId) external view returns (WorkTypes.EpochConfig memory);
}

/// @title PaidInvoiceBook
/// @notice Read-only consumer of completed WORK payments from one pinned WorkTreasury.
contract PaidInvoiceBook {
    struct Invoice {
        bytes32 epochId;
        uint64 allocationId;
        bytes32 orderId;
        address entitlementOwner;
        address paidDestination;
        uint256 amount;
        bool recorded;
    }

    IWorkTreasuryPaidRead public immutable TREASURY;
    address public immutable EXPECTED_BUYER;
    bytes32 public immutable EXPECTED_ORDER_ID;
    address public immutable EXPECTED_ASSET;
    bytes32 public immutable EXPECTED_POLICY_HASH;

    mapping(bytes32 economicId => Invoice) private _invoices;

    error InvalidExpectation();
    error InvoiceAlreadyRecorded(bytes32 economicId);
    error WorkPaymentNotCompleted();
    error UnexpectedBuyer(address got, address expected);
    error UnexpectedOrder(bytes32 got, bytes32 expected);
    error UnexpectedAsset(address got, address expected);
    error UnexpectedPolicy(bytes32 got, bytes32 expected);

    event PaidWorkRecorded(
        bytes32 indexed economicId,
        bytes32 indexed epochId,
        uint64 indexed allocationId,
        bytes32 orderId,
        address entitlementOwner,
        address paidDestination,
        uint256 amount
    );

    constructor(
        address treasury,
        address expectedBuyer,
        bytes32 expectedOrderId,
        address expectedAsset,
        bytes32 expectedPolicyHash
    ) {
        if (
            treasury == address(0) || expectedBuyer == address(0) || expectedOrderId == bytes32(0)
                || expectedPolicyHash == bytes32(0)
        ) revert InvalidExpectation();
        TREASURY = IWorkTreasuryPaidRead(treasury);
        EXPECTED_BUYER = expectedBuyer;
        EXPECTED_ORDER_ID = expectedOrderId;
        EXPECTED_ASSET = expectedAsset;
        EXPECTED_POLICY_HASH = expectedPolicyHash;
    }

    function invoice(bytes32 epochId, uint64 allocationId) external view returns (Invoice memory) {
        return _invoices[keccak256(abi.encode(epochId, allocationId))];
    }

    function recordPaidWork(bytes32 epochId, uint64 allocationId) external returns (bytes32 id) {
        id = TREASURY.economicId(epochId, allocationId);
        if (_invoices[id].recorded) revert InvoiceAlreadyRecorded(id);
        (WorkTypes.Allocation memory allocation, bool withdrawn, address paidDestination) =
            TREASURY.completedClaim(epochId, allocationId);
        if (!withdrawn || allocation.kind != WorkTypes.WORK || paidDestination == address(0)) {
            revert WorkPaymentNotCompleted();
        }
        WorkTypes.EpochConfig memory config = TREASURY.epochConfig(epochId);
        if (config.sourceSafe != EXPECTED_BUYER) revert UnexpectedBuyer(config.sourceSafe, EXPECTED_BUYER);
        if (allocation.orderId != EXPECTED_ORDER_ID) revert UnexpectedOrder(allocation.orderId, EXPECTED_ORDER_ID);
        if (allocation.asset != EXPECTED_ASSET) revert UnexpectedAsset(allocation.asset, EXPECTED_ASSET);
        if (allocation.policyHash != EXPECTED_POLICY_HASH) {
            revert UnexpectedPolicy(allocation.policyHash, EXPECTED_POLICY_HASH);
        }
        _invoices[id] = Invoice({
            epochId: epochId,
            allocationId: allocationId,
            orderId: allocation.orderId,
            entitlementOwner: allocation.claimOwner,
            paidDestination: paidDestination,
            amount: allocation.amount,
            recorded: true
        });
        emit PaidWorkRecorded(
            id, epochId, allocationId, allocation.orderId, allocation.claimOwner, paidDestination, allocation.amount
        );
    }
}
