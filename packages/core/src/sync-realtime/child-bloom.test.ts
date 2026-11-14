import { type Hex, hexToBytes, keccak256, pad, toHex } from "viem";
import { expect, test } from "vitest";
import type { LogFactory, LogFilter } from "@/internal/types.js";
import {
  createLogFilterChildBloom,
  getFactoryBloom,
  isAnyChildInBloom,
  isFactoryInBloom,
} from "./bloom.js";

const bloomOf = (values: Hex[]) => {
  const bytes = new Uint8Array(256);
  for (const value of values) {
    const hash = hexToBytes(keccak256(value));
    for (const i of [0, 2, 4]) {
      const bit = (hash[i + 1]! + (hash[i]! << 8)) & 2047;
      bytes[255 - Math.floor(bit / 8)]! |= 1 << (bit % 8);
    }
  }
  return hexToBytes(toHex(bytes));
};

const parent = "0x0000000000000000000000000000000000000001";
const selector = pad("0xc1");
const usdc = pad("0x0000000000000000000000000000000000000003");
const pool = pad("0xaa");
const token = "0x00000000000000000000000000000000000000bb";

const factory: LogFactory = {
  id: "factory",
  type: "log",
  chainId: 1,
  sourceId: "Pools",
  address: parent,
  eventSelector: selector,
  topics: [usdc, null, null],
  childAddressLocation: "child:pools.v1",
  fromBlock: undefined,
  toBlock: undefined,
};

test("isFactoryInBloom() requires the factory filter topics", () => {
  const factoryBloom = getFactoryBloom(factory);

  expect(
    isFactoryInBloom({
      bloom: bloomOf([parent, selector, usdc]),
      factory: factoryBloom,
    }),
  ).toBe(true);
  expect(
    isFactoryInBloom({
      bloom: bloomOf([parent, selector]),
      factory: factoryBloom,
    }),
  ).toBe(false);
});

test("isAnyChildInBloom() finds a known topic or address child born by the block", () => {
  const children = new Map<Hex, number>([
    [pool, 10],
    [token, 12],
  ]);

  const cache = new Map();
  const inBloom = (values: Hex[], blockNumber: number) =>
    isAnyChildInBloom({ bloom: bloomOf(values), children, blockNumber, cache });

  expect(inBloom([pool], 10)).toBe(true);
  expect(inBloom([token], 11)).toBe(false);
  expect(inBloom([token], 12)).toBe(true);
  expect(inBloom([pad("0x99")], 20)).toBe(false);
});

test("createLogFilterChildBloom() rules a block out only when every earlier child is known", () => {
  const swapSelector = pad("0x5a");
  const filter: LogFilter = {
    type: "log",
    chainId: 1,
    sourceId: "Swaps",
    address: token,
    topic0: swapSelector,
    topic1: null,
    topic2: null,
    topic3: null,
    childTopic: { index: 1, factory },
    fromBlock: undefined,
    toBlock: undefined,
    hasTransactionReceipt: false,
    include: [],
  };
  const isLogFilterChildInBloom = createLogFilterChildBloom([factory]);
  const childAddresses = new Map([["factory", new Map([[pool, 10]])]]);
  const inBloom = (values: Hex[], known: typeof childAddresses | undefined) =>
    isLogFilterChildInBloom({
      filter,
      bloom: bloomOf(values),
      blockNumber: 11,
      childAddresses: known,
    });

  expect(inBloom([token, swapSelector, pool], childAddresses)).toBe(true);
  expect(inBloom([token, swapSelector, pad("0x99")], childAddresses)).toBe(
    false,
  );
  expect(inBloom([token, swapSelector, pad("0x99")], undefined)).toBe(true);
  expect(
    inBloom([token, swapSelector, parent, selector, usdc], childAddresses),
  ).toBe(true);
});
