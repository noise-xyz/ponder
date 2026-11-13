import type { Address, Hex, LogTopic } from "viem";
import type {
  BlockFilter,
  Factory,
  FactoryFragmentId,
  Filter,
  FilterAddress,
  Fragment,
  FragmentAddress,
  FragmentAddressId,
  FragmentFactory,
  FragmentId,
  FragmentTopic,
  LogFilter,
  TraceFilter,
  TransactionFilter,
  TransferFilter,
} from "@/internal/types.js";
import { dedupe } from "@/utils/dedupe.js";
import { toLowerCase } from "@/utils/lowercase.js";
import { isAddressFactory } from "./filter.js";

export const isFragmentAddressFactory = (
  fragmentAddress: FragmentAddress,
): boolean => {
  if (fragmentAddress === null) return false;
  if (typeof fragmentAddress === "string") return false;
  return true;
};

/**
 * Encodes a factory's event selector and `filter` topics as one ID segment. A
 * factory without a filter keeps the bare selector, so existing IDs stay valid.
 */
const encodeFactoryEvent = ({
  eventSelector,
  topics,
}: {
  eventSelector: Hex;
  topics?: Factory["topics"];
}): string =>
  topics === undefined
    ? eventSelector
    : [eventSelector, ...topics.map((topic) => topic ?? "null")].join(":");

const decodeFactoryEvent = (
  segment: string,
): { eventSelector: Hex; topics?: Factory["topics"] } => {
  const [eventSelector, ...topics] = segment.split(":");
  return topics.length === 0
    ? { eventSelector: eventSelector as Hex }
    : {
        eventSelector: eventSelector as Hex,
        topics: topics.map((topic) =>
          topic === "null" ? null : (topic as Hex),
        ) as Factory["topics"],
      };
};

const toFragmentFactory = (factory: Factory, address: Address | null) =>
  ({
    address,
    eventSelector: factory.eventSelector,
    ...(factory.topics === undefined ? {} : { topics: factory.topics }),
    childAddressLocation: factory.childAddressLocation,
    fromBlock: factory.fromBlock ?? null,
    toBlock: factory.toBlock ?? null,
  }) satisfies FragmentFactory;

/** The static part of a log fragment topic. A child topic has none. */
const staticTopic = (topic: FragmentTopic): Hex | null =>
  typeof topic === "string" ? topic : null;

/**
 * Encode a log fragment topic. A child topic's factory is joined with "|", so
 * that the fragment id keeps one "_"-separated field per topic.
 */
const fragmentTopicToId = (topic: FragmentTopic): string =>
  topic === null || typeof topic === "string"
    ? `${topic}`
    : fragmentAddressToId(topic)!.replaceAll("_", "|");

type FragmentReturnType = {
  fragment: Fragment;
  adjacentIds: FragmentId[];
}[];

export const getFragments = (filter: Filter): FragmentReturnType => {
  switch (filter.type) {
    case "block":
      return getBlockFilterFragment(filter as BlockFilter);
    case "transaction":
      return getTransactionFilterFragments(filter as TransactionFilter);
    case "trace":
      return getTraceFilterFragments(filter as TraceFilter);
    case "log":
      return getLogFilterFragments(filter as LogFilter);
    case "transfer":
      return getTransferFilterFragments(filter as TransferFilter);
  }
};

export const getFactoryFragments = (factory: Factory): Fragment[] => {
  const fragments: Fragment[] = [];

  for (const fragmentAddress of Array.isArray(factory.address)
    ? factory.address
    : [factory.address]) {
    const fragment = {
      type: "factory_log",
      chainId: factory.chainId,
      address: fragmentAddress ?? null,
      eventSelector: factory.eventSelector,
      ...(factory.topics === undefined ? {} : { topics: factory.topics }),
      childAddressLocation: factory.childAddressLocation,
      fromBlock: factory.fromBlock ?? null,
      toBlock: factory.toBlock ?? null,
    } satisfies Fragment;

    fragments.push(fragment);
  }

  return fragments;
};

/** Returns the IDs of the `factory_log` fragments of `factory`, one per parent address. */
export const getFactoryFragmentIds = (factory: Factory): FactoryFragmentId[] =>
  getFactoryFragments(factory).map(encodeFragment) as FactoryFragmentId[];

/**
 * Returns the ID of the `factory_log` fragment for the parent that emitted `log`.
 */
