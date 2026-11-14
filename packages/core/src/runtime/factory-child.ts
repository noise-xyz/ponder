import { type Address, type Hash, type Hex, hexToNumber } from "viem";
import { NonRetryableUserError } from "@/internal/errors.js";
import type {
  Factory,
  SyncBlock,
  SyncLog,
  SyncTransaction,
} from "@/internal/types.js";
import {
  eth_getBlockByHash,
  eth_getTransactionReceipt,
} from "@/rpc/actions.js";
import type { Rpc } from "@/rpc/index.js";
import { toLowerCase } from "@/utils/lowercase.js";
import { getChildAddress, isLogFactoryMatched } from "./filter.js";

/**
 * Returns a function that gives the child a factory log announces, or
 * `undefined` if it announces none. For a factory with a `child` function, the
 * children of `logs` are resolved up front; otherwise the child is decoded from
 * the log, which throws if the log does not hold one.
 *
 * @dev Reads each matched log's transaction and receipt. `blocks` supplies
 * transactions the caller already has; any other block is fetched once.
 */
export const getFactoryChildren = async ({
  factory,
  logs,
  rpc,
  blocks = [],
  context,
}: {
  factory: Factory;
  logs: SyncLog[];
  rpc: Rpc;
  blocks?: SyncBlock[];
  context?: Parameters<Rpc["request"]>[1];
}): Promise<(log: SyncLog) => Address | undefined> => {
  const child = factory.child;
  if (child === undefined) return (log) => getChildAddress({ log, factory });

  const matchedLogs = logs.filter((log) =>
    isLogFactoryMatched({ factory, log }),
  );

  const blocksByHash = new Map<Hash, Promise<SyncBlock>>(
    blocks.map((block) => [block.hash, Promise.resolve(block)]),
  );
  const getBlock = (hash: Hash) => {
    if (blocksByHash.has(hash) === false) {
      blocksByHash.set(hash, eth_getBlockByHash(rpc, [hash, true], context));
    }
    return blocksByHash.get(hash)!;
  };

  const children = await Promise.all(
    matchedLogs.map(async (log) => {
      const [block, receipt] = await Promise.all([
        getBlock(log.blockHash),
        eth_getTransactionReceipt(rpc, [log.transactionHash], context),
      ]);

      const transaction = block.transactions.find(
        (transaction: SyncTransaction) =>
          transaction.hash === log.transactionHash,
      );
      if (transaction === undefined || receipt.blockHash !== log.blockHash) {
        throw new Error(
          `Failed to read the transaction of factory log ${log.transactionHash}:${log.logIndex} in block ${log.blockHash}.`,
        );
      }

      let value: Hex | undefined;
      try {
        value = child({ log, transaction, receipt });
      } catch (error) {
        throw new NonRetryableUserError(
          `Factory 'child' function of '${factory.sourceId}' (${factory.childAddressLocation}) failed for log ${log.transactionHash}:${hexToNumber(log.logIndex)}: ${(error as Error).message}`,
        );
      }
      return value === undefined ? undefined : (toLowerCase(value) as Address);
    }),
  );

  const childrenByLog = new Map(
    matchedLogs.map((log, i) => [log, children[i]]),
  );
  return (log) => childrenByLog.get(log);
};
