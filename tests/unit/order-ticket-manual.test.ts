// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OrderTicket } from "@/components/OrderTicket";
import type { Holding, Portfolio } from "@/lib/desk-types";

vi.mock("@/components/DeskModal", () => ({
  DeskModal: ({
    children,
    footer,
    kicker,
  }: {
    children: ReactNode;
    footer?: ReactNode;
    kicker: string;
  }) =>
    createElement(
      "section",
      null,
      createElement("p", null, kicker),
      children,
      footer,
    ),
}));
vi.mock("@/components/studio/OptionsExplorer", () => ({
  OptionsExplorer: () => null,
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const manualSymbol = "MANUAL:V1:BTG:2027-01-15:P:12500:100";
const terms = {
  underlying: "BTG",
  right: "PUT",
  strike: "12.5",
  expiration: "2027-01-15T00:00:00.000Z",
  multiplier: 100,
} as const;
const manualHolding = {
  id: "manual-holding",
  portfolioId: "manual-ticket",
  symbol: manualSymbol,
  assetClass: "OPTION",
  quantity: 4,
  avgCost: 2.35,
  optionDetails: terms,
  projection: { currentMarketValue: 940, costBasis: 940 },
} as Holding;
type Body = Record<string, unknown>;
type Request = {
  url: URL;
  body?: Body;
  signal?: AbortSignal | null;
  resolve: (response: Response) => void;
  reject: (reason: unknown) => void;
};
let root: Root | undefined;
let host: HTMLDivElement;
let requests: Request[];
let deferMarket: boolean;
let executeFailures: number;
const saved = vi.fn();
const response = (body: unknown, ok = true) =>
  ({ ok, json: async () => body }) as Response;
const buttons = (text: string) =>
  [...host.querySelectorAll("button")].filter((b) => b.textContent === text);
const button = (text: string) => {
  const found = buttons(text)[0];
  expect(found, `button ${text}`).toBeDefined();
  return found!;
};
function input(label: string) {
  const found = [...host.querySelectorAll("label")]
    .find((l) => l.textContent?.startsWith(label))
    ?.querySelector("input,select");
  expect(found, `field ${label}`).toBeDefined();
  return found as HTMLInputElement | HTMLSelectElement;
}
async function change(label: string, value: string) {
  const field = input(label);
  await act(() => {
    Object.getOwnPropertyDescriptor(
      field instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype,
      "value",
    )!.set!.call(field, value);
    field.dispatchEvent(
      new Event(field instanceof HTMLSelectElement ? "change" : "input", {
        bubbles: true,
      }),
    );
  });
}
const click = async (text: string) => {
  await act(() => button(text).click());
};
const orders = (path: "preview" | "execute") =>
  requests.filter((r) => r.url.pathname === `/api/orders/${path}`);
const marketRequests = () =>
  requests.filter((r) => !r.url.pathname.startsWith("/api/orders/"));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-19T16:00:00Z"));
  localStorage.clear();
  localStorage.setItem("investor-desk:order-sounds-muted:v1", "true");
  requests = [];
  deferMarket = false;
  executeFailures = 0;
  saved.mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (path: string, init: RequestInit = {}) =>
        new Promise<Response>((resolve, reject) => {
          const url = new URL(path, "http://fixture.invalid");
          const body = init.body
            ? (JSON.parse(String(init.body)) as Body)
            : undefined;
          requests.push({ url, body, signal: init.signal, resolve, reject });
          if (url.pathname.startsWith("/api/orders/")) {
            const price = Number(body!.manualPremium);
            const notional = price * Number(body!.quantity) * 100;
            const cashAfter =
              10000 + (body!.side === "SELL" ? notional : -notional);
            if (url.pathname.endsWith("/preview"))
              resolve(
                response({
                  preview: {
                    fillable: true,
                    estimatedFillPrice: price,
                    estimatedNotional: notional,
                    cashBefore: 10000,
                    cashAfter,
                    quote: null,
                  },
                }),
              );
            else if (executeFailures-- > 0)
              reject(new TypeError("Connection interrupted"));
            else
              resolve(
                response({
                  execution: {
                    fillPrice: price,
                    notional,
                    portfolioCashBalance: cashAfter,
                    orderId: "manual-order",
                    replayed: false,
                    quoteSource: "manual",
                    quoteAsOf: null,
                    simulationBasis: "MANUAL",
                  },
                }),
              );
          } else if (!deferMarket)
            resolve(response({ error: "All market feeds unavailable" }, false));
        }),
    ),
  );
  host = document.createElement("div");
  document.body.append(host);
});
afterEach(async () => {
  if (root) await act(() => root!.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function mount(holding?: Holding) {
  const portfolio = {
    id: "manual-ticket",
    name: "Manual test",
    cashBalance: 10000,
    positions: holding ? [holding] : [],
  } as unknown as Portfolio;
  await act(() => {
    root = createRoot(host);
    root.render(
      createElement(OrderTicket, {
        portfolio,
        holding,
        mode: "live",
        close: vi.fn(),
        saved,
        connectData: vi.fn(),
      }),
    );
  });
}
async function enterManual() {
  await click("Options");
  await click("Manual entry");
  await change("Underlying ticker", "btg");
  await change("Expiration date", "2027-01-15");
  await change("Option right", "PUT");
  await change("Strike price", "12.5");
  await change("Contracts", "2");
  await change("Entry premium", "2.35");
}
const expectedBuy = {
  portfolioId: "manual-ticket",
  assetClass: "OPTION",
  symbol: "BTG",
  side: "BUY",
  quantity: 2,
  orderType: "MARKET",
  optionPricing: "MANUAL",
  manualPremium: 2.35,
  optionContractSymbol: manualSymbol,
  optionRight: "PUT",
  optionStrike: 12.5,
  optionExpiration: "2027-01-15",
};

describe("manual option trade ticket", () => {
  it("records a new manual contract from Options without any provider request, using a per-share premium", async () => {
    await mount();
    await enterManual();
    await act(() => vi.advanceTimersByTimeAsync(30000));
    expect(marketRequests()).toHaveLength(0);
    expect(button("Preview order").disabled).toBe(false);
    expect(host.querySelector(".estimate-row")?.textContent).toContain(
      "$470.00",
    );
    expect(host.textContent).toContain("Manual entry");
    expect(host.textContent).toContain(
      "Contract listing and current market price are unverified",
    );
    expect(host.querySelector(".quote-strip")).toBeNull();
    expect(host.querySelector(".ticket-quote-status")).toBeNull();
    await click("Preview order");
    expect(orders("preview")[0].body).toEqual(expectedBuy);
    expect(host.querySelector(".review-box")?.textContent).toContain(
      "of BTG at $2.35 per share",
    );
    expect(host.querySelector(".review-box")?.textContent).toContain(
      "Manual premium per share; no quote used",
    );
    await click("Record manual trade");
    expect(orders("execute")[0].body).toEqual({
      ...expectedBuy,
      clientOrderId: expect.any(String),
    });
    expect(host.querySelector(".execution-provenance")?.textContent).toContain(
      "Manual entry",
    );
    expect(host.textContent).toContain("No market quote was used");
    expect(host.textContent).not.toContain("Execution quote");
    expect(saved).toHaveBeenCalledOnce();
    expect(marketRequests()).toHaveLength(0);
  });

  it("requires whole contracts and a positive entered premium before preview", async () => {
    await mount();
    await enterManual();
    await change("Contracts", "1.5");
    expect(button("Preview order").disabled).toBe(true);
    expect(host.textContent).toContain("positive whole contract count");
    await change("Contracts", "1");
    await change("Entry premium", "");
    expect(button("Preview order").disabled).toBe(true);
    await change("Entry premium", "0");
    expect(button("Preview order").disabled).toBe(true);
    await change("Entry premium", "0.01");
    expect(button("Preview order").disabled).toBe(false);
    expect(orders("preview")).toHaveLength(0);
  });

  it("locks held manual identity, requires an exit premium, and previews partial and full sales", async () => {
    await mount(manualHolding);
    expect(button("Provider prices").disabled).toBe(true);
    expect(button("Manual entry").disabled).toBe(true);
    expect(button("Stocks / ETFs").disabled).toBe(true);
    for (const field of [
      "Underlying ticker",
      "Expiration date",
      "Option right",
      "Strike price",
    ])
      expect(input(field).disabled).toBe(true);
    expect(input("Underlying ticker").value).toBe("BTG");
    expect(input("Option right").value).toBe("PUT");
    expect(input("Strike price").value).toBe("12.5");
    expect(input("Expiration date").value).toBe("2027-01-15");
    expect(input("Exit premium").value).toBe("");
    expect(button("Preview order").disabled).toBe(true);
    await change("Exit premium", "3.1");
    await change("Contracts", "1");
    await click("Preview order");
    expect(orders("preview")[0].body).toEqual({
      ...expectedBuy,
      quantity: 1,
      side: "SELL",
      manualPremium: 3.1,
    });
    await click("Sell all");
    expect(host.querySelector(".review-box")).toBeNull();
    expect(input("Contracts").value).toBe("4");
    await click("Preview order");
    expect(orders("preview")[1].body).toEqual({
      ...expectedBuy,
      quantity: 4,
      side: "SELL",
      manualPremium: 3.1,
    });
    await click("Record manual trade");
    expect(orders("execute")[0].body).toMatchObject({
      optionContractSymbol: manualSymbol,
      quantity: 4,
      side: "SELL",
      manualPremium: 3.1,
    });
    expect(marketRequests()).toHaveLength(0);
  });

  it("keeps provider holdings in provider pricing even when their feeds are unavailable", async () => {
    await mount({ ...manualHolding, symbol: "BTG   270115P00012500" });
    expect(button("Provider prices").getAttribute("aria-pressed")).toBe("true");
    expect(button("Manual entry").disabled).toBe(true);
    await click("Manual entry");
    expect(
      host.querySelector('input[placeholder="Enter your premium"]'),
    ).toBeNull();
    expect(button("Preview order").disabled).toBe(true);
    expect(orders("preview")).toHaveLength(0);
  });

  it.each([
    ["Entry premium", "2.8"],
    ["Contracts", "3"],
    ["Underlying ticker", "AAPL"],
    ["Strike price", "15"],
    ["Expiration date", "2027-02-19"],
    ["Option right", "CALL"],
  ])("invalidates the reviewed order when %s changes", async (field, value) => {
    await mount();
    await enterManual();
    await click("Preview order");
    expect(button("Record manual trade").disabled).toBe(false);
    await change(field, value);
    expect(host.querySelector(".review-box")).toBeNull();
    expect(buttons("Record manual trade")).toHaveLength(0);
    expect(button("Preview order").disabled).toBe(false);
    expect(orders("execute")).toHaveLength(0);
  });

  it("freezes premium, identity and client order id across an ambiguous execution retry", async () => {
    executeFailures = 1;
    await mount();
    await enterManual();
    await click("Preview order");
    await click("Record manual trade");
    expect(host.textContent).toContain("The response was interrupted");
    expect(input("Entry premium").matches(":disabled")).toBe(true);
    expect(input("Contracts").matches(":disabled")).toBe(true);
    expect(button("Provider prices").matches(":disabled")).toBe(true);
    const first = orders("execute")[0].body;
    expect(first).toEqual({
      ...expectedBuy,
      clientOrderId: expect.any(String),
    });
    await act(() => vi.advanceTimersByTimeAsync(61000));
    await click("Check order result");
    expect(orders("execute")[1].body).toEqual(first);
    expect(orders("preview")).toHaveLength(1);
    expect(saved).toHaveBeenCalledOnce();
    expect(marketRequests()).toHaveLength(0);
  });

  it("clears the entry premium when switching to a sale", async () => {
    await mount();
    await enterManual();
    await click("Preview order");
    await change("Action", "SELL");
    expect(input("Exit premium").value).toBe("");
    expect(button("Preview order").disabled).toBe(true);
    expect(host.querySelector(".review-box")).toBeNull();
  });

  it("aborts provider expiration and quote discovery and ignores late failures when entering manual mode", async () => {
    deferMarket = true;
    await mount();
    await change("Symbol or company", "BTG");
    await act(() =>
      input("Symbol or company").dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      ),
    );
    await click("Options");
    const stale = marketRequests();
    expect(stale.some((r) => r.url.pathname.endsWith("/expirations"))).toBe(
      true,
    );
    expect(stale.some((r) => r.url.pathname.endsWith("/snapshot"))).toBe(true);
    await click("Manual entry");
    expect(stale.every((r) => r.signal?.aborted)).toBe(true);
    await act(() =>
      stale.forEach((r) => r.reject(new Error("Obsolete provider failure"))),
    );
    expect(host.textContent).not.toContain("Obsolete provider failure");
    await change("Expiration date", "2027-01-15");
    await change("Strike price", "12.5");
    await change("Contracts", "2");
    await change("Entry premium", "2.35");
    expect(button("Preview order").disabled).toBe(false);
    await act(() => vi.advanceTimersByTimeAsync(30000));
    expect(marketRequests()).toHaveLength(stale.length);
  });

  it("aborts chain and selected-contract requests and ignores late provider prices after a mode change", async () => {
    deferMarket = true;
    await mount();
    await change("Symbol or company", "BTG");
    await act(() =>
      input("Symbol or company").dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      ),
    );
    await click("Options");
    const expirationRequest = requests.find((r) =>
      r.url.pathname.endsWith("/expirations"),
    )!;
    await act(() =>
      expirationRequest.resolve(response({ expirations: ["2027-01-15"] })),
    );
    const chainRequest = requests.find((r) =>
      r.url.pathname.endsWith("/chain"),
    )!;
    const providerContract = {
      contractSymbol: "BTG   270115C00012500",
      underlying: "BTG",
      right: "CALL",
      strike: 12.5,
      expiration: "2027-01-15",
      bid: 1,
      ask: 1.1,
      mark: 1.05,
      impliedVolatility: 0.4,
      source: "schwab",
      asOf: new Date().toISOString(),
    };
    await act(() =>
      chainRequest.resolve(response({ contracts: [providerContract] })),
    );
    await act(() =>
      host
        .querySelector<HTMLButtonElement>(
          '[aria-label="Select call strike 12.5"]',
        )!
        .click(),
    );
    const selectedRequest = requests.find(
      (r) => r.url.searchParams.get("assetClass") === "OPTION",
    )!;
    expect(selectedRequest).toBeDefined();
    await act(() => vi.advanceTimersByTimeAsync(15000));
    const lateChain = requests
      .filter((r) => r.url.pathname.endsWith("/chain"))
      .at(-1)!;
    expect(lateChain).not.toBe(chainRequest);
    await click("Manual entry");
    expect(lateChain.signal?.aborted).toBe(true);
    expect(selectedRequest.signal?.aborted).toBe(true);
    await change("Strike price", "20");
    await change("Contracts", "1");
    await change("Entry premium", "2.35");
    await act(() => {
      lateChain.resolve(
        response({ contracts: [{ ...providerContract, strike: 999 }] }),
      );
      selectedRequest.resolve(
        response({
          quote: {
            bid: 100,
            ask: 200,
            mark: 150,
            source: "schwab",
            asOf: new Date().toISOString(),
          },
          availability: { code: "LIVE", label: "Live quote", blocking: false },
        }),
      );
    });
    expect(host.querySelector(".selected-contract")).toBeNull();
    expect(host.querySelector(".quote-strip")).toBeNull();
    expect(host.textContent).not.toContain("Live quote");
    expect(host.textContent).not.toContain("schwab");
    expect(input("Strike price").value).toBe("20");
    expect(host.querySelector(".estimate-row")?.textContent).toContain(
      "$235.00",
    );
    expect(button("Preview order").disabled).toBe(false);
  });
});
