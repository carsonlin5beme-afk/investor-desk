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
  const graph = { fadeVolume: vi.fn(), dispose: vi.fn() };
  const dependencies = {
    context: vi.fn(() => context as unknown as AudioContext),
    graph: vi.fn(() => graph),
  };
  const states: AmbientState[] = [];
  const engine = new AmbientAudio((state) => states.push(state), dependencies);
  return { engine, context, graph, dependencies, states, events };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("optional ambient radio lifecycle", () => {
  it("does not create audio until play; pause fades then suspends; resume reuses one graph", async () => {
    const f = fixture();
    expect(f.dependencies.context).not.toHaveBeenCalled();
    await f.engine.play();
    expect(f.states.at(-1)).toBe("playing");
    expect(f.graph.fadeVolume).toHaveBeenLastCalledWith(0.18, 1.6);
    f.engine.pause();
    expect(f.graph.fadeVolume).toHaveBeenLastCalledWith(0, 0.3);
    expect(f.context.suspend).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(340);
    expect(f.context.state).toBe("suspended");
    await f.engine.play();
    expect(f.dependencies.graph).toHaveBeenCalledTimes(1);
    expect(f.dependencies.context).toHaveBeenCalledTimes(1);
    f.engine.dispose();
    expect(f.graph.dispose).toHaveBeenCalledTimes(1);
    expect(f.context.close).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a late resume cannot turn sound on after a rapid pause", async () => {
    const f = fixture();
    let finish!: () => void;
    f.context.resume.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = () => {
            f.context.state = "running";
            resolve();
          };
        }),
    );
    const pending = f.engine.play();
    f.engine.pause();
    finish();
    await pending;
    expect(f.context.state).toBe("suspended");
    expect(f.states).not.toContain("playing");
    expect(
      f.graph.fadeVolume.mock.calls.every(([volume]) => volume === 0),
    ).toBe(true);
    f.engine.dispose();
  });

  it("rapid pause/play cancels the old suspend and never creates another engine", async () => {
    const f = fixture();
    await f.engine.play();
    f.engine.pause();
    await f.engine.play();
    await vi.advanceTimersByTimeAsync(500);
    expect(f.context.suspend).not.toHaveBeenCalled();
    expect(f.context.state).toBe("running");
    expect(f.dependencies.graph).toHaveBeenCalledTimes(1);
    f.engine.dispose();
  });

  it("zero volume is exact silence and non-finite values remain bounded", async () => {
    const f = fixture();
    await f.engine.play();
    f.engine.setVolume(0);
    expect(f.graph.fadeVolume).toHaveBeenLastCalledWith(0);
    f.engine.setVolume(10);
    expect(f.graph.fadeVolume).toHaveBeenLastCalledWith(1);
    f.engine.setVolume(NaN);
    expect(f.graph.fadeVolume).toHaveBeenLastCalledWith(0.18);
    f.engine.dispose();
  });

  it("an interrupted context requires another explicit play and never resumes itself", async () => {
    const f = fixture();
    await f.engine.play();
    f.context.state = "interrupted";
    f.events.dispatchEvent(new Event("statechange"));
    expect(f.states.at(-1)).toBe("suspended");
    expect(f.graph.fadeVolume).toHaveBeenLastCalledWith(0, 0);
    expect(f.context.resume).toHaveBeenCalledTimes(1);
    await f.engine.play();
    expect(f.states.at(-1)).toBe("playing");
    f.engine.dispose();
  });

  it("a failed resume releases resources and leaves a recoverable error", async () => {
    const f = fixture();
    f.context.resume.mockRejectedValueOnce(new Error("Denied"));
    await f.engine.play();
    expect(f.states.at(-1)).toBe("error");
    expect(f.graph.dispose).toHaveBeenCalledTimes(1);
    expect(f.context.close).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    await f.engine.play();
    expect(f.states.at(-1)).toBe("playing");
    f.engine.dispose();
  });

  it("an unresolved start becomes suspended and a later completion stays silent", async () => {
    const f = fixture();
    let finish!: () => void;
    f.context.resume.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = () => {
            f.context.state = "running";
            resolve();
          };
        }),
    );
    const pending = f.engine.play();
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.states.at(-1)).toBe("suspended");
    finish();
    await pending;
    expect(f.context.state).toBe("suspended");
    expect(f.states).not.toContain("playing");
    f.engine.dispose();
  });

  it("disposing during startup is idempotent and stale callbacks cannot publish playing", async () => {
    const f = fixture();
    let finish!: () => void;
    f.context.resume.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const pending = f.engine.play();
    f.engine.dispose();
    f.engine.dispose();
    finish();
    await pending;
    expect(f.states).not.toContain("playing");
    expect(f.graph.dispose).toHaveBeenCalledTimes(1);
    expect(f.context.close).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
