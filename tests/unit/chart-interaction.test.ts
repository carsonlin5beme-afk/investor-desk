// @vitest-environment jsdom
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ValueChart, type ChartSeries } from "@/components/studio/ValueChart";
import { OptionsExplorer } from "@/components/studio/OptionsExplorer";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement;
beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-01-01T00:00:00.000Z"));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function render(element: ReactElement) {
  await act(() => root!.render(element));
}
async function moveRange(input: HTMLInputElement, value: number) {
  await act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, String(value));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function click(button: HTMLButtonElement) {
  await act(() => button.click());
}
function buttonNamed(name: string) {
  const button = [
    ...container.querySelectorAll<HTMLButtonElement>("button"),
  ].find(
    (b) => (b.getAttribute("aria-label") ?? b.textContent)?.trim() === name,
  );
  expect(button, `Expected button ${name}`).toBeDefined();
  return button!;
}
function explorerRange(label: string) {
  const input = [
    ...container.querySelectorAll<HTMLInputElement>("input[type=range]"),
  ].find((i) => i.closest("label")?.textContent?.includes(label));
  expect(input, `Expected slider ${label}`).toBeDefined();
  return input!;
}
const series: ChartSeries[] = [
  {
    id: "curve",
    name: "Curve",
    color: "green",
    values: [0, 100],
    valueAt: (p) => 100 * p * p,
  },
  { id: "linear", name: "Linear", color: "blue", values: [10, 30] },
];

