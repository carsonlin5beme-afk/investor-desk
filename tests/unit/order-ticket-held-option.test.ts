// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { OrderTicket } from "@/components/OrderTicket";
import {
  DemoOptionsProvider,
  DemoEquityProvider,
} from "@/server/providers/demo";
import type { Holding, Portfolio } from "@/lib/desk-types";

vi.mock("@/components/DeskModal", () => ({
  DeskModal: ({
    children,
    footer,
  }: {
    children: ReactNode;
    footer: ReactNode;
  }) => createElement("section", null, children, footer),
}));
vi.mock("@/components/studio/OptionsExplorer", () => ({
  OptionsExplorer: () => null,
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(() => root!.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function fixture(right: "CALL" | "PUT", quantity: number) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-12T16:00:00Z"));
  const options = new DemoOptionsProvider();
  const expiration = (await options.getExpirations("AAPL"))[0];
  const contract = (await options.getOptionChain("AAPL", expiration)).find(
    (c) => c.right === right && c.strike === 240,
  )!;
  const holding = {
    id: "held-option",
    portfolioId: "fixture",
    symbol: contract.contractSymbol,
    assetClass: "OPTION",
    quantity,
    avgCost: 5,
    optionDetails: {
      underlying: "AAPL",
      right,
      strike: String(contract.strike),
      expiration: contract.expiration.toISOString(),
      multiplier: 100,
    },
    projection: { currentMarketValue: 500, costBasis: 500 },
  } as Holding;
  const portfolio = {
    id: "fixture",
    name: "Fixture",
    cashBalance: 10000,
    positions: [holding],
  } as Portfolio;
  vi.setSystemTime(new Date("2026-10-01T16:00:00Z"));
  expect(await options.getExpirations("AAPL")).not.toContain(expiration);
  expect(
    (await options.getOptionQuote(contract.contractSymbol))!.bid,
  ).toBeGreaterThan(0);
  const state = {
    failQuote: false,
    failDiscovery: false,
    orders: [] as Record<string, unknown>[],
    optionRequests: [] as string[],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init?: RequestInit) => {
      const url = new URL(path, "http://fixture.invalid");
      let payload: unknown;
      if (url.pathname.startsWith("/api/options/") && state.failDiscovery)
        return new Response(
          JSON.stringify({ error: "Discovery unavailable" }),
          { status: 503 },
        );
      if (url.pathname === "/api/options/expirations")
        payload = { expirations: await options.getExpirations("AAPL") };
      else if (url.pathname === "/api/options/chain")
        payload = { contracts: [] };
      else if (url.pathname === "/api/quotes/snapshot") {
        if (url.searchParams.get("assetClass") === "OPTION") {
          const symbol = url.searchParams.get("symbol")!;
          state.optionRequests.push(symbol);
          if (state.failQuote)
            return new Response(
              JSON.stringify({ error: "Exact contract feed unavailable" }),
              { status: 503 },
            );
          payload = {
            quote: await options.getOptionQuote(symbol),
            availability: {
              code: "DEMO",
              label: "Sample quote",
              message: "Illustrative",
              blocking: false,
              connectionRequired: false,
            },
          };
        } else
          payload = {
            quote: await new DemoEquityProvider().getQuote("AAPL"),
            availability: null,
          };
      } else if (url.pathname === "/api/orders/preview") {
        state.orders.push(JSON.parse(init!.body as string));
        payload = {
          preview: { fillable: false, reason: "Fixture preview reached" },
        };
      } else throw new Error(`Unexpected request: ${url.pathname}`);
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
  const host = document.createElement("div");
  document.body.append(host);
  const mount = async () => {
    await act(async () => {
      root = createRoot(host);
      root.render(
        createElement(OrderTicket, {
          portfolio,
          holding,
          mode: "demo",
          close: vi.fn(),
          saved: vi.fn(),
          connectData: vi.fn(),
        }),
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
  };
  const button = (text: string) =>
    [...host.querySelectorAll("button")].find((b) =>
      b.textContent?.includes(text),
    )!;
  const expirationSelect = () =>
    [...host.querySelectorAll("select")].find((s) =>
      s.closest("label")?.textContent?.startsWith("Expiration"),
    )!;
  return { state, mount, host, button, expirationSelect, contract, expiration };
}

it.each(["CALL", "PUT"] as const)(
  "preserves an exact held %s through rolling/empty discovery for partial and full sale previews",
  async (right) => {
    const f = await fixture(right, 2);
    await f.mount();
    expect(f.expirationSelect().value).toBe(f.expiration);
    expect(f.host.querySelector(".selected-contract")?.textContent).toContain(
      f.contract.contractSymbol,
    );
    expect(f.button("Preview order").disabled).toBe(false);
    expect(f.state.optionRequests).toEqual([f.contract.contractSymbol]);
    await act(() => f.button("Preview order").click());
    expect(f.state.orders[0]).toMatchObject({
      optionContractSymbol: f.contract.contractSymbol,
      optionRight: right,
      optionStrike: 240,
      quantity: 2,
      side: "SELL",
    });
    const quantity = [
      ...f.host.querySelectorAll<HTMLInputElement>('input[type="number"]'),
    ].find((i) => i.closest("label")?.textContent?.startsWith("Contracts"))!;
    await act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(quantity, "1");
      quantity.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(() => f.button("Preview order").click());
    expect(f.state.orders[1]).toMatchObject({
      optionContractSymbol: f.contract.contractSymbol,
      quantity: 1,
      side: "SELL",
    });
  },
);

it("keeps the held identity through independent quote failure and recovers without rediscovery", async () => {
  const f = await fixture("PUT", 1);
  f.state.failQuote = true;
  f.state.failDiscovery = true;
  await f.mount();
  expect(f.expirationSelect().value).toBe(f.expiration);
  expect(f.host.querySelector(".selected-contract")?.textContent).toContain(
    f.contract.contractSymbol,
  );
  expect(f.button("Preview order").disabled).toBe(true);
  expect(f.host.textContent).toContain("Exact contract feed unavailable");
  f.state.failQuote = false;
  await act(async () => f.button("Refresh quote").click());
  expect(f.button("Preview order").disabled).toBe(false);
  expect(f.expirationSelect().value).toBe(f.expiration);
  expect(f.host.textContent).not.toContain("Exact contract feed unavailable");
  expect(
    f.state.optionRequests.every((s) => s === f.contract.contractSymbol),
  ).toBe(true);
});
