// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScenarioStudio } from "@/components/studio/ScenarioStudio";
import type { WorkspaceController } from "@/components/studio/useWorkspace";
import {
  defaultPreferences,
  scenarioSchema,
  snapshot,
  validateScenarioTax,
  validateWorkspaceValue,
  type SavedScenario,
} from "@/lib/studio";
import {
  createTaxSettings,
  projectScenarioTax,
  scenarioTaxSettingsSchema,
} from "@/lib/scenario-tax";
import { monthlyTaxSales } from "@/lib/scenario-tax-sales";
import { projectMonthly } from "@/lib/monthly-projection";
import {
  monthlyFixture,
  monthlyPortfolioFixture,
} from "../fixtures/monthly-scenario";

const taxScenario = (): SavedScenario => {
  const scenario = monthlyFixture();
  scenario.tax = {
    rulesYear: 2025,
    filingStatus: "headOfHousehold",
    otherOrdinaryIncome: 12345.67,
    assumptions: [
      {
        assetId: scenario.assets[0].id,
        included: true,
        treatment: "standard",
        acquiredDate: "2025-01-02",
        totalBasis: 432.1,
      },
      {
        assetId: scenario.assets[1].id,
        included: false,
        treatment: "unsupported",
        acquiredDate: null,
        totalBasis: null,
      },
    ],
  };
  return scenario;
};
const validate = (scenario: SavedScenario): SavedScenario =>
  validateWorkspaceValue(
    `scenario:${scenario.id}`,
    JSON.parse(JSON.stringify(scenario)),
  ) as SavedScenario;