export const getFactoryFragmentId = (
  factory: Factory,
  parentAddress: Address,
): FactoryFragmentId =>
  encodeFragment({
    type: "factory_log",
    chainId: factory.chainId,
    address: factory.address === undefined ? null : toLowerCase(parentAddress),
    eventSelector: factory.eventSelector,
    ...(factory.topics === undefined ? {} : { topics: factory.topics }),
    childAddressLocation: factory.childAddressLocation,
    fromBlock: factory.fromBlock ?? null,
    toBlock: factory.toBlock ?? null,
  }) as FactoryFragmentId;

export const getAddressFragments = (
  address: Address | Address[] | Factory | undefined,
) => {
  const fragments: {
    fragment: FragmentAddress;
    adjacentIds: FragmentAddressId[];
  }[] = [];

  if (isAddressFactory(address)) {
    for (const fragmentAddress of Array.isArray(address.address)
      ? address.address
      : [address.address]) {
      const fragment = toFragmentFactory(address, fragmentAddress ?? null);

      fragments.push({
        fragment,
        adjacentIds: [fragmentAddressToId(fragment)],
      });
    }
  } else {
    for (const fragmentAddress of Array.isArray(address)
      ? address
      : [address ?? null]) {
      fragments.push({
        fragment: fragmentAddress,
        adjacentIds: fragmentAddress
          ? [fragmentAddress, null]
          : [fragmentAddress],
      });
    }
  }

  return fragments;
};

export const getBlockFilterFragment = ({
  chainId,
  interval,
  offset,
}: Omit<BlockFilter, "fromBlock" | "toBlock">): FragmentReturnType => {
  return [
    {
      fragment: {
        type: "block",
        chainId,
        interval,
        offset,
      },
      adjacentIds: [`block_${chainId}_${interval}_${offset}`],
    },
  ];
};

export const getTransactionFilterFragments = ({
  chainId,
  fromAddress,
  toAddress,
}: Omit<TransactionFilter, "fromBlock" | "toBlock"> & {
  chainId: number;
}): FragmentReturnType => {
  const fragments: FragmentReturnType = [];
  const fromAddressFragments = getAddressFragments(fromAddress);
  const toAddressFragments = getAddressFragments(toAddress);

  for (const fromAddressFragment of fromAddressFragments) {
    for (const toAddressFragment of toAddressFragments) {
      const fragment = {
        type: "transaction",
        chainId,
        fromAddress: fromAddressFragment.fragment,
        toAddress: toAddressFragment.fragment,
      } satisfies Fragment;

      const adjacentIds: FragmentId[] = [];

      for (const fromAddressAdjacentId of fromAddressFragment.adjacentIds) {
        for (const toAddressAdjacentId of toAddressFragment.adjacentIds) {
          adjacentIds.push(
            `transaction_${chainId}_${fromAddressAdjacentId}_${toAddressAdjacentId}`,
          );
        }
      }

      fragments.push({ fragment, adjacentIds });
    }
  }

  return fragments;
};

export const getTraceFilterFragments = ({
  chainId,
  fromAddress,
  toAddress,
  callType,
  functionSelector,
  ...filter
}: Omit<TraceFilter, "fromBlock" | "toBlock"> & {
  chainId: number;
}): FragmentReturnType => {
  const fragments: FragmentReturnType = [];
  const fromAddressFragments = getAddressFragments(fromAddress);
  const toAddressFragments = getAddressFragments(toAddress);

  for (const fromAddressFragment of fromAddressFragments) {
    for (const toAddressFragment of toAddressFragments) {
      const fragment = {
        type: "trace",
        chainId,
        fromAddress: fromAddressFragment.fragment,
        toAddress: toAddressFragment.fragment,
        functionSelector,
        includeTransactionReceipts: filter.hasTransactionReceipt,
      } satisfies Fragment;

      const adjacentIds: FragmentId[] = [];

      for (const fromAddressAdjacentId of fromAddressFragment.adjacentIds) {
        for (const toAddressAdjacentId of toAddressFragment.adjacentIds) {
          for (const adjacentTxr of filter.hasTransactionReceipt
            ? [1]
            : [0, 1]) {
            adjacentIds.push(
              `trace_${chainId}_${fromAddressAdjacentId}_${toAddressAdjacentId}_${functionSelector}_${adjacentTxr as 0 | 1}`,
            );
          }
        }
      }

      fragments.push({ fragment, adjacentIds });
    }
  }

  return fragments;
};

