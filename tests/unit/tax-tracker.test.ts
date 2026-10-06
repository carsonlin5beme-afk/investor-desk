// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { TaxTracker } from "@/components/studio/TaxTracker";
import { downloadText } from "@/lib/studio";
import {
  createTaxSettings,
  type ScenarioTaxSettings,
  type TaxSale,
} from "@/lib/scenario-tax";
import { monthlyFixture } from "../fixtures/monthly-scenario";

vi.mock("@/lib/studio", async (load) => ({
  ...(await load<typeof import("@/lib/studio")>()),
  downloadText: vi.fn(),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement, latest: ScenarioTaxSettings | undefined;
const changed = vi.fn(),
  dateChanged = vi.fn(),
  fetcher = vi.fn();
const stock = { ...monthlyFixture().assets[0], costBasis: 80000 };
const assets = [stock];
const baseSales: TaxSale[] = [
  {
    assetId: stock.id,
    label: stock.label,
    proceeds: 100000,
    saleDate: "2026-12-31",
  },
];
function settings(): ScenarioTaxSettings {
  const result = createTaxSettings(assets);
  result.assumptions[0].acquiredDate = "2026-01-01";
  result.assumptions[0].treatment = "standard";
  return result;
}
type TrackerProps = Parameters<typeof TaxTracker>[0];
function Controlled(
  props: Partial<TrackerProps> & { initial?: ScenarioTaxSettings },
) {
  const [value, setValue] = useState(props.initial);
  latest = value;
  return createElement(TaxTracker, {
    assets,
    sales: baseSales,
    scenarioId: "tax-fixture",
    capturedAt: "2026-10-05T16:00:00Z",
    context: "Selected checkpoint",
    ...props,
    settings: value,
    onChange: (next) => {
      changed(next);
      setValue(next);
    },
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetcher);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  latest = undefined;
});
afterEach(async () => {
  await act(() => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});
const render = (
  props: Partial<TrackerProps> & { initial?: ScenarioTaxSettings } = {},
) => act(() => root.render(createElement(Controlled, props)));
const input = (name: string) =>
  [...host.querySelectorAll<HTMLInputElement>("input")].find(
    (el) =>
      el.getAttribute("aria-label") === name ||
      el.closest("label")?.textContent?.trim().startsWith(name),
  )!;
const select = (name: string) =>
  [...host.querySelectorAll<HTMLSelectElement>("select")].find(
    (el) =>
      el.getAttribute("aria-label") === name ||
      el.closest("label")?.textContent?.trim().startsWith(name),
  )!;
const button = (name: string) =>
  [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (el) => el.textContent?.trim() === name,
  )!;
const total = (name: string) =>
  [
    ...host
      .querySelector('[aria-label="Tax planning totals"]')!
      .querySelectorAll("dt"),
  ].find((el) => el.textContent === name)!.nextElementSibling!.textContent;
async function enter(name: string, value: string) {
  await act(() => {
    const el = input(name);
    expect(el, name).toBeDefined();
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const pick = (name: string, value: string) =>
  act(() => {
    const el = select(name);
    el.value = value;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });

describe("Hypothetical tax tracker", () => {
  it("opts in with captured aggregate basis, no invented acquisition or treatment, and no account mutation", async () => {
    const before = structuredClone(assets);
    await render();
    expect(host.querySelector('[aria-label="Tax planning totals"]')).toBeNull();
    await act(() => button("Set up tax estimate").click());
    expect(latest).toEqual(createTaxSettings(assets));
    expect(input("Other annual ordinary income").value).toBe("0");
    expect(input("BTG acquisition date").value).toBe("");
    expect(input("BTG total tax basis").value).toBe("80000");
    expect(select("BTG tax treatment").value).toBe("unknown");
    expect(total("Regular federal + NIIT reserve")).toBe("Unavailable");
    expect(host.textContent).toContain("adult not claimed as a dependent");
    expect(host.textContent).toContain("excludes state/local taxes");
    expect(assets).toEqual(before);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("shows gross proceeds, gain, the reserve, and amount left separately, then reclassifies a verified acquisition edit", async () => {
    await render({ initial: settings() });
    expect(total("Gross sale proceeds")).toBe("$100,000.00");
    expect(total("Short-term gain / loss")).toBe("$20,000.00");
    expect(total("Long-term gain / loss")).toBe("$0.00");
    expect(total("Regular federal + NIIT reserve")).toBe("$390.00");
    expect(total("Proceeds after tax reserve")).toBe("$99,610.00");
    expect(total("Gain after tax reserve")).toBe("$19,610.00");
    await enter("BTG acquisition date", "2025-12-30");
    expect(total("Short-term gain / loss")).toBe("$0.00");
    expect(total("Long-term gain / loss")).toBe("$20,000.00");
    expect(total("Regular federal + NIIT reserve")).toBe("$0.00");
    expect(host.textContent).toContain("Long-term");
  });
  it("reserves only the additional tax from sales above the income baseline", async () => {
    const s = settings();
    s.assumptions[0].totalBasis = 0;
    s.assumptions[0].acquiredDate = "2025-01-01";
    await render({ initial: s });
    await enter("Other annual ordinary income", "100000");
    expect(total("Regular federal + NIIT reserve")).toBe("$15,000.00");
    const annual = host.querySelector("details")!;
    expect(annual.textContent).toContain("$13,170.00");
    expect(annual.textContent).toContain("$28,170.00");
    expect(annual.textContent).toContain(
      "existing income tax is not reserved twice",
    );
  });
  it("shows separate masked ordinary and preferred marginal rates for stacked gains", async () => {
    const option = monthlyFixture().assets[1],
      selected = [stock, option];
    const s = createTaxSettings(selected);
    s.assumptions[0] = {
      ...s.assumptions[0],
      acquiredDate: "2026-01-01",
      treatment: "standard",
      totalBasis: 60000,
    };
    s.assumptions[1] = {
      ...s.assumptions[1],
      acquiredDate: "2025-01-01",
      treatment: "standard",
      totalBasis: 0,
    };
    await render({
      assets: selected,
      initial: s,
      sales: [
        ...baseSales,
        {
          assetId: option.id,
          label: option.label,
          proceeds: 60000,
          saleDate: "2026-12-18",
        },
      ],
    });
    expect(total("Regular federal + NIIT reserve")).toBe("$7,787.50");
    for (const [label, value] of [
      ["Top modeled ordinary marginal rate", "12%"],
      ["Top modeled long-term gain rate", "15%"],
    ]) {
      const dt = [...host.querySelectorAll("dt")].find(
        (el) => el.textContent === label,
      )!;
      expect(dt.nextElementSibling!.textContent?.trim()).toBe(value);
      expect(dt.nextElementSibling!.classList.contains("private-value")).toBe(
        true,
      );
    }
    expect(host.textContent).toContain("Marginal rates apply to slices");
  });

  it("keeps a loss and possible reduction separate from a positive reserve or promised refund", async () => {
    const s = settings();
    s.assumptions[0].totalBasis = 105000;
    s.otherOrdinaryIncome = 60000;
    await render({ initial: s });
    expect(total("Tax change from these sales")).toBe("-$360.00");
    expect(total("Modeled tax reduction")).toBe("$360.00");
    expect(total("Regular federal + NIIT reserve")).toBe("$0.00");
    expect(total("Gain after tax reserve")).toBe("-$5,000.00");
    expect(total("Proceeds after tax reserve")).toBe("$100,000.00");
    expect(host.textContent).toContain("not a promised refund");
  });
  it.each(["", "-1", "0.001", "1e-8", "1e309", "1000000000000.01"])(
    "keeps invalid basis %s unavailable instead of zero, with repair",
    async (raw) => {
      await render({ initial: settings() });
      await enter("BTG total tax basis", raw);
      expect(latest!.assumptions[0].totalBasis).toBeNull();
      expect(total("Regular federal + NIIT reserve")).toBe("Unavailable");
      if (["-1", "0.001", "1e-8", "1000000000000.01"].includes(raw)) {
        expect(input("BTG total tax basis").value).toBe(raw);
        expect(input("BTG total tax basis").getAttribute("aria-invalid")).toBe(
          "true",
        );
        await pick("Tax rules year", "2025");
        expect(input("BTG total tax basis").value).toBe(raw);
      }
      await enter("BTG total tax basis", "80000");
      expect(total("Regular federal + NIIT reserve")).not.toBe("Unavailable");
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
  it.each(["", "-1", "0.001", "1e-8", "Infinity"])(
    "keeps invalid annual income %s unavailable until explicitly corrected",
    async (raw) => {
      await render({ initial: settings() });
      await enter("Other annual ordinary income", raw);
      expect(latest!.otherOrdinaryIncome).toBeNull();
      expect(total("Gross sale proceeds")).toBe("Unavailable");
      await enter("Other annual ordinary income", "0");
      expect(total("Regular federal + NIIT reserve")).toBe("$390.00");
    },
  );
  it("requires ordinary treatment explicitly and lets excluded special holdings leave the estimate", async () => {
    await render({ initial: settings() });
    await pick("BTG tax treatment", "unsupported");
    expect(host.textContent).toContain("outside this estimate");
    expect(total("Regular federal + NIIT reserve")).toBe("Unavailable");
    expect(host.querySelector("article")?.textContent).not.toContain(
      "Short-term",
    );
    await act(() => input("Include BTG in tax estimate").click());
    expect(total("Gross sale proceeds")).toBe("$0.00");
    expect(total("Regular federal + NIIT reserve")).toBe("$0.00");
    expect(host.textContent).toContain("No holdings are selected");
    expect(input("BTG acquisition date").disabled).toBe(true);
  });
  it("does not publish a partial tax aggregate when one included holding has missing sale data", async () => {
    const option = monthlyFixture().assets[1],
      selected = [stock, option];
    const s = createTaxSettings(selected);
    s.assumptions.forEach((a) => {
      a.acquiredDate = "2026-01-01";
      a.treatment = "standard";
    });
    await render({
      assets: selected,
      initial: s,
      sales: [
        ...baseSales,
        {
          assetId: option.id,
          label: option.label,
          proceeds: null,
          saleDate: "2026-12-18",
          reason: "Expiry underlying price is unavailable.",
        },
      ],
    });
    expect(total("Regular federal + NIIT reserve")).toBe("Unavailable");
    expect(host.querySelectorAll("details")).toHaveLength(1);
    expect(host.textContent).toContain(
      "Expiry underlying price is unavailable",
    );
    expect(input(`${option.label} total tax basis`).value).toBe("109800");
    expect(host.textContent).toContain(
      "already includes quantity and contract multiplier",
    );
    await act(() => input(`Include ${option.label} in tax estimate`).click());
    expect(total("Regular federal + NIIT reserve")).toBe("$390.00");
  });
  it("keeps frozen rules warnings visible and exports exact assumptions, years and proceeds", async () => {
    await render({
      initial: settings(),
      sales: [{ ...baseSales[0], saleDate: "2027-01-01" }],
    });
    expect(host.querySelector('[role="status"]')?.textContent).toContain(
      "2027 sale modeled using frozen 2026 rules",
    );
    await act(() => button("Tax snapshot JSON").click());
    const call = vi.mocked(downloadText).mock.calls[0];
    expect(call.slice(1)).toEqual([
      "investor-desk-tax-fixture-tax.json",
      "application/json",
    ]);
    const file = JSON.parse(call[0]);
    expect(file.settings).toEqual(latest);
    expect(file.sales[0].proceeds).toBe(100000);
    expect(file.projection.years[0].saleYear).toBe(2027);
    expect(file.projection.years[0].usesAssumedRules).toBe(true);
    expect(file.financingTreatment).toContain("excluded from taxable-gain");
    expect(file.sources.length).toBeGreaterThan(0);
    expect(host.textContent).toContain(
      "Tax snapshot exported with exact values",
    );
  });
  it("passes blank and changed sale dates to the parent without inventing a date", async () => {
    await render({
      initial: settings(),
      saleDate: "2026-12-31",
      onSaleDate: dateChanged,
    });
    await enter("Assumed sale date", "");
    expect(dateChanged).toHaveBeenLastCalledWith(null);
    await enter("Assumed sale date", "2027-03-01");
    expect(dateChanged).toHaveBeenLastCalledWith("2027-03-01");
  });
  it("restores a different saved scenario's raw fields instead of retaining an invalid prior draft", async () => {
    await render({ initial: settings() });
    await enter("BTG total tax basis", "-7");
    await act(() =>
      root.render(
        createElement(Controlled, {
          key: "other",
          initial: settings(),
          scenarioId: "other-scenario",
        }),
      ),
    );
    expect(input("BTG total tax basis").value).toBe("80000");
    expect(total("Regular federal + NIIT reserve")).toBe("$390.00");
  });
});
