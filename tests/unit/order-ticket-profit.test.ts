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
  }: {
    children: ReactNode;
    footer?: ReactNode;
  }) => createElement("section", null, children, footer),
}));
vi.mock("@/components/studio/ValueChart", () => ({ ValueChart: () => null }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let host: HTMLDivElement;
let requests: { path: string; body?: Record<string, unknown> }[];
const manualHolding = {
  id: "manual-held",
  portfolioId: "profit-ticket",
  symbol: "MANUAL:V1:BTG:2027-01-15:P:12500:100",
  assetClass: "OPTION",
  quantity: 4,
  avgCost: 2.35,
  optionDetails: {
    underlying: "BTG",
    right: "PUT",
    strike: "12.5",
    expiration: "2027-01-15T00:00:00.000Z",
    multiplier: 100,
  },
  projection: { currentMarketValue: 940, costBasis: 940 },
} as Holding;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-05T16:00:00Z"));
  localStorage.clear();
  localStorage.setItem("investor-desk:order-sounds-muted:v1", "true");
  requests = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init: RequestInit = {}) => {
      const body = init.body
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
        : undefined;
      requests.push({ path, body });
      return {
        ok: path === "/api/orders/preview",
        json: async () =>
          path === "/api/orders/preview"
            ? {
                preview: {
                  fillable: true,
                  estimatedFillPrice: Number(body?.manualPremium),
                  estimatedNotional:
                    Number(body?.manualPremium) * Number(body?.quantity) * 100,
                  cashBefore: 10000,
                  cashAfter: 9530,
                  quote: null,
                },
              }
            : { error: "All market feeds unavailable" },
      } as Response;
    }),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(() => root.unmount());
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const mount = (holding?: Holding) =>
  act(() =>
    root.render(
      createElement(OrderTicket, {
        portfolio: {
          id: "profit-ticket",
          name: "Profit test",
          cashBalance: 10000,
          positions: holding ? [holding] : [],
        } as unknown as Portfolio,
        holding,
        mode: "live",
        close: vi.fn(),
        saved: vi.fn(),
        connectData: vi.fn(),
      }),
    ),
  );
function button(text: string) {
  const found = [...host.querySelectorAll("button")].find(
    (b) => b.textContent === text,
  );
  expect(found).toBeDefined();
  return found!;
}
const click = (text: string) => act(() => button(text).click());
function field(label: string) {
  const found = [...host.querySelectorAll("label")]
    .find((l) => l.textContent?.startsWith(label))
    ?.querySelector("input,select");
  expect(found, label).toBeDefined();
  return found as HTMLInputElement | HTMLSelectElement;
}
async function change(label: string, value: string) {
  const control = field(label);
  await act(() => {
    Object.getOwnPropertyDescriptor(
      control instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype,
      "value",
    )!.set!.call(control, value);
    control.dispatchEvent(
      new Event(control instanceof HTMLSelectElement ? "change" : "input", {
        bubbles: true,
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
async function openCalculator() {
  const details = host.querySelector<HTMLDetailsElement>(".ticket-payoff");
  expect(details).not.toBeNull();
  expect(details!.querySelector("summary")?.textContent).toBe(
    "Calculate profit & explore payoff",
  );
  await act(() => {
    details!.open = true;
    details!.dispatchEvent(new Event("toggle"));
  });
}
const output = () =>
  host.querySelector('output[aria-label="Expiration net profit or loss"]')
    ?.textContent;

describe("manual ticket profit integration", () => {
  it("opens a real calculator without quotes before recording and never adds its controls to the order", async () => {
    await mount();
    await enterManual();
    await openCalculator();
    expect(requests).toHaveLength(0);
    expect(field("Hypothetical underlying price").value).toBe("12.5");
    expect(output()).toBe("-$470.00");
    await change("Hypothetical underlying price", "10");
    expect(output()).toBe("$30.00");
    expect(host.querySelector(".estimate-row")?.textContent).toContain(
      "$470.00",
    );
    await click("Preview order");
    const reviewed = host.querySelector(".review-box")?.textContent;
    expect(reviewed).toContain("of BTG at $2.35 per share");
    expect(requests).toEqual([
      {
        path: "/api/orders/preview",
        body: {
          portfolioId: "profit-ticket",
          assetClass: "OPTION",
          symbol: "BTG",
          side: "BUY",
          quantity: 2,
          orderType: "MARKET",
          optionPricing: "MANUAL",
          manualPremium: 2.35,
          optionContractSymbol: "MANUAL:V1:BTG:2027-01-15:P:12500:100",
          optionRight: "PUT",
          optionStrike: 12.5,
          optionExpiration: "2027-01-15",
        },
      },
    ]);
    await change("Hypothetical underlying price", "0");
    expect(output()).toBe("$2,030.00");
    expect(host.querySelector(".review-box")?.textContent).toBe(reviewed);
    await change("Hypothetical underlying price", "");
    expect(output()).toBe("—");
    expect(host.querySelector(".review-box")?.textContent).toBe(reviewed);
    expect(requests).toHaveLength(1);
  });

  it.each(["", "0", "1.5", "-1"])(
    "hides profit rather than using a default contract for count %j",
    async (quantity) => {
      await mount();
      await enterManual();
      await openCalculator();
      await change("Contracts", quantity);
      expect(host.querySelector(".ticket-payoff")).toBeNull();
      expect(output()).toBeUndefined();
      expect(button("Preview order").disabled).toBe(true);
      expect(requests).toHaveLength(0);
    },
  );

  it("does not interpret an entered exit premium as an entry basis for a sale", async () => {
    await mount(manualHolding);
    await change("Exit premium", "3.1");
    await change("Contracts", "1");
    expect(host.querySelector(".ticket-payoff")).toBeNull();
    await click("Preview order");
    expect(requests[0].body).toMatchObject({
      side: "SELL",
      quantity: 1,
      manualPremium: 3.1,
    });
    expect(host.querySelector(".review-box")?.textContent).toContain(
      "$3.10 per share",
    );
  });
});
