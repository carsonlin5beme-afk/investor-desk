import { EventEmitter } from "node:events";

import { AssetClass } from "@prisma/client";

export interface QuoteEvent {
  symbol: string;
  assetClass: AssetClass;
  bid: number | null;
  ask: number | null;
  last: number | null;
  mark: number | null;
  source: string;
  asOf: string;
}

const getBus = (): EventEmitter => {
  const key = "__investorDeskQuoteBus" as const;
  const globalScope = globalThis as typeof globalThis & {
    [key]?: EventEmitter;
  };
  if (!globalScope[key]) {
    globalScope[key] = new EventEmitter();
    globalScope[key].setMaxListeners(0);
  }
  return globalScope[key];
};

export const quoteBus = getBus();

export const emitQuoteEvent = (event: QuoteEvent) => {
  quoteBus.emit("quote", event);
};