export const getLogFilterFragments = ({
  chainId,
  address,
  topic0,
  topic1: staticTopic1,
  topic2: staticTopic2,
  topic3: staticTopic3,
  childTopic,
  ...filter
}: Omit<LogFilter, "fromBlock" | "toBlock">): FragmentReturnType => {
  const fragments: FragmentReturnType = [];
  const addressFragments = getAddressFragments(address);
  const eventSelector = topic0;

  // A child topic is one fragment per parent address of its factory. Only the
  // same factory's coverage satisfies it.
  const childTopicFragments = (index: 1 | 2 | 3, staticValue: LogTopic) =>
    childTopic?.index === index
      ? (Array.isArray(childTopic.factory.address)
          ? childTopic.factory.address
          : [childTopic.factory.address ?? null]
        ).map((parent) => toFragmentFactory(childTopic.factory, parent))
      : Array.isArray(staticValue)
        ? staticValue
        : [staticValue];

  const topic1 = childTopicFragments(1, staticTopic1);
  const topic2 = childTopicFragments(2, staticTopic2);
  const topic3 = childTopicFragments(3, staticTopic3);
  const adjacentTopics = (topic: FragmentTopic | undefined): string[] =>
    topic === null || topic === undefined
      ? ["null"]
      : typeof topic === "string"
        ? [topic, "null"]
        : [fragmentTopicToId(topic)];

  for (const addressFragment of addressFragments) {
    for (const fragmentTopic1 of topic1) {
      for (const fragmentTopic2 of topic2) {
        for (const fragmentTopic3 of topic3) {
          const fragment = {
            type: "log",
            chainId,
            address: addressFragment.fragment,
            topic0: eventSelector,
            topic1: fragmentTopic1 ?? null,
            topic2: fragmentTopic2 ?? null,
            topic3: fragmentTopic3 ?? null,
            includeTransactionReceipts: filter.hasTransactionReceipt,
          } satisfies Fragment;

          const adjacentIds: FragmentId[] = [];

          for (const addressAdjacentId of addressFragment.adjacentIds) {
            for (const adjacentTopic1 of adjacentTopics(fragmentTopic1)) {
              for (const adjacentTopic2 of adjacentTopics(fragmentTopic2)) {
                for (const adjacentTopic3 of adjacentTopics(fragmentTopic3)) {
                  for (const adjacentTxr of filter.hasTransactionReceipt
                    ? [1]
                    : [0, 1]) {
                    adjacentIds.push(
                      `log_${chainId}_${addressAdjacentId}_${eventSelector}_${adjacentTopic1}_${adjacentTopic2}_${adjacentTopic3}_${adjacentTxr as 0 | 1}` as FragmentId,
                    );
                  }
                }
              }
            }
          }

          fragments.push({ fragment, adjacentIds });
        }
      }
    }
  }

  return fragments;
};

export const getTransferFilterFragments = ({
  chainId,
  fromAddress,
  toAddress,
  ...filter
}: Omit<TransferFilter, "fromBlock" | "toBlock"> & {
  chainId: number;
}): FragmentReturnType => {
  const fragments: FragmentReturnType = [];
  const fromAddressFragments = getAddressFragments(fromAddress);
  const toAddressFragments = getAddressFragments(toAddress);

  for (const fromAddressFragment of fromAddressFragments) {
    for (const toAddressFragment of toAddressFragments) {
      const fragment = {
        type: "transfer",
        chainId,
        fromAddress: fromAddressFragment.fragment,
        toAddress: toAddressFragment.fragment,
        includeTransactionReceipts: filter.hasTransactionReceipt,
      } satisfies Fragment;

      const adjacentIds: FragmentId[] = [];

      for (const fromAddressAdjacentId of fromAddressFragment.adjacentIds) {
        for (const toAddressAdjacentId of toAddressFragment.adjacentIds) {
          for (const adjacentTxr of filter.hasTransactionReceipt
            ? [1]
            : [0, 1]) {
            adjacentIds.push(
              `transfer_${chainId}_${fromAddressAdjacentId}_${toAddressAdjacentId}_${adjacentTxr as 0 | 1}`,
            );
          }
        }
      }

      fragments.push({ fragment, adjacentIds });
    }
  }

  return fragments;
};

