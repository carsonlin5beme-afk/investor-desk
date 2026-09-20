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
  let impactActive = false;
  const stopImpact = vi.fn(() => {
    impactActive = false;
  });
  const graph = {
    fadeVolume: vi.fn(),
    playImpact: vi.fn((_gold: boolean) => {
      impactActive = true;
      return stopImpact;
    }),
    cancelImpact: vi.fn(() => {
      impactActive = false;
    }),
    dispose: vi.fn(() => {
      impactActive = false;
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
    stopImpact,
    impactActive: () => impactActive,
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("ambient impact engine ownership", () => {
  it("never allocates or resumes audio for impacts before the listener opts in", () => {
    const f = fixture();
    for (const gold of [false, true]) {
      const cancel = f.engine.playImpact(gold);
      expect(cancel).toBeTypeOf("function");
      expect(() => cancel()).not.toThrow();
    }
    f.engine.cancelImpact();
    f.engine.setVolume(0);
    f.engine.playImpact(true)();
    f.engine.dispose();
    f.engine.playImpact(false)();
    expect(f.dependencies.context).not.toHaveBeenCalled();
    expect(f.dependencies.graph).not.toHaveBeenCalled();
    expect(f.context.resume).not.toHaveBeenCalled();
    expect(f.graph.playImpact).not.toHaveBeenCalled();
  });

  it("does not enqueue impacts during an unresolved start, even after the context resumes", async () => {
    const f = fixture();
    let ready!: (graph: typeof f.graph) => void;
    f.dependencies.graph.mockImplementation(
      () =>
        new Promise((resolve) => {
          ready = resolve;
        }),
    );
    const playing = f.engine.play();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.context.state).toBe("running");
    expect(f.states.at(-1)).toBe("starting");
    f.engine.playImpact(false)();
    f.engine.playImpact(true)();
    expect(f.graph.playImpact).not.toHaveBeenCalled();
    expect(f.context.resume).toHaveBeenCalledTimes(1);
    ready(f.graph);
    await playing;
    await vi.advanceTimersByTimeAsync(100);
    expect(f.states.at(-1)).toBe("playing");
    expect(f.graph.playImpact).not.toHaveBeenCalled();
    f.engine.dispose();
  });

  it("dispatches both impact types through the already-playing graph and returns its cancellation", async () => {
    const f = fixture();
    await f.engine.play();
    const cancel = f.engine.playImpact(false);
    expect(f.graph.playImpact).toHaveBeenLastCalledWith(false);
    expect(f.impactActive()).toBe(true);
    cancel();
    expect(f.stopImpact).toHaveBeenCalledOnce();
    expect(f.impactActive()).toBe(false);
    f.engine.playImpact(true);
    expect(f.graph.playImpact).toHaveBeenLastCalledWith(true);
    expect(f.impactActive()).toBe(true);
    f.engine.cancelImpact();
    expect(f.impactActive()).toBe(false);
    expect(f.context.resume).toHaveBeenCalledTimes(1);
    expect(f.context.suspend).not.toHaveBeenCalled();
    expect(f.dependencies.context).toHaveBeenCalledTimes(1);
    expect(f.dependencies.graph).toHaveBeenCalledTimes(1);
    expect(f.states.at(-1)).toBe("playing");
    f.engine.dispose();
  });

  it.each(["suspended", "interrupted", "closed"])(
    "rejects an impact when the context becomes %s before its state-change event",
    async (state) => {
      const f = fixture();
      await f.engine.play();
      f.context.state = state;
      f.engine.playImpact(true)();
      expect(f.graph.playImpact).not.toHaveBeenCalled();
      expect(f.context.resume).toHaveBeenCalledTimes(1);
      expect(f.dependencies.context).toHaveBeenCalledTimes(1);
      f.engine.dispose();
    },
  );

  it("cuts active FX immediately on pause and cannot resurrect them during or after the music fade", async () => {
    const f = fixture();
    await f.engine.play();
    f.engine.playImpact(false);
    f.engine.pause();
    expect(f.impactActive()).toBe(false);
    expect(f.states.at(-1)).toBe("pausing");
    f.engine.playImpact(true)();
    await vi.advanceTimersByTimeAsync(340);
    expect(f.states.at(-1)).toBe("paused");
    f.engine.playImpact(true)();
    f.context.state = "running";
    f.events.dispatchEvent(new Event("statechange"));
    f.engine.playImpact(true)();
    expect(f.graph.playImpact).toHaveBeenCalledTimes(1);
    expect(f.context.resume).toHaveBeenCalledTimes(1);
    expect(f.impactActive()).toBe(false);
    f.engine.dispose();
  });

  it("cancels at exact mute while retaining music state, and unmuting does not replay an old impact", async () => {
    const f = fixture();
    await f.engine.play();
    f.engine.playImpact(true);
    f.engine.setVolume(0);
    expect(f.impactActive()).toBe(false);
    expect(f.states.at(-1)).toBe("playing");
    f.engine.playImpact(false)();
    f.engine.setVolume(0.4);
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.graph.playImpact).toHaveBeenCalledTimes(1);
    expect(f.context.resume).toHaveBeenCalledTimes(1);
    f.engine.playImpact(false);
    expect(f.graph.playImpact).toHaveBeenCalledTimes(2);
    expect(f.impactActive()).toBe(true);
    f.engine.dispose();
  });

  it("cancels an interruption and requires explicit music play before any new FX", async () => {
    const f = fixture();
    await f.engine.play();
    f.engine.playImpact(false);
    f.context.state = "interrupted";
    f.events.dispatchEvent(new Event("statechange"));
    expect(f.states.at(-1)).toBe("suspended");
    expect(f.impactActive()).toBe(false);
    f.context.state = "running";
    f.events.dispatchEvent(new Event("statechange"));
    f.engine.playImpact(true)();
    expect(f.graph.playImpact).toHaveBeenCalledTimes(1);
    expect(f.context.resume).toHaveBeenCalledTimes(1);
    await f.engine.play();
    f.engine.playImpact(true);
    expect(f.graph.playImpact).toHaveBeenCalledTimes(2);
    expect(f.dependencies.graph).toHaveBeenCalledTimes(1);
    f.engine.dispose();
  });

  it("releases FX on processor failure and rejects subsequent impacts without attempting recovery", async () => {
    const f = fixture();
    await f.engine.play();
    f.engine.playImpact(true);
    f.dependencies.graph.mock.calls[0][1]();
    expect(f.states.at(-1)).toBe("error");
    expect(f.impactActive()).toBe(false);
    expect(f.graph.dispose).toHaveBeenCalledOnce();
    f.engine.playImpact(false)();
    f.engine.cancelImpact();
    expect(f.graph.playImpact).toHaveBeenCalledTimes(1);
    expect(f.dependencies.context).toHaveBeenCalledTimes(1);
    expect(f.context.resume).toHaveBeenCalledTimes(1);
    f.engine.dispose();
  });

  it("rejects hidden-document impacts without suspending or restarting the music", async () => {
    const f = fixture();
    await f.engine.play();
    vi.stubGlobal("document", { visibilityState: "hidden" });
    f.engine.playImpact(true)();
    expect(f.graph.playImpact).not.toHaveBeenCalled();
    expect(f.context.resume).toHaveBeenCalledTimes(1);
    expect(f.context.suspend).not.toHaveBeenCalled();
    expect(f.states.at(-1)).toBe("playing");
    f.engine.dispose();
  });

  it("isolates an optional FX creation failure from the running music", async () => {
    const f = fixture();
    await f.engine.play();
    f.graph.playImpact.mockImplementationOnce(() => {
      throw new Error("Effect allocation failed");
    });
    expect(() => f.engine.playImpact(true)()).not.toThrow();
    expect(f.states.at(-1)).toBe("playing");
    expect(f.context.suspend).not.toHaveBeenCalled();
    expect(f.context.close).not.toHaveBeenCalled();
    expect(f.graph.dispose).not.toHaveBeenCalled();
    expect(f.context.resume).toHaveBeenCalledTimes(1);
    f.engine.dispose();
  });

  it("disposal cancels FX once and makes all later impact and music calls inert", async () => {
    const f = fixture();
    await f.engine.play();
    f.engine.playImpact(false);
    f.engine.dispose();
    f.engine.dispose();
    expect(f.impactActive()).toBe(false);
    f.engine.playImpact(true)();
    f.engine.cancelImpact();
    await f.engine.play();
    await vi.advanceTimersByTimeAsync(10000);
    expect(f.graph.playImpact).toHaveBeenCalledTimes(1);
    expect(f.graph.dispose).toHaveBeenCalledTimes(1);
    expect(f.dependencies.context).toHaveBeenCalledTimes(1);
    expect(f.context.resume).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not resurrect an impact rejected during a start that finishes after disposal", async () => {
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
    f.engine.playImpact(true)();
    f.engine.dispose();
    ready(f.graph);
    await pending;
    f.engine.playImpact(false)();
    expect(f.graph.playImpact).not.toHaveBeenCalled();
    expect(f.graph.dispose).toHaveBeenCalledOnce();
    expect(f.context.resume).toHaveBeenCalledTimes(1);
    expect(f.states).not.toContain("playing");
  });

  it("supports a legacy graph fixture that has no optional impact methods", async () => {
    const context = fixture().context;
    const graph = { fadeVolume: vi.fn(), dispose: vi.fn() };
    const engine = new AmbientAudio(vi.fn(), {
      context: () => context as unknown as AudioContext,
      graph: () => graph,
    });
    await engine.play();
    expect(() => engine.playImpact(true)()).not.toThrow();
    expect(() => engine.cancelImpact()).not.toThrow();
    engine.pause();
    engine.dispose();
  });
});
