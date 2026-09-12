// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ScenarioPreview } from "@/components/landing/ScenarioPreview";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
let annotation: MutationObserver | undefined;
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(async () => {
  annotation?.disconnect();
  annotation = undefined;
  if (root) await act(() => root!.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function fixture(element: ReactNode = createElement(ScenarioPreview)) {
  const host = document.createElement("div");
  host.innerHTML = renderToString(element);
  document.body.append(host);
  return host;
}
function annotate(host: HTMLElement) {
  const apply = () =>
    host.querySelectorAll("input").forEach((input) => {
      if (!input.hasAttribute("data-sharkid"))
        input.setAttribute("data-sharkid", "__0");
    });
  apply();
  annotation = new MutationObserver(apply);
  annotation.observe(host, { childList: true, subtree: true });
}
async function change(input: HTMLInputElement, value: string) {
  await act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function button(host: HTMLElement, label: string) {
  return [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent?.trim() === label,
  )!;
}

it("keeps readable server-rendered totals, chart, labels and the exact value before controls mount", () => {
  const host = fixture();
  expect(host.querySelector("input")).toBeNull();
  expect(host.querySelector("[data-number-placeholder]")?.textContent).toBe(
    "2000",
  );
  expect(host.textContent).toContain("$633,029");
  expect(host.textContent).toContain("Exact price · USD");
  expect(host.querySelector("svg")).not.toBeNull();
});

it("hydrates without warnings under input annotation and preserves focus, precision, bounds, per-mode values and reset", async () => {
  const element = createElement(ScenarioPreview),
    host = fixture(element);
  annotate(host);
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  await act(() => {
    root = hydrateRoot(host, element);
  });
  const input = host.querySelector<HTMLInputElement>('input[type="number"]')!;
  expect(input.getAttribute("data-sharkid")).toBe("__0");
  expect(input.getAttribute("aria-label")).toBe(
    "Exact sample share-price target",
  );
  expect(input.step).toBe("any");
  expect(input.min).toBe("0");
  expect(input.max).toBe("2500");
  input.focus();
  await change(input, "1234.56");
  expect(input.value).toBe("1234.56");
  expect(document.activeElement).toBe(input);
  expect(host.querySelector('input[type="number"]')).toBe(input);
  await act(() => button(host, "Options").click());
  expect(host.querySelector('input[type="number"]')).toBe(input);
  expect(input.value).toBe("50");
  expect(input.max).toBe("75");
  expect(input.getAttribute("aria-label")).toBe(
    "Exact sample market-cap target in billions",
  );
  await change(input, "-1");
  expect(input.value).toBe("0");
  await change(input, "100");
  expect(input.value).toBe("75");
  await act(() => button(host, "Stocks & ETFs").click());
  expect(input.value).toBe("1234.56");
  await act(() => button(host, "Reset example").click());
  expect(input.value).toBe("2000");
  await act(() => button(host, "Options").click());
  expect(input.value).toBe("50");
  expect(error).not.toHaveBeenCalled();
});

it("continues reporting unrelated hydration mismatches", async () => {
  const element = createElement(
    "section",
    { "data-thesis": "original" },
    createElement(ScenarioPreview),
  );
  const host = fixture(element);
  host.querySelector("section")!.setAttribute("data-thesis", "unexpected");
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  await act(() => {
    root = hydrateRoot(host, element);
  });
  expect(error.mock.calls.flat().join(" ")).toContain("data-thesis");
});