export const fragmentAddressToId = (
  fragmentAddress: FragmentAddress,
): FragmentAddressId => {
  if (fragmentAddress === null) return null;
  if (typeof fragmentAddress === "string") return fragmentAddress;
  return `${fragmentAddress.address}_${encodeFactoryEvent(fragmentAddress)}_${fragmentAddress.childAddressLocation}_${fragmentAddress.fromBlock}_${fragmentAddress.toBlock}` as FragmentAddressId;
};

export const encodeFragment = (fragment: Fragment): FragmentId => {
  switch (fragment.type) {
    case "block":
      return `block_${fragment.chainId}_${fragment.interval}_${fragment.offset}`;
    case "transaction":
      return `transaction_${fragment.chainId}_${fragmentAddressToId(fragment.fromAddress)}_${fragmentAddressToId(fragment.toAddress)}`;
    case "trace":
      return `trace_${fragment.chainId}_${fragmentAddressToId(fragment.fromAddress)}_${fragmentAddressToId(fragment.toAddress)}_${fragment.functionSelector}_${fragment.includeTransactionReceipts ? 1 : 0}`;
    case "log":
      return `log_${fragment.chainId}_${fragmentAddressToId(fragment.address)}_${fragment.topic0}_${fragmentTopicToId(fragment.topic1)}_${fragmentTopicToId(fragment.topic2)}_${fragmentTopicToId(fragment.topic3)}_${fragment.includeTransactionReceipts ? 1 : 0}`;
    case "transfer":
      return `transfer_${fragment.chainId}_${fragmentAddressToId(fragment.fromAddress)}_${fragmentAddressToId(fragment.toAddress)}_${fragment.includeTransactionReceipts ? 1 : 0}`;
    case "factory_log":
      return `factory_log_${fragment.chainId}_${fragment.address}_${encodeFactoryEvent(fragment)}_${fragment.childAddressLocation}_${fragment.fromBlock}_${fragment.toBlock}`;
  }
};

