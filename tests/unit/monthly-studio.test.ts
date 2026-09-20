// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScenarioStudio } from "@/components/studio/ScenarioStudio";
import { createMonthlyPlan } from "@/lib/monthly-scenario";
import type { WorkspaceController } from "@/components/studio/useWorkspace";
import {
  defaultPreferences,
  validateWorkspaceValue,
  type SavedScenario,
  type WorkspaceEntry,
  type WorkspaceValue,
} from "@/lib/studio";
import {
  monthlyFixture,
  monthlyPortfolioFixture,
} from "../fixtures/monthly-scenario";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, container: HTMLDivElement, workspace: WorkspaceController;
const draftKey = "investor-desk:profile-a:monthly-scenario-draft";
const portfolios = [monthlyPortfolioFixture()];
function controller(identity = "profile-a"): WorkspaceController {
  const result: WorkspaceController = {
    identity,
    entries: [],
    loading: false,
    error: "",
    preferences: { ...defaultPreferences },
    reload: vi.fn(async () => {}),
    updatePreferences: vi.fn(),
    save: vi.fn(async (key, input) => {
      const previous = result.entries.find((entry) => entry.key === key);
      const value = validateWorkspaceValue(
        key,
        typeof input === "function" ? input(previous?.value) : input,
      );
      const entry: WorkspaceEntry = {
        key,
        value: structuredClone(value),
        version: (previous?.version ?? 0) + 1,
        updatedAt: new Date().toISOString(),
      };
      result.entries = [
        ...result.entries.filter((entry) => entry.key !== key),
        entry,
      ];
      return entry;
    }),
    remove: vi.fn(async (key) => {
      result.entries = result.entries.filter((entry) => entry.key !== key);
    }),
  };
  return result;
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime("2026-09-17T16:00:00Z");
  vi.stubGlobal("fetch", vi.fn());
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  sessionStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  workspace = controller();
});
afterEach(async () => {
  await act(() => root.unmount());
  document.body.replaceChildren();
  sessionStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const render = () =>
  act(() =>
    root.render(createElement(ScenarioStudio, { portfolios, workspace })),
  );
function button(name: string) {
  const result = [
    ...container.querySelectorAll<HTMLButtonElement>("button"),
  ].find(
    (button) =>
      (button.getAttribute("aria-label") ?? button.textContent)?.trim() ===
      name,
  );
  expect(result, `button ${name}`).toBeDefined();
  return result!;
}
const input = (label: string) => {
  const field = [...container.querySelectorAll<HTMLInputElement>("input")].find(
    (field) =>
      field.getAttribute("aria-label") === label ||
      field.closest("label")?.textContent?.trim().startsWith(label),
  );
  expect(field, `input ${label}`).toBeDefined();
  return field!;
};
async function enter(field: HTMLInputElement, value: string) {
  await act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const click = (target: HTMLElement) => act(() => target.click());
const pickMonth = (date: string) =>
  click(container.querySelector<HTMLButtonElement>(`[data-month="${date}"]`)!);
async function pickTargetMode(mode: "price" | "valuation") {
  const select = container.querySelector<HTMLSelectElement>(
    'select[aria-label="BTG target type"]',
  )!;
  expect(select).not.toBeNull();
  await act(() => {
    select.value = mode;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("monthly scenario editor", () => {
  it("retains separate price and valuation inputs, shares assumptions and added months through save and reopen", async () => {
    await render();
    await enter(input("BTG price in October 2026"), "007.50");
    await pickTargetMode("valuation");
    await enter(
      input("BTG company valuation in October 2026"),
      "06000000000.00",
    );
    expect(
      container.querySelector('[data-testid="monthly-total"]')?.textContent,
    ).toBe("Incomplete");
    expect(container.textContent).toContain(
      "Enter positive shares outstanding",
    );
    await enter(input("BTG shares outstanding"), "1000000000");
    expect(container.textContent).toContain("Implied stock price: $6.00");
    expect(
      container.querySelector('[data-testid="monthly-total"]')?.textContent,
    ).not.toBe("Incomplete");
    await pickTargetMode("price");
    expect(input("BTG price in October 2026").value).toBe("007.50");
    await pickTargetMode("valuation");
    expect(input("BTG company valuation in October 2026").value).toBe(
      "06000000000.00",
    );
    await click(button("Add month"));
    await click(button("Save monthly scenario"));
    const saved = workspace.entries[0].value as SavedScenario;
    expect(saved.monthly!.paths[0].targetInputs).toMatchObject({
      mode: "valuation",
      sharesOutstandingInput: "1000000000",
      sharesSource: "manual",
    });
    expect(saved.monthly!.paths[0].targetInputs!.priceInputs).toHaveLength(7);
    expect(saved.monthly!.paths[0].targetInputs!.marketCapInputs).toHaveLength(
      7,
    );
    expect(saved.monthly!.paths[0].targetInputs!.marketCapInputs[0]).toBe(
      "06000000000.00",
    );
    await act(() => root.unmount());
    sessionStorage.clear();
    root = createRoot(container);
    await render();
    const select = container.querySelector<HTMLSelectElement>(
      'select[aria-label="Open saved scenario"]',
    )!;
    await act(() => {
      select.value = saved.id;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(input("BTG company valuation in October 2026").value).toBe(
      "06000000000.00",
    );
    expect(input("BTG shares outstanding").value).toBe("1000000000");
    expect(container.textContent).toContain("Implied stock price: $6.00");
    await pickTargetMode("price");
    expect(input("BTG price in October 2026").value).toBe("007.50");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps invalid valuation and share drafts for correction after a reload", async () => {
    await render();
    await pickTargetMode("valuation");
    await enter(input("BTG company valuation in October 2026"), "1e309");
    await enter(input("BTG shares outstanding"), "1.5");
    expect(button("Save monthly scenario").disabled).toBe(true);
    expect(
      container.querySelector('[data-testid="monthly-total"]')?.textContent,
    ).toBe("Incomplete");
    await act(() => root.unmount());
    root = createRoot(container);
    await render();
    expect(input("BTG company valuation in October 2026").value).toBe("1e309");
    expect(input("BTG shares outstanding").value).toBe("1.5");
    await pickTargetMode("price");
    expect(button("Save monthly scenario").disabled).toBe(false);
    expect(
      container.querySelector('[data-testid="monthly-total"]')?.textContent,
    ).not.toBe("Incomplete");
    await pickTargetMode("valuation");
    expect(input("BTG company valuation in October 2026").value).toBe("1e309");
    expect(button("Save monthly scenario").disabled).toBe(true);
    await enter(input("BTG company valuation in October 2026"), "6000000000");
    await enter(input("BTG shares outstanding"), "1000000000");
    expect(button("Save monthly scenario").disabled).toBe(false);
    expect(
      container.querySelector('[data-testid="monthly-total"]')?.textContent,
    ).not.toBe("Incomplete");
    await pickTargetMode("price");
    await enter(input("BTG price in October 2026"), "-2");
    expect(button("Save monthly scenario").disabled).toBe(true);
    await pickTargetMode("valuation");
    expect(button("Save monthly scenario").disabled).toBe(false);
    expect(
      container.querySelector('[data-testid="monthly-total"]')?.textContent,
    ).not.toBe("Incomplete");
  });

  it("retains an old non-month-end draft intact while blocking calculations and save", async () => {
    const draft = monthlyFixture();
    draft.monthly!.dates[0] = "2026-10-30";
    sessionStorage.setItem(draftKey, JSON.stringify(draft));
    await render();
    expect(container.textContent).toContain("last calendar day");
    expect(button("Save monthly scenario").disabled).toBe(true);
    expect(JSON.parse(sessionStorage.getItem(draftKey)!).monthly.dates[0]).toBe(
      "2026-10-30",
    );
    expect(input("BTG price in October 2026").value).toBe("6");
  });

  it("discloses conflicting captures and preserves saved shared assumptions on reopen", async () => {
    const draft = monthlyFixture();
    draft.assets[1].spot = 7;
    sessionStorage.setItem(draftKey, JSON.stringify(draft));
    await render();
    expect(container.textContent).toContain("Captured prices differ for BTG");
    expect(input("BTG at capture ($)").value).toBe("5");
    expect(input("BTG price in October 2026").value).toBe("6");
    await act(() => root.unmount());
    root = createRoot(container);
    draft.monthly = createMonthlyPlan(draft.assets, draft.capturedAt, 4);
    sessionStorage.setItem(draftKey, JSON.stringify(draft));
    await render();
    expect(input("BTG at capture ($)").value).toBe("");
    expect(input("BTG price in October 2026").value).toBe("");
    await enter(input("BTG price in October 2026"), "6");
    expect(
      container.querySelector('[data-testid="monthly-total"]')?.textContent,
    ).not.toBe("Incomplete");
  });

  it("omits inactive price/expiry editors and values when only zero-quantity holdings remain", async () => {
    const draft = monthlyFixture();
    draft.assets.forEach((asset) =>
      Object.assign(asset, { quantity: 0, costBasis: 0, currentValue: 0 }),
    );
    draft.assets[1].option!.expiration = "2026-08-21T20:00:00.000Z";
    draft.monthly!.paths[0].initialPrice = null;
    draft.monthly!.paths[0].prices.fill(null);
    sessionStorage.setItem(draftKey, JSON.stringify(draft));
    await render();
    expect(
      container.querySelector('[data-testid="monthly-total"]')?.textContent,
    ).toBe("$1,000.00");
    expect(
      container.querySelector('[aria-label="BTG price in October 2026"]'),
    ).toBeNull();
    expect(container.textContent).not.toContain("Expiry prices · shared");
    expect(container.textContent).toContain("No positions in this snapshot");
  });

  it("uses the normalized symbol's late cutoff in the expiry editor", async () => {
    const draft = monthlyFixture();
    draft.assets = [draft.assets[1]];
    draft.assets[0].symbol = " spy ";
    draft.assets[0].option!.expiration = "2026-11-30T21:15:00.000Z";
    draft.monthly = createMonthlyPlan(draft.assets, draft.capturedAt, 4);
    sessionStorage.setItem(draftKey, JSON.stringify(draft));
    await render();
    expect(container.textContent).toContain("4:15 PM New York");
    expect(input("SPY expiry price on 2026-11-30")).toBeDefined();
  });

  it("marks monetary copies for visual privacy and separates losses from unavailable values", async () => {
    sessionStorage.setItem(draftKey, JSON.stringify(monthlyFixture()));
    await render();
    expect(
      [...container.querySelectorAll(".financial-number")].every((element) =>
        element.classList.contains("private-value"),
      ),
    ).toBe(true);
    expect(
      container
        .querySelector('[data-testid="monthly-profit"]')
        ?.classList.contains("negative"),
    ).toBe(true);
    expect(
      container
        .querySelector('[data-testid="monthly-change"]')
        ?.classList.contains("negative"),
    ).toBe(true);
    expect(
      [...container.querySelectorAll("td")].every((element) =>
        element.classList.contains("private-value"),
      ),
    ).toBe(true);
    await enter(input("BTG price in October 2026"), "");
    const total = container.querySelector('[data-testid="monthly-total"]')!;
    expect(total.className).toContain("unavailable");
    expect(
      [...container.querySelectorAll(".private-value")].some(
        (element) => element.textContent === "$1,000.00",
      ),
    ).toBe(true);
  });

  it("is discoverable and recalculates shared-underlying inputs locally, distinguishing zero and blanks", async () => {
    await render();
    expect(button("Monthly").getAttribute("aria-pressed")).toBe("true");
    expect(input("BTG price in October 2026").value).toBe("5");
    await enter(input("BTG price in October 2026"), "8");
    expect(
      container.querySelector('[data-testid="monthly-total"]')?.textContent,
    ).not.toBe("Incomplete");
    const data = JSON.parse(sessionStorage.getItem(draftKey)!);
    expect(data.monthly.paths).toHaveLength(1);
    expect(data.monthly.paths[0].prices[0]).toBe(8);
    await enter(input("BTG price in October 2026"), "0");
    expect(
      container.querySelector('[data-testid="monthly-total"]')?.textContent,
    ).toBe("$1,000.00");
    await enter(input("BTG price in October 2026"), "");
    expect(
      container.querySelector('[data-testid="monthly-total"]')?.textContent,
    ).toBe("Incomplete");
    expect(container.textContent).toContain("Known subtotal: $1,000.00");
    expect(fetch).not.toHaveBeenCalled();
    await click(button("Target progress"));
    expect(container.textContent).toContain("Compare your possibilities");
    await click(button("Monthly"));
    expect(input("BTG price in October 2026").value).toBe("");
  });

  it("saves and reopens monthly inputs, assumptions and expiry overrides", async () => {
    sessionStorage.setItem(draftKey, JSON.stringify(monthlyFixture()));
    await render();
    await enter(input("Scenario name"), "My October and November thesis");
    await enter(input("BTG price in October 2026"), "6.5");
    await pickMonth("2026-11-30");
    await enter(input("BTG price in November 2026"), "7.5");
    await enter(input("IV override (%)"), "45");
    await enter(input("BTG expiry price on 2026-12-18"), "9");
    await click(button("Save monthly scenario"));
    expect(workspace.save).toHaveBeenCalledOnce();
    const saved = workspace.entries[0].value as SavedScenario;
    expect(saved.monthly).toMatchObject({
      ivOverride: 0.45,
      expiryPrices: [{ symbol: "BTG", date: "2026-12-18", price: 9 }],
    });
    expect(saved.monthly!.paths[0].prices.slice(0, 2)).toEqual([6.5, 7.5]);
    await act(() => root.unmount());
    sessionStorage.clear();
    root = createRoot(container);
    await render();
    const select = container.querySelector<HTMLSelectElement>(
      'select[aria-label="Open saved scenario"]',
    )!;
    await act(() => {
      select.value = saved.id;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(input("BTG price in October 2026").value).toBe("6.5");
    expect(input("IV override (%)").value).toBe("45");
    await pickMonth("2026-12-31");
    expect(container.textContent).toContain("$240,000.00");
    expect(container.textContent).toContain("Liquidated in this model");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("recovers an invalid draft for correction while rejecting save and hiding totals", async () => {
    await render();
    await enter(input("BTG price in October 2026"), "-2");
    expect(button("Save monthly scenario").disabled).toBe(true);
    expect(
      container.querySelector('[data-testid="monthly-total"]')?.textContent,
    ).toBe("Incomplete");
    await act(() => root.unmount());
    root = createRoot(container);
    await render();
    expect(input("BTG price in October 2026").value).toBe("-2");
    await enter(input("BTG price in October 2026"), "6");
    expect(button("Save monthly scenario").disabled).toBe(false);
  });

  it("keeps drafts after save errors and isolates them when identity changes", async () => {
    await render();
    await enter(input("BTG price in October 2026"), "12");
    vi.mocked(workspace.save).mockRejectedValueOnce(
      new Error(
        "This item changed in another window. Reload the workspace before saving again.",
      ),
    );
    await click(button("Save monthly scenario"));
    expect(container.textContent).toContain(
      "This item changed in another window",
    );
    expect(input("BTG price in October 2026").value).toBe("12");
    workspace = controller("profile-b");
    await render();
    expect(input("BTG price in October 2026").value).toBe("5");
    workspace = controller("profile-a");
    await render();
    expect(input("BTG price in October 2026").value).toBe("12");
  });

  it("does not claim a later edit was saved when an earlier write completes", async () => {
    await render();
    await enter(input("BTG price in October 2026"), "6");
    let resolve!: (entry: WorkspaceEntry) => void;
    vi.mocked(workspace.save).mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await click(button("Save monthly scenario"));
    await enter(input("BTG price in October 2026"), "7");
    await act(() =>
      resolve({
        key: "fixture",
        value: {} as WorkspaceValue,
        version: 1,
        updatedAt: new Date().toISOString(),
      }),
    );
    expect(input("BTG price in October 2026").value).toBe("7");
    expect(container.querySelector(".save-state")?.textContent).not.toBe(
      "Saved",
    );
  });

  it("supports keyboard month inspection and prominent semantic money outputs", async () => {
    await render();
    const october = container.querySelector<HTMLButtonElement>(
      '[data-month="2026-10-31"]',
    )!;
    await act(() => {
      october.focus();
      october.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
    });
    expect(
      container
        .querySelector('[data-month="2026-11-30"]')
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
    expect(document.activeElement).toBe(
      container.querySelector('[data-month="2026-11-30"]'),
    );
    expect(
      container
        .querySelector('[data-testid="monthly-total"]')
        ?.classList.contains("financial-number"),
    ).toBe(true);
    expect(
      input("BTG price in November 2026").classList.contains(
        "financial-number",
      ),
    ).toBe(true);
  });
});
