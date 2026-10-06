import { describe, expect, it } from "vitest";
import { expiryPrice, projectMonthly } from "@/lib/monthly-projection";
import {
  monthlyDraftPlanSchema,
  monthlyPlanSchema,
  monthlyTargetInputs,
  monthlyValuationAt,
  resolveMonthlyTarget,
  type MonthlyPath,
} from "@/lib/monthly-scenario";
import { validateWorkspaceValue } from "@/lib/studio";
import { monthlyFixture } from "../fixtures/monthly-scenario";

function returnFixture(
  returns = ["10", "-5", "0", "25"],
  initialPrice: number | null = 100,
) {
  const scenario = monthlyFixture();
  const path = scenario.monthly!.paths[0];
  path.initialPrice = initialPrice;
  path.targetInputs = {
    ...monthlyTargetInputs(path),
    mode: "return",
    returnInputs: returns,
  };
  return { scenario, plan: scenario.monthly!, path };
}
const resolved = (path: MonthlyPath) =>
  path.prices.map((_, index) => resolveMonthlyTarget(path, index));

describe("monthly compounded returns", () => {
  it("compounds each signed percentage from the explicit starting price without changing other inputs", () => {
    const { plan, path } = returnFixture([" +10 ", "-5", ".5", "0e2"]);
    const before = structuredClone(path);
    const prices = resolved(path).map((target) => target.price);
    expect(prices[0]).toBeCloseTo(110, 12);
    expect(prices[1]).toBeCloseTo(104.5, 12);
    expect(prices[2]).toBeCloseTo(105.0225, 12);
    expect(prices[3]).toBeCloseTo(105.0225, 12);
    expect(
      resolved(path).every((target) => !target.invalid && !target.reason),
    ).toBe(true);
    expect(monthlyPlanSchema.safeParse(plan).success).toBe(true);
    expect(path).toEqual(before);
  });

  it("accepts zero, -100%, and a zero anchor while continuing to inspect later rates", () => {
    const { plan, path } = returnFixture(["0", "-100", "1e308", "0"]);
    expect(resolved(path).map((target) => target.price)).toEqual([
      100, 0, 0, 0,
    ]);
    expect(monthlyPlanSchema.safeParse(plan).success).toBe(true);
    path.initialPrice = 0;
    expect(resolved(path).map((target) => target.price)).toEqual([0, 0, 0, 0]);
    path.targetInputs!.returnInputs![2] = "";
    expect(resolveMonthlyTarget(path, 3)).toMatchObject({
      price: null,
      invalid: false,
    });
    expect(monthlyPlanSchema.safeParse(plan).success).toBe(true);
    path.targetInputs!.returnInputs![2] = "-101";
    expect(resolveMonthlyTarget(path, 3)).toMatchObject({
      price: null,
      invalid: true,
    });
    expect(monthlyPlanSchema.safeParse(plan).success).toBe(false);
  });

  it("blocks every downstream checkpoint after a missing or invalid anchor, rate, or price", () => {
    const { plan, path } = returnFixture(["10", "", "50", "-5"]);
    expect(resolveMonthlyTarget(path, 0).price).toBeCloseTo(110, 12);
    for (const index of [1, 2, 3])
      expect(resolveMonthlyTarget(path, index)).toMatchObject({
        price: null,
        invalid: false,
      });
    path.targetInputs!.returnInputs![1] = "-101";
    for (const index of [1, 2, 3])
      expect(resolveMonthlyTarget(path, index)).toMatchObject({
        price: null,
        invalid: true,
      });
    path.targetInputs!.returnInputs = ["10", "0", "0", "0"];
    path.initialPrice = null;
    expect(
      resolved(path).every((target) => target.price == null && !target.invalid),
    ).toBe(true);
    expect(monthlyPlanSchema.safeParse(plan).success).toBe(true);
    expect(resolveMonthlyTarget(path, 0).reason).toContain("starting price");
    for (const anchor of [-1, 1e9 + 1, NaN, Infinity]) {
      path.initialPrice = anchor;
      expect(
        resolved(path).every(
          (target) => target.price == null && target.invalid,
        ),
      ).toBe(true);
      expect(monthlyPlanSchema.safeParse(plan).success).toBe(false);
    }
    path.initialPrice = 1e9;
    expect(
      resolved(path).every((target) => target.price == null && target.invalid),
    ).toBe(true);
  });

  it.each([
    "-100.01",
    "Infinity",
    "NaN",
    "1e309",
    "0xff",
    "10%",
    "-",
    "1e-999",
  ])(
    "rejects malformed or unsupported rate %s even after an earlier blank, preserving the draft text",
    (raw) => {
      const { scenario, plan, path } = returnFixture(["", raw, "0", "0"]);
      expect(resolveMonthlyTarget(path, 3)).toMatchObject({
        price: null,
        invalid: false,
      });
      const parsed = monthlyPlanSchema.safeParse(plan);
      expect(parsed.success).toBe(false);
      if (!parsed.success)
        expect(
          parsed.error.issues.some((issue) =>
            issue.message.includes("finite percentages"),
          ),
        ).toBe(true);
      expect(() =>
        validateWorkspaceValue(`scenario:${scenario.id}`, scenario),
      ).toThrow();
      expect(
        monthlyDraftPlanSchema.parse(JSON.parse(JSON.stringify(plan))).paths[0]
          .targetInputs!.returnInputs,
      ).toEqual(["", raw, "0", "0"]);
    },
  );

  it("bounds each intermediate price and rejects positive-price underflow without hiding the draft", () => {
    const { plan, path } = returnFixture(["0", "0", "0", "0"], 1e9);
    expect(monthlyPlanSchema.safeParse(plan).success).toBe(true);
    expect(resolveMonthlyTarget(path, 0).price).toBe(1e9);
    for (const rates of [
      ["100", "-50", "0", "0"],
      ["1e308", "0", "0", "0"],
    ]) {
      path.targetInputs!.returnInputs = rates;
      expect(resolveMonthlyTarget(path, 3)).toMatchObject({
        price: null,
        invalid: true,
      });
      expect(monthlyPlanSchema.safeParse(plan).success).toBe(false);
    }
    path.initialPrice = Number.MIN_VALUE;
    path.targetInputs!.returnInputs = ["-99", "100", "0", "0"];
    expect(resolveMonthlyTarget(path, 0)).toMatchObject({
      price: null,
      invalid: true,
    });
    expect(resolveMonthlyTarget(path, 3)).toMatchObject({
      price: null,
      invalid: true,
    });
    expect(monthlyPlanSchema.safeParse(plan).success).toBe(false);
    expect(monthlyDraftPlanSchema.parse(plan).paths[0]).toEqual(path);
    path.targetInputs!.returnInputs![0] = "-100";
    expect(resolved(path).map((target) => target.price)).toEqual([0, 0, 0, 0]);
    expect(monthlyPlanSchema.safeParse(plan).success).toBe(true);
  });

  it("requires complete array shapes while preserving optional return metadata on legacy paths", () => {
    const { plan, path } = returnFixture();
    delete path.targetInputs!.returnInputs;
    expect(monthlyPlanSchema.safeParse(plan).success).toBe(false);
    expect(monthlyDraftPlanSchema.safeParse(plan).success).toBe(false);
    path.targetInputs!.mode = "price";
    expect(monthlyPlanSchema.safeParse(plan).success).toBe(true);
    const legacy = structuredClone(path);
    expect(monthlyTargetInputs(path).returnInputs).toEqual(["", "", "", ""]);
    expect(path).toEqual(legacy);
    for (const rates of [[], ["0"], ["0", "0", "0", "0", "0"]]) {
      path.targetInputs!.returnInputs = rates;
      expect(monthlyPlanSchema.safeParse(plan).success).toBe(false);
      expect(monthlyDraftPlanSchema.safeParse(plan).success).toBe(false);
    }
    path.targetInputs!.returnInputs = ["-200", "bad", "", "1e309"];
    expect(monthlyPlanSchema.safeParse(plan).success).toBe(true);
    expect(
      monthlyPlanSchema.parse(plan).paths[0].targetInputs!.returnInputs,
    ).toEqual(path.targetInputs!.returnInputs);
  });
});

