// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mountLandingOrbit, type OrbitMotionState } from "@/lib/landing-orbit";

const scene = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@/lib/landing-orbit-scene", () => ({ createScene: scene.create }));
const viewer = () => ({
  render: vi.fn(),
  rotate: vi.fn(),
  resize: vi.fn(),
  dispose: vi.fn(),
});
let media: EventTarget & { matches: boolean };
let intersect: (entries: { isIntersecting: boolean }[]) => void;
let stage: HTMLDivElement;
let host: HTMLDivElement;
let controller: ReturnType<typeof mountLandingOrbit> | undefined;
let states: OrbitMotionState[];
let visibility: DocumentVisibilityState;
const visible = async () => {
  intersect([{ isIntersecting: true }]);
  await vi.dynamicImportSettled();
};
const preference = async (matches: boolean) => {
  media.matches = matches;
  media.dispatchEvent(Object.assign(new Event("change"), { matches }));
  await vi.dynamicImportSettled();
};
const mount = () => {
  controller = mountLandingOrbit(stage, host, (state) => states.push(state));
};
beforeEach(() => {
  scene.create.mockReset();
  media = Object.assign(new EventTarget(), { matches: false });
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(
    () => visibility,
  );
  vi.stubGlobal("matchMedia", () => media);
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: typeof intersect) {
        intersect = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  stage = document.createElement("div");
  host = document.createElement("div");
  stage.append(host);
  states = [];
});
afterEach(() => {
  controller?.dispose();
  controller = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("does not load under reduced motion; live preference changes dispose and restore one viewer", async () => {
  const first = viewer();
  const second = viewer();
  scene.create.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
  media.matches = true;
  mount();
  await visible();
  expect(scene.create).not.toHaveBeenCalled();
  expect(states.at(-1)).toEqual({
    label: "Motion reduced",
    paused: false,
    disabled: true,
  });
  await preference(false);
  expect(scene.create).toHaveBeenCalledTimes(1);
  expect(stage.dataset.state).toBe("ready");
  await preference(true);
  expect(first.dispose).toHaveBeenCalledTimes(1);
  expect(stage.dataset.state).toBe("static");
  await preference(false);
  expect(scene.create).toHaveBeenCalledTimes(2);
  controller!.toggle();
  expect(states.at(-1)?.label).toBe("Resume motion");
  controller!.dispose();
  controller!.dispose();
  expect(second.dispose).toHaveBeenCalledTimes(1);
});

it("a stale load and context-loss callback cannot replace a newer successful viewer", async () => {
  const stale = viewer();
  const current = viewer();
  let resolveOld!: (value: ReturnType<typeof viewer>) => void;
  scene.create.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
  );
  scene.create.mockResolvedValueOnce(current);
  mount();
  await visible();
  const oldOptions = scene.create.mock.calls[0][1];
  controller!.toggle();
  expect(oldOptions.signal.aborted).toBe(true);
  controller!.toggle();
  await vi.dynamicImportSettled();
  expect(stage.dataset.state).toBe("ready");
  resolveOld(stale);
  await vi.dynamicImportSettled();
  oldOptions.onContextLoss();
  expect(stale.dispose).toHaveBeenCalledTimes(1);
  expect(current.dispose).not.toHaveBeenCalled();
  expect(stage.dataset.state).toBe("ready");
  expect(states.at(-1)?.disabled).toBe(false);
});

it("keeps static artwork after a failed model and stops scheduling while hidden", async () => {
  const current = viewer();
  scene.create.mockResolvedValueOnce(current);
  mount();
  await visible();
  expect(requestAnimationFrame).toHaveBeenCalled();
  visibility = "hidden";
  document.dispatchEvent(new Event("visibilitychange"));
  expect(cancelAnimationFrame).toHaveBeenCalledWith(1);
  visibility = "visible";
  document.dispatchEvent(new Event("visibilitychange"));
  expect(scene.create).toHaveBeenCalledTimes(1);
  scene.create.mock.calls[0][1].onContextLoss();
  expect(stage.dataset.state).toBe("static");
  expect(states.at(-1)).toEqual({
    label: "Static artwork",
    paused: false,
    disabled: true,
  });
  document.dispatchEvent(new Event("visibilitychange"));
  await vi.dynamicImportSettled();
  expect(scene.create).toHaveBeenCalledTimes(1);
  expect(current.dispose).toHaveBeenCalledTimes(1);
});