describe("Frozen hypothetical-tax scenario persistence", () => {
  it("retains captured tax basis, dates and sale scope after live portfolios change", () => {
    const portfolio = monthlyPortfolioFixture();
    portfolio.margin = {
      debt: 10000,
      aprPercent: 12,
      maintenancePercent: 30,
      dayCountBasis: 365,
    };
    const captured = snapshot([portfolio], "Tax assumptions at capture");
    captured.tax = createTaxSettings(captured.assets);
    captured.tax.assumptions[0].acquiredDate = "2024-01-01";
    captured.tax.assumptions[0].totalBasis = 1234.56;
    captured.tax.assumptions[0].treatment = "standard";
    captured.tax.assumptions[1].included = false;
    const frozen = structuredClone(captured);

    portfolio.name = "Changed live account";
    portfolio.cashBalance = 0;
    portfolio.margin.debt = 7000;
    portfolio.margin.aprPercent = 3;
    portfolio.positions[0].avgCost = 99;
    portfolio.positions[0].quantity = 1;
    portfolio.positions[0].projection.costBasis = 99;
    portfolio.positions[0].projection.targetUnderlyingPrice = 200;
    portfolio.positions = [];

    expect(captured).toEqual(frozen);
    expect(validate(captured)).toEqual(frozen);
    expect(captured.tax.assumptions).toHaveLength(2);
    expect(captured.tax.assumptions[0]).toMatchObject({
      acquiredDate: "2024-01-01",
      totalBasis: 1234.56,
      included: true,
      treatment: "standard",
    });
    expect(captured.portfolioSnapshots?.[0].margin.debt).toBe(10000);
  });

  it("round-trips every field through scenario JSON and isolates the parsed copy", () => {
    const scenario = taxScenario();
    const parsed = scenarioSchema.parse(JSON.parse(JSON.stringify(scenario)));
    validateScenarioTax(parsed);
    expect(parsed).toEqual(scenario);
    expect(validate(scenario)).toEqual(scenario);
    const before = structuredClone(parsed.tax);
    scenario.tax!.rulesYear = 2026;
    scenario.tax!.otherOrdinaryIncome = 0;
    scenario.tax!.assumptions[0].totalBasis = 0;
    scenario.tax!.assumptions[1].included = true;
    expect(parsed.tax).toEqual(before);
  });

  it("preserves unknown nullable assumptions for correction without fabricating a complete estimate", () => {
    const scenario = taxScenario();
    scenario.tax!.otherOrdinaryIncome = null;
    scenario.tax!.assumptions = scenario.assets.map((asset) => ({
      assetId: asset.id,
      included: true,
      treatment: "unknown",
      acquiredDate: null,
      totalBasis: null,
    }));
    const restored = validate(scenario);
    expect(restored.tax).toEqual(scenario.tax);
    const estimate = projectScenarioTax(
      restored.tax!,
      monthlyTaxSales(restored, projectMonthly(restored)[0]),
    );
    expect(estimate.complete).toBe(false);
    expect(estimate.taxReserve).toBeNull();
    expect(estimate.years).toEqual([]);
  });

  it("retains a frozen rule year across distinct option-expiry and later equity-sale years", () => {
    const scenario = monthlyFixture();
    scenario.tax = createTaxSettings(scenario.assets);
    scenario.tax.rulesYear = 2025;
    scenario.tax.filingStatus = "marriedJoint";
    scenario.tax.assumptions.forEach((assumption) => {
      assumption.treatment = "standard";
      assumption.acquiredDate = "2026-01-01";
    });
    const before = projectScenarioTax(
      scenario.tax,
      monthlyTaxSales(scenario, projectMonthly(scenario)[3]),
    );
    const restored = validate(scenario);
    const after = projectScenarioTax(
      restored.tax!,
      monthlyTaxSales(restored, projectMonthly(restored)[3]),
    );
    expect(after).toEqual(before);
    expect(after.complete).toBe(true);
    expect(
      after.years.map((year) => [
        year.saleYear,
        year.rulesYear,
        year.usesAssumedRules,
      ]),
    ).toEqual([
      [2026, 2025, true],
      [2027, 2025, true],
    ]);
  });

  it("leaves legacy omitted tax settings omitted after validation and JSON reload", () => {
    const legacy = monthlyFixture();
    const parsed = scenarioSchema.parse(JSON.parse(JSON.stringify(legacy)));
    validateScenarioTax(parsed);
    const restored = validate(legacy);
    expect(restored).toEqual(legacy);
    expect(Object.hasOwn(parsed, "tax")).toBe(false);
    expect(Object.hasOwn(restored, "tax")).toBe(false);
  });

  it("matches only positive-quantity captured holdings, with an explicit zero-quantity omission", () => {
    const scenario = taxScenario();
    delete scenario.monthly;
    scenario.assets.push({
      ...scenario.assets[0],
      id: "closed-position",
      quantity: 0,
    });
    expect(() => validateScenarioTax(scenario)).not.toThrow();
    expect(validate(scenario).tax).toEqual(scenario.tax);
    scenario.tax!.assumptions.push({
      assetId: "closed-position",
      included: false,
      treatment: "unknown",
      acquiredDate: null,
      totalBasis: null,
    });
    expect(() => validate(scenario)).toThrow();
  });

  it.each([
    "duplicate assumptions",
    "missing included holding",
    "missing excluded holding",
    "extraneous holding",
    "duplicate captured holding",
  ])("rejects %s rather than silently rewriting frozen tax scope", (kind) => {
    const scenario = taxScenario();
    delete scenario.monthly;
    if (kind === "duplicate assumptions")
      scenario.tax!.assumptions.push({ ...scenario.tax!.assumptions[0] });
    if (kind === "missing included holding") scenario.tax!.assumptions.shift();
    if (kind === "missing excluded holding") scenario.tax!.assumptions.pop();
    if (kind === "extraneous holding")
      scenario.tax!.assumptions[1].assetId = "foreign-holding";
    if (kind === "duplicate captured holding")
      scenario.assets[1].id = scenario.assets[0].id;
    const original = structuredClone(scenario);
    expect(() =>
      validateWorkspaceValue(`scenario:${scenario.id}`, scenario),
    ).toThrow();
    expect(scenario).toEqual(original);
  });

  it("allows reordered assumptions while retaining the association by captured asset ID", () => {
    const scenario = taxScenario();
    scenario.tax!.assumptions.reverse();
    expect(validate(scenario).tax).toEqual(scenario.tax);
    expect(validate(scenario).tax!.assumptions[0].assetId).toBe(
      scenario.assets[1].id,
    );
  });

  it.each([
    ["null tax record", null],
    ["unsupported rules", { ...taxScenario().tax, rulesYear: 2027 }],
    ["unknown setting", { ...taxScenario().tax, cashDeduction: 1000 }],
    ["subcent income", { ...taxScenario().tax, otherOrdinaryIncome: 0.001 }],
    [
      "impossible date",
      {
        ...taxScenario().tax,
        assumptions: [
          { ...taxScenario().tax!.assumptions[0], acquiredDate: "2026-02-30" },
          taxScenario().tax!.assumptions[1],
        ],
      },
    ],
    [
      "subcent basis",
      {
        ...taxScenario().tax,
        assumptions: [
          { ...taxScenario().tax!.assumptions[0], totalBasis: 100.001 },
          taxScenario().tax!.assumptions[1],
        ],
      },
    ],
  ])("rejects malformed persisted tax settings: %s", (_name, tax) => {
    const scenario = { ...monthlyFixture(), tax };
    expect(() =>
      validateWorkspaceValue(`scenario:${scenario.id}`, scenario),
    ).toThrow();
  });

  it("does not change captured cash, financing or holding values when tax assumptions and projections are edited", () => {
    const scenario = taxScenario();
    scenario.portfolioSnapshots = [
      {
        id: "fixture-portfolio",
        name: "Options",
        cash: 1000,
        margin: {
          debt: 30000,
          aprPercent: 12,
          maintenancePercent: 30,
          dayCountBasis: 360,
        },
      },
    ];
    const records = structuredClone({
      cash: scenario.cash,
      accounts: scenario.portfolioSnapshots,
      assets: scenario.assets,
      assumptions: scenario.assumptions,
    });
    scenario.tax!.otherOrdinaryIncome = 0;
    scenario.tax!.assumptions[0].totalBasis = 0;
    scenario.tax!.assumptions[0].acquiredDate = "2024-12-31";
    const parsedTax = scenarioTaxSettingsSchema.parse(scenario.tax);
    projectScenarioTax(
      parsedTax,
      monthlyTaxSales(scenario, projectMonthly(scenario)[3]),
    );
    expect({
      cash: scenario.cash,
      accounts: scenario.portfolioSnapshots,
      assets: scenario.assets,
      assumptions: scenario.assumptions,
    }).toEqual(records);
  });
});

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let host: HTMLDivElement;
let workspace: WorkspaceController;
const monthlyDraftKey = "investor-desk:tax-profile:monthly-scenario-draft";
const targetDraftKey = "investor-desk:tax-profile:scenario-draft";

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
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  workspace = {
    identity: "tax-profile",
    entries: [],
    loading: false,
    error: "",
    preferences: { ...defaultPreferences },
    reload: vi.fn(async () => {}),
    save: vi.fn(),
    remove: vi.fn(),
    updatePreferences: vi.fn(),
  };
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
    root.render(createElement(ScenarioStudio, { portfolios: [], workspace })),
  );
