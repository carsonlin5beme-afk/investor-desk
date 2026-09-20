// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { startAsteroidImpact } from "@/components/asteroid-impact-effects";

let sidebar: HTMLElement;
beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML =
    '<main class="desk-shell"><aside class="sidebar"><button id="side">Portfolios</button></aside><button id="order">New order</button></main>';
  sidebar = document.querySelector("aside")!;
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  vi.spyOn(sidebar, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 20,
    width: 280,
    height: 700,
    right: 280,
    bottom: 720,
    x: 0,
    y: 20,
    toJSON() {},
  });
});
afterEach(() => {
  vi.runAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

it("confines a regular impact to the sidebar and removes every transient style after five seconds", () => {
  const button = document.querySelector<HTMLButtonElement>("#order")!;
  button.focus();
  const original = document.querySelector("main")!.outerHTML;
  startAsteroidImpact(sidebar, { x: 120, y: 340 }, false);
  const layer = document.querySelector<HTMLElement>("[data-asteroid-impact]")!;
  expect(layer.dataset.asteroidImpact).toBe("sage");
  expect(layer.style.width).toBe("280px");
  expect(layer.style.top).toBe("20px");
  expect(layer.style.getPropertyValue("--impact-y")).toBe("320px");
  expect(document.querySelector("main")!.className).toBe("desk-shell");
  expect(document.activeElement).toBe(button);
  vi.advanceTimersByTime(4999);
  expect(layer.isConnected).toBe(true);
  vi.advanceTimersByTime(1);
  expect(layer.isConnected).toBe(false);
  expect(document.querySelector("main")!.outerHTML).toBe(original);
});

it("gold effects cover the viewport, keep controls operable and do not let stale cleanup erase a newer hit", () => {
  const button = document.querySelector<HTMLButtonElement>("#order")!;
  const action = vi.fn();
  button.addEventListener("click", action);
  const old = startAsteroidImpact(sidebar, { x: 120, y: 340 }, true);
  vi.advanceTimersByTime(1200);
  const cancel = startAsteroidImpact(sidebar, { x: 140, y: 320 }, true);
  old();
  expect(document.querySelectorAll("[data-asteroid-impact]")).toHaveLength(1);
  expect(
    document.querySelector<HTMLElement>("[data-asteroid-impact]")!.style.width,
  ).toBe(`${window.innerWidth}px`);
  button.click();
  expect(action).toHaveBeenCalledOnce();
  vi.advanceTimersByTime(3800);
  expect(document.querySelector("[data-asteroid-impact]")).not.toBeNull();
  cancel();
  expect(document.querySelector("main")!.className).toBe("desk-shell");
  expect(document.querySelector("[data-asteroid-impact]")).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});

it("does not create visual or timer work while hidden or with reduced motion", () => {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  startAsteroidImpact(sidebar, { x: 120, y: 340 }, true);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  startAsteroidImpact(sidebar, { x: 120, y: 340 }, false);
  expect(document.querySelector("[data-asteroid-impact]")).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});
