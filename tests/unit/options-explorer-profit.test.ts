// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OptionsExplorer } from "@/components/studio/OptionsExplorer";
import { ValueChart } from "@/components/studio/ValueChart";

vi.mock("@/components/studio/ValueChart", () => ({
  ValueChart: vi.fn(({ label }: { label: string }) =>
    createElement("div", { "aria-label": label }),
  ),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let host: HTMLDivElement;
const defaults = {
  underlying: "BTG",
  spot: null,
  strike: 12.5,
  right: "CALL" as "CALL" | "PUT",
  expiration: "2027-01-15",
  premium: 2.35,
  quantity: 2,
  multiplier: 100,
  iv: 0.6,
  ivEstimated: true,
};
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-05T16:00:00Z"));
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(() => root.unmount());
  document.body.replaceChildren();
  vi.useRealTimers();
});
const render = (props: Partial<typeof defaults> = {}) =>
  act(() =>
    root.render(createElement(OptionsExplorer, { ...defaults, ...props })),
  );
const output = (label = "Expiration net profit or loss") =>
  host.querySelector(`output[aria-label="${label}"]`)?.textContent;
const target = () =>
  host.querySelector<HTMLInputElement>('input[type="text"]')!;
async function setField(field: HTMLInputElement, value: string) {
  await act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const formula = () =>
  host.querySelector('[aria-label="Substituted expiration profit formula"]')
    ?.textContent;

describe("Options Explorer profit calculator", () => {
  it("works at a hypothetical strike without an observed quote and shows full premium and actual expiration", async () => {
    await render();
    expect(target().value).toBe("12.5");
    expect(host.textContent).toContain("No observed underlying quote is used");
    expect(host.textContent).toContain("expires 2027-01-15");
    expect(output()).toBe("-$470.00");
    expect(host.querySelector(".option-risk-metrics")?.textContent).toContain(
      "$470.00",
    );
    await setField(target(), "15");
    expect(output()).toBe("$30.00");
    expect(formula()).toBe(
      "[max($15.00 − $12.50, $0.00) − $2.35] × 2 × 100 = $30.00",
    );
    expect(output("Modeled net profit or loss")).not.toBe(output());
    expect(host.textContent).toContain("Before-expiration model P/L");
    expect(host.textContent).toContain("Fees are excluded");
    expect(host.textContent).toContain("4% annual interest, zero dividends");
    expect(host.textContent).toContain("assumed 60%");
  });

  it("reverses the put subtraction, accepts zero, and never confuses blank or invalid inputs with zero", async () => {
    await render({ right: "PUT" });
    await setField(target(), "10");
    expect(output()).toBe("$30.00");
    expect(formula()).toContain("max($12.50 − $10.00, $0.00)");
    await setField(target(), "0");
    expect(output()).toBe("$2,030.00");
    expect(target().getAttribute("aria-invalid")).toBe("false");
    for (const invalid of ["", "-1", "Infinity", "1e309", "NaN", "oops"]) {
      await setField(target(), invalid);
      expect(output()).toBe("—");
      expect(output("Modeled net profit or loss")).toBe("—");
      expect(formula()).toBeUndefined();
      expect(target().getAttribute("aria-invalid")).toBe("true");
      expect(host.querySelector('[role="alert"]')?.textContent).toContain(
        "finite, nonnegative",
      );
    }
  });

  it("keeps hypothetical price while recalculating premium, whole contracts and multiplier", async () => {
    await render();
    await setField(target(), "15");
    await render({ premium: 2.350001, quantity: 3, multiplier: 50 });
    expect(target().value).toBe("15");
    expect(output()).toBe("$22.50");
    expect(formula()).toContain("$2.350001] × 3 × 50");
    expect(host.textContent).toContain("Entry premium: $2.350001 per share");
  });

  it("changes only the model when adjusting volatility or time and converges to intrinsic at expiration", async () => {
    await render();
    await setField(target(), "15");
    const initialModel = output("Modeled net profit or loss");
    const ranges = [
      ...host.querySelectorAll<HTMLInputElement>('input[type="range"]'),
    ];
    await setField(ranges[0], "90");
    expect(output()).toBe("$30.00");
    expect(output("Modeled net profit or loss")).not.toBe(initialModel);
    await setField(ranges[1], ranges[1].max);
    expect(output("Modeled net profit or loss")).toBe("$30.00");
    expect(host.textContent).toContain("Model at expiration");
    expect(host.textContent).toContain("uses intrinsic value");
    const chart = vi.mocked(ValueChart).mock.calls.at(-1)![0];
    expect(chart.series).toHaveLength(2);
    expect(chart.series[0].values).toEqual(chart.series[1].values);
  });

  it("retains chart and sensitivity while using separate expiration and model profits", async () => {
    await render();
    expect(
      host.querySelector(
        '[aria-label="Option profit and loss by underlying price"]',
      ),
    ).not.toBeNull();
    expect(
      host.querySelectorAll(".sensitivity-table tbody button"),
    ).toHaveLength(25);
    expect(
      vi
        .mocked(ValueChart)
        .mock.calls.at(-1)![0]
        .series.every((s) => s.values.every(Number.isFinite)),
    ).toBe(true);
    await act(() =>
      host
        .querySelector<HTMLButtonElement>(".sensitivity-table tbody button")!
        .click(),
    );
    expect(host.querySelector('[role="status"]')?.textContent).toContain(
      "modeled P/L",
    );
  });

  it.each([0, 1.5, NaN, Infinity])(
    "does not substitute one contract for invalid count %s",
    async (quantity) => {
      await render({ quantity });
      expect(host.querySelector('[role="alert"]')?.textContent).toContain(
        "positive whole contract count",
      );
      expect(output()).toBeUndefined();
      expect(vi.mocked(ValueChart)).not.toHaveBeenCalled();
    },
  );

  it("preserves hypothetical price precision in the formula for a large whole contract count", async () => {
    await render({ right: "PUT", quantity: 1_000_000_000 });
    await setField(target(), "10.00000049");
    expect(output()).toBe("$14,999,951,000.00");
    expect(formula()).toContain("max($12.50 − $10.00000049, $0.00)");
    expect(formula()).toContain("× 1,000,000,000 × 100 = $14,999,951,000.00");
  });

  it("shows unattainable put break-even separately from zero-price break-even", async () => {
    await render({ right: "PUT", strike: 10, premium: 11, quantity: 1 });
    expect(host.textContent).toContain("No nonnegative break-even");
    await setField(target(), "0");
    expect(output()).toBe("-$100.00");
    await render({ right: "PUT", strike: 10, premium: 10, quantity: 1 });
    expect(host.textContent).not.toContain("No nonnegative break-even");
    expect(host.querySelector(".option-risk-metrics")?.textContent).toContain(
      "$0.00",
    );
    expect(output()).toBe("$0.00");
  });
});
