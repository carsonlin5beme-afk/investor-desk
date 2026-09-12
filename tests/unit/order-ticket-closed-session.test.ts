// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OrderTicket } from "@/components/OrderTicket";
import type { Portfolio } from "@/lib/desk-types";

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
const sound = vi.hoisted(() => ({ events: [] as unknown[][], muted: false }));
vi.mock("@/lib/order-success-audio", () => ({
  OrderSuccessAudio: class {
    setMuted(value: boolean) {
      sound.muted = value;
      sound.events.push(["mute", value]);
    }
    prepare() {
      sound.events.push(["prepare"]);
      return 1;
    }
    success(attempt: number, id: string, replayed: boolean) {
      sound.events.push(["success", attempt, id, replayed, sound.muted]);
    }
    cancel() {
      sound.events.push(["cancel"]);
    }
    dispose() {}
  },
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
type Pending = {
  url: string;
  body: any;
  resolve: (r: Response) => void;
  reject: (e: unknown) => void;
};
let root: Root, host: HTMLDivElement, pending: Pending[];
const portfolio = {
  id: "sentinel-synthetic",
  name: "Synthetic review",
  cashBalance: 1000,
  positions: [],
} as unknown as Portfolio;
const response = (body: unknown, ok = true) =>
  ({ ok, json: async () => body }) as Response;
const quote = (ask = 25.3) => ({
  bid: 25.1,
  ask,
  mark: (25.1 + ask) / 2,
  source: "alpaca-iex",
  asOf: "2026-09-09T14:05:00.000Z",
});
const basis = (ask = 25.3) => ({
  kind: "CLOSED_SESSION_LIMIT",
  quoteSource: "alpaca-iex",
  quoteAsOf: quote().asOf,
  quoteBid: 25.1,
  quoteAsk: ask,
  sessionDate: "2026-09-09",
  nextOpen: "2026-09-10T13:30:00.000Z",
  validUntil: new Date(Date.now() + 60000).toISOString(),
});
const snapshot = (ask = 25.3) => ({
  quote: quote(ask),
  availability: {
    code: "CLOSED_LIMIT",
    label: "Regular session closed",
    message: "Last available quote",
    blocking: false,
    connectionRequired: false,
    closedSession: basis(ask),
  },
});
beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-10T04:30:00Z"));
  localStorage.clear();
  sound.events = [];
  sound.muted = false;
  pending = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (url: string, options: RequestInit) =>
        new Promise<Response>((resolve, reject) =>
          pending.push({
            url,
            body: options.body ? JSON.parse(String(options.body)) : undefined,
            resolve,
            reject,
          }),
        ),
    ),
  );
  host = document.createElement("div");
  document.body.append(host);
  await act(() => {
    root = createRoot(host);
    root.render(
      createElement(OrderTicket, {
        portfolio,
        mode: "live",
        close: vi.fn(),
        saved: vi.fn(),
        connectData: vi.fn(),
      }),
    );
  });
});
afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function inputValue(input: HTMLInputElement, value: string) {
  await act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function button(text: string) {
  return [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent?.trim() === text,
  );
}
async function selectPL() {
  const input = host.querySelector<HTMLInputElement>('[role="combobox"]')!;
  await inputValue(input, "PL");
  await act(() =>
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    ),
  );
  await act(() =>
    pending
      .find((p) => p.url.includes("/snapshot"))!
      .resolve(response(snapshot())),
  );
}