export const decodeFragment = (fragmentId: FragmentId): Fragment => {
  const [type, chainId] = fragmentId.split("_");

  const decodeFragmentAddress = (
    offset: number,
    fragmentAddressId = fragmentId.split("_").slice(offset),
  ): FragmentAddress => {
    // Note: A factory without an address starts with "null", so it must be
    // detected before the null address.
    if (
      fragmentAddressId.length >= 3 &&
      (fragmentAddressId[2]!.startsWith("topic") ||
        fragmentAddressId[2]!.startsWith("offset") ||
        fragmentAddressId[2]!.startsWith("child:"))
    ) {
      return {
        address:
          fragmentAddressId[0] === "null"
            ? null
            : (fragmentAddressId[0] as Address),
        ...decodeFactoryEvent(fragmentAddressId[1]!),
        childAddressLocation:
          fragmentAddressId[2] as Factory["childAddressLocation"],
        fromBlock:
          fragmentAddressId[3] === "null" ? null : Number(fragmentAddressId[3]),
        toBlock:
          fragmentAddressId[4] === "null" ? null : Number(fragmentAddressId[4]),
      } satisfies FragmentAddress;
    }

    if (fragmentAddressId[0] === "null") {
      return null;
    }

    return fragmentAddressId[0] as Address;
  };

  const decodeFragmentTopic = (topicId: string): FragmentTopic =>
    topicId === "null"
      ? null
      : topicId.includes("|")
        ? (decodeFragmentAddress(0, topicId.split("|")) as FragmentFactory)
        : (topicId as Hex);

  switch (type! as Fragment["type"]) {
    case "block": {
      const [, chainId, interval, offset] = fragmentId.split("_");
      return {
        type: "block",
        chainId: Number(chainId),
        interval: Number(interval),
        offset: Number(offset),
      };
    }
    case "transaction": {
      const fragmentFromAddress = decodeFragmentAddress(2);
      if (isFragmentAddressFactory(fragmentFromAddress)) {
        const fragmentToAddress = decodeFragmentAddress(7);
        return {
          type: "transaction",
          chainId: Number(chainId),
          fromAddress: fragmentFromAddress,
          toAddress: fragmentToAddress,
        };
      }

      const fragmentToAddress = decodeFragmentAddress(3);
      return {
        type: "transaction",
        chainId: Number(chainId),
        fromAddress: fragmentFromAddress,
        toAddress: fragmentToAddress,
      };
    }
    case "trace": {
      const fragmentFromAddress = decodeFragmentAddress(2);
      if (isFragmentAddressFactory(fragmentFromAddress)) {
        const fragmentToAddress = decodeFragmentAddress(7);
        if (isFragmentAddressFactory(fragmentToAddress)) {
          const [, , , , , , , , , , , , functionSelector, includeTxr] =
            fragmentId.split("_");
          return {
            type: "trace",
            chainId: Number(chainId),
            fromAddress: fragmentFromAddress,
            toAddress: fragmentToAddress,
            functionSelector: functionSelector as Hex,
            includeTransactionReceipts: includeTxr === "1",
          };
        }
        const [, , , , , , , , functionSelector, includeTxr] =
          fragmentId.split("_");
        return {
          type: "trace",
          chainId: Number(chainId),
          fromAddress: fragmentFromAddress,
          toAddress: fragmentToAddress,
          functionSelector: functionSelector as Hex,
          includeTransactionReceipts: includeTxr === "1",
        };
      }

      const fragmentToAddress = decodeFragmentAddress(3);
      if (isFragmentAddressFactory(fragmentToAddress)) {
        const [, , , , , , , , functionSelector, includeTxr] =
          fragmentId.split("_");
        return {
          type: "trace",
          chainId: Number(chainId),
          fromAddress: fragmentFromAddress,
          toAddress: fragmentToAddress,
          functionSelector: functionSelector as Hex,
          includeTransactionReceipts: includeTxr === "1",
        };
      }

      const [, , , , functionSelector, includeTxr] = fragmentId.split("_");
      return {
        type: "trace",
        chainId: Number(chainId),
        fromAddress: fragmentFromAddress,
        toAddress: fragmentToAddress,
        functionSelector: functionSelector as Hex,
        includeTransactionReceipts: includeTxr === "1",
      };
    }
    case "log": {
      const fragmentAddress = decodeFragmentAddress(2);
      if (isFragmentAddressFactory(fragmentAddress)) {
        const [, , , , , , , topic0, topic1, topic2, topic3, includeTxr] =
          fragmentId.split("_");
        return {
          type: "log",
          chainId: Number(chainId),
          address: fragmentAddress,
          topic0: topic0 as Hex,
          topic1: decodeFragmentTopic(topic1!),
          topic2: decodeFragmentTopic(topic2!),
          topic3: decodeFragmentTopic(topic3!),
          includeTransactionReceipts: includeTxr === "1",
        };
      }

      const [, , , topic0, topic1, topic2, topic3, includeTxr] =
        fragmentId.split("_");

      return {
        type: "log",
        chainId: Number(chainId),
        address: fragmentAddress,
        topic0: topic0 as Hex,
        topic1: decodeFragmentTopic(topic1!),
        topic2: decodeFragmentTopic(topic2!),
        topic3: decodeFragmentTopic(topic3!),
        includeTransactionReceipts: includeTxr === "1",
      };
    }
    case "transfer": {
      const fragmentFromAddress = decodeFragmentAddress(2);
      if (isFragmentAddressFactory(fragmentFromAddress)) {
        const fragmentToAddress = decodeFragmentAddress(7);
        if (isFragmentAddressFactory(fragmentToAddress)) {
          const [, , , , , , , , , , , , includeTxr] = fragmentId.split("_");
          return {
            type: "transfer",
            chainId: Number(chainId),
            fromAddress: fragmentFromAddress,
            toAddress: fragmentToAddress,
            includeTransactionReceipts: includeTxr === "1",
          };
        }
        const [, , , , , , , , includeTxr] = fragmentId.split("_");
        return {
          type: "transfer",
          chainId: Number(chainId),
          fromAddress: fragmentFromAddress,
          toAddress: fragmentToAddress,
          includeTransactionReceipts: includeTxr === "1",
        };
      }

      const fragmentToAddress = decodeFragmentAddress(3);
      if (isFragmentAddressFactory(fragmentToAddress)) {
        const [, , , , , , , , includeTxr] = fragmentId.split("_");
        return {
          type: "transfer",
          chainId: Number(chainId),
          fromAddress: fragmentFromAddress,
          toAddress: fragmentToAddress,
          includeTransactionReceipts: includeTxr === "1",
        };
      }

      const [, , , , includeTxr] = fragmentId.split("_");
      return {
        type: "transfer",
        chainId: Number(chainId),
        fromAddress: fragmentFromAddress,
        toAddress: fragmentToAddress,
        includeTransactionReceipts: includeTxr === "1",
      };
    }
    case "factory_log": {
      const [
        ,
        chainId,
        address,
        eventSelector,
        childAddressLocation,
        fromBlock,
        toBlock,
      ] = fragmentId.split("_");
      return {
        type: "factory_log",
        chainId: Number(chainId),
        address: address as Address,
        ...decodeFactoryEvent(eventSelector!),
        childAddressLocation:
          childAddressLocation as Factory["childAddressLocation"],
        fromBlock: fromBlock ? Number(fromBlock) : null,
        toBlock: toBlock ? Number(toBlock) : null,
      };
    }
  }
};

