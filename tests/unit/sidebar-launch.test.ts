// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarRings } from "@/components/SidebarRings";

const sound = vi.hoisted(() => ({ play: vi.fn(), cancel: vi.fn() }));
vi.mock("@/components/AmbientRadio", () => ({
  useBlastLaunchSound: () => sound.play,
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let host: HTMLDivElement;
let animationTime: number;
let wallTime: number;
let visibility: DocumentVisibilityState;
let reduced: boolean;
let resize: () => void;
let intersect: (visible: boolean) => void;
let motionChange: () => void;
let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;

async function mount(time = 0) {
  animationTime = time;
  await act(() => {
    root.render(
      createElement(
        "div",
        { className: "signalBeacon" },
        createElement(
          "span",
          { className: "signalLine" },
          createElement("span", { className: "signalPulse" }),
        ),
        createElement(
          "span",
          { className: "signalOrb" },
          createElement(SidebarRings),
        ),
      ),
    );
  });
  intersect(true);
}
function tick(time: number, wall = time) {
  animationTime = time;
  wallTime = wall;
  const pending = [...frames.values()];
  frames.clear();
  pending.forEach((callback) => callback(wall));
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  animationTime = 0;
  wallTime = 0;
  visibility = "visible";
  reduced = false;
  frames = new Map();
  nextFrame = 0;
  sound.play.mockReset().mockImplementation(() => sound.cancel);
  sound.cancel.mockReset();
  vi.spyOn(performance, "now").mockImplementation(() => wallTime);
  vi.spyOn(document, "visibilityState", "get").mockImplementation(
    () => visibility,
  );
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(220);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: (entries: unknown[]) => void) {
        intersect = (visible) =>
          callback([
            {
              isIntersecting: visible,
              intersectionRect: {
                width: visible ? 64 : 0,
                height: visible ? 64 : 0,
              },
            },
          ]);
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", () => ({
    get matches() {
      return reduced;
    },
    addEventListener(_type: string, callback: () => void) {
      motionChange = callback;
    },
    removeEventListener() {},
  }));
  // jsdom does not implement Web Animations; this stands in for its live clock.
  Object.defineProperty(HTMLElement.prototype, "getAnimations", {
    configurable: true,
    value: () => [{ currentTime: animationTime }],
  });
});
afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  delete (HTMLElement.prototype as unknown as Record<string, unknown>)
    .getAnimations;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("sidebar launch sound integration", () => {
  it("plays on each fresh visible launch, not duplicate observer updates, and cancels on unmount", async () => {
    await mount();
    tick(9_960);
    expect(sound.play).not.toHaveBeenCalled();
    tick(10_010);
    expect(sound.play).toHaveBeenCalledTimes(1);
    resize();
    intersect(true);
    tick(10_060);
    expect(sound.play).toHaveBeenCalledTimes(1);
    tick(19_960);
    tick(20_010);
    expect(sound.play).toHaveBeenCalledTimes(2);
    const cancelled = sound.cancel.mock.calls.length;
    await act(() => root.render(null));
    expect(sound.cancel.mock.calls.length).toBe(cancelled + 1);
    expect(frames.size).toBe(0);
  });

  it("seeds mount and visibility resumes silently, then accepts the next real launch", async () => {
    await mount(10_020);
    tick(10_060, 40);
    expect(sound.play).not.toHaveBeenCalled();
    tick(19_970, 10_000);
    tick(20_010, 10_040);
    expect(sound.play).toHaveBeenCalledTimes(1);
    visibility = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    expect(sound.cancel).toHaveBeenCalled();
    expect(frames.size).toBe(0);
    animationTime = 30_025;
    wallTime = 20_055;
    visibility = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    tick(30_060, 20_090);
    expect(sound.play).toHaveBeenCalledTimes(1);
    tick(39_970, 30_000);
    tick(40_010, 30_040);
    expect(sound.play).toHaveBeenCalledTimes(2);
  });

  it("cancels and reseeds after reduced motion and leaving the viewport", async () => {
    await mount();
    tick(9_970);
    tick(10_010);
    expect(sound.play).toHaveBeenCalledTimes(1);
    reduced = true;
    motionChange();
    expect(sound.cancel).toHaveBeenCalled();
    expect(frames.size).toBe(0);
    animationTime = 20_010;
    wallTime = 20_010;
    reduced = false;
    motionChange();
    tick(20_050);
    expect(sound.play).toHaveBeenCalledTimes(1);
    tick(29_970);
    tick(30_010);
    expect(sound.play).toHaveBeenCalledTimes(2);
    intersect(false);
    expect(frames.size).toBe(0);
    animationTime = 40_010;
    wallTime = 40_010;
    intersect(true);
    tick(40_050);
    expect(sound.play).toHaveBeenCalledTimes(2);
  });
});
