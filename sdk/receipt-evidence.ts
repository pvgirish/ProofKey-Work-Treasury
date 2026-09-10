import { AbiCoder, getAddress, isHexString } from "ethers";
import { decodeAllocationEvent, decodeCheckpointEvent } from "./allocation.ts";
import type { Address, AllocationV1, CheckpointV1, Hex } from "./types.ts";

const abi = AbiCoder.defaultAbiCoder();
const RECEIPT_TYPES = ["uint8", "uint64", "tuple(address,bytes32[],bytes)[]", "bytes"];

export interface NativeReceiptLogV1 { address: Address; topics: Hex[]; data: Hex }

/**
 * Decode the same ABI-v1 receipt chunk as the pinned EvmV1Decoder, then select
 * one receipt-local log. This establishes structure and semantics only; the
 * native proof or authenticated cache must separately establish authenticity.
 * Preparation requires canonical ABI encoding, stricter than abi.decode alone.
 */
export function decodeNativeReceiptLog(encoded: Hex, ordinal: number, expectedEmitter: Address): NativeReceiptLogV1 {
  if (!isHexString(encoded) || encoded === "0x") throw new Error("native receipt bytes are empty or malformed");
  if (!Number.isSafeInteger(ordinal) || ordinal < 0) throw new Error("receipt-local log ordinal is invalid");
  const [type, decodedChunks] = abi.decode(["uint8", "bytes[]"], encoded);
  const txType = Number(type), chunks = Array.from(decodedChunks, String);
  if (txType < 0 || txType > 4) throw new Error("unsupported ABI-v1 transaction type");
  if (chunks.length !== (txType <= 2 ? 3 : 4)) throw new Error("native transaction has an invalid receipt chunk count");
  if (abi.encode(["uint8", "bytes[]"], [type, chunks]).toLowerCase() !== encoded.toLowerCase()) throw new Error("native transaction has noncanonical ABI encoding");
  const receiptBytes = chunks[txType <= 2 ? 2 : 3]!;
  const [status, gasUsed, decodedLogs, bloom] = abi.decode(RECEIPT_TYPES, receiptBytes);
  if (status !== 1n) throw new Error("native source receipt did not succeed");
  const logs = Array.from(decodedLogs, (log: any) => [getAddress(log[0]), Array.from(log[1], String), String(log[2])]);
  if (abi.encode(RECEIPT_TYPES, [status, gasUsed, logs, bloom]).toLowerCase() !== receiptBytes.toLowerCase()) throw new Error("native receipt has noncanonical ABI encoding");
  if (ordinal >= logs.length) throw new Error("receipt-local log ordinal is outside the source receipt");
  const log = logs[ordinal]!;
  if (String(log[0]).toLowerCase() !== getAddress(expectedEmitter).toLowerCase()) throw new Error("selected native log was not emitted by the pinned source coordinator");
  return { address: log[0] as Address, topics: log[1] as Hex[], data: log[2] as Hex };
}

export function decodeNativeAllocation(encoded: Hex, ordinal: number, expectedEmitter: Address): AllocationV1 {
  const log = decodeNativeReceiptLog(encoded, ordinal, expectedEmitter);
  return decodeAllocationEvent(log.topics, log.data);
}

export function decodeNativeCheckpoint(encoded: Hex, ordinal: number, expectedEmitter: Address): CheckpointV1 {
  const log = decodeNativeReceiptLog(encoded, ordinal, expectedEmitter);
  return decodeCheckpointEvent(log.topics, log.data);
}
