import { readFile, writeFile } from "node:fs/promises";
import { AbiCoder, keccak256, toUtf8Bytes } from "ethers";
import { deriveWorkAuthorizationOrderTerms } from "../sdk/work-authorization.ts";
import { quoteDigest } from "../sdk/identity.ts";

const source = await readFile(new URL("../schema/work-authorization-v1-vectors.json", import.meta.url), "utf8");
const vector = JSON.parse(source);
const config = vector.authorization.epochConfig;
const order = deriveWorkAuthorizationOrderTerms(vector.authorization);
const epochTuple = "tuple(uint256 sourceChainId,uint64 sourceChainKey,address sourceCoordinator,bytes32 sourceVersion,uint256 targetChainId,address targetTreasury,bytes32 schemaVersion,address sourceSafe,address sponsor,address refundBeneficiary,address asset,uint256 cap,bytes32 policyHash,uint64 initializationCutoff,uint64 admissionCutoff,uint32 maxMilestones,uint32 maxActiveReturns,uint32 maxDrainingReturns,uint8 treeDepth,uint64 nonce)";
const orderTuple = "tuple(bytes32 epochId,bytes32 termsHash,address worker,address claimOwner,address destination,address feeOwner,address feeDestination,address[3] committee,uint64 acceptBefore,uint64 nonce,tuple(uint256 work,uint256 fee,uint256 timeoutWork,uint64 deliverBefore,uint64 reviewBefore,uint64 ruleBefore)[] milestones)";
const abi = AbiCoder.defaultAbiCoder();
await writeFile(new URL("../schema/work-authorization-conformance-v1.json", import.meta.url), JSON.stringify({
  version: "proofkey.work-authorization.solidity-conformance.v1",
  sourceVectorHash: keccak256(toUtf8Bytes(source)),
  epochAbi: abi.encode([epochTuple], [config]),
  orderAbi: abi.encode([orderTuple], [order]),
  quoteDigest: quoteDigest({ chainId: BigInt(config.sourceChainId), coordinator: config.sourceCoordinator, orderId: vector.orderId }),
}, null, 2) + "\n");
