// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const lifecycle = vi.hoisted(() => ({ mount: vi.fn() }));
vi.mock("@/lib/landing-orbit", () => ({ mountLandingOrbit: lifecycle.mount }));
vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) =>
    createElement("img", { src, alt }),
}));
import { OrbitArtwork } from "@/components/landing/OrbitArtwork";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let host: HTMLDivElement;
const viewers: Array<{
  toggle: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
}> = [];
beforeEach(() => {
  viewers.length = 0;
  lifecycle.mount.mockReset().mockImplementation((_stage, _host, report) => {
    let paused = false;
    const publish = () =>
      report({
        label: paused ? "Resume motion" : "Pause motion",
        paused,
        disabled: false,
      });
    const viewer = {
      toggle: vi.fn(() => {
        paused = !paused;
        publish();
      }),
      dispose: vi.fn(),
    };
    viewers.push(viewer);
    publish();
    return viewer;
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(() => root.unmount());
  document.body.replaceChildren();
});

it("uses an accessible direct-art pause target with no visible button text", async () => {
  await act(() => root.render(createElement(OrbitArtwork)));
  const button = host.querySelector("button")!;
  expect(button.textContent).toBe("");
  expect(button.getAttribute("aria-label")).toBe("Pause motion");
  expect(button.closest('[aria-hidden="true"]')).toBeNull();
  expect(button.closest("[data-orbit-stage]")).not.toBeNull();
  expect(host.querySelector("img")?.alt).toBe("");
  await act(() => button.click());
  expect(viewers[0].toggle).toHaveBeenCalledTimes(1);
  expect(button.getAttribute("aria-label")).toBe("Resume motion");
  expect(button.getAttribute("aria-pressed")).toBe("true");
});

it("releases page-owned work on leave and restores one controller on bfcache return", async () => {
  await act(() => root.render(createElement(OrbitArtwork)));
  await act(() => window.dispatchEvent(new Event("pagehide")));
  expect(viewers[0].dispose).toHaveBeenCalledTimes(1);
  await act(() =>
    window.dispatchEvent(
      Object.assign(new Event("pageshow"), { persisted: false }),
    ),
  );
  expect(lifecycle.mount).toHaveBeenCalledTimes(1);
  await act(() =>
    window.dispatchEvent(
      Object.assign(new Event("pageshow"), { persisted: true }),
    ),
  );
  expect(lifecycle.mount).toHaveBeenCalledTimes(2);
  await act(() => window.dispatchEvent(new Event("pagehide")));
  expect(viewers[0].dispose).toHaveBeenCalledTimes(1);
  expect(viewers[1].dispose).toHaveBeenCalledTimes(1);
});