describe("chart inspection", () => {
  it("uses exact evaluators for readouts and the data table, retaining interpolation as a fallback", async () => {
    const onProgress = vi.fn();
    await render(
      createElement(ValueChart, {
        label: "Portfolio thesis",
        series,
        onProgress,
      }),
    );
    const slider =
      container.querySelector<HTMLInputElement>("input[type=range]")!;
    await moveRange(slider, 25);
    expect(onProgress).toHaveBeenLastCalledWith(0.25);
    expect(
      [...container.querySelectorAll(".chart-readout strong")].map(
        (s) => s.textContent,
      ),
    ).toEqual(["$6.25", "$15.00"]);
    expect(slider.getAttribute("aria-valuetext")).toContain(
      "25%, Curve $6.25, Linear $15.00",
    );
    expect(
      buttonNamed("Unpin chart details").getAttribute("aria-pressed"),
    ).toBe("true");
    await click(buttonNamed("View exact data"));
    const row = [...container.querySelectorAll(".chart-data tbody tr")].find(
      (r) => r.firstElementChild?.textContent === "20%",
    );
    expect([...row!.children].map((cell) => cell.textContent)).toEqual([
      "20%",
      "$4.00",
      "$14.00",
    ]);
    await click(buttonNamed("Reset chart"));
    expect(slider.value).toBe("100");
    expect(onProgress).toHaveBeenLastCalledWith(1);
    expect(buttonNamed("Pin chart details").getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("keeps legend pressed state consistent with plotted series after removing the only visible scenario", async () => {
    const third = {
      id: "third",
      name: "Third",
      color: "orange",
      values: [50, 75],
    };
    await render(
      createElement(ValueChart, {
        label: "Comparison",
        series: [...series, third],
      }),
    );
    await click(buttonNamed("Curve"));
    await click(buttonNamed("Linear"));
    expect(container.querySelectorAll(".chart-series-path")).toHaveLength(1);
    expect(container.querySelector(".chart-readout")!.textContent).toContain(
      "Third",
    );
    await render(createElement(ValueChart, { label: "Comparison", series }));
    const shown = [
      ...container.querySelectorAll<HTMLButtonElement>(".chart-legend button"),
    ].filter((button) => button.getAttribute("aria-pressed") === "true");
    expect(shown.length).toBeGreaterThan(0);
    expect(container.querySelectorAll(".chart-series-path")).toHaveLength(
      shown.length,
    );
    for (const button of shown)
      expect(container.querySelector(".chart-readout")!.textContent).toContain(
        button.textContent,
      );
    // A legend interaction must leave a visible series, even after the set changes.
    await click(shown[0]);
    expect(
      container.querySelectorAll(".chart-series-path").length,
    ).toBeGreaterThan(0);
  });

  it("gives charts with the same units distinct accessible slider names", async () => {
    await render(
      createElement(
        "section",
        null,
        createElement(ValueChart, { label: "Saved comparison", series }),
        createElement(ValueChart, { label: "Draft preview", series }),
      ),
    );
    const names = [...container.querySelectorAll("input[type=range]")].map(
      (input) => input.getAttribute("aria-label"),
    );
    expect(names[0]).toContain("Saved comparison");
    expect(names[1]).toContain("Draft preview");
    expect(new Set(names).size).toBe(2);
  });

  it("reports the selected underlying price with cents in visual and accessible readouts", async () => {
    await render(
      createElement(ValueChart, {
        label: "Option payoff",
        xLabel: "Underlying price (USD)",
        xUnit: "usd",
        xMax: 123.4,
        series: [series[0]],
      }),
    );
    const slider =
      container.querySelector<HTMLInputElement>("input[type=range]")!;
    await moveRange(slider, 30);
    expect(container.querySelector(".chart-readout")!.textContent).toContain(
      "$37.02 · selected price",
    );
    expect(slider.getAttribute("aria-valuetext")).toContain("$37.02");
  });
});

const option = {
  spot: 100,
  strike: 100,
  right: "CALL" as const,
  expiration: "2027-01-01T00:00:00.000Z",
  premium: 6,
  iv: 0.6,
  quantity: 2,
};

describe("option model interactions", () => {
  it("represents a valid high-IV quote within the slider's actual range", async () => {
    await render(createElement(OptionsExplorer, { ...option, iv: 3.5 }));
    const slider = explorerRange("Model volatility");
    expect(slider.closest("label")!.textContent).toContain("350%");
    expect(slider.value).toBe("350");
    expect(Number(slider.max)).toBeGreaterThanOrEqual(350);
    expect(Number(slider.min)).toBeLessThanOrEqual(350);
  });

  it("preserves fractional quote IV in the model and keeps sensitivity rows distinct", async () => {
    await render(createElement(OptionsExplorer, { ...option, iv: 0.004 }));
    const volatility = explorerRange("Model volatility");
    expect(volatility.closest("label")!.textContent).toContain("0.4%");
    expect(volatility.value).toBe("0.4");
    expect(Number(volatility.min)).toBeLessThanOrEqual(0.4);
    const rows = [
      ...container.querySelectorAll(".sensitivity-table tbody th"),
    ].map((th) => Number(th.textContent!.replace("%", "")));
    expect(rows).toHaveLength(5);
    expect(new Set(rows).size).toBe(5);
    expect(rows).toContain(0.4);
    expect(rows.every((vol) => vol > 0)).toBe(true);
    await moveRange(
      container.querySelector<HTMLInputElement>(
        ".value-chart input[type=range]",
      )!,
      50,
    );
    // A positive 0.4% IV retains the one-year model's interest/time value.
    // Rounding it to zero incorrectly makes both series use intrinsic value.
    expect(
      [...container.querySelectorAll(".chart-readout strong")].map(
        (s) => s.textContent,
      ),
    ).toEqual(["-$1,200.00", "-$415.79"]);
    await moveRange(volatility, 0.25);
    expect(volatility.closest("label")!.textContent).toContain("0.25%");
    expect(volatility.value).toBe("0.25");
  });

  it("preserves distinct sensitivity prices for a low-priced underlying", async () => {
    await render(
      createElement(OptionsExplorer, {
        ...option,
        spot: 3,
        strike: 3,
        premium: 0.5,
      }),
    );
    expect(
      [...container.querySelectorAll(".sensitivity-table thead th")]
        .slice(1)
        .map((th) => th.textContent),
    ).toEqual(["$1.50", "$2.25", "$3.00", "$3.75", "$4.50"]);
  });

  it("revalues a selected sensitivity cell at expiry and after premium/quantity changes", async () => {
    await render(createElement(OptionsExplorer, option));
    const selected = [
      ...container.querySelectorAll<HTMLButtonElement>(
        ".sensitivity-table button",
      ),
    ].find((button) =>
      button.getAttribute("aria-label")?.startsWith("At $100.00 and 60% IV:"),
    )!;
    await click(selected);
    expect(selected.getAttribute("aria-pressed")).toBe("true");
    const before = container.querySelector(
      '[role="status"] strong',
    )!.textContent;
    await moveRange(explorerRange("Days forward"), 365);
    expect(container.querySelector('[role="status"] strong')!.textContent).toBe(
      "-$1,200.00",
    );
    expect(before).not.toBe("-$1,200.00");
    await render(
      createElement(OptionsExplorer, { ...option, premium: 8, quantity: 3 }),
    );
    expect(container.querySelector('[role="status"] strong')!.textContent).toBe(
      "-$2,400.00",
    );
    await moveRange(
      container.querySelector<HTMLInputElement>(
        ".value-chart input[type=range]",
      )!,
      60,
    );
    // At $120, (intrinsic $20 - entry premium $8) × 3 × 100 = $3,600.
    expect(
      [...container.querySelectorAll(".chart-readout strong")].map(
        (s) => s.textContent,
      ),
    ).toEqual(["$3,600.00", "$3,600.00"]);
  });
});
