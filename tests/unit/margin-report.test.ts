// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Report } from "@/components/studio/Report";
import { downloadText } from "@/lib/studio";
import { monthlyPortfolioFixture } from "../fixtures/monthly-scenario";
vi.mock("@/components/DeskModal", () => ({
  DeskModal: ({ children }: { children: React.ReactNode }) =>
    createElement("div", null, children),
}));
vi.mock("@/lib/studio", async (load) => ({
  ...(await load<typeof import("@/lib/studio")>()),
  downloadText: vi.fn(),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement;
const portfolio = () => ({
  ...monthlyPortfolioFixture(),
  margin: {
    debt: 2000,
    aprPercent: 12,
    maintenancePercent: 25,
    dayCountBasis: 360 as const,
  },
  currentValue: 108700,
});
beforeEach(() => {
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(() => root.unmount());
  document.body.replaceChildren();
});
const render = () => {
  const p = portfolio();
  return act(() =>
    root.render(
      createElement(Report, {
        portfolios: [p],
        filtered: [],
        asOf: "2026-10-05T16:00:00Z",
        mode: "demo",
        initialMasked: false,
        close: vi.fn(),
      }),
    ),
  );
};
async function filtered() {
  await act(() => {
    const select = host.querySelector("select")!;
    Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      "value",
    )!.set!.call(select, "filtered");
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function json() {
  await act(() =>
    [...host.querySelectorAll("button")]
      .find((e) => e.textContent?.includes("Snapshot JSON"))!
      .click(),
  );
  return JSON.parse(vi.mocked(downloadText).mock.calls.at(-1)![0]);
}
describe("Captured report margin semantics", () => {
  it("keeps full-account maintenance and selected debt in a filtered subset, with gross allocation percentages", async () => {
    await render();
    await filtered();
    expect(host.textContent).toContain("Subset net value");
    expect(host.textContent).toContain("-$1,000.00");
    expect(host.textContent).toContain("Gross asset allocation");
    expect(host.querySelector(".report-allocation")?.textContent).toContain(
      "$1,000.00 · 100.0%",
    );
    expect(host.textContent).toContain("$625.00");
    const snapshot = await json();
    expect(snapshot.summary).toMatchObject({
      current: -1000,
      grossCurrent: 1000,
      enteredDebt: 2000,
    });
    expect(snapshot.summary.fullAccountMaintenance.maintenanceShortfall).toBe(
      625,
    );
    expect(snapshot.portfolios[0].margin).toEqual(portfolio().margin);
    expect(snapshot.assets).toEqual([]);
    // Negative net equity stays in the chart domain and never creates invalid SVG coordinates.
    expect(
      [...host.querySelectorAll("svg path")].every(
        (p) => !/(NaN|Infinity)/.test(p.getAttribute("d") ?? ""),
      ),
    ).toBe(true);
  });
  it("exposes all selected gross assets, debt and net equity separately in exported snapshots", async () => {
    await render();
    const snapshot = await json();
    expect(snapshot.summary).toMatchObject({
      grossCurrent: 110700,
      enteredDebt: 2000,
      current: 108700,
    });
    expect(
      snapshot.assets.map((a: { currentValue: number }) => a.currentValue),
    ).toEqual([500, 109200]);
    expect(snapshot.portfolios[0].cash).toBe(1000);
  });
});
