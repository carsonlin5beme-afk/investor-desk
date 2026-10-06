// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { ScenarioStudio } from "@/components/studio/ScenarioStudio";
import {
  defaultPreferences,
  validateWorkspaceValue,
  scenarioTotalAt,
  valueAt,
  scenarioFinancing,
  type SavedScenario,
  type WorkspaceEntry,
} from "@/lib/studio";
import { targetSaleDate } from "@/lib/scenario-tax-sales";
import type { WorkspaceController } from "@/components/studio/useWorkspace";
import {
  monthlyPortfolioFixture,
  monthlyFixture,
} from "../fixtures/monthly-scenario";
vi.mock("@/components/studio/ValueChart", () => ({ ValueChart: () => null }));
vi.mock("@/components/studio/MonthlyChart", () => ({
  MonthlyChart: () => null,
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement, workspace: WorkspaceController;
const p = monthlyPortfolioFixture();
const stock = {
  ...p.positions[0],
  avgCost: 800,
  projection: {
    ...p.positions[0].projection,
    currentMarketValue: 100000,
    currentPrice: 1000,
    costBasis: 80000,
    targetUnderlyingPrice: 1000,
    underlyingPrice: 1000,
  },
};
const portfolios = [
  {
    ...p,
    positions: [stock],
    equitiesValue: 100000,
    optionsValue: 0,
    currentValue: 71000,
    margin: {
      debt: 30000,
      aprPercent: 12,
      maintenancePercent: 30,
      dayCountBasis: 360 as const,
    },
  },
];
const controller = (): WorkspaceController => {
  const result: WorkspaceController = {
    identity: "tax-ui",
    entries: [],
    loading: false,
    error: "",
    preferences: { ...defaultPreferences },
    reload: vi.fn(),
    updatePreferences: vi.fn(),
    remove: vi.fn(),
    save: vi.fn(async (key, value) => {
      const prior = result.entries.find((e) => e.key === key);
      const parsed = validateWorkspaceValue(
        key,
        typeof value === "function" ? value(prior?.value) : value,
      );
      const entry: WorkspaceEntry = {
        key,
        value: structuredClone(parsed),
        version: (prior?.version ?? 0) + 1,
        updatedAt: "2026-09-17T16:00:00Z",
      };
      result.entries = [...result.entries.filter((e) => e.key !== key), entry];
      return entry;
    }),
  };
  return result;
};
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime("2026-09-17T16:00:00Z");
  vi.stubGlobal("fetch", vi.fn());
  sessionStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  workspace = controller();
});
afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  sessionStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const render = () =>
  act(() =>
    root.render(createElement(ScenarioStudio, { portfolios, workspace })),
  );
const button = (text: string) =>
  [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (e) => e.textContent?.trim() === text,
  )!;
const click = (text: string) =>
  act(async () => {
    button(text).click();
    await Promise.resolve();
  });
const input = (name: string) =>
  [...host.querySelectorAll<HTMLInputElement>("input")].find(
    (e) =>
      e.getAttribute("aria-label") === name ||
      e.closest("label")?.textContent?.trim().startsWith(name),
  )!;
async function enter(name: string, value: string) {
  await act(() => {
    const field = input(name);
    expect(field, name).toBeDefined();
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function treatment() {
  await act(() => {
    const field = host.querySelector<HTMLSelectElement>(
      'select[aria-label="BTG tax treatment"]',
    )!;
    field.value = "standard";
    field.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
const total = (label: string) =>
  [
    ...host
      .querySelector('[aria-label="Tax planning totals"]')!
      .querySelectorAll("dt"),
  ].find((e) => e.textContent === label)!.nextElementSibling!.textContent;
const draft = (kind: "target" | "monthly") =>
  JSON.parse(
    sessionStorage.getItem(
      `investor-desk:tax-ui:${kind === "target" ? "scenario" : "monthly-scenario"}-draft`,
    )!,
  ) as SavedScenario;
async function reloadTarget() {
  await act(() => root.unmount());
  root = createRoot(host);
  await render();
  await click("Target progress");
}

describe("Tax integration in Scenario Studio", () => {
  it("keeps the default view opt-in and applies each monthly checkpoint as an alternative gross sale", async () => {
    await render();
    expect(host.querySelector('[aria-label="Tax planning totals"]')).toBeNull();
    await click("Set up tax estimate");
    await enter("BTG acquisition date", "2026-01-01");
    await treatment();
    expect(total("Gross sale proceeds")).toBe("$100,000.00");
    expect(total("Regular federal + NIIT reserve")).toBe("$390.00");
    expect(draft("monthly").portfolioSnapshots![0].margin.debt).toBe(30000);
    await act(() =>
      host
        .querySelector<HTMLButtonElement>('[data-month="2026-11-30"]')!
        .click(),
    );
    await enter("BTG price in November 2026", "1100");
    expect(total("Gross sale proceeds")).toBe("$110,000.00");
    expect(total("Regular federal + NIIT reserve")).toBe("$1,420.00");
    await act(() =>
      host
        .querySelector<HTMLButtonElement>('[data-month="2026-10-31"]')!
        .click(),
    );
    expect(total("Gross sale proceeds")).toBe("$100,000.00");
    expect(total("Regular federal + NIIT reserve")).toBe("$390.00");
    expect(fetch).not.toHaveBeenCalled();
    expect(p.positions[0].projection.costBasis).toBe(400);
  });
  it("links intended date to model timing and preserves a cleared date as unknown across reload", async () => {
    await render();
    await click("Target progress");
    await click("New scenario");
    await click("Set up tax estimate");
    await enter("BTG acquisition date", "2025-11-30");
    await treatment();
    await enter("Assumed sale date", "2026-11-30");
    expect(total("Short-term gain / loss")).toBe("$20,000.00");
    expect(total("Regular federal + NIIT reserve")).toBe("$390.00");
    expect(targetSaleDate(draft("target"))).toBe("2026-11-30");
    await enter("Assumed sale date", "");
    expect(draft("target").assumptions.daysForward).toBeNull();
    expect(input("Days forward").value).toBe("");
    expect(total("Regular federal + NIIT reserve")).toBe("Unavailable");
    expect(button("Save scenario").disabled).toBe(true);
    await reloadTarget();
    expect(input("Assumed sale date").value).toBe("");
    expect(input("Days forward").value).toBe("");
    expect(total("Regular federal + NIIT reserve")).toBe("Unavailable");
    expect(button("Save scenario").disabled).toBe(true);
    await enter("Assumed sale date", "2026-12-01");
    expect(targetSaleDate(draft("target"))).toBe("2026-12-01");
    expect(Number(input("Days forward").value)).toBeGreaterThan(0);
    expect(total("Long-term gain / loss")).toBe("$20,000.00");
    expect(total("Regular federal + NIIT reserve")).toBe("$0.00");
    await click("Save scenario");
    expect(workspace.save).toHaveBeenCalledOnce();
    expect((workspace.entries[0].value as SavedScenario).tax).toEqual(
      draft("target").tax,
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["", "-1", "3651"])(
    "does not turn invalid days %s into zero timing after reload",
    async (raw) => {
      await render();
      await click("Target progress");
      await click("New scenario");
      await click("Set up tax estimate");
      await enter("Days forward", raw);
      expect(draft("target").assumptions.daysForward).toBeNull();
      expect(button("Save scenario").disabled).toBe(true);
      await reloadTarget();
      expect(draft("target").assumptions.daysForward).toBeNull();
      expect(input("Assumed sale date").value).toBe("");
      await enter("Days forward", "30");
      expect(targetSaleDate(draft("target"))).toBe("2026-10-17");
      expect(button("Save scenario").disabled).toBe(false);
    },
  );
  it("does not claim later tax edits were saved when an earlier scenario write completes", async () => {
    await render();
    await click("Target progress");
    await click("New scenario");
    await click("Set up tax estimate");
    await enter("BTG acquisition date", "2026-01-01");
    await treatment();
    let finish!: (entry: WorkspaceEntry) => void;
    vi.mocked(workspace.save).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await click("Save scenario");
    const submitted = structuredClone(draft("target"));
    await enter("BTG total tax basis", "70000");
    await act(() =>
      finish({
        key: `scenario:${submitted.id}`,
        value: submitted,
        version: 1,
        updatedAt: submitted.capturedAt,
      }),
    );
    expect(draft("target").tax!.assumptions[0].totalBasis).toBe(70000);
    expect(
      host.querySelector(".editor-footer .save-state")?.textContent?.trim(),
    ).not.toBe("Saved");
    expect(button("Save scenario").disabled).toBe(false);
  });
  it("keeps financing and future values unknown with null timing while the captured asset value remains known", () => {
    const s = monthlyFixture();
    s.assumptions.daysForward = null;
    expect(scenarioFinancing(s)).toBeNull();
    expect(scenarioTotalAt(s, 1)).toBeNaN();
    expect(
      valueAt(s.assets[0], 1, "model", s.assumptions, Date.parse(s.capturedAt)),
    ).toBeNaN();
    expect(
      valueAt(s.assets[0], 0, "model", s.assumptions, Date.parse(s.capturedAt)),
    ).toBe(500);
  });
});
