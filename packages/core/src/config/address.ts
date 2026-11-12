import type { AbiEvent, AbiParameter, AbiParameterToPrimitiveType } from "viem";
import type { FactoryChild, LogFactory } from "@/internal/types.js";

// Note: Currently limit the depth to 1 level.
type ParameterNames<T extends AbiParameter> = T extends {
  components: readonly AbiParameter[];
}
  ? T["components"][number] extends {
      components: readonly AbiParameter[];
    }
    ? never
    : `${T["name"]}.${T["components"][number]["name"]}`
  : T["name"];

type FactoryFilter<event extends AbiEvent> = {
  [input in Extract<
    event["inputs"][number],
    { indexed: true; name: string }
  > as input["name"]]?: AbiParameterToPrimitiveType<input>;
};

export type Factory<event extends AbiEvent = AbiEvent> = {
  /** Address of the factory contract that creates this contract. */
  address?: `0x${string}` | readonly `0x${string}`[];
  /** ABI event that announces the creation of a new instance of this contract. */
  event: event;
  /** Values of indexed factory event parameters. Only a matching factory event announces a child. */
  filter?: FactoryFilter<event>;
  /** From block */
  startBlock?: number | "latest";
  /** To block */
  endBlock?: number | "latest";
} & (
  | {
      /** Name of the factory event parameter that contains the new child contract address. */
      parameter: Exclude<ParameterNames<event["inputs"][number]>, undefined>;
      location?: never;
    }
  | {
      parameter?: never;
      /**
       * Low-level alternative to `parameter`. Specifies the exact location
       * (e.g. topic or offset) of the child contract address in the factory
       * event. Most users should prefer `parameter` instead.
       */
      location: Exclude<LogFactory["childAddressLocation"], `child:${string}`>;
    }
  | {
      parameter?: never;
      location?: never;
      /**
       * Picks the child from the factory event's transaction and receipt, for a
       * child that no single event parameter names. The child can be an address
       * or a topic value. Ponder fetches the receipt of every matching factory event.
       */
      child: FactoryChild;
      /**
       * Names the rules of `child`. Change it whenever `child` would pick a different
       * child, so that children from the old rules are not reused. Letters, digits,
       * `.`, `-` and `:` only.
       */
      childId: string;
    }
);

export const factory = <event extends AbiEvent>(factory: Factory<event>) =>
  factory;

export type AddressConfig = {
  address?: `0x${string}` | readonly `0x${string}`[] | Factory;
};
