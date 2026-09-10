// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Report } from "@/components/studio/Report";
import { downloadText } from "@/lib/studio";
import type { Holding, Portfolio } from "@/lib/desk-types";

vi.mock("@/lib/studio", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/studio")>()),
  downloadText: vi.fn(),
}));
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
const asOf = "2026-01-01T12:00:00.000Z";
const holding: Holding = {
  id: "holding",
  portfolioId: "portfolio",
  symbol: "ABC",
  assetClass: "EQUITY",
  quantity: 10,
  avgCost: 90,
  optionDetails: null,
  targetScenario: {
    targetMode: "PRICE",
    targetPrice: "150",
    targetMarketCap: null,
    sharesOutstandingLive: null,
    sharesOutstandingManual: null,
    useManualShares: false,
  },
  projection: {
    currentMarketValue: 1000,
    currentPrice: 100,
    costBasis: 900,
    unrealizedPnL: 100,
    targetUnderlyingPrice: 150,
    projectedValue: 1500,
    optionIntrinsicProjectedValue: null,
    optionModelProjectedValue: null,
    hasTarget: true,
    priceEstimated: false,
    quoteStale: false,
    quoteAsOf: asOf,
    quoteSource: "demo",
    impliedVolatility: null,
    ivEstimated: false,
    underlyingPrice: null,
    expired: false,
  },
};
const option: Holding = {
  ...holding,
  id: "option",
  symbol: "ABC270101C00123450",
  assetClass: "OPTION",
  quantity: 1,
  optionDetails: {
    underlying: "ABC",
    optionSymbol: "ABC270101C00123450",
    right: "CALL",
    strike: "123.45",
    expiration: "2027-01-01T12:00:00.000Z",
    multiplier: 100,
  },
  projection: {
    ...holding.projection,
    currentMarketValue: 500,
    currentPrice: 5,
    costBasis: 400,
    underlyingPrice: 100,
    impliedVolatility: 0.3,
  },
};
const portfolio = (holdings: Holding[] = [holding]): Portfolio => ({
  id: "portfolio",
  name: "Long Horizon",
  cashBalance: 5000,
  startingCash: 6000,
  currentValue: 6000,
  equitiesValue: 1000,
  optionsValue: 0,
  projectedNetWorth: 6500,
  intrinsicNetWorth: 6500,
  targetCount: holdings.length,
  estimatedCount: 0,
  positions: holdings,
  orders: [],
  ledger: [],
});
async function render(
  portfolios = [portfolio()],
  filtered = [holding],
  timestamp = asOf,
) {
  await act(() =>
    root.render(
      createElement(Report, {
        portfolios,
        filtered,
        asOf: timestamp,
        mode: "demo",
        close: () => {},
      }),
    ),
  );
}
function button(name: string) {
  const found = Array.from(container.querySelectorAll("button")).find(
    (b) => b.textContent === name,
  );
  expect(found, `button ${name}`).toBeDefined();
  return found!;
}
async function click(name: string) {
  await act(() => button(name).click());
}
async function mask() {
  await act(() =>
    (
      container.querySelector('input[type="checkbox"]') as HTMLInputElement
    ).click(),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value: vi.fn() },
    close: { configurable: true, value: vi.fn() },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  if (root) await act(() => root.unmount());
  Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("investment brief", () => {
  it("keeps chart, report, and exports on one captured snapshot while quotes refresh", async () => {
    await render();
    expect(container.querySelector("svg desc")?.textContent).toContain(
      "Current value $6,000.00. Model target $6,500.00. Intrinsic target $6,500.00.",
    );
    await render(
      [{ ...portfolio(), cashBalance: 99999 }],
      [holding],
      "2026-02-01T12:00:00.000Z",
    );
    expect(container.querySelector("svg desc")?.textContent).toContain(
      "Current value $6,000.00",
    );
    await click("Snapshot JSON");
    const payload = JSON.parse(vi.mocked(downloadText).mock.calls[0][0]);
    expect(payload).toMatchObject({
      asOf,
      cash: 5000,
      summary: { current: 6000, modelTarget: 6500, intrinsicTarget: 6500 },
    });
  });

  it("masks every monetary label and option strike in the brief but preserves explicit exact exports", async () => {
    await render([portfolio([holding, option])]);
    expect(container.querySelector(".report-sheet")?.textContent).toContain(
      "$123.45",
    );
    await mask();
    const sheet = container.querySelector(".report-sheet")!;
    expect(sheet.textContent).not.toMatch(/\$/);
    expect(sheet.textContent).not.toContain("123.45");
    expect(sheet.querySelector("svg desc")?.textContent).toContain(
      "Monetary values are masked",
    );
    expect(sheet.textContent).toContain("ABC");
    await click("Snapshot JSON");
    const payload = JSON.parse(vi.mocked(downloadText).mock.calls[0][0]);
    expect(payload.assets[1].option.strike).toBe(123.45);
    expect(payload.cash).toBe(5000);
    expect(container.textContent).toContain(
      "CSV and JSON include exact values",
    );
  });

  it("keeps all selected cash but only filtered holdings in the filtered brief and exports", async () => {
    await render([portfolio([holding, option])], [holding]);
    const select = container.querySelector("select")!;
    await act(() => {
      select.value = "filtered";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container.querySelector("svg desc")?.textContent).toContain(
      "Current value $6,000.00",
    );
    expect(container.querySelectorAll("tbody tr")).toHaveLength(1);
    await click("Snapshot JSON");
    const payload = JSON.parse(vi.mocked(downloadText).mock.calls[0][0]);
    expect(payload.scope).toBe("filtered");
    expect(payload.assets).toHaveLength(1);
    expect(payload.cash).toBe(5000);
  });

  it("exports source provenance and spreadsheet-safe portfolio names", async () => {
    await render([{ ...portfolio(), name: '=HYPERLINK("unsafe")' }]);
    await click("Holdings CSV");
    const csv = vi.mocked(downloadText).mock.calls[0][0];
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('"\'=HYPERLINK(""unsafe"")"');
    expect(csv).toContain('"1500","1500","demo"');
    expect(csv).toContain(asOf);
  });

  it("shows an actionable error when the browser blocks a printable brief", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    await render();
    await click("Print / save PDF");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Allow pop-ups for this site",
    );
    expect(button("Print / save PDF").disabled).toBe(false);
  });

  it("prints masked chart semantics and inline SVG without revealing monetary labels", async () => {
    const printDocument = document.implementation.createHTMLDocument();
    Object.defineProperty(printDocument, "fonts", {
      value: { ready: Promise.resolve() },
    });
    const printWindow = {
      document: printDocument,
      opener: window,
      closed: false,
      focus: vi.fn(),
      print: vi.fn(),
    };
    vi.spyOn(window, "open").mockReturnValue(printWindow as unknown as Window);
    await render([portfolio([holding, option])]);
    await mask();
    await click("Print / save PDF");
    expect(printWindow.opener).toBeNull();
    expect(printWindow.print).toHaveBeenCalledOnce();
    expect(printDocument.querySelector("svg path")).not.toBeNull();
    expect(printDocument.body.textContent).not.toMatch(/\$/);
    expect(printDocument.body.textContent).not.toContain("123.45");
    expect(printDocument.querySelector("svg desc")?.textContent).toContain(
      "Monetary values are masked",
    );
  });

  it("keeps failed downloads recoverable without losing the brief", async () => {
    vi.mocked(downloadText).mockImplementationOnce(() => {
      throw new Error("Download unavailable");
    });
    await render();
    await click("Holdings CSV");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Please try again",
    );
    expect(container.querySelector(".report-sheet h1")?.textContent).toBe(
      "The bigger picture.",
    );
    await click("Holdings CSV");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "CSV download requested",
    );
  });
});
