// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { MarginModal } from "@/components/studio/MarginModal";
import { monthlyPortfolioFixture } from "../fixtures/monthly-scenario";
vi.mock("@/components/DeskModal", () => ({
  DeskModal: ({ children }: { children: React.ReactNode }) =>
    createElement("div", null, children),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const saved = vi.fn(),
  close = vi.fn(),
  fetcher = vi.fn();
const settings = {
  debt: 10000,
  aprPercent: 12,
  maintenancePercent: 30,
  dayCountBasis: 360 as const,
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetcher);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(() => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});
const render = (margin?: typeof settings) =>
  act(() =>
    root.render(
      createElement(MarginModal, {
        portfolio: { ...monthlyPortfolioFixture(), margin },
        saved,
        close,
      }),
    ),
  );
const input = (label: string) =>
  [...host.querySelectorAll("label")]
    .find((e) => e.textContent?.startsWith(label))!
    .querySelector("input")!;
async function field(label: string, value: string) {
  await act(() => {
    const el = input(label);
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const button = () =>
  host.querySelector<HTMLButtonElement>("button.button.primary")!;
const submit = () =>
  act(() =>
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
const preview = (label: string) =>
  [...host.querySelectorAll("dt")].find((e) => e.textContent === label)!
    .nextElementSibling!.textContent;
describe("Existing margin editor", () => {
  it("requires an explicit APR for a new liability, previews debt separately, and keeps cash unchanged", async () => {
    await render();
    expect(button().disabled).toBe(true);
    expect(input("Margin loan APR").value).toBe("");
    await field("Existing margin debt", "10000");
    await field("Margin loan APR", "12");
    expect(button().disabled).toBe(false);
    expect(preview("Gross assets")).toBe("$110,700.00");
    expect(preview("Entered debt")).toBe("$10,000.00");
    expect(preview("Net equity")).toBe("$100,700.00");
    expect(preview("Available cash")).toBe("$1,000.00");
    // Valuable long options do not cure the account's cash/equity collateral deficit.
    expect(preview("Margin equity")).toBe("-$8,500.00");
    expect(preview("Maintenance shortfall")).toBe("$8,625.00");
    expect(host.textContent).toContain("standalone long options");
    expect(host.textContent).toContain("whole Eastern calendar days");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    ["Existing margin debt", ""],
    ["Existing margin debt", "-1"],
    ["Existing margin debt", "0.001"],
    ["Margin loan APR", ""],
    ["Margin loan APR", "-1"],
    ["Equity maintenance", "24.99"],
    ["Equity maintenance", "100.01"],
  ])("disables malformed %s=%s without submitting", async (label, value) => {
    await render(settings);
    await field(label, value);
    expect(button().disabled).toBe(true);
    await submit();
    expect(fetcher).not.toHaveBeenCalled();
    expect(saved).not.toHaveBeenCalled();
  });
  it("allows explicit zero APR/debt and sends only four strict settings", async () => {
    await render(settings);
    await field("Existing margin debt", "0");
    await field("Margin loan APR", "0");
    fetcher.mockResolvedValue(
      new Response(
        JSON.stringify({ margin: { ...settings, debt: 0, aprPercent: 0 } }),
        { status: 200 },
      ),
    );
    await submit();
    expect(fetcher).toHaveBeenCalledWith(
      "/api/portfolios/fixture-portfolio/margin",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ ...settings, debt: 0, aprPercent: 0 }),
      }),
    );
    expect(saved).toHaveBeenCalledWith({ ...settings, debt: 0, aprPercent: 0 });
    expect(close).toHaveBeenCalledOnce();
  });
  it("locks fields during save, retains input and permits retry after a recoverable failure", async () => {
    await render(settings);
    let finish!: (response: Response) => void;
    fetcher.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    await submit();
    expect(button().disabled).toBe(true);
    expect(input("Existing margin debt").disabled).toBe(true);
    expect(saved).not.toHaveBeenCalled();
    await act(() =>
      finish(
        new Response(JSON.stringify({ error: "Please retry" }), {
          status: 500,
        }),
      ),
    );
    expect(input("Existing margin debt").value).toBe("10000");
    expect(button().disabled).toBe(false);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Please retry",
    );
    expect(close).not.toHaveBeenCalled();
    fetcher.mockResolvedValueOnce(
      new Response(JSON.stringify({ margin: settings }), { status: 200 }),
    );
    await submit();
    expect(saved).toHaveBeenCalledOnce();
  });
});
