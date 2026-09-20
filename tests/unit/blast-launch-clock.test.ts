import { describe, expect, it } from "vitest";
import { createBlastLaunchClock } from "@/lib/blast-launch-clock";

describe("visible blast launch clock", () => {
  it("waits for the initial charge and emits once at each fresh launch", () => {
    const clock = createBlastLaunchClock();
    const launches: number[] = [];
    for (let time = 0; time <= 30_050; time += 35) {
      if (clock.sample(time, time + 5_000)) launches.push(time);
      expect(clock.sample(time, time + 5_000)).toBe(false);
    }
    expect(launches).toEqual([10_010, 20_020, 30_030]);
  });

  it("does not play on mount or resume during a flight", () => {
    const clock = createBlastLaunchClock();
    expect(clock.sample(10_020, 0)).toBe(false);
    expect(clock.sample(10_060, 40)).toBe(false);
    clock.reset();
    expect(clock.sample(20_030, 3_000)).toBe(false);
    expect(clock.sample(20_070, 3_040)).toBe(false);
  });

  it("discards delayed frames and skipped cycles with no backlog", () => {
    const clock = createBlastLaunchClock();
    clock.sample(9_950, 0);
    expect(clock.sample(10_010, 2_000)).toBe(false);
    expect(clock.sample(10_045, 2_035)).toBe(false);
    clock.sample(19_700, 3_000);
    expect(clock.sample(20_010, 3_035)).toBe(false);
    expect(clock.sample(30_010, 3_070)).toBe(false);
    expect(clock.sample(30_045, 3_105)).toBe(false);
    clock.sample(39_970, 4_000);
    expect(clock.sample(40_010, 4_040)).toBe(true);
  });

  it("consumes muted boundaries without needing to know audio state", () => {
    const clock = createBlastLaunchClock();
    clock.sample(9_970, 0);
    expect(clock.sample(10_010, 40)).toBe(true); // Audio gate may reject this.
    expect(clock.sample(10_045, 75)).toBe(false); // Turning radio on cannot replay it.
    clock.sample(19_980, 10_000);
    expect(clock.sample(20_020, 10_040)).toBe(true);
  });

  it("reseeds invalid clocks and tolerates rewinds without an immediate launch", () => {
    for (const value of [NaN, Infinity, -Infinity, -1]) {
      const clock = createBlastLaunchClock();
      clock.sample(9_970, 0);
      expect(clock.sample(value, 40)).toBe(false);
      expect(clock.sample(10_010, 80)).toBe(false);
    }
    const clock = createBlastLaunchClock();
    clock.sample(19_970, 0);
    expect(clock.sample(9_970, 40)).toBe(false);
    expect(clock.sample(10_010, 80)).toBe(true);
    clock.sample(19_970, 120);
    expect(clock.sample(20_010, 100)).toBe(false);
    expect(clock.sample(20_020, 140)).toBe(false);
  });
});
