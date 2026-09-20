const CHARGE_MS = 10_000;
const FRESH_FRAME_MS = 120;

/** Follow the visible animation clock without replaying missed launches. */
export function createBlastLaunchClock() {
  let previous: { animation: number; wall: number } | null = null;
  return {
    reset() {
      previous = null;
    },
    sample(animation: number, wall: number): boolean {
      if (
        !Number.isFinite(animation) ||
        animation < 0 ||
        !Number.isFinite(wall)
      ) {
        previous = null;
        return false;
      }
      const before = previous;
      // Consume every sample, including muted launches and skipped frames.
      previous = { animation, wall };
      if (!before) return false;
      const elapsed = animation - before.animation;
      const wallElapsed = wall - before.wall;
      return (
        animation >= CHARGE_MS &&
        elapsed > 0 &&
        elapsed <= FRESH_FRAME_MS &&
        wallElapsed >= 0 &&
        wallElapsed <= FRESH_FRAME_MS &&
        Math.floor(animation / CHARGE_MS) ===
          Math.floor(before.animation / CHARGE_MS) + 1 &&
        animation % CHARGE_MS <= FRESH_FRAME_MS
      );
    },
  };
}
