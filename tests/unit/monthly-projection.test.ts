import { describe, expect, it } from "vitest";
import { expiryPrice, projectMonthly } from "@/lib/monthly-projection";
import {
  createMonthlyPlan,
  capturedPriceAnchor,
  monthlyPlanSchema,
  monthlyDraftPlanSchema,
  monthlyTargetInputs,
  monthlyValuationAt,
} from "@/lib/monthly-scenario";
import { scenarioSchema, validateWorkspaceValue } from "@/lib/studio";
import { monthlyFixture } from "../fixtures/monthly-scenario";

describe("dated monthly valuation", () => {
  it("shares a valuation-derived price with all company holdings and preserves expiry proceeds", () => {
    const scenario = monthlyFixture();
    const expected = projectMonthly(scenario);
    const path = scenario.monthly!.paths[0];
    path.targetInputs = {
      ...monthlyTargetInputs(path),
      mode: "valuation",
      marketCapInputs: [
        "6000000000",
        "8000000000",
        "9000000000",
        "15000000000",
      ],
      sharesOutstandingInput: "1000000000",
    };
    // Retained price-mode inputs are independent and cannot drive valuation mode.
    path.prices.fill(123);
    path.targetInputs.priceInputs.fill("123");
    expect(projectMonthly(scenario)).toEqual(expected);
    const saved = validateWorkspaceValue(`scenario:${scenario.id}`, scenario);
    expect(projectMonthly(saved as typeof scenario)).toEqual(expected);
    expect((saved as typeof scenario).monthly!.paths[0].targetInputs).toEqual(
      path.targetInputs,
    );
  });

  it("requires an explicit positive whole share assumption and distinguishes zero market cap from blank", () => {
    const scenario = monthlyFixture();
    const path = scenario.monthly!.paths[0];
    path.targetInputs = {
      ...monthlyTargetInputs(path),
      mode: "valuation",
      marketCapInputs: ["0", "", "", ""],
    };
    expect(projectMonthly(scenario)[0]).toMatchObject({
      total: null,
      knownSubtotal: 1000,
      missingCount: 2,
    });
    expect(projectMonthly(scenario)[0].positions[1].reason).toContain(
      "positive shares outstanding",
    );
    path.targetInputs.sharesOutstandingInput = "1000000000";
    expect(projectMonthly(scenario)[0]).toMatchObject({
      total: 1000,
      missingCount: 0,
    });
    expect(projectMonthly(scenario)[1]).toMatchObject({
      total: null,
      missingCount: 2,
    });
    for (const shares of ["0", "-1", "1.5", "1e16", "Infinity"]) {
      path.targetInputs.sharesOutstandingInput = shares;
      expect(monthlyPlanSchema.safeParse(scenario.monthly).success).toBe(false);
      expect(
        monthlyDraftPlanSchema.parse(scenario.monthly).paths[0].targetInputs!
          .sharesOutstandingInput,
      ).toBe(shares);
    }
  });

  it("uses the same terms for manual and quoted options, including an expiry before the first checkpoint", () => {
    const scenario = monthlyFixture();
    scenario.assets[1].option!.expiration = "2026-10-16T20:00:00.000Z";
    const manual = structuredClone(scenario.assets[1]);
    manual.id = "manual-call";
    manual.label = "Manually entered BTG call";
    manual.quoteQuality = {
      ...manual.quoteQuality!,
      source: "manual",
      estimated: true,
    };
    scenario.assets.push(manual);
    const expected = projectMonthly(scenario);
    const path = scenario.monthly!.paths[0];
    path.targetInputs = {
      ...monthlyTargetInputs(path),
      mode: "valuation",
      marketCapInputs: path.prices.map((price) => String(price! * 1000000000)),
      sharesOutstandingInput: "1000000000",
    };
    const rows = projectMonthly(scenario);
    expect(rows).toEqual(expected);
    for (const row of rows) {
      expect(row.cash).toBe(1000);
      expect(row.positions[2].expiryProceeds).toBe(
        row.positions[1].expiryProceeds,
      );
      expect(row.positions[2].expirySpot).toBe(row.positions[1].expirySpot);
    }
    expect(new Set(rows.map((row) => row.expiryProceeds)).size).toBe(1);
  });

  it("bounds valuation and derived prices without falling back to saved price inputs", () => {
    const scenario = monthlyFixture();
    const path = scenario.monthly!.paths[0];
    path.targetInputs = {
      ...monthlyTargetInputs(path),
      mode: "valuation",
      sharesOutstandingInput: "1",
    };
    for (const cap of ["1e14", "1e309", "1000000001", "-1", "0xff", "1e-999"]) {
      path.targetInputs.marketCapInputs[0] = cap;
      expect(monthlyPlanSchema.safeParse(scenario.monthly).success, cap).toBe(
        false,
      );
      expect(
        monthlyDraftPlanSchema.parse(scenario.monthly).paths[0].targetInputs!
          .marketCapInputs[0],
      ).toBe(cap);
    }
    path.targetInputs.marketCapInputs = [
      "10000000000000",
      "8000000000000",
      "9000000000000",
      "10000000000000",
    ];
    path.targetInputs.sharesOutstandingInput = "1000000000000000";
    expect(monthlyPlanSchema.safeParse(scenario.monthly).success).toBe(true);
    expect(projectMonthly(scenario)[0].positions[0].spot).toBe(0.01);
  });

  it("keeps legacy price-only saved documents unchanged and known funds in price mode", () => {
    const scenario = monthlyFixture();
    expect(validateWorkspaceValue(`scenario:${scenario.id}`, scenario)).toEqual(
      scenario,
    );
    scenario.assets.forEach((asset) => {
      asset.symbol = "SPY";
    });
    scenario.monthly!.paths[0].symbol = "SPY";
    scenario.monthly!.paths[0].targetInputs = {
      ...monthlyTargetInputs(scenario.monthly!.paths[0]),
      mode: "valuation",
      marketCapInputs: ["1", "1", "1", "1"],
      sharesOutstandingInput: "1",
    };
    expect(() => projectMonthly(scenario)).toThrow(
      "Use share-price targets for this fund",
    );
  });

  it("matches Scout's independent two-call October/November/expiry fixture", () => {
    const scenario = monthlyFixture();
    scenario.capturedAt = "2026-09-17T20:00:00.000Z";
    Object.assign(scenario.assets[1], {
      quantity: 2,
      currentValue: 150,
      costBasis: 100,
    });
    scenario.monthly!.paths[0].prices = [6, 7, 8, 10];
    const rows = projectMonthly(scenario);
    expect(
      rows.map((row) => [
        row.options,
        row.expiryProceeds,
        row.total,
        row.profit,
        row.change,
      ]),
    ).toEqual([
      [230.77, 0, 1830.77, 330.77, 180.77],
      [402.25, 0, 2102.25, 602.25, 452.25],
      [0, 516.13, 2316.13, 816.13, 666.13],
      [0, 516.13, 2516.13, 1016.13, 866.13],
    ]);
    const novemberExpiry = Date.parse("2026-11-20T21:00:00Z");
    expect(
      expiryPrice(
        scenario.monthly!,
        "BTG",
        novemberExpiry,
        Date.parse(scenario.capturedAt),
      ).price,
    ).toBeCloseTo(6 + 481 / 721, 12);
  });
  it("uses calendar month ends at 16:00 Eastern through DST, not daysForward", () => {
    const scenario = monthlyFixture();
    expect(scenario.monthly!.dates).toEqual([
      "2026-10-31",
      "2026-11-30",
      "2026-12-31",
      "2027-01-31",
    ]);
    const before = projectMonthly(scenario);
    expect(before.map((row) => row.at)).toEqual([
      "2026-10-31T20:00:00.000Z",
      "2026-11-30T21:00:00.000Z",
      "2026-12-31T21:00:00.000Z",
      "2027-01-31T21:00:00.000Z",
    ]);
    scenario.assumptions.daysForward = 3650;
    expect(projectMonthly(scenario)).toEqual(before);
    expect(createMonthlyPlan([], "2027-12-17T12:00:00Z", 2).dates).toEqual([
      "2028-01-31",
      "2028-02-29",
    ]);
  });

  it("models the BTG $5 December calls in October and November without anchoring to the mark", () => {
    const rows = projectMonthly(monthlyFixture());
    // Independent normal-CDF (Python math.erf) reference, 365 calendar-day year.
    expect(rows[0].positions[1].holdingValue).toBeCloseTo(69229.62, 1);
    expect(rows[1].positions[1].holdingValue).toBeCloseTo(180593.69, 1);
    expect(rows[0].positions[0].value).toBe(600);
    expect(rows[1].positions[0].value).toBe(800);
    expect(rows[0].positions[0].spot).toBe(rows[0].positions[1].spot);
    const scenario = monthlyFixture();
    scenario.assets[1].currentValue = 1;
    expect(projectMonthly(scenario)[0].positions[1].holdingValue).toBe(
      rows[0].positions[1].holdingValue,
    );
    expect(projectMonthly(scenario)[0].change).not.toBe(rows[0].change);
  });

  it("decays flat-price time value and applies visible rate and IV assumptions", () => {
    const scenario = monthlyFixture();
    scenario.monthly!.paths[0].prices = [5, 5, 5, 5];
    const rows = projectMonthly(scenario);
    expect(rows[0].positions[1].value!).toBeGreaterThan(
      rows[1].positions[1].value!,
    );
    expect(rows[1].positions[1].value!).toBeGreaterThan(0);
    expect(rows[2].positions[1].value).toBe(0);
    scenario.monthly!.ivOverride = 1;
    const higherIV = projectMonthly(scenario)[0].positions[1].value!;
    expect(higherIV).toBeGreaterThan(rows[0].positions[1].value!);
    scenario.monthly!.rate = 0.1;
    expect(projectMonthly(scenario)[0].positions[1].value!).toBeGreaterThan(
      higherIV,
    );
  });

  it("locks intrinsic proceeds once and keeps them separate from cash and later targets", () => {
    const scenario = monthlyFixture();
    scenario.monthly!.paths[0].prices = [8, 8, 8, 50];
    const before = structuredClone(scenario);
    const rows = projectMonthly(scenario);
    const december = rows[2],
      january = rows[3];
    expect(december.options).toBe(0);
    expect(december.expiryProceeds).toBe(180000);
    expect(january.expiryProceeds).toBe(180000);
    expect(december.cash).toBe(1000);
    expect(december.total).toBe(181800);
    expect(december.profit).toBe(70600);
    expect(december.change).toBe(71100);
    expect(january.total).toBe(186000);
    expect(january.positions[1]).toMatchObject({
      state: "liquidated",
      holdingValue: 0,
      expiryProceeds: 180000,
      expirySpot: 8,
    });
    expect(scenario).toEqual(before);
  });

  it("never revives an OTM contract and supports puts with the stored multiplier", () => {
    const scenario = monthlyFixture();
    scenario.monthly!.paths[0].prices = [4, 4, 4, 100];
    expect(projectMonthly(scenario)[3].positions[1].value).toBe(0);
    scenario.assets[1].option!.right = "PUT";
    scenario.assets[1].option!.multiplier = 50;
    expect(projectMonthly(scenario)[2].positions[1].expiryProceeds).toBe(30000);
    expect(projectMonthly(scenario)[3].positions[1].expiryProceeds).toBe(30000);
  });

  it("interpolates at the actual expiry milliseconds and accepts a shared override", () => {
    const scenario = monthlyFixture(),
      plan = scenario.monthly!;
    const expiry = Date.parse("2026-12-18T21:00:00Z"),
      captured = Date.parse(scenario.capturedAt);
    const expected = 8 + 18 / 31;
    expect(expiryPrice(plan, "BTG", expiry, captured)).toEqual({
      price: expected,
      source: "interpolated",
    });
    plan.expiryPrices = [{ symbol: "BTG", date: "2026-12-18", price: 7 }];
    expect(projectMonthly(scenario)[2].positions[1]).toMatchObject({
      expirySpot: 7,
      expirySource: "override",
      expiryProceeds: 120000,
    });
    plan.paths[0].prices[2] = null;
    const row = projectMonthly(scenario)[2];
    expect(row.positions[1].value).toBe(120000);
    expect(row.total).toBeNull();
    expect(row.knownSubtotal).toBe(121000);
  });

  it("does not skip a blank checkpoint or extrapolate a terminal price", () => {
    const scenario = monthlyFixture(),
      plan = scenario.monthly!;
    plan.paths[0].prices[1] = null;
    expect(projectMonthly(scenario)[2].positions[1].value).toBeNull();
    expect(projectMonthly(scenario)[3].positions[1].value).toBeNull();
    expect(
      expiryPrice(
        plan,
        "BTG",
        Date.parse("2028-01-21T21:00:00Z"),
        Date.parse(scenario.capturedAt),
      ).price,
    ).toBeNull();
    scenario.assets[1].option!.expiration = "2026-12-31T21:00:00.000Z";
    expect(projectMonthly(scenario)[2].positions[1].expirySpot).toBe(9);
    expect(projectMonthly(scenario)[2].positions[1].state).toBe("liquidated");
  });

  it("honors a different underlying's late-close expiry and multiple maturities", () => {
    const scenario = monthlyFixture();
    scenario.assets[1].symbol = "SPY";
    scenario.assets[1].option!.expiration = "2026-11-30T21:15:00.000Z";
    scenario.assets.push({
      ...structuredClone(scenario.assets[1]),
      id: "later-call",
      option: {
        ...scenario.assets[1].option!,
        expiration: "2026-12-18T21:15:00.000Z",
      },
    });
    scenario.monthly = createMonthlyPlan(
      scenario.assets,
      scenario.capturedAt,
      4,
    );
    scenario.monthly.paths.forEach((path) => (path.prices = [8, 8, 8, 8]));
    const rows = projectMonthly(scenario);
    expect(rows[0].positions[1].state).toBe("model"); // 16:00 is before SPY's 16:15 cutoff.
    expect(rows[1].positions[1].state).toBe("model");
    expect(rows[1].positions[2].state).toBe("model");
    expect(
      rows[2].positions.filter((position) => position.state === "liquidated"),
    ).toHaveLength(2);
  });

  it("keeps zero prices distinct from missing data and withholds incomplete totals", () => {
    const scenario = monthlyFixture();
    scenario.monthly!.paths[0].prices[0] = 0;
    expect(projectMonthly(scenario)[0]).toMatchObject({
      total: 1000,
      profit: -110200,
      missingCount: 0,
    });
    scenario.monthly!.paths[0].prices[0] = null;
    expect(projectMonthly(scenario)[0]).toMatchObject({
      total: null,
      profit: null,
      change: null,
      knownSubtotal: 1000,
      missingCount: 2,
    });
  });

  it("never assumes historical settlement for an already-expired captured position", () => {
    const scenario = monthlyFixture();
    scenario.assets[1].option!.expiration = "2026-08-21T20:00:00Z";
    scenario.monthly!.expiryPrices = [
      { symbol: "BTG", date: "2026-08-21", price: 50 },
    ];
    for (const row of projectMonthly(scenario)) {
      expect(row.positions[1].value).toBeNull();
      expect(row.positions[1].reason).toContain("Already expired at capture");
      expect(row.total).toBeNull();
    }
  });

  it("zero-quantity holdings require no target, anchor or expiry data and contribute zero", () => {
    const scenario = monthlyFixture();
    scenario.assets.forEach((asset) => {
      asset.quantity = 0;
      asset.currentValue = 0;
      asset.costBasis = 0;
    });
    scenario.assets[1].option!.expiration = "2026-08-21T20:00:00.000Z";
    scenario.monthly!.paths[0].initialPrice = null;
    scenario.monthly!.paths[0].prices.fill(null);
    for (const row of projectMonthly(scenario)) {
      expect(row).toMatchObject({
        total: 1000,
        profit: 0,
        change: 0,
        missingCount: 0,
        expiryProceeds: 0,
      });
      expect(row.positions).toEqual([]);
    }
    scenario.assets[1].option!.expiration = "9999-12-17T21:00:00.000Z";
    scenario.monthly!.rate = -0.1;
    expect(projectMonthly(scenario)[0].total).toBe(1000);
    scenario.assets[1].quantity = 0.000001;
    scenario.assets[1].option!.expiration = "2026-08-21T20:00:00.000Z";
    expect(projectMonthly(scenario)[0].missingCount).toBe(1);
    scenario.assets[1].quantity = 0;
    scenario.assets[1].costBasis = 1;
    expect(() => projectMonthly(scenario)).toThrow("zero-quantity");
    expect(() =>
      validateWorkspaceValue(`scenario:${scenario.id}`, scenario),
    ).toThrow("zero-quantity");
  });

  it("uses normalized symbols for both plan grouping and late-close expiry", () => {
    const scenario = monthlyFixture();
    scenario.assets = [scenario.assets[1]];
    scenario.assets[0].symbol = " spy ";
    scenario.assets[0].option!.expiration = "2026-11-30T21:15:00.000Z";
    scenario.monthly = createMonthlyPlan(
      scenario.assets,
      scenario.capturedAt,
      4,
    );
    const validated = validateWorkspaceValue(
      `scenario:${scenario.id}`,
      scenario,
    ) as typeof scenario;
    const november = projectMonthly(validated)[1].positions[0];
    expect(november.state).toBe("model");
    expect(november.expiryAt).toBe("2026-11-30T21:15:00.000Z");
    expect(projectMonthly(validated)[2].positions[0].state).toBe("liquidated");
  });

  it("seeds shared anchors deterministically and exposes conflicts without guessing a source", () => {
    const scenario = monthlyFixture(),
      [stock, option] = scenario.assets;
    const plan = (assets = scenario.assets) =>
      createMonthlyPlan(assets, scenario.capturedAt, 4);
    option.spot = null;
    expect(plan().paths[0].initialPrice).toBe(5);
    option.spot = 7;
    expect(plan()).toEqual(plan([...scenario.assets].reverse()));
    expect(plan().paths[0]).toMatchObject({
      initialPrice: null,
      prices: [null, null, null, null],
    });
    expect(capturedPriceAnchor(scenario.assets, " btg ")).toMatchObject({
      conflict: true,
      prices: [5, 7],
    });
    stock.spot = option.spot = 0;
    expect(plan().paths[0].initialPrice).toBe(0);
    stock.spot = 99;
    stock.quantity = 0;
    stock.costBasis = stock.currentValue = 0;
    option.spot = 5;
    expect(plan().paths[0].initialPrice).toBe(5);
    option.spot = 1e10;
    expect(plan().paths[0].initialPrice).toBeNull();
    expect(capturedPriceAnchor(scenario.assets, "BTG").unsupported).toBe(true);
  });

  it("requires only the relevant conflicted capture anchor and preserves explicit saved assumptions", () => {
    const scenario = monthlyFixture();
    scenario.capturedAt = "2026-09-17T20:00:00.000Z";
    scenario.assets[1].spot = 7;
    scenario.assets[1].quantity = 2;
    scenario.assets[1].option!.expiration = "2026-10-16T20:00:00.000Z";
    scenario.monthly = createMonthlyPlan(
      scenario.assets,
      scenario.capturedAt,
      4,
    );
    scenario.monthly.paths[0].prices = [6, 7, 8, 9];
    expect(projectMonthly(scenario)[0].positions[1].value).toBeNull();
    scenario.monthly.paths[0].initialPrice = 4;
    expect(projectMonthly(scenario)[0].positions[1]).toMatchObject({
      expiryProceeds: 63.64,
    });
    expect(projectMonthly(scenario)[0].positions[1].expirySpot).toBeCloseTo(
      4 + (2 * 29) / 44,
      12,
    );
    const reopened = validateWorkspaceValue(
      `scenario:${scenario.id}`,
      structuredClone(scenario),
    ) as typeof scenario;
    expect(reopened.monthly).toEqual(scenario.monthly);
    scenario.monthly.paths[0].initialPrice = null;
    scenario.monthly.expiryPrices = [
      { symbol: "BTG", date: "2026-10-16", price: 7 },
    ];
    expect(projectMonthly(scenario)[0].positions[1].expiryProceeds).toBe(400);
    scenario.monthly.expiryPrices = [];
    scenario.assets[1].option!.expiration = "2026-12-18T21:00:00.000Z";
    expect(projectMonthly(scenario)[2].positions[1].value).not.toBeNull();
  });

  it("distinguishes an absent manual market mark from a stale provider quote", () => {
    const scenario = monthlyFixture();
    scenario.assets[1].quoteQuality = {
      ...scenario.assets[1].quoteQuality!,
      source: "manual",
      asOf: null,
      stale: true,
      estimated: true,
    };
    scenario.assets[0].quoteQuality!.stale = true;
    const positions = projectMonthly(scenario)[0].positions;
    expect(positions[1].warnings).toContain(
      "Manual entry: no market quote was captured.",
    );
    expect(positions[1].warnings).toContain(
      "Captured current value is a cost-basis estimate.",
    );
    expect(positions[1].warnings).not.toContain("Captured quote was stale.");
    expect(positions[0].warnings).toContain("Captured quote was stale.");
  });

  it("reports quote/IV uncertainty and finite cash-only/zero-cost outcomes", () => {
    const scenario = monthlyFixture();
    scenario.assets[1].quoteQuality = undefined;
    expect(projectMonthly(scenario)[0].positions[1].ivEstimated).toBe(true);
    scenario.assets[0].quoteQuality!.stale = true;
    expect(projectMonthly(scenario)[0].positions[0].warnings).toContain(
      "Captured quote was stale.",
    );
    scenario.assets = [];
    scenario.monthly = createMonthlyPlan([], scenario.capturedAt, 1);
    expect(projectMonthly(scenario)[0]).toMatchObject({
      total: 1000,
      profit: 0,
      change: 0,
      costReturnPercent: null,
    });
    scenario.cash = 0;
    expect(projectMonthly(scenario)[0].changePercent).toBeNull();
  });

  it("withholds full profit when cash or combined totals exceed safe cent precision", () => {
    const scenario = monthlyFixture();
    scenario.cash = 1e20;
    const row = projectMonthly(scenario)[0];
    expect(row).toMatchObject({
      cash: null,
      total: null,
      profit: null,
      change: null,
      missingCount: 0,
    });
    expect(row.knownSubtotal).toBe(69829.59);
    expect(row.unavailableReason).toContain("Starting cash");
    scenario.cash = 9e13;
    scenario.assets[0].quantity = 9e12;
    const overflow = projectMonthly(scenario)[0];
    expect(overflow.total).toBeNull();
    expect(overflow.profit).toBeNull();
    expect(overflow.unavailableReason).toContain("combined portfolio");
  });

  it("isolates unsupported option model inputs while retaining a labeled known subtotal", () => {
    const scenario = monthlyFixture();
    scenario.assets[1].option!.expiration = "9999-12-17T21:00:00.000Z";
    scenario.monthly!.rate = -0.1;
    expect(scenarioSchema.safeParse(scenario).success).toBe(true);
    const row = projectMonthly(scenario)[0];
    expect(row).toMatchObject({
      total: null,
      profit: null,
      change: null,
      knownSubtotal: 1600,
      missingCount: 1,
    });
    expect(row.positions[1].reason).toContain("supported model range");
  });
});

