import type { createScene } from "./landing-orbit-scene";

export type OrbitMotionState = {
  label: string;
  paused: boolean;
  disabled: boolean;
};

/** Owns a single decorative viewer; expensive rendering loads only while visible. */
export function mountLandingOrbit(
  stage: HTMLElement,
  host: HTMLElement,
  report: (state: OrbitMotionState) => void,
) {
  const preference = matchMedia("(prefers-reduced-motion: reduce)");
  let reduced = preference.matches;
  let viewer: Awaited<ReturnType<typeof createScene>> | null = null;
  let loading = false;
  let failed = false;
  let disposed = false;
  let intersecting = typeof IntersectionObserver !== "function";
  let paused = false;
  let frame = 0;
  let lastTick = 0;
  let angle = 0;
  let generation = 0;
  let controller: AbortController | null = null;
  const eligible = () =>
    !disposed &&
    !failed &&
    !paused &&
    !reduced &&
    intersecting &&
    document.visibilityState === "visible";
  const publish = () => {
    if (disposed) return;
    report({
      label: reduced
        ? "Motion reduced"
        : failed
          ? "Static artwork"
          : paused
            ? "Resume motion"
            : "Pause motion",
      paused,
      disabled: reduced || failed,
    });
  };
  const stop = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    lastTick = 0;
  };
  const cancelLoad = () => {
    controller?.abort();
    generation++;
    loading = false;
  };
  const fail = () => {
    if (disposed) return;
    failed = true;
    stop();
    cancelLoad();
    viewer?.dispose();
    viewer = null;
    stage.dataset.state = "static";
    publish();
  };
  const tick = (time: number) => {
    frame = 0;
    if (!eligible() || !viewer) return stop();
    if (!lastTick || time - lastTick >= 1000 / 30 - 1) {
      const delta = lastTick ? Math.min((time - lastTick) / 1000, 0.1) : 0;
      lastTick = time;
      angle = (angle + (delta * Math.PI * 2) / 72) % (Math.PI * 2);
      viewer.rotate(angle);
      try {
        viewer.render();
      } catch {
        return fail();
      }
    }
    frame = requestAnimationFrame(tick);
  };
  async function sync() {
    publish();
    if (!eligible()) {
      stop();
      if (loading) cancelLoad();
      return;
    }
    if (viewer) {
      if (!frame) frame = requestAnimationFrame(tick);
      return;
    }
    if (loading) return;
    loading = true;
    controller = new AbortController();
    const version = ++generation;
    const signal = controller.signal;
    const current = () => !disposed && version === generation;
    try {
      const { createScene } = await import("./landing-orbit-scene");
      if (signal.aborted || !current()) return;
      const candidate = await createScene(host, {
        modelUrl: "/landing/investor-orbit.glb",
        signal,
        onContextLoss: () => {
          if (current()) fail();
        },
      });
      if (!current() || reduced || signal.aborted) {
        candidate.dispose();
        return;
      }
      viewer = candidate;
      viewer.rotate(angle);
      viewer.render();
      stage.dataset.state = "ready";
    } catch (error) {
      if (current() && !(error instanceof Error && error.name === "AbortError"))
        fail();
    } finally {
      if (current()) {
        loading = false;
        publish();
        if (eligible() && viewer && !frame) frame = requestAnimationFrame(tick);
      }
    }
  }
  const visibility = () => {
    void sync();
  };
  const changePreference = (event: MediaQueryListEvent) => {
    reduced = event.matches;
    if (reduced) {
      stop();
      cancelLoad();
      viewer?.dispose();
      viewer = null;
      stage.dataset.state = "static";
    }
    void sync();
  };
  const intersection =
    typeof IntersectionObserver === "function"
      ? new IntersectionObserver(
          ([entry]) => {
            intersecting = entry.isIntersecting;
            void sync();
          },
          { threshold: 0.01 },
        )
      : null;
  const resize =
    typeof ResizeObserver === "function"
      ? new ResizeObserver(() => {
          if (!viewer || disposed) return;
          try {
            viewer.resize();
            if (
              !reduced &&
              intersecting &&
              document.visibilityState === "visible"
            )
              viewer.render();
          } catch {
            fail();
          }
        })
      : null;
  preference.addEventListener("change", changePreference);
  document.addEventListener("visibilitychange", visibility);
  intersection?.observe(stage);
  resize?.observe(host);
  void sync();
  return {
    toggle() {
      if (disposed || reduced || failed) return;
      paused = !paused;
      void sync();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stop();
      cancelLoad();
      viewer?.dispose();
      viewer = null;
      intersection?.disconnect();
      resize?.disconnect();
      preference.removeEventListener("change", changePreference);
      document.removeEventListener("visibilitychange", visibility);
      stage.dataset.state = "static";
    },
  };
}
