import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OrderSuccessAudio } from "@/lib/order-success-audio";
function fixture() {
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
  };
  const stop = vi.fn();
  const dependencies = {
    context: vi.fn(() => context as unknown as AudioContext),
    chime: vi.fn(() => stop),
  };
  return {
    audio: new OrderSuccessAudio(dependencies),
    context,
    dependencies,
    stop,
  };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
describe("order confirmation sound", () => {
  it("stays silent until a new successful response, and cleans up after its short cue", async () => {
    const f = fixture();
    expect(f.dependencies.context).not.toHaveBeenCalled();
    const attempt = f.audio.prepare();
    expect(f.context.resume).toHaveBeenCalledTimes(1);
    expect(f.dependencies.chime).not.toHaveBeenCalled();
    f.audio.success(attempt, "new-order", false);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.dependencies.chime).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(650);
    expect(f.stop).toHaveBeenCalledTimes(1);
    expect(f.context.state).toBe("suspended");
    f.audio.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("duplicate callbacks do not cancel the first legitimate cue or play it twice", async () => {
    const f = fixture(),
      attempt = f.audio.prepare();
    f.audio.success(attempt, "duplicate", false);
    f.audio.success(attempt, "duplicate", false);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.dependencies.chime).toHaveBeenCalledTimes(1);
    f.audio.success(attempt, "duplicate", false);
    expect(f.stop).not.toHaveBeenCalled();
    f.audio.dispose();
  });
  it("replayed or rejected requests stay silent", async () => {
    const f = fixture();
    f.audio.success(f.audio.prepare(), "existing", true);
    await vi.advanceTimersByTimeAsync(0);
    const cancelled = f.audio.prepare();
    f.audio.cancel(cancelled);
    f.audio.success(cancelled, "late", false);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.dependencies.chime).not.toHaveBeenCalled();
    f.audio.dispose();
  });
  it("muting while HTTP is pending suppresses that response even if later unmuted", async () => {
    const f = fixture(),
      attempt = f.audio.prepare();
    f.audio.setMuted(true);
    f.audio.setMuted(false);
    f.audio.success(attempt, "muted-response", false);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.dependencies.chime).not.toHaveBeenCalled();
    f.audio.success(f.audio.prepare(), "next-order", false);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.dependencies.chime).toHaveBeenCalledTimes(1);
    f.audio.dispose();
  });
  it("starting muted never creates an audio context", () => {
    const f = fixture();
    f.audio.setMuted(true);
    f.audio.success(f.audio.prepare(), "muted", false);
    expect(f.dependencies.context).not.toHaveBeenCalled();
    f.audio.dispose();
  });
  it("a delayed resume after cancellation is suspended and never sounds", async () => {
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
    const attempt = f.audio.prepare();
    f.audio.cancel(attempt);
    finish();
    f.audio.success(attempt, "late-resume", false);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.context.state).toBe("suspended");
    expect(f.dependencies.chime).not.toHaveBeenCalled();
    f.audio.dispose();
  });
  it("denied or broken audio cannot throw into a successful order handler", async () => {
    const f = fixture();
    f.context.resume.mockRejectedValueOnce(new Error("Denied"));
    expect(() =>
      f.audio.success(f.audio.prepare(), "denied", false),
    ).not.toThrow();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.dependencies.chime).not.toHaveBeenCalled();
    f.dependencies.chime.mockImplementationOnce(() => {
      throw new Error("Unavailable");
    });
    f.audio.success(f.audio.prepare(), "broken", false);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.context.state).toBe("suspended");
    f.audio.dispose();
  });
  it("disposal suppresses a pending confirmation and clears timers", async () => {
    const f = fixture(),
      attempt = f.audio.prepare();
    f.audio.dispose();
    f.audio.success(attempt, "unmounted", false);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.dependencies.chime).not.toHaveBeenCalled();
    expect(f.context.close).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