describe("monthly persistence contract", () => {
  it("accepts leap month ends and rejects valid dates that are not month ends", () => {
    const scenario = monthlyFixture();
    for (const date of ["2026-10-31", "2027-02-28", "2028-02-29"])
      expect(
        monthlyPlanSchema.safeParse({
          ...scenario.monthly,
          dates: [date],
          paths: [{ ...scenario.monthly!.paths[0], prices: [5] }],
        }).success,
      ).toBe(true);
    for (const date of ["2026-10-30", "2026-12-18", "2028-02-28", "2028-02-30"])
      expect(
        monthlyPlanSchema.safeParse({
          ...scenario.monthly,
          dates: [date],
          paths: [{ ...scenario.monthly!.paths[0], prices: [5] }],
        }).success,
      ).toBe(false);
  });
  it("round-trips monthly inputs while accepting unchanged old scenarios", () => {
    const scenario = monthlyFixture();
    expect(
      validateWorkspaceValue(
        `scenario:${scenario.id}`,
        JSON.parse(JSON.stringify(scenario)),
      ),
    ).toEqual(scenario);
    const legacy = { ...scenario, monthly: undefined };
    expect(scenarioSchema.parse(legacy).monthly).toBeUndefined();
    expect(projectMonthly(legacy)).toEqual([]);
  });

  it("normalizes paths and rejects duplicate or misaligned underlying/date inputs", () => {
    const fixture = monthlyFixture(),
      plan = fixture.monthly!;
    expect(
      monthlyPlanSchema.parse({
        ...plan,
        paths: [{ ...plan.paths[0], symbol: " btg " }],
      }).paths[0].symbol,
    ).toBe("BTG");
    for (const bad of [
      { ...plan, paths: [...plan.paths, { ...plan.paths[0], symbol: "btg" }] },
      {
        ...plan,
        dates: ["2026-10-31", "2026-10-20", "2026-12-31", "2027-01-31"],
      },
      { ...plan, dates: ["2026-02-30", ...plan.dates.slice(1)] },
      { ...plan, dates: ["2026-10-30", ...plan.dates.slice(1)] },
      { ...plan, paths: [{ ...plan.paths[0], prices: [5] }] },
      {
        ...plan,
        expiryPrices: [
          { symbol: "BTG", date: "2026-12-18", price: 5 },
          { symbol: "btg", date: "2026-12-18", price: 6 },
        ],
      },
    ])
      expect(monthlyPlanSchema.safeParse(bad).success).toBe(false);
  });

  it.each([NaN, Infinity, -1, 1e10])(
    "rejects invalid monthly prices %s on save",
    (bad) => {
      const scenario = monthlyFixture();
      scenario.monthly!.paths[0].prices[0] = bad;
      expect(() =>
        validateWorkspaceValue(`scenario:${scenario.id}`, scenario),
      ).toThrow();
    },
  );

  it("rejects dates before capture, unrelated paths/overrides and unsupported policies", () => {
    const fixture = monthlyFixture();
    for (const mutate of [
      (s: typeof fixture) => {
        s.monthly!.dates[0] = "2026-08-31";
      },
      (s: typeof fixture) => {
        s.monthly!.paths[0].symbol = "OTHER";
      },
      (s: typeof fixture) => {
        s.monthly!.expiryPrices = [
          { symbol: "BTG", date: "2027-12-17", price: 6 },
        ];
      },
    ]) {
      const scenario = structuredClone(fixture);
      mutate(scenario);
      expect(() =>
        validateWorkspaceValue(`scenario:${scenario.id}`, scenario),
      ).toThrow();
    }
    expect(
      monthlyPlanSchema.safeParse({
        ...fixture.monthly,
        policy: "reprice-expired-every-month",
      }).success,
    ).toBe(false);
    expect(() => monthlyValuationAt("2026-02-30")).toThrow();
  });
});