it("retains the original ambiguous submission while snapshots fail and recover with a new ask", async () => {
  await selectPL();
  const quantity = host.querySelector<HTMLInputElement>(
    'input[type="number"]',
  )!;
  await inputValue(quantity, "10");
  await act(() =>
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  const review = pending.find((p) => p.url === "/api/orders/preview")!;
  expect(review).toBeDefined();
  await act(() =>
    review.resolve(
      response({
        preview: {
          fillable: true,
          estimatedFillPrice: 25.3,
          estimatedNotional: 253,
          cashBefore: 1000,
          cashAfter: 747,
          quote: quote(),
          closedSession: basis(),
        },
      }),
    ),
  );
  await act(() => button("Simulate limit order")!.click());
  const first = pending.find((p) => p.url === "/api/orders/execute")!;
  expect(first.body.limitPrice).toBe(25.3);
  await act(() => first.reject(new TypeError("Synthetic lost response")));
  expect(button("Check order result")).toBeDefined();
  await act(() => vi.advanceTimersByTimeAsync(15000));
  await act(() =>
    pending
      .filter((p) => p.url.includes("/snapshot"))
      .at(-1)!
      .resolve(
        response({
          quote: quote(),
          availability: {
            code: "REFRESH_FAILED",
            label: "Provider refresh unavailable",
            message: "Synthetic failure",
            blocking: true,
            connectionRequired: true,
          },
        }),
      ),
  );
  await act(() => vi.advanceTimersByTimeAsync(15000));
  await act(() =>
    pending
      .filter((p) => p.url.includes("/snapshot"))
      .at(-1)!
      .resolve(response(snapshot(25.4))),
  );
  expect(button("Check order result")).toBeDefined();
  await act(() => button("Check order result")!.click());
  const retries = pending.filter((p) => p.url === "/api/orders/execute");
  expect(retries).toHaveLength(2);
  expect(retries[1].body).toEqual(first.body);
  await act(() => retries[1].reject(new TypeError("Still interrupted")));
  await act(() => vi.advanceTimersByTimeAsync(61000));
  await act(() => button("Check order result")!.click());
  const finalRetry = pending
    .filter((p) => p.url === "/api/orders/execute")
    .at(-1)!;
  expect(finalRetry.body).toEqual(first.body);
  await act(() =>
    finalRetry.resolve(
      response({
        execution: {
          orderId: "already-filled",
          fillPrice: 25.3,
          notional: 253,
          portfolioCashBalance: 747,
          replayed: true,
          quoteSource: "alpaca-iex",
          quoteAsOf: quote().asOf,
          simulationBasis: "CLOSED_SESSION_LIMIT",
        },
      }),
    ),
  );
  expect(host.textContent).toContain("This order was already confirmed.");
  expect(host.textContent).toContain("Current cash balance");
  expect(sound.events.filter((e) => e[0] === "success")).toEqual([
    ["success", 1, "already-filled", true, false],
  ]);
});

it("refreshes failed option expirations when the active error recovery button is pressed", async () => {
  await selectPL();
  await act(() => button("Options")!.click());
  await act(() =>
    pending
      .find((p) => p.url.includes("/expirations"))!
      .resolve(
        response({ error: "Synthetic option metadata unavailable" }, false),
      ),
  );
  expect(button("Refresh quote")).toBeDefined();
  await act(() => button("Refresh quote")!.click());
  expect(pending.filter((p) => p.url.includes("/expirations"))).toHaveLength(2);
});

async function reviewPL() {
  await selectPL();
  await inputValue(
    host.querySelector<HTMLInputElement>('input[type="number"]')!,
    "10",
  );
  await act(() =>
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  const request = pending.find((p) => p.url === "/api/orders/preview")!;
  expect(request.body).toMatchObject({
    assetClass: "EQUITY",
    symbol: "PL",
    side: "BUY",
    quantity: 10,
    orderType: "LIMIT",
    limitPrice: 25.3,
  });
  await act(() =>
    request.resolve(
      response({
        preview: {
          fillable: true,
          estimatedFillPrice: 25.3,
          estimatedNotional: 253,
          cashBefore: 1000,
          cashAfter: 747,
          quote: quote(),
          closedSession: basis(),
        },
      }),
    ),
  );
}

it("prefills BUY ask and SELL bid while preserving a user limit through polling and quote failures", async () => {
  await selectPL();
  const limit = host.querySelectorAll<HTMLInputElement>(
    'input[type="number"]',
  )[1];
  expect(limit.value).toBe("25.3");
  expect(
    host.querySelector<HTMLOptionElement>('option[value="MARKET"]')!.disabled,
  ).toBe(true);
  await inputValue(limit, "26");
  await act(() => vi.advanceTimersByTimeAsync(15000));
  await act(() =>
    pending
      .filter((p) => p.url.includes("/snapshot"))
      .at(-1)!
      .reject(new TypeError("Temporary quote outage")),
  );
  await act(() => vi.advanceTimersByTimeAsync(15000));
  await act(() =>
    pending
      .filter((p) => p.url.includes("/snapshot"))
      .at(-1)!
      .resolve(response(snapshot(25.4))),
  );
  expect(limit.value).toBe("26");
  const side = host.querySelector<HTMLSelectElement>("select")!;
  await act(() => {
    side.value = "SELL";
    side.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(limit.value).toBe("25.1");
});

it("keeps mute enabled while execute is pending and confirms only once with the current mute state", async () => {
  await reviewPL();
  expect(sound.events).toEqual([]);
  const confirm = button("Simulate limit order")!;
  await act(() => {
    confirm.click();
    confirm.click();
  });
  const posts = pending.filter((p) => p.url === "/api/orders/execute");
  expect(posts).toHaveLength(1);
  expect(posts[0].body.closedSessionPreview).toEqual(basis());
  expect(sound.events.map((e) => e[0])).toEqual(["mute", "prepare"]);
  const toggle = host.querySelector<HTMLInputElement>(
    'input[type="checkbox"]',
  )!;
  expect(toggle.closest("fieldset")).toBeNull();
  expect(toggle.disabled).toBe(false);
  await act(() => toggle.click());
  expect(localStorage.getItem("investor-desk:order-sounds-muted:v1")).toBe(
    "true",
  );
  await act(() =>
    posts[0].resolve(
      response({
        execution: {
          orderId: "new-confirmed",
          fillPrice: 25.3,
          notional: 253,
          portfolioCashBalance: 747,
          replayed: false,
          quoteSource: "alpaca-iex",
          quoteAsOf: quote().asOf,
          simulationBasis: "CLOSED_SESSION_LIMIT",
        },
      }),
    ),
  );
  expect(sound.events.filter((e) => e[0] === "success")).toEqual([
    ["success", 1, "new-confirmed", false, true],
  ]);
  expect(host.textContent).toContain("Your portfolio is updated.");
  expect(host.textContent).toContain("Closed-session limit simulation");
  expect(host.textContent).toContain("alpaca-iex");
  expect(host.textContent).toContain("Sep 9, 2026");
});

it("requires a new preview for changed quote prices and never executes the replaced basis", async () => {
  await reviewPL();
  await act(() => vi.advanceTimersByTimeAsync(15000));
  await act(() =>
    pending
      .filter((p) => p.url.includes("/snapshot"))
      .at(-1)!
      .resolve(response(snapshot(25.4))),
  );
  expect(button("Simulate limit order")).toBeUndefined();
  expect(button("Refresh preview")).toBeDefined();
  expect(pending.filter((p) => p.url === "/api/orders/execute")).toHaveLength(
    0,
  );
  expect(sound.events).toEqual([]);
});

it("rejects an expired preview and recovers from a definitive server refusal without sounding", async () => {
  await reviewPL();
  await act(() => vi.advanceTimersByTimeAsync(61000));
  expect(button("Simulate limit order")).toBeUndefined();
  expect(pending.filter((p) => p.url === "/api/orders/execute")).toHaveLength(
    0,
  );
  await act(() =>
    pending
      .filter((p) => p.url.includes("/snapshot"))
      .at(-1)!
      .resolve(response(snapshot())),
  );
  await act(() =>
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  await act(() =>
    pending
      .filter((p) => p.url === "/api/orders/preview")
      .at(-1)!
      .resolve(
        response({
          preview: { fillable: true, quote: quote(), closedSession: basis() },
        }),
      ),
  );
  await act(() => button("Simulate limit order")!.click());
  await act(() =>
    pending
      .filter((p) => p.url === "/api/orders/execute")
      .at(-1)!
      .resolve(
        response(
          { error: "This closed-session preview has expired. Preview again." },
          false,
        ),
      ),
  );
  expect(button("Simulate limit order")).toBeUndefined();
  expect(button("Preview order")).toBeDefined();
  expect(host.textContent).toContain("Preview again.");
  expect(sound.events.filter((e) => e[0] === "success")).toHaveLength(0);
  expect(sound.events.some((e) => e[0] === "cancel")).toBe(true);
});
