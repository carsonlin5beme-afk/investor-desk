import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AmbientAudio, type AmbientState } from "@/lib/ambient-audio";

function fixture() {
  const events = new EventTarget();
  const context = {
    state: "suspended",
    resume: vi.fn(async () => {
      context.state = "running";
    }),
    suspend: vi.fn(async () => {
      context.state = "suspended";
    }),
    close: vi.fn(async () => {
      context.state = "closed";
    }),
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
  };
  const active = { launch: false, impact: false };
  const stopLaunch = vi.fn(() => {
    active.launch = false;
  });
  const stopImpact = vi.fn(() => {
    active.impact = false;
  });
  const graph = {
    fadeVolume: vi.fn(),
    playLaunch: vi.fn(() => {
      active.launch = true;
      return stopLaunch;
    }),
    cancelLaunch: vi.fn(() => {
      active.launch = false;
    }),
    playImpact: vi.fn((_gold: boolean) => {
      active.impact = true;
      return stopImpact;
    }),
    cancelImpact: vi.fn(() => {
      active.impact = false;
    }),
    dispose: vi.fn(() => {
      active.launch = active.impact = false;
    }),
  };
  const dependencies = {
    context: vi.fn(() => context as unknown as AudioContext),
    graph: vi.fn<
      (
        context: BaseAudioContext,
        onError: () => void,
      ) => typeof graph | Promise<typeof graph>
    >(() => graph),
  };
  const states: AmbientState[] = [];
  const engine = new AmbientAudio((state) => states.push(state), dependencies);
  return {
    engine,
    context,
    graph,
    dependencies,
    states,
    events,
    active,
    stopLaunch,
    stopImpact,
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("blast launch engine ownership", () => {
  it("never allocates or resumes audio for launches before opt-in or after disposal", async () => {
    const f = fixture();
    expect(() => f.engine.playLaunch()()).not.toThrow();
    f.engine.cancelLaunch();
    f.engine.setVolume(0);
    expect(() => f.engine.playLaunch()()).not.toThrow();
    f.engine.dispose();
    expect(() => f.engine.playLaunch()()).not.toThrow();
    await f.engine.play();
    expect(f.dependencies.context).not.toHaveBeenCalled();
    expect(f.dependencies.graph).not.toHaveBeenCalled();
    expect(f.context.resume).not.toHaveBeenCalled();
    expect(f.graph.playLaunch).not.toHaveBeenCalled();
  });

  it("does not queue a launch while starting even when the context is already running", async () => {
    const f = fixture();
    let ready!: (graph: typeof f.graph) => void;
    f.dependencies.graph.mockImplementation(
      () =>
        new Promise((resolve) => {
          ready = resolve;
        }),
    );
    const pending = f.engine.play();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.context.state).toBe("running");
    expect(f.states.at(-1)).toBe("starting");
    f.engine.playLaunch()();
    ready(f.graph);
    await pending;
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.states.at(-1)).toBe("playing");
    expect(f.graph.playLaunch).not.toHaveBeenCalled();
    expect(f.context.resume).toHaveBeenCalledOnce();
    f.engine.dispose();
  });

  it("allows launch and impact to overlap on the existing graph with independent caller cancellation", async () => {
    const f = fixture();
    await f.engine.play();
    const cancelImpact = f.engine.playImpact(true);
    const cancelLaunch = f.engine.playLaunch();
    expect(f.active).toEqual({ launch: true, impact: true });
    expect(f.graph.playLaunch).toHaveBeenCalledWith();
    cancelLaunch();
    expect(f.stopLaunch).toHaveBeenCalledOnce();
    expect(f.active).toEqual({ launch: false, impact: true });
    f.engine.playLaunch();
    cancelImpact();
    expect(f.active).toEqual({ launch: true, impact: false });
    expect(f.stopImpact).toHaveBeenCalledOnce();
    expect(f.dependencies.context).toHaveBeenCalledOnce();
    expect(f.dependencies.graph).toHaveBeenCalledOnce();
    expect(f.context.resume).toHaveBeenCalledOnce();
    expect(f.context.suspend).not.toHaveBeenCalled();
    expect(f.states.at(-1)).toBe("playing");
    f.engine.dispose();
  });

  it("keeps explicit launch and impact cancellation separate while music plays", async () => {
    const f = fixture();
    await f.engine.play();
    f.engine.playLaunch();
    f.engine.playImpact(false);
    const impactCancels = f.graph.cancelImpact.mock.calls.length;
    f.engine.cancelLaunch();
    expect(f.active).toEqual({ launch: false, impact: true });
    expect(f.graph.cancelImpact).toHaveBeenCalledTimes(impactCancels);
    f.engine.playLaunch();
    const launchCancels = f.graph.cancelLaunch.mock.calls.length;
    f.engine.cancelImpact();
    expect(f.active).toEqual({ launch: true, impact: false });
    expect(f.graph.cancelLaunch).toHaveBeenCalledTimes(launchCancels);
    expect(f.context.suspend).not.toHaveBeenCalled();
    expect(f.states.at(-1)).toBe("playing");
    f.engine.dispose();
  });

  it.each(["suspended", "interrupted", "closed"])(
    "rejects a launch when the context is %s before its state event arrives",
    async (state) => {
      const f = fixture();
      await f.engine.play();
      f.context.state = state;
      expect(() => f.engine.playLaunch()()).not.toThrow();
      expect(f.graph.playLaunch).not.toHaveBeenCalled();
      expect(f.context.resume).toHaveBeenCalledOnce();
      expect(f.dependencies.context).toHaveBeenCalledOnce();
      f.engine.dispose();
    },
  );

  it("cancels both active channels immediately on pause and never replays rejected launches", async () => {
    const f = fixture();
    await f.engine.play();
    f.engine.playImpact(false);
    f.engine.playLaunch();
    f.engine.pause();
    expect(f.active).toEqual({ launch: false, impact: false });
    expect(f.states.at(-1)).toBe("pausing");
    f.engine.playLaunch()();
    await vi.advanceTimersByTimeAsync(340);
    expect(f.states.at(-1)).toBe("paused");
    f.engine.playLaunch()();
    f.context.state = "running";
    f.events.dispatchEvent(new Event("statechange"));
    f.engine.playLaunch()();
    await f.engine.play();
    expect(f.states.at(-1)).toBe("playing");
    expect(f.graph.playLaunch).toHaveBeenCalledOnce();
    expect(f.active).toEqual({ launch: false, impact: false });
    f.engine.dispose();
  });

  it("cancels both channels at mute without pausing music or replaying on unmute", async () => {
    const f = fixture();
    await f.engine.play();
    f.engine.playImpact(true);
    f.engine.playLaunch();
    f.engine.setVolume(0);
    expect(f.active).toEqual({ launch: false, impact: false });
    expect(f.states.at(-1)).toBe("playing");
    f.engine.playLaunch()();
    f.engine.setVolume(0.6);
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.graph.playLaunch).toHaveBeenCalledOnce();
    expect(f.context.resume).toHaveBeenCalledOnce();
    expect(f.context.suspend).not.toHaveBeenCalled();
    f.engine.playLaunch();
    expect(f.active).toEqual({ launch: true, impact: false });
    f.engine.dispose();
  });

  it("cancels both channels on interruption and requires explicit music recovery", async () => {
    const f = fixture();
    await f.engine.play();
    f.engine.playLaunch();
    f.engine.playImpact(false);
    f.context.state = "interrupted";
    f.events.dispatchEvent(new Event("statechange"));
    expect(f.states.at(-1)).toBe("suspended");
    expect(f.active).toEqual({ launch: false, impact: false });
    f.context.state = "running";
    f.events.dispatchEvent(new Event("statechange"));
    f.engine.playLaunch()();
    expect(f.context.resume).toHaveBeenCalledOnce();
    await f.engine.play();
    expect(f.graph.playLaunch).toHaveBeenCalledOnce();
    f.engine.playLaunch();
    expect(f.graph.playLaunch).toHaveBeenCalledTimes(2);
    expect(f.dependencies.graph).toHaveBeenCalledOnce();
    f.engine.dispose();
  });

  it("releases both channels on a music processor error without recovering for a launch", async () => {
    const f = fixture();
    await f.engine.play();
    f.engine.playLaunch();
    f.engine.playImpact(true);
    f.dependencies.graph.mock.calls[0][1]();
    expect(f.states.at(-1)).toBe("error");
    expect(f.active).toEqual({ launch: false, impact: false });
    expect(f.graph.cancelLaunch).toHaveBeenCalled();
    expect(f.graph.cancelImpact).toHaveBeenCalled();
    expect(f.graph.dispose).toHaveBeenCalledOnce();
    f.engine.playLaunch()();
    expect(f.graph.playLaunch).toHaveBeenCalledOnce();
    expect(f.dependencies.context).toHaveBeenCalledOnce();
    expect(f.context.resume).toHaveBeenCalledOnce();
    f.engine.dispose();
  });

  it("checks hidden document state without allocating, resuming or pausing music", async () => {
    const f = fixture();
    await f.engine.play();
    vi.stubGlobal("document", { visibilityState: "hidden" });
    f.engine.playLaunch()();
    expect(f.graph.playLaunch).not.toHaveBeenCalled();
    expect(f.context.resume).toHaveBeenCalledOnce();
    expect(f.context.suspend).not.toHaveBeenCalled();
    expect(f.states.at(-1)).toBe("playing");
    f.engine.dispose();
  });

  it("cancels a failed launch allocation without touching an overlapping impact or music", async () => {
    const f = fixture();
    await f.engine.play();
    f.engine.playImpact(true);
    const impactCancels = f.graph.cancelImpact.mock.calls.length;
    const launchCancels = f.graph.cancelLaunch.mock.calls.length;
    f.graph.playLaunch.mockImplementationOnce(() => {
      f.active.launch = true;
      throw new Error("Launch allocation failed");
    });
    expect(() => f.engine.playLaunch()()).not.toThrow();
    expect(f.active).toEqual({ launch: false, impact: true });
    expect(f.graph.cancelLaunch).toHaveBeenCalledTimes(launchCancels + 1);
    expect(f.graph.cancelImpact).toHaveBeenCalledTimes(impactCancels);
    expect(f.states.at(-1)).toBe("playing");
    expect(f.context.suspend).not.toHaveBeenCalled();
    expect(f.context.close).not.toHaveBeenCalled();
    expect(f.graph.dispose).not.toHaveBeenCalled();
    f.engine.playLaunch();
    expect(f.active).toEqual({ launch: true, impact: true });
    f.engine.dispose();
  });

  it("disposes both channels once and makes later music and effect requests inert", async () => {
    const f = fixture();
    await f.engine.play();
    f.engine.playLaunch();
    f.engine.playImpact(false);
    f.engine.dispose();
    f.engine.dispose();
    expect(f.active).toEqual({ launch: false, impact: false });
    f.engine.playLaunch()();
    f.engine.playImpact(true)();
    f.engine.cancelLaunch();
    await f.engine.play();
    await vi.advanceTimersByTimeAsync(10000);
    expect(f.graph.playLaunch).toHaveBeenCalledOnce();
    expect(f.graph.playImpact).toHaveBeenCalledOnce();
    expect(f.graph.dispose).toHaveBeenCalledOnce();
    expect(f.dependencies.context).toHaveBeenCalledOnce();
    expect(f.context.resume).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not resurrect a launch when pending start resolves after disposal", async () => {
    const f = fixture();
    let ready!: (graph: typeof f.graph) => void;
    f.dependencies.graph.mockImplementation(
      () =>
        new Promise((resolve) => {
          ready = resolve;
        }),
    );
    const pending = f.engine.play();
    await vi.advanceTimersByTimeAsync(0);
    f.engine.playLaunch()();
    f.engine.dispose();
    ready(f.graph);
    await pending;
    f.engine.playLaunch()();
    expect(f.graph.playLaunch).not.toHaveBeenCalled();
    expect(f.graph.dispose).toHaveBeenCalledOnce();
    expect(f.states).not.toContain("playing");
  });

  it("supports legacy graphs without optional launch methods", async () => {
    const context = fixture().context;
    const engine = new AmbientAudio(vi.fn(), {
      context: () => context as unknown as AudioContext,
      graph: () => ({ fadeVolume: vi.fn(), dispose: vi.fn() }),
    });
    await engine.play();
    expect(() => engine.playLaunch()()).not.toThrow();
    expect(() => engine.cancelLaunch()).not.toThrow();
    engine.pause();
    engine.dispose();
  });
});
