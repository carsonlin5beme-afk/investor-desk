// @vitest-environment jsdom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InvestorDesk } from "@/components/InvestorDesk";
import { DeskModal } from "@/components/DeskModal";
import type { DeskData, Holding, Portfolio } from "@/lib/desk-types";

const captured = vi.hoisted(() => ({
  ticket: null as null | {
    saved: () => void;
    onSetTarget: (id: string) => void;
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/auth-client", () => ({ authClient: {} }));
vi.mock("@/components/AmbientRadio", () => ({
  AmbientRadioControls: () => null,
  DialogRadioControl: () => null,
}));
vi.mock("@/components/Brand", () => ({
  BrandMonogram: () => null,
  BrandWordmark: () => null,
}));
vi.mock("@/components/OrderTicket", () => ({
  OrderTicket: (props: NonNullable<typeof captured.ticket>) => {
    captured.ticket = props;
    return createElement("div", { "data-ticket": "" }, "Test order receipt");
  },
}));
vi.mock("@/components/TargetEditor", () => ({
  TargetEditor: ({ holding }: { holding: Holding }) =>
    createElement("div", { "data-target": holding.id }, holding.symbol),
}));
vi.mock("@/components/studio/Trajectory", () => ({ Trajectory: () => null }));
vi.mock("@/components/studio/Allocation", () => ({ Allocation: () => null }));
vi.mock("@/components/studio/Holdings", () => ({ Holdings: () => null }));
vi.mock("@/components/studio/Activity", () => ({ Activity: () => null }));
vi.mock("@/components/studio/ScenarioStudio", () => ({
  ScenarioStudio: () => null,
}));
vi.mock("@/components/studio/Journal", () => ({ Journal: () => null }));
vi.mock("@/components/studio/Report", () => ({ Report: () => null }));
vi.mock("@/components/studio/OptionsExplorer", () => ({
  OptionsExplorer: () => null,
}));
vi.mock("@/components/studio/Settings", () => ({ Settings: () => null }));
vi.mock("@/components/studio/CommandPalette", () => ({
  CommandPalette: () => null,
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

type Request = {
  url: string;
  signal?: AbortSignal;
  resolve: (value: Response) => void;
  reject: (reason: unknown) => void;
};
let root: Root | undefined;
let host: HTMLDivElement;
let pending: Request[];
const response = (body: unknown) =>
  ({ ok: true, json: async () => body }) as Response;
const portfolio: Portfolio = {
  id: "portfolio-1",
  name: "Current portfolio",
  cashBalance: 1000,
  startingCash: 1000,
  currentValue: 1000,
  equitiesValue: 0,
  optionsValue: 0,
  projectedNetWorth: 1000,
  intrinsicNetWorth: 1000,
  targetCount: 0,
  estimatedCount: 0,
  positions: [],
  orders: [],
  ledger: [],
};
const desk = (name = "Current portfolio", user = "profile-a"): DeskData => ({
  user: { id: user, name: user, email: `${user}@example.invalid` },
  portfolios: [{ ...portfolio, name }],
  mode: "demo",
  feeds: {
    equities: false,
    options: false,
    fundamentals: false,
    equityFeed: "demo",
  },
  asOf: "2026-09-13T01:00:00Z",
});
const holding = {
  id: "holding-1",
  portfolioId: portfolio.id,
  symbol: "PL",
  quantity: 2,
} as Holding;

beforeEach(() => {
  vi.useFakeTimers();
  pending = [];
  captured.ticket = null;
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    })),
  );
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, options: RequestInit = {}) => {
      if (url === "/api/workspace")
        return Promise.resolve(response({ entries: [] }));
      return new Promise<Response>((resolve, reject) =>
        pending.push({
          url,
          signal: options.signal ?? undefined,
          resolve,
          reject,
        }),
      );
    }),
  );
  host = document.createElement("div");
  document.body.append(host);
});
afterEach(async () => {
  if (root) await act(() => root!.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function mount(strict = false) {
  await act(() => {
    root = createRoot(host);
    root.render(
      strict
        ? createElement(StrictMode, null, createElement(InvestorDesk))
        : createElement(InvestorDesk),
    );
  });
}
async function ready() {
  await mount();
  expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual([
    "/api/desk",
  ]);
  await act(() => pending[0].resolve(response(desk())));
}
async function openTicket() {
  await act(() =>
    [...host.querySelectorAll("button")]
      .find((button) => button.textContent?.trim() === "New order")!
      .click(),
  );
  expect(captured.ticket).not.toBeNull();
}

describe("desk revalidation ownership", () => {
  it("coalesces repeated mutation refreshes behind a poll and skips its obsolete snapshot", async () => {
    await ready();
    await openTicket();
    await act(() => vi.advanceTimersByTimeAsync(15000));
    await act(() => {
      captured.ticket!.saved();
      captured.ticket!.saved();
    });
    expect(pending).toHaveLength(2);
    await act(() => pending[1].resolve(response(desk("Obsolete portfolio"))));
    expect(pending).toHaveLength(3);
    expect(host.textContent).not.toContain("Obsolete portfolio");
    expect(
      host.querySelector<HTMLButtonElement>('[aria-label="Refresh portfolio"]')!
        .disabled,
    ).toBe(true);
    await act(() => pending[2].resolve(response(desk("Updated portfolio"))));
    expect(host.textContent).toContain("Updated portfolio");
    expect(
      host.querySelector<HTMLButtonElement>('[aria-label="Refresh portfolio"]')!
        .disabled,
    ).toBe(false);
  });

  it("runs a required refresh after a failed poll and retains visible data if that refresh fails", async () => {
    await ready();
    await openTicket();
    await act(() => vi.advanceTimersByTimeAsync(15000));
    await act(() => captured.ticket!.saved());
    await act(() => pending[1].reject(new Error("Obsolete failure")));
    expect(pending).toHaveLength(3);
    expect(host.textContent).not.toContain("Obsolete failure");
    await act(() => pending[2].reject(new Error("Current refresh failed")));
    expect(host.textContent).toContain("Current refresh failed");
    expect(host.textContent).toContain("Current portfolio");
  });

  it("aborts obsolete Strict Mode reads and cannot start queued work after unmount", async () => {
    await mount(true);
    expect(pending).toHaveLength(2);
    expect(pending[0].signal!.aborted).toBe(true);
    await act(() => pending[1].resolve(response(desk())));
    await act(() => pending[0].resolve(response(desk("Obsolete mount"))));
    expect(host.textContent).not.toContain("Obsolete mount");
    await openTicket();
    await act(() => vi.advanceTimersByTimeAsync(15000));
    await act(() => captured.ticket!.saved());
    const last = pending.at(-1)!;
    await act(() => root!.unmount());
    root = undefined;
    expect(last.signal!.aborted).toBe(true);
    const count = pending.length;
    await act(() => last.resolve(response(desk("Too late"))));
    await act(() => vi.advanceTimersByTimeAsync(30000));
    expect(pending).toHaveLength(count);
  });
});

describe("post-fill target loading", () => {
  it("opens a loading shell before scoped positions return, without fetching the full desk", async () => {
    await ready();
    await openTicket();
    await act(() => captured.ticket!.onSetTarget(holding.id));
    expect(host.querySelector("dialog[open]")?.textContent).toContain(
      "Loading your holding",
    );
    expect(host.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(host.querySelector("[data-ticket]")).toBeNull();
    expect(pending.map((request) => request.url)).toEqual([
      "/api/desk",
      `/api/positions?portfolioId=${portfolio.id}`,
    ]);
    await act(() => pending[1].resolve(response({ positions: [holding] })));
    expect(
      host.querySelector("[data-target]")?.getAttribute("data-target"),
    ).toBe(holding.id);
    expect(host.querySelector("dialog")).toBeNull();
  });

  it("rejects a mismatched holding and allows an explicit retry", async () => {
    await ready();
    await openTicket();
    await act(() => captured.ticket!.onSetTarget(holding.id));
    await act(() =>
      pending[1].resolve(
        response({
          positions: [{ ...holding, portfolioId: "other-portfolio" }],
        }),
      ),
    );
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "no longer available",
    );
    expect(host.querySelector("[data-target]")).toBeNull();
    await act(() =>
      [...host.querySelectorAll("dialog button")]
        .find((button) => button.textContent === "Retry")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    expect(pending).toHaveLength(3);
    await act(() => pending[2].resolve(response({ positions: [holding] })));
    expect(host.querySelector("[data-target]")).not.toBeNull();
  });

  it.each(["close button", "Escape"])(
    "cancels synchronously on %s so a response during dismissal cannot reopen the editor",
    async (action) => {
      await ready();
      await openTicket();
      await act(() => captured.ticket!.onSetTarget(holding.id));
      await act(() => {
        if (action === "Escape")
          host
            .querySelector("dialog")!
            .dispatchEvent(new Event("cancel", { cancelable: true }));
        else
          host
            .querySelector<HTMLButtonElement>(
              'dialog [aria-label="Close dialog"]',
            )!
            .click();
      });
      expect(pending[1].signal!.aborted).toBe(true);
      expect(host.querySelector("dialog.is-closing")).not.toBeNull();
      await act(() => pending[1].resolve(response({ positions: [holding] })));
      expect(host.querySelector("[data-target]")).toBeNull();
      await act(() => vi.advanceTimersByTimeAsync(160));
      expect(host.querySelector("dialog")).toBeNull();
    },
  );

  it("keeps scoped read failures in the loading shell and permits cancellation", async () => {
    await ready();
    await openTicket();
    await act(() => captured.ticket!.onSetTarget(holding.id));
    await act(() => pending[1].reject(new Error("Position read unavailable")));
    expect(host.querySelector('dialog [role="alert"]')?.textContent).toBe(
      "Position read unavailable",
    );
    expect(host.querySelector('dialog [aria-busy="false"]')).not.toBeNull();
    expect(host.querySelector("[data-target]")).toBeNull();
    await act(() =>
      host
        .querySelector("dialog")!
        .dispatchEvent(new Event("cancel", { cancelable: true })),
    );
    await act(() => vi.advanceTimersByTimeAsync(160));
    expect(host.querySelector("dialog")).toBeNull();
  });

  it("cancels a pending holding read when the desk identity changes", async () => {
    await ready();
    await openTicket();
    await act(() => captured.ticket!.onSetTarget(holding.id));
    await act(() => vi.advanceTimersByTimeAsync(15000));
    await act(() =>
      pending[2].resolve(response(desk("Other profile", "profile-b"))),
    );
    expect(pending[1].signal!.aborted).toBe(true);
    await act(() => pending[1].resolve(response({ positions: [holding] })));
    expect(host.querySelector("[data-target]")).toBeNull();
    expect(host.querySelector("dialog")).toBeNull();
  });
});

it("keeps busy dialog dismissal restrictions with the optional synchronous hook", async () => {
  const close = vi.fn(),
    onDismiss = vi.fn();
  await act(() => {
    root = createRoot(host);
    root.render(
      createElement(DeskModal, {
        title: "Saving",
        kicker: "Test",
        busy: true,
        close,
        onDismiss,
        children: "Saving",
      }),
    );
  });
  await act(() =>
    host
      .querySelector("dialog")!
      .dispatchEvent(new Event("cancel", { cancelable: true })),
  );
  expect(onDismiss).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
});
