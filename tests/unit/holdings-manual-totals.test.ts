// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Holdings } from "@/components/studio/Holdings";
import type { Holding, Portfolio } from "@/lib/desk-types";
import { monthlyPortfolioFixture } from "../fixtures/monthly-scenario";

function fixture() {
  const portfolio = monthlyPortfolioFixture();
  const stock = portfolio.positions[0];
  const manual = structuredClone(portfolio.positions[1]);
  manual.symbol = "MANUAL:V1:BTG:2026-12-18:C:5000:100";
  manual.optionDetails!.optionSymbol = manual.symbol;
  Object.assign(manual.projection, {
    quoteSource: "manual",
    currentPrice: null,
    quoteAsOf: null,
    priceEstimated: true,
    valuationBasis: "COST_BASIS",
    unrealizedPnL: 0,
  });
  portfolio.positions = [stock, manual];
  return { portfolio, stock, manual };
}
function render(holdings: Holding[], portfolio: Portfolio) {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(
    createElement(Holdings, {
      holdings,
      portfolios: [portfolio],
      totalCount: portfolio.positions.length,
      onTarget: vi.fn(),
      onSell: vi.fn(),
      onDetail: vi.fn(),
      onClear: vi.fn(),
      onTrade: vi.fn(),
    }),
  );
  return host;
}
const pnlTotal = (host: HTMLElement) =>
  host.querySelector('tfoot td[data-label="Unrealized P/L"]')!.textContent!;

describe("visible manual holding P/L totals", () => {
  it("renders manual-only unrealized P/L as unavailable instead of a verified zero", () => {
    const { portfolio, manual } = fixture();
    const host = render([manual], portfolio);
    expect(
      host.querySelector('tbody td[data-label="Unrealized P/L"]')!.textContent,
    ).toContain("Unavailable");
    expect(pnlTotal(host)).toContain("Unavailable");
    expect(pnlTotal(host)).toContain(
      "No current market mark for 1 manual holding.",
    );
    expect(pnlTotal(host)).not.toContain("$0.00");
    expect(host.querySelector("tfoot")!.textContent).toContain(
      "Visible holdings · 1 of 2",
    );
  });

  it("marks mixed visible holdings incomplete without presenting the known subtotal as total P/L", () => {
    const { portfolio, stock, manual } = fixture();
    stock.projection.unrealizedPnL = 125;
    const host = render([stock, manual], portfolio);
    expect(
      host.querySelectorAll('tbody td[data-label="Unrealized P/L"]')[0]
        .textContent,
    ).toContain("$125.00");
    expect(pnlTotal(host)).toContain("Incomplete");
    expect(pnlTotal(host)).toContain("No current market mark");
    expect(pnlTotal(host)).not.toMatch(/\$/);
  });

  it("recalculates completeness from the visible filtered rows, not hidden portfolio holdings", () => {
    const { portfolio, stock, manual } = fixture();
    stock.projection.unrealizedPnL = -37.5;
    expect(pnlTotal(render([stock, manual], portfolio))).toContain(
      "Incomplete",
    );
    const filtered = render([stock], portfolio);
    expect(pnlTotal(filtered)).toBe("-$37.50");
    expect(filtered.querySelector("tfoot")!.textContent).toContain(
      "Visible holdings · 1 of 2",
    );
    expect(pnlTotal(render([manual], portfolio))).toContain("Unavailable");
  });

  it("retains a genuine zero total for provider-priced holdings", () => {
    const { portfolio, stock } = fixture();
    stock.projection.unrealizedPnL = 0;
    expect(pnlTotal(render([stock], portfolio))).toBe("$0.00");
  });
});
