import type { Abi, GetEventArgs } from "viem";
import type { Factory } from "./address.js";
import type { ParseAbiEvent, SafeEventNames } from "./utilityTypes.js";

type EventArgs<abi extends Abi, event extends string> = GetEventArgs<
  abi,
  string,
  {
    EnableUnion: true;
    IndexedOnly: true;
    Required: false;
  },
  ParseAbiEvent<abi, event>
>;

/** An indexed argument can also be a factory: the event then matches only its children. */
type WithFactoryArgs<args> = args extends readonly unknown[]
  ? args
  : { [key in keyof args]?: args[key] | Factory };

type FilterArgs<abi extends Abi, event extends string> = WithFactoryArgs<
  EventArgs<abi, event>
>;

export type GetEventFilter<
  abi extends Abi,
  ///
  safeEventNames extends string = SafeEventNames<abi>,
> = {
  filter?:
    | (safeEventNames extends safeEventNames
        ? {
            event: safeEventNames;
            args: FilterArgs<abi, safeEventNames>;
          }
        : never)
    | (safeEventNames extends safeEventNames
        ? {
            event: safeEventNames;
            args: FilterArgs<abi, safeEventNames>;
          }
        : never)[];
};
