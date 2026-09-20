// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarAsteroids } from "@/components/SidebarAsteroids";
import type { AsteroidEncounter } from "@/lib/sidebar-asteroids";

const planner = vi.hoisted(() => ({
  create: vi.fn(),
  next: vi.fn(),
  createSchedule: vi.fn(),
  schedule: vi.fn(),
  position: vi.fn(),
}));
const effects = vi.hoisted(() => ({ visual: vi.fn(), sound: vi.fn() }));
vi.mock("@/lib/sidebar-asteroids", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sidebar-asteroids")>()),
  createAsteroidSequence: planner.create,
  createAsteroidCompanionSchedule: planner.createSchedule,
  asteroidPosition: planner.position,
}));
vi.mock("@/components/AmbientRadio", () => ({
  useAsteroidImpactSound: () => effects.sound,
}));
vi.mock("@/components/asteroid-impact-effects", () => ({
  IMPACT_DURATION_MS: 5_000,
  startAsteroidImpact: effects.visual,
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | null;
let host: HTMLDivElement;
let animationTime: number | null;
let wallTime: number;
let visibility: DocumentVisibilityState;
let reduced: boolean;
let laneHeight: number;
let fieldWidth: number;
let pulse: { x: number; y: number };
let portfolioBottom: number;
let navBottom: number;
let resize: () => void;
let intersect: (visible: boolean) => void;
let motionChange: () => void;
let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;
let positions: Map<number, { x: number; y: number }>;
let visualCancels: ReturnType<typeof vi.fn>[];
let soundCancels: ReturnType<typeof vi.fn>[];
let resizeObserve: ReturnType<typeof vi.fn>;
let resizeDisconnect: ReturnType<typeof vi.fn>;
let intersectionDisconnect: ReturnType<typeof vi.fn>;
let removeMotionListener: ReturnType<typeof vi.fn>;

function encounter(
  index: number,
  start: number,
  patch: Partial<AsteroidEncounter> = {},
): AsteroidEncounter {
  return {
    index,
    start,
    gold: false,
    impact: index === 0,
    crossing: start + 2_000,
    duration: 4_000,
    size: 20,
    direction: 1,
    slope: 0,
    angle: 0,
    spin: 25,
    height: 0.4,
    variant: index % 3,
    ...patch,
  };
}
const field = () => host.querySelector<HTMLElement>("[data-asteroid-field]")!;
const rocks = () => [...host.querySelectorAll<HTMLElement>("[data-asteroid]")];
const active = () => rocks().filter((rock) => rock.dataset.active === "true");
const rect = (
  left: number,
  top: number,
  width: number,
  height: number,
): DOMRect => ({
  x: left,
  y: top,
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
  toJSON() {},
});

async function mount() {
  await act(() => {
    root = createRoot(host);
    root.render(
      createElement(
        "main",
        { className: "desk-shell" },
        createElement(
          "aside",
          { className: "sidebar" },
          createElement(
            "nav",
            { "data-navigation": "" },
            createElement(
              "div",
              { className: "portfolio-nav" },
              createElement("button", null, "Portfolio"),
            ),
          ),
          createElement(
            "div",
            { className: "signalBeacon" },
            createElement(
              "span",
              { className: "signalLine" },
              createElement("span", {
                className: "signalPulse",
                style: { opacity: "1" },
              }),
            ),
            createElement(SidebarAsteroids),
          ),
        ),
      ),
    );
  });
  intersect(true);
}
function tick(time: number | null, wall = wallTime + 40) {
  animationTime = time;
  wallTime = wall;
  const pending = [...frames.values()];
  frames.clear();
  pending.forEach((callback) => callback(wallTime));
}
function advanceTo(target: number) {
  expect(typeof animationTime).toBe("number");
  while (animationTime! < target) tick(Math.min(target, animationTime! + 40));
}
function expectCleared() {
  expect(active()).toHaveLength(0);
  expect(rocks().every((rock) => Number(rock.style.opacity) === 0)).toBe(true);
}
async function beginImpact() {
  planner.next.mockImplementation((now: number) =>
    encounter(planner.next.mock.calls.length - 1, now, { duration: 20_000 }),
  );
  await mount();
  advanceTo(8_800);
  pulse.y = 80;
  tick(8_840);
  expect(effects.sound).toHaveBeenCalledOnce();
  expect(active()).toHaveLength(2);
}

beforeEach(() => {
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.append(host);
  root = null;
  animationTime = wallTime = 0;
  visibility = "visible";
  reduced = false;
  laneHeight = 220;
  fieldWidth = 240;
  portfolioBottom = 370;
  navBottom = 300;
  pulse = { x: 120, y: 210 };
  positions = new Map([
    [0, { x: 120, y: 80 }],
    [1, { x: 200, y: 120 }],
  ]);
  frames = new Map();
  nextFrame = 0;
  visualCancels = [];
  soundCancels = [];
  resizeObserve = vi.fn();
  resizeDisconnect = vi.fn();
  intersectionDisconnect = vi.fn();
  removeMotionListener = vi.fn();
  planner.create.mockImplementation(() => planner.next);
  planner.createSchedule.mockImplementation(() => planner.schedule);
  planner.schedule.mockImplementation(
    (primary: AsteroidEncounter) => primary.start + 4_000,
  );
  planner.next.mockImplementation((now: number) => {
    const index = planner.next.mock.calls.length - 1;
    return encounter(index, now, { duration: index === 0 ? 8_000 : 6_000 });
  });
  planner.position.mockImplementation(
    (e: AsteroidEncounter) => positions.get(e.index) ?? { x: 200, y: 120 },
  );
  effects.visual.mockImplementation(() => {
    const cancel = vi.fn();
    visualCancels.push(cancel);
    return cancel;
  });
  effects.sound.mockImplementation(() => {
    const cancel = vi.fn();
    soundCancels.push(cancel);
    return cancel;
  });
  vi.spyOn(performance, "now").mockImplementation(() => wallTime);
  vi.spyOn(document, "visibilityState", "get").mockImplementation(
    () => visibility,
  );
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.hasAttribute("data-asteroid-field") ? fieldWidth : 280;
    },
  );
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.classList.contains("signalLine") ? laneHeight : 220;
    },
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      if (this.classList.contains("sidebar")) return rect(0, 0, 280, 900);
      if (this.classList.contains("portfolio-nav"))
        return rect(12, 120, 256, portfolioBottom - 120);
      if (this.hasAttribute("data-navigation"))
        return rect(0, 100, 280, navBottom - 100);
      if (this.classList.contains("signalPulse"))
        return rect(20 + pulse.x - 2, 340 + pulse.y, 4, 20);
      if (this.hasAttribute("data-asteroid-field"))
        return rect(20, 340, fieldWidth, laneHeight);
      return rect(20, 340, 240, laneHeight);
    },
  );
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
      observe = resizeObserve;
      disconnect = resizeDisconnect;
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
                width: visible ? fieldWidth : 0,
                height: visible ? laneHeight : 0,
              },
            },
          ]);
      }
      observe() {}
      disconnect = intersectionDisconnect;
    },
  );
  vi.stubGlobal("matchMedia", () => ({
    get matches() {
      return reduced;
    },
    addEventListener(_type: string, callback: () => void) {
      motionChange = callback;
    },
    removeEventListener: removeMotionListener,
  }));
  Object.defineProperty(HTMLElement.prototype, "getAnimations", {
    configurable: true,
    value: () =>
      animationTime === null ? [] : [{ currentTime: animationTime }],
  });
});
afterEach(async () => {
  if (root) await act(() => root!.unmount());
  host.remove();
  delete (HTMLElement.prototype as unknown as Record<string, unknown>)
    .getAnimations;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("paired sidebar asteroid lifecycle", () => {
  it("uses two fixed slots and unique local SVG definitions with a single planner and RAF", async () => {
    await mount();
    expect(rocks()).toHaveLength(2);
    const ids = [...host.querySelectorAll<SVGElement>("svg [id]")].map(
      (el) => el.id,
    );
    expect(ids.length).toBeGreaterThan(2);
    expect(new Set(ids).size).toBe(ids.length);
    for (const rock of rocks()) {
      const ownIds = new Set(
        [...rock.querySelectorAll("[id]")].map((el) => el.id),
      );
      for (const el of rock.querySelectorAll("[fill]")) {
        const match = el.getAttribute("fill")?.match(/^url\(#(.+)\)$/);
        if (match) expect(ownIds.has(match[1])).toBe(true);
      }
    }
    expect(frames.size).toBe(1);
    advanceTo(4_000);
    expect(planner.create).toHaveBeenCalledOnce();
    expect(planner.next).toHaveBeenCalledOnce();
    expect(rocks()[0].dataset.encounter).toBe("0");
    expect(rocks()[1].dataset.encounter).toBeUndefined();
    expect(rocks()[0].dataset.active).toBe("true");
    expect(rocks()[1].dataset.active).toBe("false");
    resize();
    intersect(true);
    advanceTo(8_040);
    expect(active()).toHaveLength(2);
    expect(frames.size).toBe(1);
    expect(planner.next).toHaveBeenCalledTimes(2);
    expect(planner.next.mock.calls[1][0]).toBe(8_000);
    expect(rocks()[1].dataset.encounter).toBe("1");
    expect(planner.createSchedule).toHaveBeenCalledOnce();
    expect(planner.schedule).toHaveBeenCalledOnce();
  });

  it("fades each rock on its own clock and keeps the companion alive after the primary ends", async () => {
    await mount();
    advanceTo(4_200);
    expect(Number(rocks()[0].style.opacity)).toBeGreaterThan(0);
    expect(Number(rocks()[1].style.opacity)).toBe(0);
    advanceTo(8_400);
    expect(Number(rocks()[0].style.opacity)).toBeGreaterThan(
      Number(rocks()[1].style.opacity),
    );
    advanceTo(12_040);
    expect(rocks()[0].dataset.active).toBe("false");
    expect(Number(rocks()[0].style.opacity)).toBe(0);
    expect(rocks()[1].dataset.active).toBe("true");
    expect(Number(rocks()[1].style.opacity)).toBeGreaterThan(0);
    expect(planner.next).toHaveBeenCalledTimes(2);
    advanceTo(14_040);
    expectCleared();
    expect(effects.sound).not.toHaveBeenCalled();
  });

  it("does not consume a scheduled companion while hidden or replay it on resume", async () => {
    await mount();
    advanceTo(4_400);
    expect(planner.next).toHaveBeenCalledOnce();
    expect(planner.schedule).toHaveBeenCalledOnce();
    visibility = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    animationTime = wallTime = 30_000;
    expect(frames.size).toBe(0);
    expectCleared();
    expect(planner.next).toHaveBeenCalledOnce();
    visibility = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    advanceTo(33_960);
    expect(planner.next).toHaveBeenCalledOnce();
    advanceTo(34_040);
    expect(planner.next).toHaveBeenCalledTimes(2);
    expect(planner.next.mock.calls[1][0]).toBe(34_000);
    expect(planner.schedule).toHaveBeenCalledTimes(2);
    expect(active()).toHaveLength(1);
  });

  it("does not let the companion's natural end cancel the primary's physical impact", async () => {
    planner.next.mockImplementation((now: number) => {
      const index = planner.next.mock.calls.length - 1;
      return encounter(index, now, { duration: index === 0 ? 20_000 : 2_000 });
    });
    await mount();
    advanceTo(8_800);
    pulse.y = 80;
    tick(8_840);
    expect(effects.sound).toHaveBeenCalledWith(false);
    expect(rocks()[0].dataset.impact).toBe("true");
    expect(Number(rocks()[0].dataset.impactTime)).toBe(8_840);
    advanceTo(10_040);
    expect(rocks()[1].dataset.active).toBe("false");
    expect(rocks()[0].dataset.active).toBe("true");
    expect(soundCancels[0]).not.toHaveBeenCalled();
    expect(visualCancels[0]).not.toHaveBeenCalled();
    advanceTo(13_880);
    expect(soundCancels[0]).toHaveBeenCalledOnce();
    expect(visualCancels[0]).toHaveBeenCalledOnce();
    expectCleared();
  });

  it("requires actual swept contact even for a planned impact and allows contact on a planned miss", async () => {
    positions.set(0, { x: 200, y: 80 });
    positions.set(1, { x: 120, y: 120 });
    planner.next.mockImplementation((now: number) => {
      const index = planner.next.mock.calls.length - 1;
      return encounter(index, now, {
        duration: 20_000,
        gold: index === 1,
        impact: index === 0,
      });
    });
    await mount();
    advanceTo(8_400);
    expect(rocks()[0].dataset.collision).toBe("true");
    expect(effects.sound).not.toHaveBeenCalled();
    pulse.y = 80;
    tick(8_440);
    pulse.y = 160;
    tick(8_480);
    expect(rocks()[0].dataset.impact).toBe("false");
    expect(rocks()[1].dataset.collision).toBe("false");
    expect(rocks()[1].dataset.impact).toBe("true");
    expect(Number(rocks()[1].dataset.impactDistance)).toBeLessThan(0.001);
    expect(effects.sound).toHaveBeenCalledExactlyOnceWith(true);
    expect(effects.visual).toHaveBeenCalledWith(
      host.querySelector(".sidebar"),
      { x: 140, y: 460 },
      true,
    );
  });

  it("lets a late physical impact finish its five seconds after the flight path ends", async () => {
    planner.next.mockImplementation((now: number) => {
      const index = planner.next.mock.calls.length - 1;
      return encounter(index, now, { duration: index === 0 ? 6_000 : 20_000 });
    });
    await mount();
    advanceTo(9_800);
    pulse.y = 80;
    tick(9_840);
    expect(effects.sound).toHaveBeenCalledOnce();
    advanceTo(10_040);
    expect(rocks()[0].dataset.active).toBe("true");
    expect(rocks()[0].dataset.impact).toBe("true");
    expect(soundCancels[0]).not.toHaveBeenCalled();
    advanceTo(14_880);
    expect(rocks()[0].dataset.active).toBe("false");
    expect(soundCancels[0]).toHaveBeenCalledOnce();
    expect(rocks()[1].dataset.active).toBe("true");
  });

  it("ending one impact does not cancel the other rock's newer impact", async () => {
    planner.next.mockImplementation((now: number) =>
      encounter(planner.next.mock.calls.length - 1, now, { duration: 20_000 }),
    );
    positions.set(1, { x: 120, y: 120 });
    await mount();
    advanceTo(4_800);
    pulse.y = 80;
    tick(4_840);
    advanceTo(8_800);
    pulse.y = 120;
    tick(8_840);
    expect(effects.sound).toHaveBeenCalledTimes(2);
    advanceTo(9_880);
    expect(soundCancels[0]).toHaveBeenCalledOnce();
    expect(visualCancels[0]).toHaveBeenCalledOnce();
    expect(soundCancels[1]).not.toHaveBeenCalled();
    expect(visualCancels[1]).not.toHaveBeenCalled();
    expect(rocks()[0].dataset.active).toBe("false");
    expect(rocks()[1].dataset.impact).toBe("true");
    visibility = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    expect(soundCancels[0]).toHaveBeenCalledOnce();
    expect(soundCancels[1]).toHaveBeenCalledOnce();
    expect(visualCancels[1]).toHaveBeenCalledOnce();
  });

  it("does not collide with an invisible projectile or stale sweep across a resize", async () => {
    await mount();
    advanceTo(4_400);
    const head = host.querySelector<HTMLElement>(".signalPulse")!;
    head.style.opacity = "0";
    pulse.y = 80;
    tick(4_440);
    expect(effects.sound).not.toHaveBeenCalled();
    head.style.opacity = "1";
    pulse.y = 40;
    tick(4_480);
    resize();
    pulse.y = 120;
    tick(4_520);
    expect(effects.sound).not.toHaveBeenCalled();
    expect(planner.next).toHaveBeenCalledOnce();
    expect(active()).toHaveLength(1);
  });

  it("retains portfolio scroll measurement and observes the real layout anchors", async () => {
    await mount();
    const beacon = host.querySelector<HTMLElement>(".signalBeacon")!;
    expect(beacon.style.getPropertyValue("--signal-rise")).toBe("68px");
    const observed = resizeObserve.mock.calls.map(([element]) => element);
    for (const element of [
      field(),
      host.querySelector(".signalLine"),
      beacon,
      host.querySelector(".sidebar"),
      host.querySelector(".portfolio-nav"),
      host.querySelector("[data-navigation]"),
    ]) {
      expect(observed).toContain(element);
    }
    advanceTo(8_800);
    portfolioBottom = 260;
    host.querySelector("[data-navigation]")!.dispatchEvent(new Event("scroll"));
    expect(beacon.style.getPropertyValue("--signal-rise")).toBe("108px");
    expect(active()).toHaveLength(2);
    expect(planner.next).toHaveBeenCalledTimes(2);
  });

  it.each([
    "hidden",
    "reduced",
    "offscreen",
    "short lane",
    "narrow field",
  ] as const)(
    "clears every rock and impact while %s, then waits for a fresh passage",
    async (gate) => {
      await beginImpact();
      const setGate = (enabled: boolean) => {
        if (gate === "hidden") {
          visibility = enabled ? "hidden" : "visible";
          document.dispatchEvent(new Event("visibilitychange"));
        }
        if (gate === "reduced") {
          reduced = enabled;
          motionChange();
        }
        if (gate === "offscreen") intersect(!enabled);
        if (gate === "short lane") {
          laneHeight = enabled ? 104 : 220;
          resize();
        }
        if (gate === "narrow field") {
          fieldWidth = enabled ? 79 : 240;
          resize();
        }
      };
      setGate(true);
      expectCleared();
      expect(frames.size).toBe(0);
      expect(soundCancels[0]).toHaveBeenCalledOnce();
      expect(visualCancels[0]).toHaveBeenCalledOnce();
      animationTime = 30_000;
      wallTime += 21_160;
      expect(planner.next).toHaveBeenCalledTimes(2);
      setGate(false);
      advanceTo(33_960);
      expectCleared();
      expect(planner.next).toHaveBeenCalledTimes(2);
      expect(effects.sound).toHaveBeenCalledOnce();
      advanceTo(34_040);
      expect(planner.next).toHaveBeenCalledTimes(3);
      expect(frames.size).toBe(1);
    },
  );

  it.each(["missing", "backward"] as const)(
    "resets a %s authoritative clock without catching up old encounters or sounds",
    async (fault) => {
      await beginImpact();
      const resumeTime = fault === "backward" ? 100 : 30_000;
      tick(fault === "missing" ? null : resumeTime);
      expectCleared();
      expect(soundCancels[0]).toHaveBeenCalledOnce();
      expect(visualCancels[0]).toHaveBeenCalledOnce();
      if (fault === "missing") tick(resumeTime);
      advanceTo(resumeTime + 3_960);
      expect(planner.next).toHaveBeenCalledTimes(2);
      expect(effects.sound).toHaveBeenCalledOnce();
      advanceTo(resumeTime + 4_080);
      expect(planner.next).toHaveBeenCalledTimes(3);
    },
  );

  it.each([250, 1_500])(
    "preserves both absolute-time trajectories and the full impact lifetime after a %i ms forward stall",
    async (gap) => {
      planner.position.mockImplementation(
        (e: AsteroidEncounter, time: number) =>
          e.index === 1
            ? { x: 180 + (time - e.start) / 1_000, y: 120 }
            : positions.get(e.index),
      );
      await beginImpact();
      const firstImpact = rocks()[0].dataset.impactTime;
      const stalledTime = 8_840 + gap;
      tick(stalledTime, wallTime + gap);
      expect(active()).toHaveLength(2);
      expect(rocks().map((rock) => rock.dataset.encounter)).toEqual(["0", "1"]);
      expect(rocks()[0].dataset.impactTime).toBe(firstImpact);
      expect(rocks()[1].style.transform).toBe(
        `translate(${180 + (stalledTime - 8_000) / 1_000}px, 120px)`,
      );
      expect(soundCancels[0]).not.toHaveBeenCalled();
      expect(visualCancels[0]).not.toHaveBeenCalled();
      expect(effects.sound).toHaveBeenCalledOnce();
      expect(planner.next).toHaveBeenCalledTimes(2);
      advanceTo(13_839);
      expect(rocks()[0].dataset.active).toBe("true");
      expect(soundCancels[0]).not.toHaveBeenCalled();
      expect(visualCancels[0]).not.toHaveBeenCalled();
      tick(13_879);
      expect(rocks()[0].dataset.active).toBe("false");
      expect(rocks()[1].dataset.active).toBe("true");
      expect(soundCancels[0]).toHaveBeenCalledOnce();
      expect(visualCancels[0]).toHaveBeenCalledOnce();
    },
  );

  it("drops a stale companion opportunity across a forward stall without consuming its encounter", async () => {
    await mount();
    advanceTo(7_960);
    expect(planner.next).toHaveBeenCalledOnce();
    tick(8_160, wallTime + 200);
    expect(rocks()[0].dataset.active).toBe("true");
    expect(rocks()[0].dataset.encounter).toBe("0");
    expect(rocks()[1].dataset.active).toBe("false");
    expect(planner.next).toHaveBeenCalledOnce();
    advanceTo(9_000);
    expect(planner.next).toHaveBeenCalledOnce();
    expect(planner.schedule).toHaveBeenCalledOnce();
    expect(effects.sound).not.toHaveBeenCalled();
  });

  it("never sweeps the projectile across a forward gap for either active rock", async () => {
    positions.set(1, { x: 120, y: 150 });
    await mount();
    advanceTo(8_400);
    expect(active()).toHaveLength(2);
    pulse.y = 20;
    tick(8_600, wallTime + 200);
    expect(active()).toHaveLength(2);
    expect(rocks().every((rock) => rock.dataset.impact === "false")).toBe(true);
    expect(effects.sound).not.toHaveBeenCalled();
    expect(effects.visual).not.toHaveBeenCalled();
    pulse.y = 80;
    tick(8_640);
    expect(rocks()[0].dataset.impact).toBe("true");
    expect(rocks()[1].dataset.impact).toBe("false");
    expect(effects.sound).toHaveBeenCalledOnce();
  });

  it("rebases an idle forward stall for four seconds instead of catching up an overdue passage", async () => {
    await mount();
    advanceTo(3_960);
    tick(8_000, wallTime + 4_040);
    expectCleared();
    expect(planner.next).not.toHaveBeenCalled();
    advanceTo(11_960);
    expect(planner.next).not.toHaveBeenCalled();
    advanceTo(12_040);
    expect(planner.next).toHaveBeenCalledOnce();
    expect(planner.next.mock.calls[0][0]).toBe(12_000);
  });

  it("cancels active FX, RAF and observers on unmount and ignores later lifecycle events", async () => {
    await beginImpact();
    await act(() => root!.unmount());
    root = null;
    expect(frames.size).toBe(0);
    expect(soundCancels[0]).toHaveBeenCalledOnce();
    expect(visualCancels[0]).toHaveBeenCalledOnce();
    expect(resizeDisconnect).toHaveBeenCalledOnce();
    expect(intersectionDisconnect).toHaveBeenCalledOnce();
    expect(removeMotionListener).toHaveBeenCalled();
    visibility = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    expect(soundCancels[0]).toHaveBeenCalledOnce();
    expect(planner.next).toHaveBeenCalledTimes(2);
  });
});
