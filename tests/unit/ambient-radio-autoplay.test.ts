// @vitest-environment jsdom
import { act, createElement, Fragment, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  AmbientRadio,
  AmbientRadioControls,
  AmbientRadioOrb,
} from "@/components/AmbientRadio";
import type { AmbientState } from "@/lib/ambient-audio";

const volumeKey = "investor-desk:ambient-volume:v1";
const pausedKey = "investor-desk:ambient-paused:v1";
const audio = vi.hoisted(() => ({
  emit: (_state: AmbientState) => {},
  created: vi.fn(),
  play: vi.fn(),
  pause: vi.fn(),
  dispose: vi.fn(),
  volume: vi.fn(),
  cancelImpact: vi.fn(),
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
    cancelImpact = audio.cancelImpact;
    cancelLaunch = audio.cancelLaunch;
  },
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | null;
let host: HTMLDivElement;
let visibility: DocumentVisibilityState;
const button = (label: string) =>
  host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const click = async (label: string) => act(() => button(label).click());
const status = () => host.querySelector('[role="status"]')?.textContent;

function page(homepage: boolean, strict = false) {
  const provider = createElement(AmbientRadio, {
    children: createElement(
      Fragment,
      null,
      homepage
        ? createElement(AmbientRadioOrb, { autoPlay: true })
        : createElement(AmbientRadioControls),
      createElement("button", { "aria-label": "Explore" }, "Explore"),
    ),
  });
  return strict ? createElement(StrictMode, null, provider) : provider;
}
async function mount(homepage = true, strict = false) {
  await act(() => {
    root = createRoot(host);
    root.render(page(homepage, strict));
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  audio.play.mockImplementation(async () => audio.emit("starting"));
  audio.pause.mockImplementation(() => audio.emit("paused"));
  localStorage.clear();
  sessionStorage.clear();
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(
    () => visibility,
  );
  host = document.createElement("div");
  document.body.append(host);
});
afterEach(async () => {
  if (root) await act(() => root!.unmount());
  root = null;
  host.remove();
  vi.restoreAllMocks();
});

it("starts only for a homepage request and reads the saved volume before its first play", async () => {
  localStorage.setItem(volumeKey, "0.37");
  await mount(false);
  expect(audio.created).not.toHaveBeenCalled();
  await act(() => root!.render(page(true)));
  expect(audio.created).toHaveBeenCalledOnce();
  expect(audio.play).toHaveBeenCalledOnce();
  expect(audio.volume).toHaveBeenCalledWith(0.37);
  expect(status()).toContain("Starting");
  await act(() => audio.emit("playing"));
  await act(() => root!.render(page(false)));
  expect(status()).toContain("Playing");
  expect(audio.dispose).not.toHaveBeenCalled();
  await act(() => root!.render(page(true)));
  expect(audio.play).toHaveBeenCalledOnce();
  expect(audio.created).toHaveBeenCalledOnce();
});

it.each(["click", "keydown"] as const)(
  "retries a browser-blocked start from the first ordinary %s",
  async (gesture) => {
    audio.play.mockImplementationOnce(async () => audio.emit("suspended"));
    audio.play.mockImplementation(async () => audio.emit("playing"));
    await mount();
    expect(status()).toContain("Tap to resume");
    await act(() =>
      button("Explore").dispatchEvent(
        gesture === "click"
          ? new MouseEvent("click", { bubbles: true })
          : new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      ),
    );
    expect(audio.created).toHaveBeenCalledOnce();
    expect(audio.play).toHaveBeenCalledTimes(2);
    expect(status()).toContain("Playing");
    await click("Explore");
    expect(audio.play).toHaveBeenCalledTimes(2);
  },
);

it("uses an interaction that arrives while autoplay is still starting", async () => {
  await mount();
  expect(status()).toContain("Starting");
  audio.play.mockImplementationOnce(async () => audio.emit("playing"));
  await click("Explore");
  expect(audio.play).toHaveBeenCalledTimes(2);
  expect(status()).toContain("Playing");
});

it("lets an orb click resume exactly once and the next click pause", async () => {
  audio.play.mockImplementationOnce(async () => audio.emit("suspended"));
  audio.play.mockImplementation(async () => audio.emit("playing"));
  await mount();
  await click("Play space radio");
  expect(audio.play).toHaveBeenCalledTimes(2);
  expect(audio.pause).not.toHaveBeenCalled();
  expect(status()).toContain("Playing");
  await click("Pause space radio");
  expect(audio.pause).toHaveBeenCalledOnce();
  expect(sessionStorage.getItem(pausedKey)).toBe("true");
  await click("Explore");
  expect(audio.play).toHaveBeenCalledTimes(2);
});

it("leaves an orb's keyboard activation to its own toggle", async () => {
  audio.play.mockImplementationOnce(async () => audio.emit("suspended"));
  audio.play.mockImplementation(async () => audio.emit("playing"));
  await mount();
  await act(() => {
    const play = button("Play space radio");
    play.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    play.click();
  });
  expect(audio.play).toHaveBeenCalledTimes(2);
  expect(audio.pause).not.toHaveBeenCalled();
});

it("remembers a deliberate startup cancellation on navigation and a new provider", async () => {
  await mount();
  await click("Pause space radio");
  await act(() => root!.render(page(false)));
  await act(() => root!.render(page(true)));
  await click("Explore");
  expect(audio.play).toHaveBeenCalledOnce();
  await act(() => root!.unmount());
  root = null;
  await mount();
  expect(audio.created).toHaveBeenCalledOnce();
  expect(status()).toContain("Paused");
  await click("Explore");
  expect(audio.play).toHaveBeenCalledOnce();
  await click("Play space radio");
  expect(audio.created).toHaveBeenCalledTimes(2);
  expect(audio.play).toHaveBeenCalledTimes(2);
  expect(sessionStorage.getItem(pausedKey)).toBe("false");
});

it("respects a saved mute before autoplay and ordinary interactions", async () => {
  localStorage.setItem(volumeKey, "0");
  await mount();
  await click("Explore");
  expect(audio.created).not.toHaveBeenCalled();
  expect(audio.play).not.toHaveBeenCalled();
  await click("Play space radio");
  await act(() => audio.emit("playing"));
  expect(audio.volume).toHaveBeenLastCalledWith(0);
  expect(status()).toContain("Playing · Muted");
});

it("cleans fallback listeners on navigation and page exit without reviving audio", async () => {
  audio.play.mockImplementation(async () => audio.emit("suspended"));
  const remove = vi.spyOn(document, "removeEventListener");
  await mount();
  await act(() => root!.render(page(false)));
  await click("Explore");
  expect(audio.play).toHaveBeenCalledOnce();
  expect(remove).toHaveBeenCalledWith("click", expect.any(Function), true);
  expect(remove).toHaveBeenCalledWith("keydown", expect.any(Function), true);
  await act(() => root!.render(page(true)));
  expect(audio.play).toHaveBeenCalledTimes(2);
  await act(() => window.dispatchEvent(new Event("pagehide")));
  await click("Explore");
  expect(audio.dispose).toHaveBeenCalledOnce();
  expect(audio.created).toHaveBeenCalledOnce();
  expect(audio.play).toHaveBeenCalledTimes(2);
  await act(() => root!.unmount());
  root = null;
  await act(() => document.dispatchEvent(new MouseEvent("click")));
  expect(audio.play).toHaveBeenCalledTimes(2);
});

it("ignores hidden-tab gestures, shortcuts and repeats while awaiting activation", async () => {
  audio.play.mockImplementation(async () => audio.emit("suspended"));
  await mount();
  visibility = "hidden";
  await click("Explore");
  visibility = "visible";
  await act(() => {
    for (const options of [
      { key: "Escape" },
      { key: "Enter", repeat: true },
      { key: "l", metaKey: true },
      { key: "l", ctrlKey: true },
    ])
      button("Explore").dispatchEvent(
        new KeyboardEvent("keydown", { ...options, bubbles: true }),
      );
  });
  expect(audio.play).toHaveBeenCalledOnce();
});

it("keeps automatic playback usable when browser storage is restricted", async () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new DOMException("Denied", "SecurityError");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("Denied", "SecurityError");
  });
  audio.play.mockImplementation(async () => audio.emit("playing"));
  await mount();
  expect(audio.volume).toHaveBeenCalledWith(0.2);
  await click("Pause space radio");
  await act(() => root!.render(page(false)));
  await act(() => root!.render(page(true)));
  await click("Explore");
  expect(audio.play).toHaveBeenCalledOnce();
  expect(status()).toContain("Paused");
});

it("handles rejected starts honestly without an unhandled playback rejection", async () => {
  audio.play.mockRejectedValueOnce(new Error("Unavailable"));
  await mount();
  expect(status()).toContain("Playback unavailable");
  await click("Explore");
  expect(audio.play).toHaveBeenCalledOnce();
  await click("Play space radio");
  expect(audio.play).toHaveBeenCalledTimes(2);
});

it("retires the first Strict Mode player and leaves the replacement playable", async () => {
  audio.play.mockImplementation(async () => audio.emit("playing"));
  await mount(true, true);
  expect(audio.created).toHaveBeenCalledTimes(2);
  expect(audio.dispose).toHaveBeenCalledOnce();
  expect(status()).toContain("Playing");
  await click("Pause space radio");
  expect(audio.pause).toHaveBeenCalledOnce();
  await act(() => root!.unmount());
  root = null;
  expect(audio.dispose).toHaveBeenCalledTimes(2);
});
