export const CLAIM_PACKAGE_VERSION = "proofkey.work-treasury.claim-package.v1" as const;

export type Hex = `0x${string}`;
export type Address = `0x${string}`;

export const AllocationKind = {
  WORK: 1,
  FEE: 2,
  RETURN: 3,
} as const;

export const AllocationRole = {
  EPOCH: 0,
  WORKER: 1,
  FEE: 2,
} as const;

export const EpochPhase = {
  ACTIVE: 1,
  DRAINING: 2,
  CLOSED: 3,
} as const;

export interface AllocationV1 {
  epochId: Hex;
  allocationId: bigint;
  treeIndex: number;
  kind: number;
  orderId: Hex;
  milestoneId: number;
  role: number;
  asset: Address;
  amount: bigint;
  claimOwner: Address;
  destination: Address;
  policyHash: Hex;
  evidenceHash: Hex;
}

export interface SerializedAllocationV1 extends Omit<AllocationV1, "allocationId" | "amount"> {
  allocationId: string;
  amount: string;
}

export interface CheckpointV1 {
  epochId: Hex;
  root: Hex;
  leafCount: number;
  earned: bigint;
  returned: bigint;
  phase: number;
}

export interface NativePosition {
  sourceChainKey: bigint;
  blockHeight: bigint;
  transactionIndex: bigint;
  profileId: Hex;
}

export interface AuthenticationReference extends NativePosition {
  encodedTransactionHash: Hex;
}

export interface NativeProofMaterial {
  blockHeight: bigint;
  encodedTransaction: Hex;
  merkleProof: {
    root: Hex;
    siblings: Array<{ hash: Hex; isLeft: boolean }>;
  };
  continuityProof: {
    lowerEndpointDigest: Hex;
    roots: Hex[];
  };
}

export interface CheckpointClaimPackage {
  version: typeof CLAIM_PACKAGE_VERSION;
  route: "checkpoint";
  createdAt: string;
  allocation: SerializedAllocationV1;
  siblings: Hex[];
  checkpoint: {
    checkpointId: Hex;
    root: Hex;
    leafCount: number;
    receiptLocalLogOrdinal?: number;
    authentication?: AuthenticationReference;
    material?: NativeProofMaterial;
  };
}

export interface ReceiptClaimPackage {
  version: typeof CLAIM_PACKAGE_VERSION;
  route: "receipt";
  createdAt: string;
  allocation: SerializedAllocationV1;
  receiptLocalLogOrdinal: number;
  encodedTransaction: Hex;
  authentication?: AuthenticationReference;
  material?: NativeProofMaterial;
}

export type ClaimPackage = CheckpointClaimPackage | ReceiptClaimPackage;

export interface ContractArtifact {
  contractName: string;
  sourceName: string;
  abi: readonly unknown[];
  /** Hash of unlinked compiler output only. This is never presented as deployed-bytecode correspondence. */
  compiledTemplateCodeHash?: Hex;
}

export interface AbiManifest {
  generatedAt: string;
  contracts: Record<string, ContractArtifact>;
}

export interface ChainConnection {
  label: string;
  chainId: bigint;
  rpcUrl: string;
  confirmations: number;
  coordinator?: Address;
  treasury?: Address;
  invoiceBook?: Address;
}

export interface EpochConfigV1 {
  sourceChainId: bigint;
  sourceChainKey: bigint;
  sourceCoordinator: Address;
  sourceVersion: Hex;
  targetChainId: bigint;
  targetTreasury: Address;
  schemaVersion: Hex;
  sourceSafe: Address;
  sponsor: Address;
  refundBeneficiary: Address;
  asset: Address;
  cap: bigint;
  policyHash: Hex;
  initializationCutoff: bigint;
  admissionCutoff: bigint;
  maxMilestones: number;
  maxActiveReturns: number;
  maxDrainingReturns: number;
  treeDepth: number;
  nonce: bigint;
}

export interface MilestoneTermsV1 {
  work: bigint;
  fee: bigint;
  timeoutWork: bigint;
  deliverBefore: bigint;
  reviewBefore: bigint;
  ruleBefore: bigint;
}

export interface OrderTermsV1 {
  epochId: Hex;
  termsHash: Hex;
  worker: Address;
  claimOwner: Address;
  destination: Address;
  feeOwner: Address;
  feeDestination: Address;
  committee: readonly [Address, Address, Address];
  acceptBefore: bigint;
  nonce: bigint;
  milestones: readonly MilestoneTermsV1[];
}

export interface StoredWorkspace {
  source?: ChainConnection;
  target?: ChainConnection;
  lastEpochId?: Hex;
  proofServiceUrl?: string;
}