const recoverAddress = <filterAddress extends FilterAddress>(
  baseAddress: filterAddress,
  fragmentAddresses: FragmentAddress[],
): filterAddress => {
  if (baseAddress === undefined) return undefined as filterAddress;
  if (typeof baseAddress === "string") return baseAddress as filterAddress;
  if (Array.isArray(baseAddress)) {
    return dedupe(fragmentAddresses) as filterAddress;
  }

  // Note: At this point, `baseAddress` is a factory. The factory address is not recovered from the
  // fragments because child addresses are matched with the union of all parents of the factory.

  return baseAddress;
};

const recoverTopic = (
  base: Hex | Hex[] | null,
  fragments: (Hex | null)[],
): Hex | Hex[] | null => {
  if (base === null) return null;
  if (typeof base === "string") return base;
  return dedupe(fragments) as Hex[];
};

/** Returns `baseFactory` with only the parent addresses of `fragments`. */
export const recoverFactory = (
  baseFactory: Factory,
  fragments: Fragment[],
): Factory => {
  if (Array.isArray(baseFactory.address) === false) return baseFactory;

  return {
    ...baseFactory,
    address: dedupe(
      (fragments as Extract<Fragment, { type: "factory_log" }>[]).map(
        (fragment) => fragment.address!,
      ),
    ),
  };
};

export const recoverFilter = (
  baseFilter: Filter,
  fragments: Fragment[],
): Filter => {
  switch (baseFilter.type) {
    case "block": {
      return baseFilter;
    }
    case "transaction": {
      return {
        ...baseFilter,
        fromAddress: recoverAddress(
          baseFilter.fromAddress,
          (fragments as Extract<Fragment, { type: "transaction" }>[]).map(
            (fragment) => fragment.fromAddress,
          ),
        ),
        toAddress: recoverAddress(
          baseFilter.toAddress,
          (fragments as Extract<Fragment, { type: "transaction" }>[]).map(
            (fragment) => fragment.toAddress,
          ),
        ),
      };
    }
    case "trace": {
      return {
        ...baseFilter,
        fromAddress: recoverAddress(
          baseFilter.fromAddress,
          (fragments as Extract<Fragment, { type: "transaction" }>[]).map(
            (fragment) => fragment.fromAddress,
          ),
        ),
        toAddress: recoverAddress(
          baseFilter.toAddress,
          (fragments as Extract<Fragment, { type: "transaction" }>[]).map(
            (fragment) => fragment.toAddress,
          ),
        ),
        functionSelector: baseFilter.functionSelector,
      };
    }
    case "log": {
      return {
        ...baseFilter,
        address: recoverAddress(
          baseFilter.address,
          (fragments as Extract<Fragment, { type: "log" }>[]).map(
            (fragment) => fragment.address,
          ),
        ),
        topic0: baseFilter.topic0,
        topic1: recoverTopic(
          baseFilter.topic1,
          fragments.map((fragment) =>
            staticTopic(
              (fragment as Extract<Fragment, { type: "log" }>).topic1,
            ),
          ),
        ),
        topic2: recoverTopic(
          baseFilter.topic2,
          fragments.map((fragment) =>
            staticTopic(
              (fragment as Extract<Fragment, { type: "log" }>).topic2,
            ),
          ),
        ),
        topic3: recoverTopic(
          baseFilter.topic3,
          fragments.map((fragment) =>
            staticTopic(
              (fragment as Extract<Fragment, { type: "log" }>).topic3,
            ),
          ),
        ),
      };
    }
    case "transfer": {
      return {
        ...baseFilter,
        fromAddress: recoverAddress(
          baseFilter.fromAddress,
          (fragments as Extract<Fragment, { type: "transaction" }>[]).map(
            (fragment) => fragment.fromAddress,
          ),
        ),
        toAddress: recoverAddress(
          baseFilter.toAddress,
          (fragments as Extract<Fragment, { type: "transaction" }>[]).map(
            (fragment) => fragment.toAddress,
          ),
        ),
      };
    }
  }
};
