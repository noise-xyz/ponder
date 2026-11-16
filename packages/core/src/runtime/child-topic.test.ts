import { type Address, type Hex, numberToHex, pad } from "viem";
import { expect, test, vi } from "vitest";
import type {
  LogFactory,
  LogFilter,
  SyncBlock,
  SyncLog,
} from "@/internal/types.js";
import type { Rpc } from "@/rpc/index.js";
import { getFactoryChildren } from "./factory-child.js";
import {
  isLogFactoryMatched,
  isLogFilterChildMatched,
  mergeLogFiltersToRequests,
  toKnownChildrenLogFilter,
} from "./filter.js";
import { encodeFragment, getFragments } from "./fragments.js";

const parent = "0x0000000000000000000000000000000000000001" as Address;
const target = "0x0000000000000000000000000000000000000002" as Address;
const createSelector = pad("0xc1");
const swapSelector = pad("0x5a");
const usdc = pad("0x0000000000000000000000000000000000000003");
const poolA = pad("0xaa");
const poolB = pad("0xbb");

const factoryFor = (child?: LogFactory["child"]): LogFactory => ({
  id: "factory",
  type: "log",
  chainId: 1,
  sourceId: "Pools",
  address: parent,
  eventSelector: createSelector,
  topics: [usdc, null, null],
  childAddressLocation: "child:pools.v1",
  child: child ?? (() => poolA),
  fromBlock: undefined,
  toBlock: undefined,
});

const filterFor = (factory: LogFactory): LogFilter => ({
  type: "log",
  chainId: 1,
  sourceId: "Swaps",
  address: target,
  topic0: swapSelector,
  topic1: null,
  topic2: null,
  topic3: null,
  childTopic: { index: 1, factory },
  fromBlock: undefined,
  toBlock: undefined,
  hasTransactionReceipt: false,
  include: [],
});

const logOf = (overrides: Partial<SyncLog>): SyncLog => ({
  address: parent,
  topics: [createSelector, usdc],
  data: "0x",
  blockNumber: numberToHex(10),
  blockHash: pad("0x10"),
  transactionHash: pad("0x11"),
  transactionIndex: "0x0",
  logIndex: "0x0",
  removed: false,
  ...overrides,
});

test("isLogFactoryMatched() requires the factory filter topics", () => {
  const factory = factoryFor();

  expect(isLogFactoryMatched({ factory, log: logOf({}) })).toBe(true);
  expect(
    isLogFactoryMatched({
      factory,
      log: logOf({ topics: [createSelector, pad("0x04")] }),
    }),
  ).toBe(false);
});

test("isLogFilterChildMatched() matches a child topic only from its birth block", () => {
  const filter = filterFor(factoryFor());
  const childAddresses = new Map([["factory", new Map([[poolA, 10]])]]);
  const swap = { address: target, topics: [swapSelector, poolA] };

  expect(
    isLogFilterChildMatched({
      filter,
      log: swap,
      blockNumber: 10,
      childAddresses,
    }),
  ).toBe(true);
  expect(
    isLogFilterChildMatched({
      filter,
      log: swap,
      blockNumber: 9,
      childAddresses,
    }),
  ).toBe(false);
  expect(
    isLogFilterChildMatched({
      filter,
      log: { address: target, topics: [swapSelector, poolB] },
      blockNumber: 10,
      childAddresses,
    }),
  ).toBe(false);
});

test("mergeLogFiltersToRequests() requests child topics above the factory address threshold", () => {
  const filter = filterFor(factoryFor());

  const requests = mergeLogFiltersToRequests(
    [{ filter, interval: [1, 20] }],
    new Map([
      [
        "factory",
        new Map([
          [poolA, 10],
          [poolB, 12],
        ]),
      ],
    ]),
    1,
  );

  expect(requests).toHaveLength(1);
  expect(requests[0]!.params[0].address).toBe(target);
  expect(requests[0]!.params[0].topics).toStrictEqual([
    swapSelector,
    [poolA, poolB],
  ]);
});

test("mergeLogFiltersToRequests() sends no request before the first child", () => {
  const filter = filterFor(factoryFor());

  expect(
    mergeLogFiltersToRequests(
      [{ filter, interval: [1, 20] }],
      new Map([["factory", new Map()]]),
      1_000,
    ),
  ).toStrictEqual([]);
});

