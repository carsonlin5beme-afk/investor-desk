// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MonthlyChart } from "@/components/studio/MonthlyChart";
import { projectMonthly } from "@/lib/monthly-projection";
import { monthlyFixture } from "../fixtures/monthly-scenario";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(() => root.unmount());
  document.body.replaceChildren();
});
describe("Financed monthly chart", () => {
  it("keeps real negative net equity within the plot and uses a financing-aware accessible label", async () => {
    const s = monthlyFixture();
    s.assets = s.assets.filter((a) => !a.option);
    s.portfolioSnapshots = [
      {
        id: "fixture-portfolio",
        name: "Debt",
        cash: 1000,
        margin: {
          debt: 10000,
          aprPercent: 0,
          maintenancePercent: 25,
          dayCountBasis: 360,
        },
      },
    ];
    const rows = projectMonthly(s);
    expect(rows.every((r) => r.netEquity! < 0)).toBe(true);
    await act(() =>
      root.render(createElement(MonthlyChart, { rows, selected: 0 })),
    );
    expect(host.textContent).toContain("Modeled portfolio net equity");
    expect(host.querySelector("svg")?.getAttribute("aria-label")).toContain(
      "net equity",
    );
    const circles = [...host.querySelectorAll("circle")];
    expect(circles).toHaveLength(4);
    for (const circle of circles) {
      const y = Number(circle.getAttribute("cy"));
      expect(y).toBeGreaterThanOrEqual(20);
      expect(y).toBeLessThanOrEqual(160);
    }
    expect(host.querySelector("path")?.getAttribute("d")).not.toMatch(
      /NaN|Infinity/,
    );
  });
  it("retains the legacy no-debt label and preserves gaps for unavailable months", async () => {
    const s = monthlyFixture();
    s.assets = s.assets.filter((a) => !a.option);
    s.monthly!.paths[0].prices[1] = null;
    const rows = projectMonthly(s);
    await act(() =>
      root.render(createElement(MonthlyChart, { rows, selected: 0 })),
    );
    expect(host.textContent).toContain("Modeled portfolio value");
    expect(host.textContent).toContain("does not bridge missing months");
    expect(host.querySelectorAll("circle")).toHaveLength(3);
    expect(
      host.querySelector("path")?.getAttribute("d")?.match(/M/g),
    ).toHaveLength(2);
  });
});
