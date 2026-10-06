// @vitest-environment jsdom
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AmbientRadio,
  AmbientRadioControls,
  useAsteroidImpactSound,
} from "@/components/AmbientRadio";
import type { AmbientState } from "@/lib/ambient-audio";

const audio = vi.hoisted(() => ({
  emit: (_state: AmbientState) => {},
  created: vi.fn(),
  play: vi.fn(),
  pause: vi.fn(),
  dispose: vi.fn(),
  volume: vi.fn(),
  impact: vi.fn(),
  cancelImpact: vi.fn(),
  stopImpact: vi.fn(),
  launch: vi.fn(() => () => {}),
  cancelLaunch: vi.fn(),
}));
vi.mock("@/lib/ambient-audio", () => ({
  initialAmbientVolume: 0.2,
  AmbientAudio: class {
    constructor(emit: (state: AmbientState) => void) {
      audio.created();
      audio.emit = emit;
    }
    play = audio.play;
    pause = audio.pause;
    dispose = audio.dispose;
    setVolume = audio.volume;
    playImpact = audio.impact;
    cancelImpact = audio.cancelImpact;
    playLaunch = audio.launch;
    cancelLaunch = audio.cancelLaunch;
  },
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
type Impact = (gold: boolean) => () => void;
let root: Root | null;
let host: HTMLDivElement;
let visibility: DocumentVisibilityState;
let callbacks: Impact[];
let cancelLastImpact: (() => void) | undefined;
function Consumer() {
  const impact = useAsteroidImpactSound();
  callbacks.push(impact);
  return createElement(
    Fragment,
    null,
    createElement(
      "button",
      {
        onClick: () => {
          cancelLastImpact = impact(false);
        },
      },
      "Normal impact",
    ),
    createElement(
      "button",
      {
        onClick: () => {
          cancelLastImpact = impact(true);
        },
      },
      "Gold impact",
    ),
  );
}
const button = (label: string) => {
  const found = [...host.querySelectorAll("button")].find(
    (b) => (b.getAttribute("aria-label") ?? b.textContent) === label,
  );
  expect(found, label).toBeDefined();
  return found!;
};
const click = async (label: string) => {
  await act(() => button(label).click());
};
const emit = async (state: AmbientState) => {
  await act(() => audio.emit(state));
};
async function volume(value: string) {
  const input = host.querySelector<HTMLInputElement>(
    '[aria-label="Space radio volume"]',
  )!;
  await act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function setVisibility(next: DocumentVisibilityState) {
  await act(() => {
    visibility = next;
    document.dispatchEvent(new Event("visibilitychange"));
  });
}
async function mount(provider = true) {
  await act(() => {
    root = createRoot(host);
    root.render(
      provider
        ? createElement(AmbientRadio, {
            children: createElement(
              Fragment,
              null,
              createElement(Consumer),
              createElement(AmbientRadioControls),
            ),
          })
        : createElement(Consumer),
    );
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  audio.impact.mockImplementation(() => audio.stopImpact);
  localStorage.clear();
  sessionStorage.clear();
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(
    () => visibility,
  );
  callbacks = [];
  cancelLastImpact = undefined;
  host = document.createElement("div");
  document.body.append(host);
});
afterEach(async () => {
  if (root) await act(() => root!.unmount());
  root = null;
  host.remove();
  vi.restoreAllMocks();
});

describe("asteroid impact provider boundary", () => {
  it("returns safe cancellations without creating or playing audio before opt-in, even outside a provider", async () => {
    await mount(false);
    await click("Gold impact");
    expect(cancelLastImpact).toBeTypeOf("function");
    expect(() => cancelLastImpact!()).not.toThrow();
    await act(() => root!.unmount());
    root = null;
    await mount();
    await click("Normal impact");
    await click("Gold impact");
    await setVisibility("hidden");
    await setVisibility("visible");
    expect(audio.created).not.toHaveBeenCalled();
    expect(audio.play).not.toHaveBeenCalled();
    expect(audio.impact).not.toHaveBeenCalled();
  });

  it("passes normal/gold impacts and caller cancellation to the existing confirmed player", async () => {
    await mount();
    await click("Play space radio");
    await emit("starting");
    await click("Gold impact");
    expect(audio.impact).not.toHaveBeenCalled();
    await emit("playing");
    await click("Normal impact");
    expect(audio.impact).toHaveBeenLastCalledWith(false);
    await click("Gold impact");
    expect(audio.impact).toHaveBeenLastCalledWith(true);
    cancelLastImpact!();
    expect(audio.stopImpact).toHaveBeenCalledOnce();
    expect(audio.created).toHaveBeenCalledOnce();
    expect(audio.play).toHaveBeenCalledOnce();
    expect(audio.pause).not.toHaveBeenCalled();
    expect(audio.dispose).not.toHaveBeenCalled();
  });

  it.each(["starting", "pausing", "paused", "suspended", "error"] as const)(
    "blocks the hook while the radio is %s without attempting recovery",
    async (state) => {
      await mount();
      await click("Play space radio");
      await emit(state);
      await click("Gold impact");
      expect(audio.impact).not.toHaveBeenCalled();
      expect(audio.created).toHaveBeenCalledOnce();
      expect(audio.play).toHaveBeenCalledOnce();
    },
  );

  it("blocks muted impacts and does not replay them when volume rises", async () => {
    await mount();
    await click("Play space radio");
    await emit("playing");
    await click("Show space radio controls");
    await volume("0");
    await click("Gold impact");
    expect(audio.volume).toHaveBeenLastCalledWith(0);
    expect(audio.impact).not.toHaveBeenCalled();
    await volume("40");
    expect(audio.impact).not.toHaveBeenCalled();
    await click("Normal impact");
    expect(audio.impact).toHaveBeenCalledOnce();
    expect(audio.created).toHaveBeenCalledOnce();
    expect(audio.play).toHaveBeenCalledOnce();
  });

  it("cancels only FX on document hide and preserves the playing music across visibility changes", async () => {
    await mount();
    await click("Play space radio");
    await emit("playing");
    await click("Gold impact");
    const cancelsBefore = audio.cancelImpact.mock.calls.length;
    await setVisibility("hidden");
    expect(audio.cancelImpact.mock.calls.length).toBeGreaterThan(cancelsBefore);
    await click("Normal impact");
    expect(audio.impact).toHaveBeenCalledOnce();
    expect(audio.pause).not.toHaveBeenCalled();
    expect(audio.dispose).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Playing");
    await setVisibility("visible");
    expect(audio.impact).toHaveBeenCalledOnce();
    expect(audio.play).toHaveBeenCalledOnce();
    await click("Normal impact");
    expect(audio.impact).toHaveBeenCalledTimes(2);
  });

  it("checks current document visibility even before a visibility event is delivered", async () => {
    await mount();
    await click("Play space radio");
    await emit("playing");
    visibility = "hidden";
    await click("Gold impact");
    expect(audio.impact).not.toHaveBeenCalled();
    expect(audio.play).toHaveBeenCalledOnce();
  });

  it("keeps one hook callback identity across state, volume and visibility rerenders", async () => {
    await mount();
    const initial = callbacks[0];
    await click("Play space radio");
    await emit("starting");
    await emit("playing");
    await click("Show space radio controls");
    await volume("0");
    await volume("70");
    await setVisibility("hidden");
    await setVisibility("visible");
    await emit("pausing");
    await emit("paused");
    await emit("error");
    expect(callbacks.length).toBeGreaterThan(5);
    expect(callbacks.every((callback) => callback === initial)).toBe(true);
  });

  it("does not allocate or restart audio through retained callbacks after pagehide or unmount", async () => {
    await mount();
    await click("Play space radio");
    await emit("playing");
    const retained = callbacks.at(-1)!;
    await act(() => window.dispatchEvent(new Event("pagehide")));
    expect(audio.dispose).toHaveBeenCalledOnce();
    expect(() => retained(true)()).not.toThrow();
    expect(audio.impact).not.toHaveBeenCalled();
    await act(() => root!.unmount());
    root = null;
    expect(() => retained(false)()).not.toThrow();
    expect(audio.created).toHaveBeenCalledOnce();
    expect(audio.play).toHaveBeenCalledOnce();
  });
});
