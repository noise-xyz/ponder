import { type Hex, keccak256 } from "viem";
import type { Factory, FactoryId, LogFilter } from "@/internal/types.js";
import { isAddressFactory } from "@/runtime/filter.js";

export const zeroLogsBloom =
  "0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";

const BLOOM_SIZE_BYTES = 256;

export type BloomBits = {
  byte0: number;
  mask0: number;
  byte1: number;
  mask1: number;
  byte2: number;
  mask2: number;
};

/**
 * A `LogFilter` with each address and topic converted to `BloomBits`.
 *
 * `undefined` matches every bloom. An array matches if any item is in the bloom.
 */
export type LogFilterBloom = {
  address: BloomBits[] | undefined;
  topics: (BloomBits[] | undefined)[];
};

export const getBloomBits = (input: Hex): BloomBits => {
  const hash = keccak256(input, "bytes");
  const bytes = [0, 0, 0];
  const masks = [0, 0, 0];

  for (let i = 0; i < 3; i++) {
    const bit = (hash[i * 2 + 1]! + (hash[i * 2]! << 8)) & 0x7ff;
    bytes[i] = BLOOM_SIZE_BYTES - 1 - Math.floor(bit / 8);
    masks[i] = 1 << (bit % 8);
  }

  return {
    byte0: bytes[0]!,
    mask0: masks[0]!,
    byte1: bytes[1]!,
    mask1: masks[1]!,
    byte2: bytes[2]!,
    mask2: masks[2]!,
  };
};

export const isBloomBitsInBloom = (
  bloom: Uint8Array,
  bits: BloomBits,
): boolean =>
  (bloom[bits.byte0]! & bits.mask0) !== 0 &&
  (bloom[bits.byte1]! & bits.mask1) !== 0 &&
  (bloom[bits.byte2]! & bits.mask2) !== 0;

export const isInBloom = (bloom: Uint8Array, input: Hex): boolean =>
  isBloomBitsInBloom(bloom, getBloomBits(input));

const isAnyInBloom = (
  bloom: Uint8Array,
  bits: BloomBits[] | undefined,
): boolean =>
  bits === undefined || bits.some((b) => isBloomBitsInBloom(bloom, b));

const toBloomBits = (
  input: Hex | Hex[] | null | undefined,
): BloomBits[] | undefined => {
  if (input === null || input === undefined) return undefined;
  if (Array.isArray(input)) return input.map(getBloomBits);
  return [getBloomBits(input)];
};

/**
 * Convert `filter` to a `LogFilterBloom`. Call once for each filter,
 * so that the inputs are not hashed again for each block.
 */
export const getLogFilterBloom = (filter: LogFilter): LogFilterBloom => {
  let address: BloomBits[] | undefined;

  if (isAddressFactory(filter.address)) {
    address = undefined;
  } else if (Array.isArray(filter.address) && filter.address.length === 0) {
    address = undefined;
  } else {
    address = toBloomBits(filter.address);
  }

  return {
    address,
    topics: [filter.topic0, filter.topic1, filter.topic2, filter.topic3].map(
      toBloomBits,
    ),
  };
};

/**
 * Return true if `filter` is in `bloom`.
 *
 * A filter with an address of type `LogFactory` matches all addresses.
 * Use `isFactoryInBloom` to check for new child contracts.
 *
 * Note: False positives are possible.
 */
export function isFilterInBloom({
  bloom,
  filter,
}: {
  bloom: Uint8Array;
  filter: LogFilterBloom;
}): boolean {
  return (
    isAnyInBloom(bloom, filter.address) &&
    filter.topics.every((topic) => isAnyInBloom(bloom, topic))
  );
}

/**
 * A `Factory` with its address and event selector converted to `BloomBits`.
 */
export type FactoryBloom = {
  address: BloomBits[] | undefined;
  eventSelector: BloomBits;
  /** The factory's `filter` topics. */
  topics: (BloomBits | undefined)[];
};

/**
 * Convert `factory` to a `FactoryBloom`. Call once for each factory,
 * so that the inputs are not hashed again for each block.
 */
export const getFactoryBloom = (factory: Factory): FactoryBloom => ({
  address: toBloomBits(factory.address),
  eventSelector: getBloomBits(factory.eventSelector),
  topics: (factory.topics ?? []).map((topic) =>
    topic === null ? undefined : getBloomBits(topic),
  ),
});

/**
 * Return true if a log that matches `factory` can be in `bloom`.
 *
 * Note: False positives are possible.
 */
export function isFactoryInBloom({
  bloom,
  factory,
}: {
  bloom: Uint8Array;
  factory: FactoryBloom;
}): boolean {
  return (
    isAnyInBloom(bloom, factory.address) &&
    isBloomBitsInBloom(bloom, factory.eventSelector) &&
    factory.topics.every(
      (topic) => topic === undefined || isBloomBitsInBloom(bloom, topic),
    )
  );
}

/**
 * Return true if a child in `children` born at or before `blockNumber` can be
 * in `bloom`. A child is an address or a topic value; `cache` holds the bloom
 * bits of each child hashed so far.
 *
 * Note: False positives are possible.
 */
export function isAnyChildInBloom({
  bloom,
  children,
  blockNumber,
  cache,
}: {
  bloom: Uint8Array;
  children: Map<Hex, number>;
  blockNumber: number;
  cache: Map<Hex, BloomBits>;
}): boolean {
  for (const [child, childBlockNumber] of children) {
    if (childBlockNumber > blockNumber) continue;

    let bits = cache.get(child);
    if (bits === undefined) {
      bits = getBloomBits(child);
      cache.set(child, bits);
    }
    if (isBloomBitsInBloom(bloom, bits)) return true;
  }

  return false;
}

/**
 * Create a check that returns true if a log of `filter`'s factory children can
 * be in `bloom`: a known child is in it, or the factory can announce a new
 * child there. Pass `childAddresses` only when it holds every child born before
 * the block; without it, the check cannot rule a block out.
 *
 * Note: False positives are possible.
 */
export const createLogFilterChildBloom = (factories: Factory[]) => {
  const factoryBlooms = new Map(
    factories.map((factory) => [factory.id, getFactoryBloom(factory)]),
  );
  const cache = new Map<Hex, BloomBits>();

  const isFactoryChildInBloom = (
    factory: Factory,
    bloom: Uint8Array,
    blockNumber: number,
    childAddresses: Map<FactoryId, Map<Hex, number>>,
  ) => {
    const factoryBloom = factoryBlooms.get(factory.id);

    return (
      (factoryBloom !== undefined &&
        isFactoryInBloom({ bloom, factory: factoryBloom })) ||
      isAnyChildInBloom({
        bloom,
        children: childAddresses.get(factory.id) ?? new Map(),
        blockNumber,
        cache,
      })
    );
  };

  return ({
    filter,
    bloom,
    blockNumber,
    childAddresses,
  }: {
    filter: LogFilter;
    bloom: Uint8Array;
    blockNumber: number;
    childAddresses: Map<FactoryId, Map<Hex, number>> | undefined;
  }): boolean =>
    childAddresses === undefined ||
    ((isAddressFactory(filter.address) === false ||
      isFactoryChildInBloom(
        filter.address,
        bloom,
        blockNumber,
        childAddresses,
      )) &&
      (filter.childTopic === undefined ||
        isFactoryChildInBloom(
          filter.childTopic.factory,
          bloom,
          blockNumber,
          childAddresses,
        )));
};