describe("return-mode projection and persistence", () => {
  it.each([
    "2026-10-16T20:00:00.000Z",
    "2026-11-30T21:00:00.000Z",
    "2026-12-18T21:00:00.000Z",
  ])(
    "shares derived checkpoints and unchanged expiry math across stock, provider and manual options expiring %s",
    (expiration) => {
      const { scenario, path } = returnFixture(["20", "25", "20", "100"], 5);
      scenario.assets[1].option!.expiration = expiration;
      const manual = structuredClone(scenario.assets[1]);
      manual.id = "manual-return-call";
      manual.quoteQuality!.source = "manual";
      scenario.assets.push(manual);
      const expected = structuredClone(scenario);
      delete expected.monthly!.paths[0].targetInputs;
      expected.monthly!.paths[0].prices = [6, 7.5, 9, 18];
      path.prices.fill(123);
      path.targetInputs!.priceInputs.fill("123");
      path.targetInputs!.marketCapInputs.fill("999999999");
      const rows = projectMonthly(scenario);
      expect(rows).toEqual(projectMonthly(expected));
      expect(
        rows.every((row) =>
          row.positions.every(
            (position) => position.spot === row.positions[0].spot,
          ),
        ),
      ).toBe(true);
      const terminal = rows.filter(
        (row) => row.positions[1].state === "liquidated",
      );
      expect(terminal.length).toBeGreaterThan(0);
      expect(new Set(terminal.map((row) => row.expiryProceeds)).size).toBe(1);
      expect(rows.every((row) => row.cash === 1000)).toBe(true);
    },
  );

  it("keeps expiry interpolation linear before, exactly at, and between compounded checkpoints", () => {
    const { scenario, plan } = returnFixture(["20", "25", "20", "100"], 5);
    const capture = Date.parse(scenario.capturedAt);
    const [first, second] = plan.dates.map(monthlyValuationAt);
    for (const [at, expected] of [
      [capture + (first - capture) / 2, 5.5],
      [first, 6],
      [first + (second - first) / 4, 6.375],
    ]) {
      const result = expiryPrice(plan, "BTG", at, capture);
      expect(result.source).toBe("interpolated");
      expect(result.price).toBeCloseTo(expected, 12);
    }
  });

  it("keeps known liquidation proceeds after later missing returns and gives explicit expiry overrides precedence", () => {
    const { scenario, plan, path } = returnFixture(["20", "25", "20", ""], 5);
    const rows = projectMonthly(scenario);
    expect(rows[3].positions[0].value).toBeNull();
    expect(rows[3].positions[1]).toMatchObject({
      state: "liquidated",
      holdingValue: 0,
    });
    const knownProceeds = rows[2].positions[1].expiryProceeds!;
    expect(rows[3].positions[1].expiryProceeds).toBe(knownProceeds);
    expect(knownProceeds).toBeGreaterThan(0);
    expect(rows[3].knownSubtotal).toBe(1000 + knownProceeds);
    path.targetInputs!.returnInputs = ["", "", "", ""];
    path.initialPrice = null;
    plan.expiryPrices = [{ symbol: "BTG", date: "2026-12-18", price: 7 }];
    const overridden = projectMonthly(scenario);
    expect(overridden[2].positions[1]).toMatchObject({
      state: "liquidated",
      expirySpot: 7,
      expirySource: "override",
      expiryProceeds: 120000,
    });
    expect(overridden[3].positions[1].expiryProceeds).toBe(120000);
    expect(overridden[3].knownSubtotal).toBe(121000);
  });

  it.each(["SPY", "QQQ", "VOO"])(
    "supports return targets for %s without valuation shares",
    (symbol) => {
      const { scenario, path } = returnFixture(["10", "-5", "0", "0"]);
      scenario.assets = [scenario.assets[0]];
      scenario.assets[0].symbol = symbol;
      path.symbol = symbol;
      path.targetInputs!.sharesOutstandingInput = "not needed";
      const rows = projectMonthly(scenario);
      expect(rows[0].equities).toBe(11000);
      expect(rows[1].equities).toBe(10450);
    },
  );

  it("round-trips all raw modes and the explicit anchor through workspace validation without changing version 1", () => {
    const { scenario, path } = returnFixture([" +10 ", "-5.0", "0e0", "25"]);
    path.targetInputs!.marketCapInputs = ["123", "", "007", "8e4"];
    path.targetInputs!.sharesOutstandingInput = "1000000000";
    const saved = validateWorkspaceValue(
      `scenario:${scenario.id}`,
      JSON.parse(JSON.stringify(scenario)),
    ) as typeof scenario;
    expect(saved).toEqual(scenario);
    expect(saved.monthly!.version).toBe(1);
    expect(projectMonthly(saved)).toEqual(projectMonthly(scenario));
    const restoredPath = saved.monthly!.paths[0];
    restoredPath.targetInputs!.mode = "price";
    expect(resolveMonthlyTarget(restoredPath, 0).price).toBe(6);
    restoredPath.targetInputs!.mode = "return";
    expect(resolveMonthlyTarget(restoredPath, 1).price).toBeCloseTo(104.5, 12);
    expect(restoredPath.targetInputs!.returnInputs).toEqual([
      " +10 ",
      "-5.0",
      "0e0",
      "25",
    ]);
    expect(restoredPath.targetInputs!.marketCapInputs).toEqual([
      "123",
      "",
      "007",
      "8e4",
    ]);
  });

  it("round-trips old paths with and without metadata without injecting return inputs", () => {
    const scenario = monthlyFixture();
    const path = scenario.monthly!.paths[0];
    expect(monthlyTargetInputs(path).returnInputs).toEqual(["", "", "", ""]);
    expect(
      validateWorkspaceValue(
        `scenario:${scenario.id}`,
        JSON.parse(JSON.stringify(scenario)),
      ),
    ).toEqual(scenario);
    path.targetInputs = monthlyTargetInputs(path);
    delete path.targetInputs.returnInputs;
    const saved = validateWorkspaceValue(
      `scenario:${scenario.id}`,
      JSON.parse(JSON.stringify(scenario)),
    ) as typeof scenario;
    expect(saved).toEqual(scenario);
    expect(saved.monthly!.paths[0].targetInputs).not.toHaveProperty(
      "returnInputs",
    );
    expect(monthlyTargetInputs(saved.monthly!.paths[0]).returnInputs).toEqual([
      "",
      "",
      "",
      "",
    ]);
  });
});
