// @vitest-environment jsdom
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  AmbientRadio,
  AmbientRadioControls,
  AmbientRadioOrb,
  DialogRadioControl,
} from "@/components/AmbientRadio";
import type { AmbientState } from "@/lib/ambient-audio";

const audio = vi.hoisted(() => ({
  emit: (_state: AmbientState) => {},
  created: vi.fn(),
  play: vi.fn(),
  pause: vi.fn(),
  dispose: vi.fn(),
  volume: vi.fn(),
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
  },
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | null;
let host: HTMLDivElement;
let visibility: DocumentVisibilityState;
const orbits = () => [
  ...host.querySelectorAll<HTMLElement>("[data-radio-orbit]"),
];
const button = (name: string) =>
  host.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;
const click = async (name: string) => act(() => button(name).click());
const state = async (value: AmbientState) => act(() => audio.emit(value));

beforeEach(async () => {
  vi.clearAllMocks();
  localStorage.clear();
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(
    () => visibility,
  );
  host = document.createElement("div");
  document.body.append(host);
  await act(() => {
    root = createRoot(host);
    root.render(
      createElement(AmbientRadio, {
        children: createElement(
          Fragment,
          null,
          createElement(AmbientRadioControls),
          createElement(DialogRadioControl),
        ),
      }),
    );
  });
});
afterEach(async () => {
  await act(() => root?.unmount());
  host.remove();
  vi.restoreAllMocks();
});

it("never starts audio on mount or expand and keeps one shared emblem identity", async () => {
  expect(audio.created).not.toHaveBeenCalled();
  expect(orbits()).toHaveLength(1);
  expect(button("Play space radio")).toBeTruthy();
  await click("Show space radio controls");
  expect(orbits()).toHaveLength(2);
  expect(audio.play).not.toHaveBeenCalled();
  expect(document.activeElement?.getAttribute("aria-label")).toBe(
    "Space radio volume",
  );
  for (const orbit of orbits()) {
    expect(orbit.dataset.playing).toBe("false");
    expect(orbit.getAttribute("aria-hidden")).toBe("true");
  }
  await act(() =>
    document.activeElement!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
  expect(orbits()).toHaveLength(1);
  expect(document.activeElement).toBe(button("Show space radio controls"));
});

it("spins all emblems only for confirmed playing while retaining start cancellation", async () => {
  await click("Show space radio controls");
  await click("Play space radio");
  expect(audio.created).toHaveBeenCalledTimes(1);
  expect(audio.play).toHaveBeenCalledTimes(1);
  await state("starting");
  expect(orbits()).toHaveLength(3);
  expect(orbits().every((e) => e.dataset.playing === "false")).toBe(true);
  await click("Pause space radio");
  expect(audio.pause).toHaveBeenCalledTimes(1);
  await state("playing");
  expect(orbits().every((e) => e.dataset.playing === "true")).toBe(true);
  for (const next of ["pausing", "paused", "suspended", "error"] as const) {
    await state(next);
    expect(orbits().every((e) => e.dataset.playing === "false")).toBe(true);
    expect(button("Play space radio")).toBeTruthy();
    expect(button("Resume space radio")).toBeTruthy();
  }
  expect(host.textContent).toContain("Playback unavailable");
  await click("Resume space radio");
  expect(audio.play).toHaveBeenCalledTimes(2);
  expect(audio.created).toHaveBeenCalledTimes(1);
});

it("pauses only hidden-tab visuals, resumes them, and cleans its visibility listener", async () => {
  await click("Play space radio");
  await state("playing");
  expect(orbits().every((e) => e.dataset.motionVisible === "true")).toBe(true);
  await act(() => {
    visibility = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(orbits().every((e) => e.dataset.motionVisible === "false")).toBe(true);
  expect(orbits().every((e) => e.dataset.playing === "true")).toBe(true);
  expect(audio.pause).not.toHaveBeenCalled();
  expect(audio.dispose).not.toHaveBeenCalled();
  await act(() => {
    visibility = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(orbits().every((e) => e.dataset.motionVisible === "true")).toBe(true);
  const remove = vi.spyOn(document, "removeEventListener");
  await act(() => root!.unmount());
  root = null;
  expect(remove).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
  expect(audio.dispose).toHaveBeenCalledTimes(1);
});

it("keeps volume zero as actual Playing · Muted rather than a failed start", async () => {
  localStorage.setItem("investor-desk:ambient-volume:v1", "0");
  await act(() => root!.unmount());
  await act(() => {
    root = createRoot(host);
    root.render(
      createElement(AmbientRadio, {
        children: createElement(AmbientRadioControls),
      }),
    );
  });
  await click("Play space radio");
  await state("playing");
  expect(audio.volume).toHaveBeenLastCalledWith(0);
  expect(host.textContent).toContain("Playing · Muted");
  expect(orbits()[0].dataset.playing).toBe("true");
});

it("the homepage orb is an opt-in toggle with honest playback and failure states", async () => {
  await act(() => root!.unmount());
  await act(() => {
    root = createRoot(host);
    root.render(
      createElement(AmbientRadio, { children: createElement(AmbientRadioOrb) }),
    );
  });
  expect(audio.created).not.toHaveBeenCalled();
  expect(host.querySelectorAll("button")).toHaveLength(1);
  expect(
    host.querySelector('[aria-label="Show space radio controls"]'),
  ).toBeNull();
  expect(button("Play space radio").getAttribute("aria-pressed")).toBe("false");
  await click("Play space radio");
  await state("starting");
  expect(orbits()[0].dataset.playing).toBe("false");
  await click("Pause space radio");
  expect(audio.pause).toHaveBeenCalledTimes(1);
  await state("playing");
  expect(button("Pause space radio").getAttribute("aria-pressed")).toBe("true");
  expect(orbits()[0].dataset.playing).toBe("true");
  await state("suspended");
  expect(host.querySelector('[role="status"]')?.textContent).toContain(
    "Tap to resume",
  );
  expect(orbits()[0].dataset.playing).toBe("false");
  await state("error");
  expect(host.querySelector('[role="status"]')?.textContent).toContain(
    "Playback unavailable",
  );
  await click("Play space radio");
  expect(audio.created).toHaveBeenCalledTimes(1);
  expect(audio.play).toHaveBeenCalledTimes(2);
});

it("moving from the homepage orb to full controls preserves one player and volume", async () => {
  await act(() => root!.unmount());
  const render = (orb: boolean) => {
    root!.render(
      createElement(AmbientRadio, {
        children: orb
          ? createElement(AmbientRadioOrb)
          : createElement(AmbientRadioControls),
      }),
    );
  };
  await act(() => {
    root = createRoot(host);
    render(true);
  });
  await click("Play space radio");
  await state("playing");
  await act(() => render(false));
  expect(orbits()[0].dataset.playing).toBe("true");
  expect(audio.created).toHaveBeenCalledTimes(1);
  expect(audio.dispose).not.toHaveBeenCalled();
  await click("Show space radio controls");
  expect(host.querySelector('[aria-label="Space radio volume"]')).toBeTruthy();
  expect(host.textContent).toContain("The Long Way Home");
  await click("Pause space radio");
  expect(audio.pause).toHaveBeenCalledTimes(1);
});
