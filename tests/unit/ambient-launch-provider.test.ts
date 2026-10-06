// @vitest-environment jsdom
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AmbientRadio,
  AmbientRadioControls,
  useAsteroidImpactSound,
  useBlastLaunchSound,
} from "@/components/AmbientRadio";
import type { AmbientState } from "@/lib/ambient-audio";

const audio = vi.hoisted(() => ({
  emit: (_state: AmbientState) => {},
  created: vi.fn(),
  play: vi.fn(),
  pause: vi.fn(),
  dispose: vi.fn(),
  volume: vi.fn(),
  launch: vi.fn(),
  cancelLaunch: vi.fn(),
  stopLaunch: vi.fn(),
  impact: vi.fn(),
  cancelImpact: vi.fn(),
  stopImpact: vi.fn(),
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
    playLaunch = audio.launch;
    cancelLaunch = audio.cancelLaunch;
    playImpact = audio.impact;
    cancelImpact = audio.cancelImpact;
  },
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
type Launch = () => () => void;
let root: Root | null;
let host: HTMLDivElement;
let visibility: DocumentVisibilityState;
let callbacks: Launch[];
let cancelLastLaunch: (() => void) | undefined;
let cancelLastImpact: (() => void) | undefined;
function Consumer() {
  const launch = useBlastLaunchSound();
  const impact = useAsteroidImpactSound();
  callbacks.push(launch);
  return createElement(
    Fragment,
    null,
    createElement(
      "button",
      {
        onClick: () => {
          cancelLastLaunch = launch();
        },
      },
      "Launch",
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
  audio.launch.mockImplementation(() => audio.stopLaunch);
  audio.impact.mockImplementation(() => audio.stopImpact);
  localStorage.clear();
  sessionStorage.clear();
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(
    () => visibility,
  );
  callbacks = [];
  cancelLastLaunch = cancelLastImpact = undefined;
  host = document.createElement("div");
  document.body.append(host);
});
afterEach(async () => {
  if (root) await act(() => root!.unmount());
  root = null;
  host.remove();
  vi.restoreAllMocks();
});

describe("blast launch provider boundary", () => {
  it("has a safe no-op outside a provider and never opts into audio from a launch", async () => {
    await mount(false);
    await click("Launch");
    expect(cancelLastLaunch).toBeTypeOf("function");
    expect(() => cancelLastLaunch!()).not.toThrow();
    await act(() => root!.unmount());
    root = null;
    await mount();
    await click("Launch");
    await setVisibility("hidden");
    await setVisibility("visible");
    await click("Launch");
    expect(audio.created).not.toHaveBeenCalled();
    expect(audio.play).not.toHaveBeenCalled();
    expect(audio.launch).not.toHaveBeenCalled();
  });

  it("dispatches overlapping effects through the confirmed player with separate caller cancellations", async () => {
    await mount();
    await click("Play space radio");
    await emit("starting");
    await click("Launch");
    expect(audio.launch).not.toHaveBeenCalled();
    await emit("playing");
    expect(audio.launch).not.toHaveBeenCalled();
    await click("Gold impact");
    await click("Launch");
    expect(audio.impact).toHaveBeenCalledWith(true);
    expect(audio.launch).toHaveBeenCalledWith();
    cancelLastLaunch!();
    expect(audio.stopLaunch).toHaveBeenCalledOnce();
    expect(audio.stopImpact).not.toHaveBeenCalled();
    expect(audio.cancelImpact).not.toHaveBeenCalled();
    cancelLastImpact!();
    expect(audio.stopImpact).toHaveBeenCalledOnce();
    expect(audio.stopLaunch).toHaveBeenCalledOnce();
    expect(audio.created).toHaveBeenCalledOnce();
    expect(audio.play).toHaveBeenCalledOnce();
    expect(audio.pause).not.toHaveBeenCalled();
    expect(audio.dispose).not.toHaveBeenCalled();
  });

  it.each(["starting", "pausing", "paused", "suspended", "error"] as const)(
    "blocks a launch while the radio is %s without allocating or attempting recovery",
    async (state) => {
      await mount();
      await click("Play space radio");
      await emit(state);
      await click("Launch");
      expect(() => cancelLastLaunch!()).not.toThrow();
      expect(audio.launch).not.toHaveBeenCalled();
      expect(audio.created).toHaveBeenCalledOnce();
      expect(audio.play).toHaveBeenCalledOnce();
    },
  );

  it("gates a retained callback with current volume and does not replay launches after unmute", async () => {
    await mount();
    await click("Play space radio");
    await emit("playing");
    const retained = callbacks.at(-1)!;
    await click("Show space radio controls");
    await volume("0");
    retained()();
    expect(audio.volume).toHaveBeenLastCalledWith(0);
    expect(audio.launch).not.toHaveBeenCalled();
    await volume("40");
    expect(audio.launch).not.toHaveBeenCalled();
    retained();
    expect(audio.launch).toHaveBeenCalledOnce();
    expect(audio.play).toHaveBeenCalledOnce();
  });

  it("cancels both FX on hide while preserving music, and does not queue hidden launches", async () => {
    await mount();
    await click("Play space radio");
    await emit("playing");
    await click("Launch");
    await click("Gold impact");
    const retained = callbacks.at(-1)!;
    const launchesBefore = audio.cancelLaunch.mock.calls.length;
    const impactsBefore = audio.cancelImpact.mock.calls.length;
    await setVisibility("hidden");
    expect(audio.cancelLaunch.mock.calls.length).toBeGreaterThan(
      launchesBefore,
    );
    expect(audio.cancelImpact.mock.calls.length).toBeGreaterThan(impactsBefore);
    retained()();
    expect(audio.launch).toHaveBeenCalledOnce();
    expect(audio.pause).not.toHaveBeenCalled();
    expect(audio.dispose).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Playing");
    await setVisibility("visible");
    expect(audio.launch).toHaveBeenCalledOnce();
    expect(audio.impact).toHaveBeenCalledOnce();
    expect(audio.play).toHaveBeenCalledOnce();
    retained();
    expect(audio.launch).toHaveBeenCalledTimes(2);
  });

  it("checks current visibility before a delayed visibility event", async () => {
    await mount();
    await click("Play space radio");
    await emit("playing");
    visibility = "hidden";
    await click("Launch");
    expect(audio.launch).not.toHaveBeenCalled();
    expect(audio.play).toHaveBeenCalledOnce();
  });

  it("preserves hook identity and gates retained callbacks across radio rerenders", async () => {
    await mount();
    const retained = callbacks[0];
    await click("Play space radio");
    await emit("starting");
    await emit("playing");
    retained();
    expect(audio.launch).toHaveBeenCalledOnce();
    await click("Show space radio controls");
    await volume("0");
    await volume("70");
    await setVisibility("hidden");
    await setVisibility("visible");
    await emit("pausing");
    await emit("paused");
    await emit("error");
    retained()();
    expect(audio.launch).toHaveBeenCalledOnce();
    expect(callbacks.length).toBeGreaterThan(5);
    expect(callbacks.every((callback) => callback === retained)).toBe(true);
  });

  it.each(["pagehide", "unmount"] as const)(
    "does not revive the disposed player through a retained launch callback after %s",
    async (exit) => {
      await mount();
      await click("Play space radio");
      await emit("playing");
      const retained = callbacks.at(-1)!;
      if (exit === "pagehide") {
        await act(() => window.dispatchEvent(new Event("pagehide")));
      } else {
        await act(() => root!.unmount());
        root = null;
      }
      expect(audio.dispose).toHaveBeenCalledOnce();
      expect(() => retained()()).not.toThrow();
      expect(audio.launch).not.toHaveBeenCalled();
      expect(audio.created).toHaveBeenCalledOnce();
      expect(audio.play).toHaveBeenCalledOnce();
    },
  );
});