async function targetView() {
  const button = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent?.trim() === "Target progress",
  );
  expect(button).toBeDefined();
  await act(() => button!.click());
}

describe("Actual scenario session-draft tax parsers", () => {
  it.each(["monthly", "targets"])(
    "restores nullable tax fields through the %s draft parser without filling unknown assumptions",
    async (view) => {
      const scenario = taxScenario();
      scenario.tax!.otherOrdinaryIncome = null;
      const key = view === "monthly" ? monthlyDraftKey : targetDraftKey;
      sessionStorage.setItem(key, JSON.stringify(scenario));
      await render();
      if (view === "targets") await targetView();
      const restored = JSON.parse(
        sessionStorage.getItem(key)!,
      ) as SavedScenario;
      expect(restored.tax).toEqual(scenario.tax);
      expect(restored.assets).toEqual(scenario.assets);
      expect(restored.tax!.assumptions[1].acquiredDate).toBeNull();
      expect(restored.tax!.assumptions[1].totalBasis).toBeNull();
      expect(workspace.save).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each(["monthly", "targets"])(
    "rejects tax holding-scope corruption through the actual %s draft parser",
    async (view) => {
      const scenario = taxScenario();
      scenario.tax!.assumptions[0].assetId = "foreign-holding";
      const key = view === "monthly" ? monthlyDraftKey : targetDraftKey;
      sessionStorage.setItem(key, JSON.stringify(scenario));
      await render();
      if (view === "targets") await targetView();
      expect(sessionStorage.getItem(key)).toBeNull();
      expect(workspace.save).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each(["monthly", "targets"])(
    "keeps legacy tax omission when reopening a %s draft",
    async (view) => {
      const scenario = monthlyFixture();
      const key = view === "monthly" ? monthlyDraftKey : targetDraftKey;
      sessionStorage.setItem(key, JSON.stringify(scenario));
      await render();
      if (view === "targets") await targetView();
      const restored = JSON.parse(sessionStorage.getItem(key)!);
      expect(Object.hasOwn(restored, "tax")).toBe(false);
      expect(workspace.save).not.toHaveBeenCalled();
    },
  );
});
