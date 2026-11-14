import { getEventSelector, parseAbiItem } from "viem";
import { expect, test } from "vitest";
import { buildLogFactory } from "./factory.js";

const llamaFactoryEventAbiItem = parseAbiItem(
  "event LlamaInstanceCreated(address indexed deployer, string indexed name, address llamaCore, address llamaExecutor, address llamaPolicy, uint256 chainId)",
);

test("buildLogFactory throws if provided parameter not found in inputs", () => {
  expect(() =>
    buildLogFactory({
      address: "0xa",
      event: llamaFactoryEventAbiItem,
      parameter: "fakeParameter",
      chainId: 1,
      sourceId: "Llama",
      fromBlock: undefined,
      toBlock: undefined,
    }),
  ).toThrowError(
    "Factory event parameter not found in factory event signature. Got 'fakeParameter', expected one of ['deployer', 'name', 'llamaCore', 'llamaExecutor', 'llamaPolicy', 'chainId'].",
  );
});

test("buildLogFactory handles LlamaInstanceCreated llamaCore", () => {
  const criteria = buildLogFactory({
    address: "0xa",
    event: llamaFactoryEventAbiItem,
    parameter: "llamaCore",
    chainId: 1,
    sourceId: "Llama",
    fromBlock: undefined,
    toBlock: undefined,
  });

  expect(criteria).toMatchObject({
    address: "0xa",
    eventSelector: getEventSelector(llamaFactoryEventAbiItem),
    childAddressLocation: "offset0",
  });
});

test("buildLogFactory handles LlamaInstanceCreated llamaPolicy", () => {
  const criteria = buildLogFactory({
    address: "0xa",
    event: llamaFactoryEventAbiItem,
    parameter: "llamaPolicy",
    chainId: 1,
    sourceId: "Llama",
    fromBlock: undefined,
    toBlock: undefined,
  });

  expect(criteria).toMatchObject({
    address: "0xa",
    eventSelector: getEventSelector(llamaFactoryEventAbiItem),
    childAddressLocation: "offset64",
  });
});

const morphoFactoryEvent = parseAbiItem([
  "struct MarketParams { address loanToken; address collateralToken; address oracle; address irm; uint256 lltv;}",
  "event CreateMarket(bytes32 indexed id, MarketParams marketParams)",
]);

test("buildLogFactory handles Morpho CreateMarket struct parameter", () => {
  const criteria = buildLogFactory({
    address: "0xa",
    event: morphoFactoryEvent,
    parameter: "marketParams.oracle",
    chainId: 1,
    sourceId: "Llama",
    fromBlock: undefined,
    toBlock: undefined,
  });

  expect(criteria).toMatchObject({
    address: "0xa",
    eventSelector:
      "0xac4b2400f169220b0c0afdde7a0b32e775ba727ea1cb30b35f935cdaab8683ac",
    childAddressLocation: "offset64",
  });
});

const zoraFactoryEvent = parseAbiItem([
  "struct PoolKey { address currency0; address currency1; uint24 fee;int24 tickSpacing; address hooks; }",
  "event CoinCreatedV4(address indexed caller,address indexed payoutRecipient,address indexed platformReferrer,address currency,string uri,string name,string symbol,address coin,PoolKey poolKey,bytes32 poolKeyHash,string version)",
]);

test("buildLogFactory handles Morpho CreateMarket struct parameter", () => {
  const criteria = buildLogFactory({
    address: "0xa",
    event: zoraFactoryEvent,
    parameter: "poolKey.hooks",
    chainId: 1,
    sourceId: "Llama",
    fromBlock: undefined,
    toBlock: undefined,
  });

  expect(criteria).toMatchObject({
    address: "0xa",
    eventSelector:
      "0x2de436107c2096e039c98bbcc3c5a2560583738ce15c234557eecb4d3221aa81",
    childAddressLocation: "offset288",
  });
});

test("buildLogFactory handles location", () => {
  const criteria = buildLogFactory({
    address: "0xa",
    event: zoraFactoryEvent,
    location: "offset10",
    chainId: 1,
    sourceId: "Llama",
    fromBlock: undefined,
    toBlock: undefined,
  });

  expect(criteria).toMatchObject({
    address: "0xa",
    eventSelector:
      "0x2de436107c2096e039c98bbcc3c5a2560583738ce15c234557eecb4d3221aa81",
    childAddressLocation: "offset10",
  });
});

test("buildLogFactory encodes the filter option as factory event topics", () => {
  const factory = buildLogFactory({
    address: "0xa",
    event: llamaFactoryEventAbiItem,
    parameter: "llamaCore",
    filter: { deployer: "0x00000000000000000000000000000000000000bb" },
    chainId: 1,
    sourceId: "Llama",
    fromBlock: undefined,
    toBlock: undefined,
  });

  expect(factory.topics).toStrictEqual([
    "0x00000000000000000000000000000000000000000000000000000000000000bb",
    null,
    null,
  ]);
  expect(factory.id).toContain(
    "_0x00000000000000000000000000000000000000000000000000000000000000bb_null_null",
  );
});

test("buildLogFactory rejects a filter key that is not an indexed parameter", () => {
  expect(() =>
    buildLogFactory({
      address: "0xa",
      event: llamaFactoryEventAbiItem,
      parameter: "llamaCore",
      filter: { llamaCore: "0x00000000000000000000000000000000000000bb" },
      chainId: 1,
      sourceId: "Llama",
      fromBlock: undefined,
      toBlock: undefined,
    }),
  ).toThrowError(
    "Factory filter key is not an indexed factory event parameter. Got 'llamaCore', expected one of ['deployer', 'name'].",
  );
});

test("buildLogFactory keeps a child function under its childId", () => {
  const child = () => undefined;
  const factory = buildLogFactory({
    address: "0xa",
    event: llamaFactoryEventAbiItem,
    child,
    childId: "llama.v2",
    chainId: 1,
    sourceId: "Llama",
    fromBlock: undefined,
    toBlock: undefined,
  });

  expect(factory.childAddressLocation).toBe("child:llama.v2");
  expect(factory.child).toBe(child);
  expect(factory.id).toContain("_child:llama.v2_");
});

test("buildLogFactory rejects a childId that fragment IDs cannot hold", () => {
  expect(() =>
    buildLogFactory({
      address: "0xa",
      event: llamaFactoryEventAbiItem,
      child: () => undefined,
      childId: "llama_v2",
      chainId: 1,
      sourceId: "Llama",
      fromBlock: undefined,
      toBlock: undefined,
    }),
  ).toThrowError(
    "Factory childId is invalid. Got 'llama_v2', expected letters, digits, '.', '-' or ':'.",
  );
});