test("getFactoryChildren() reads each launch's transaction and receipt", async () => {
  const transaction = {
    hash: pad("0x11"),
    from: parent,
    to: target,
    input: "0x1234",
  };
  const receipt = {
    blockHash: pad("0x10"),
    blockNumber: numberToHex(10),
    transactionHash: pad("0x11"),
    transactionIndex: "0x0",
    from: parent,
    status: "0x1",
    logs: [],
  };
  const requests: string[] = [];
  const rpc = {
    request: vi.fn(async ({ method }: { method: string }) => {
      requests.push(method);
      if (method === "eth_getTransactionReceipt") return receipt;
      throw new Error(`Unexpected ${method}`);
    }),
  } as unknown as Rpc;
  const child = vi.fn(
    ({ transaction: tx }: { transaction: { input: Hex } }) =>
      (tx.input === "0x1234" ? poolA.toUpperCase() : undefined) as Hex,
  );
  const launch = logOf({});
  const foreign = logOf({ topics: [createSelector, pad("0x04")] });

  const childOf = await getFactoryChildren({
    factory: factoryFor(child as unknown as LogFactory["child"]),
    logs: [launch, foreign],
    rpc,
    blocks: [
      {
        hash: pad("0x10"),
        transactions: [transaction],
      } as unknown as SyncBlock,
    ],
  });

  expect(childOf(launch)).toBe(poolA);
  expect(childOf(foreign)).toBeUndefined();
  expect(requests).toStrictEqual(["eth_getTransactionReceipt"]);
});

test("getFactoryChildren() decodes the child of a factory without a child function from the log", async () => {
  const factory: LogFactory = {
    ...factoryFor(),
    child: undefined,
    childAddressLocation: "topic1",
  };
  const rpc = { request: vi.fn() } as unknown as Rpc;

  const childOf = await getFactoryChildren({
    factory,
    logs: [logOf({})],
    rpc,
  });

  expect(childOf(logOf({}))).toBe("0x0000000000000000000000000000000000000003");
  expect(rpc.request).not.toHaveBeenCalled();
});

test("getFactoryChildren() names the factory and log when a child function throws", async () => {
  const transaction = {
    hash: pad("0x11"),
    from: parent,
    to: target,
    input: "0x",
  };
  const rpc = {
    request: vi.fn(async () => ({
      blockHash: pad("0x10"),
      blockNumber: numberToHex(10),
      transactionHash: pad("0x11"),
      transactionIndex: "0x0",
      from: parent,
      status: "0x1",
      logs: [],
    })),
  } as unknown as Rpc;

  await expect(
    getFactoryChildren({
      factory: factoryFor(() => {
        throw new Error("bad launch");
      }),
      logs: [logOf({})],
      rpc,
      blocks: [
        {
          hash: pad("0x10"),
          transactions: [transaction],
        } as unknown as SyncBlock,
      ],
    }),
  ).rejects.toThrow(
    `Factory 'child' function of 'Pools' (child:pools.v1) failed for log ${pad("0x11")}:0: bad launch`,
  );
});

test("getFragments() keys a child topic by its factory, so other coverage cannot satisfy it", () => {
  const fragments = getFragments(filterFor(factoryFor()));
  const otherPolicy = getFragments(
    filterFor({ ...factoryFor(), childAddressLocation: "child:pools.v2" }),
  );

  expect(fragments).toHaveLength(1);
  const [{ fragment, adjacentIds }] = fragments as [(typeof fragments)[number]];
  const id = encodeFragment(fragment);

  expect(id).toContain(`_child:pools.v1_`);
  expect(id).toContain(`${createSelector}:${usdc}:null:null`);
  expect(adjacentIds).toContain(id);
  expect(
    adjacentIds.every((adjacent) => adjacent.includes("child:pools.v1")),
  ).toBe(true);
  expect(
    adjacentIds.some((adjacent) =>
      otherPolicy[0]!.adjacentIds.includes(adjacent),
    ),
  ).toBe(false);
});

test("toKnownChildrenLogFilter() narrows a factory address to children born by the block", () => {
  const filter: LogFilter = {
    ...filterFor(factoryFor()),
    address: factoryFor(),
    childTopic: undefined,
  };
  const tokenA: Address = "0x00000000000000000000000000000000000000aa";
  const tokenB: Address = "0x00000000000000000000000000000000000000bb";
  const childAddresses = new Map([
    [
      "factory",
      new Map([
        [tokenA, 10],
        [tokenB, 12],
      ]),
    ],
  ]);
  const narrow = (
    known: typeof childAddresses | undefined,
    threshold = 1_000,
  ) =>
    toKnownChildrenLogFilter({
      filter,
      childAddresses: known,
      blockNumber: 11,
      factoryAddressCountThreshold: threshold,
    }).address;

  expect(narrow(childAddresses)).toStrictEqual([tokenA]);
  expect(narrow(undefined)).toBe(filter.address);
  expect(narrow(childAddresses, 2)).toBe(filter.address);
});
