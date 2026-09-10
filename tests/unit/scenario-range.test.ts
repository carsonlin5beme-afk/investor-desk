// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScenarioRange } from "@/components/ScenarioRange";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(() => root!.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});
const attributes = {
  "aria-label": "Target progress",
  min: 0,
  max: 100,
  value: 100,
  onChange: () => {},
};
function annotateInputs(container: HTMLElement) {
  for (const input of container.querySelectorAll("input"))
    input.setAttribute("data-sharkid", "__0");
}
function fixture(element: ReturnType<typeof createElement>) {
  const container = document.createElement("div");
  container.innerHTML = renderToString(element);
  document.body.append(container);
  return container;
}
describe("scenario slider hydration", () => {
  it("reproduces the reported warning for an annotated server-rendered input", async () => {
    const element = createElement("input", { ...attributes, type: "range" });
    const container = fixture(element);
    annotateInputs(container);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await act(() => {
      root = hydrateRoot(container, element);
    });
    expect(error.mock.calls.flat().join(" ")).toContain("data-sharkid");
  });

  it("server-renders a noninteractive placeholder rather than an extension target", () => {
    const container = fixture(createElement(ScenarioRange, attributes));
    expect(container.querySelector("input")).toBeNull();
    expect(
      container
        .querySelector("[data-range-placeholder]")
        ?.getAttribute("aria-hidden"),
    ).toBe("true");
  });

  it("hydrates cleanly and preserves controlled changes with input annotation enabled", async () => {
    function Example() {
      const [value, setValue] = useState(100);
      return createElement(
        "label",
        null,
        createElement(ScenarioRange, {
          ...attributes,
          value,
          onChange: (e) => setValue(Number(e.target.value)),
        }),
        createElement("output", null, value),
      );
    }
    const element = createElement(Example);
    const container = fixture(element);
    annotateInputs(container);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await act(() => {
      root = hydrateRoot(container, element);
    });
    const input = container.querySelector("input")!;
    expect(container.querySelector("[data-range-placeholder]")).toBeNull();
    expect(input.type).toBe("range");
    expect(input.value).toBe("100");
    expect(input.getAttribute("aria-label")).toBe("Target progress");
    // A later extension annotation must not interfere with normal controlled updates.
    annotateInputs(container);
    await act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, "40");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.querySelector("output")!.textContent).toBe("40");
    expect(error).not.toHaveBeenCalled();
  });

  it("does not silence unrelated hydration mismatches", async () => {
    const element = createElement(
      "section",
      { "data-thesis": "original" },
      createElement(ScenarioRange, attributes),
    );
    const container = fixture(element);
    container
      .querySelector("section")!
      .setAttribute("data-thesis", "unexpected");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await act(() => {
      root = hydrateRoot(container, element);
    });
    expect(error.mock.calls.flat().join(" ")).toContain("data-thesis");
  });
});
