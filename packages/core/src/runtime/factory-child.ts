import type { Address, Hash } from "viem";
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
import { isLogFactoryMatched } from "./filter.js";

/**
 * Returns the child that each of `logs` announces for a factory with a `child`
 * function, keyed by log, or `undefined` for a log that announces none. Logs
 * that `factory` does not match are skipped. Empty for any other factory.
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
}): Promise<Map<SyncLog, Address | undefined>> => {
  const child = factory.child;
  if (child === undefined) return new Map();

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

      const value = child({ log, transaction, receipt });
      return value === undefined ? undefined : (toLowerCase(value) as Address);
    }),
  );

  return new Map(matchedLogs.map((log, i) => [log, children[i]]));
};
