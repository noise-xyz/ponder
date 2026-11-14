import {
  type Address,
  encodeEventTopics,
  type Hex,
  toEventSelector,
} from "viem";
import type { Factory as FactoryConfig } from "@/config/address.js";
import type { FactoryChild, LogFactory } from "@/internal/types.js";
import { dedupe } from "@/utils/dedupe.js";
import { toLowerCase } from "@/utils/lowercase.js";
import {
  getBytesConsumedByParam,
  getNestedParamOffset,
  type TupleAbiParameter,
} from "@/utils/offset.js";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

export function buildLogFactory({
  chainId,
  sourceId,
  fromBlock,
  toBlock,
  ...factoryConfig
}: {
  chainId: number;
  sourceId: string;
  fromBlock: number | undefined;
  toBlock: number | undefined;
} & DistributiveOmit<FactoryConfig, "startBlock" | "endBlock">): LogFactory {
  let address: Address | Address[] | undefined;
  if (factoryConfig.address === undefined) {
    // noop
  } else if (Array.isArray(factoryConfig.address)) {
    address = dedupe(factoryConfig.address)
      .map(toLowerCase)
      .sort((a, b) => (a < b ? -1 : 1));
  } else {
    address = toLowerCase(factoryConfig.address);
  }

  const eventSelector = toEventSelector(factoryConfig.event);

  const { child, childId } = factoryConfig as {
    child?: FactoryChild;
    childId?: string;
  };

  let childAddressLocation: LogFactory["childAddressLocation"];
  if ("parameter" in factoryConfig) {
    const params = factoryConfig.parameter!.split(".");
    const isParameterIndexedTopic = factoryConfig.event.inputs.some(
      (input) => input.indexed === true && input.name === params[0],
    );
    if (params.length === 1 && isParameterIndexedTopic) {
      const indexedInputPosition = factoryConfig.event.inputs
        .filter((input) => input.indexed === true)
        .findIndex((input) => {
          return input.name === params[0];
        });

      childAddressLocation = `topic${(indexedInputPosition + 1) as 1 | 2 | 3}`;
    } else {
      const nonIndexedInputs = factoryConfig.event.inputs.filter(
        (x) => !("indexed" in x && x.indexed),
      );
      const nonIndexedInputPosition = nonIndexedInputs.findIndex(
        (input) => input.name === params[0],
      );

      if (nonIndexedInputPosition === -1) {
        throw new Error(
          `Factory event parameter not found in factory event signature. Got '${factoryConfig.parameter}', expected one of [${factoryConfig.event.inputs
            .map((i) => `'${i.name}'`)
            .join(", ")}].`,
        );
      }

      const nonIndexedParameter = nonIndexedInputs[nonIndexedInputPosition]!;

      if (nonIndexedParameter.type !== "address" && params.length === 1) {
        throw new Error(
          `Factory event parameter type is not valid. Got '${nonIndexedParameter.type}', expected 'address'.`,
        );
      }

      if (params.length > 1 && nonIndexedParameter.type !== "tuple") {
        throw new Error(
          `Factory event parameter type is not valid. Got '${nonIndexedParameter.type}', expected 'tuple'.`,
        );
      }

      let offset = 0;
      for (let i = 0; i < nonIndexedInputPosition; i++) {
        offset += getBytesConsumedByParam(nonIndexedInputs[i]!);
      }

      if (params.length > 1) {
        const nestedOffset = getNestedParamOffset(
          nonIndexedInputs[nonIndexedInputPosition]! as TupleAbiParameter,
          params.slice(1),
        );

        offset += nestedOffset;
      }

      childAddressLocation = `offset${offset}`;
    }
  } else if ("location" in factoryConfig) {
    if (
      factoryConfig.location !== "topic1" &&
      factoryConfig.location !== "topic2" &&
      factoryConfig.location !== "topic3" &&
      (factoryConfig.location?.startsWith("offset") &&
        Number.isInteger(Number(factoryConfig.location?.slice(6)))) === false
    ) {
      throw new Error(
        `Factory location is invalid. Got '${factoryConfig.location}', expected 'topic1', 'topic2', 'topic3', or 'offset[number]'.`,
      );
    }
    childAddressLocation = factoryConfig.location!;
  } else if (child !== undefined) {
    if (/^[A-Za-z0-9.:-]+$/.test(childId ?? "") === false) {
      throw new Error(
        `Factory childId is invalid. Got '${childId}', expected letters, digits, '.', '-' or ':'.`,
      );
    }
    childAddressLocation = `child:${childId}`;
  } else {
    throw new Error(
      `Factory must specify "parameter", "location", or "child".`,
    );
  }

  const topics = buildFactoryTopics(factoryConfig);

  return {
    id: `log_${Array.isArray(address) ? address.join("_") : address}_${chainId}_${childAddressLocation}_${eventSelector}_${fromBlock ?? "undefined"}_${toBlock ?? "undefined"}${topics === undefined ? "" : `_${topics.map((topic) => topic ?? "null").join("_")}`}`,
    type: "log",
    chainId,
    sourceId,
    address,
    eventSelector,
    ...(topics === undefined ? {} : { topics }),
    childAddressLocation,
    ...(child === undefined ? {} : { child }),
    fromBlock,
    toBlock,
  };
}

/** Encodes the `filter` option as topic1 to topic3 of the factory event. */
function buildFactoryTopics({
  event,
  filter,
}: Pick<FactoryConfig, "event" | "filter">): LogFactory["topics"] {
  if (filter === undefined) return undefined;

  const indexedInputs = event.inputs.filter((input) => input.indexed === true);

  for (const [name, value] of Object.entries(filter)) {
    if (indexedInputs.every((input) => input.name !== name)) {
      throw new Error(
        `Factory filter key is not an indexed factory event parameter. Got '${name}', expected one of [${indexedInputs
          .map((i) => `'${i.name}'`)
          .join(", ")}].`,
      );
    }
    if (value === null || value === undefined || Array.isArray(value)) {
      throw new Error(
        `Factory filter value for '${name}' must be a single value.`,
      );
    }
  }

  const [, ...encoded] = encodeEventTopics({
    abi: [event],
    eventName: event.name,
    args: filter,
  } as Parameters<typeof encodeEventTopics>[0]);

  const topics = [0, 1, 2].map((index) => {
    const topic = encoded[index];
    return topic === undefined || topic === null || Array.isArray(topic)
      ? null
      : (toLowerCase(topic) as Hex);
  }) as [Hex | null, Hex | null, Hex | null];

  return topics.every((topic) => topic === null) ? undefined : topics;
}
