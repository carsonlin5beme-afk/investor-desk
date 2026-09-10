// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OrderTicket } from "@/components/OrderTicket";
import type { Portfolio } from "@/lib/desk-types";

vi.mock("@/components/DeskModal", () => ({
  DeskModal: ({
    children,
    footer,
  }: {
    children: ReactNode;
    footer?: ReactNode;
  }) => createElement("section", null, children, footer),
}));
vi.mock("@/components/studio/OptionsExplorer", () => ({
  OptionsExplorer: () => null,
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const portfolio = {
  id: "cancel-test",
  name: "Cancellation test",
  cashBalance: 1000,
  positions: [],
} as unknown as Portfolio;
type Pending = {
  url: string;
  signal: AbortSignal;
  resolve: (response: Response) => void;
  reject: (reason: unknown) => void;
};
let root: Root | undefined;
let pending: Pending[];
let host: HTMLDivElement;
beforeEach(async () => {
  vi.useFakeTimers();
  pending = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (url: string, options: RequestInit) =>
        new Promise<Response>((resolve, reject) =>
          pending.push({
            url,
            signal: options.signal!,
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
        mode: "demo",
        close: vi.fn(),
        saved: vi.fn(),
        connectData: vi.fn(),
      }),
    );
  });
});
afterEach(async () => {
  if (root) await act(() => root!.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function selectSymbol(symbol: string) {
  const input = host.querySelector<HTMLInputElement>('[role="combobox"]')!;
  await act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, symbol);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(() =>
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    ),
  );
}
const quote = {
  quote: {
    bid: 10,
    ask: 11,
    mark: 10.5,
    source: "demo",
    asOf: new Date().toISOString(),
  },
  availability: {
    code: "DEMO",
    label: "Sample prices",
    message: "Illustrative prices",
    blocking: false,
  },
};
function response(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as Response;
}
describe("order ticket request ownership", () => {
  it("renders a safe current-request failure even when a rejection has no Error object", async () => {
    await selectSymbol("PL");
    await act(() => pending[0].reject(null));
    expect(host.textContent).toContain("Request failed. Please try again.");
    expect(host.textContent).toContain("Quote refresh failed");
  });

  it("ignores obsolete expiration failures while showing the new symbol's actual failure", async () => {
    await selectSymbol("PL");
    await act(() =>
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent === "Options")!
        .click(),
    );
    const old = pending.find((request) =>
      request.url.includes("/expirations"),
    )!;
    await selectSymbol("TSLA");
    const current = pending
      .filter((request) => request.url.includes("/expirations"))
      .at(-1)!;
    await act(() => old.reject(new Error("Old expiration failure")));
    expect(host.textContent).not.toContain("Old expiration failure");
    await act(() =>
      current.resolve(
        response({ error: "Options entitlement unavailable" }, false),
      ),
    );
    expect(host.textContent).toContain("Options refresh failed");
    expect(host.textContent).toContain("Options entitlement unavailable");
  });

  it("serializes chain polling and ignores a late chain failure after switching to stocks", async () => {
    await selectSymbol("PL");
    await act(() =>
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent === "Options")!
        .click(),
    );
    await act(() =>
      pending
        .find((request) => request.url.includes("/expirations"))!
        .resolve(response({ expirations: ["2027-01-15"] })),
    );
    const chain = pending.find((request) => request.url.includes("/chain"))!;
    expect(chain).toBeDefined();
    await act(() => vi.advanceTimersByTimeAsync(30000));
    expect(
      pending.filter((request) => request.url.includes("/chain")),
    ).toHaveLength(1);
    await act(() =>
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent === "Stocks / ETFs")!
        .click(),
    );
    expect(chain.signal.aborted).toBe(true);
    await act(() => chain.reject(new Error("Obsolete chain failure")));
    expect(host.textContent).not.toContain("Obsolete chain failure");
  });

  it("handles a native fetch abort on symbol change and keeps the new quote usable", async () => {
    await selectSymbol("PL");
    const old = pending[0];
    old.signal.addEventListener("abort", () => old.reject(old.signal.reason), {
      once: true,
    });
    await selectSymbol("TSLA");
    expect(old.signal.aborted).toBe(true);
    await act(() => pending.at(-1)!.resolve(response(quote)));
    expect(host.textContent).toContain("$10.50");
    expect(host.textContent).not.toContain("Quote refresh failed");
  });

  it("ignores an obsolete non-AbortError rejection instead of overwriting the next symbol", async () => {
    await selectSymbol("PL");
    const old = pending[0];
    await selectSymbol("TSLA");
    await act(() => pending.at(-1)!.resolve(response(quote)));
    await act(() => old.reject(new TypeError("Obsolete provider failure")));
    expect(host.textContent).toContain("$10.50");
    expect(host.textContent).not.toContain("Obsolete provider failure");
    expect(host.textContent).not.toContain("Quote refresh failed");
  });

  it("owns response-body cancellation and removes polling when the ticket closes", async () => {
    await selectSymbol("PL");
    const request = pending[0];
    let rejectBody!: (reason: unknown) => void;
    await act(() =>
      request.resolve({
        ok: true,
        json: () =>
          new Promise((_, reject) => {
            rejectBody = reject;
            request.signal.addEventListener(
              "abort",
              () => reject(request.signal.reason),
              { once: true },
            );
          }),
      } as Response),
    );
    expect(rejectBody).toBeTypeOf("function");
    await act(() => root!.unmount());
    root = undefined;
    expect(request.signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(30000);
    expect(pending).toHaveLength(1);
  });

  it("does not overlap refreshes while the previous quote request is pending", async () => {
    await selectSymbol("PL");
    await act(() => vi.advanceTimersByTimeAsync(30000));
    expect(pending).toHaveLength(1);
    await act(() => pending[0].resolve(response(quote)));
    await act(() => vi.advanceTimersByTimeAsync(15000));
    expect(pending).toHaveLength(2);
  });

  it("keeps genuine current HTTP failures visible and blocks order preview", async () => {
    await selectSymbol("PL");
    await act(() =>
      pending[0].resolve(
        response({ error: "Quote provider unavailable" }, false),
      ),
    );
    expect(host.textContent).toContain("Quote refresh failed");
    expect(host.textContent).toContain("Quote provider unavailable");
    const preview = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Preview order",
    )!;
    expect(preview.disabled).toBe(true);
  });

  it("does not repopulate search suggestions after a ticker was committed", async () => {
    const input = host.querySelector<HTMLInputElement>('[role="combobox"]')!;
    await act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, "PL");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(() => vi.advanceTimersByTimeAsync(200));
    const search = pending.find((request) =>
      request.url.includes("/symbols/search"),
    )!;
    await act(() =>
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      ),
    );
    expect(search.signal.aborted).toBe(true);
    await act(() =>
      search.resolve(
        response({ symbols: [{ symbol: "PL", name: "Obsolete result" }] }),
      ),
    );
    expect(host.querySelector('[role="listbox"]')).toBeNull();
  });
});
