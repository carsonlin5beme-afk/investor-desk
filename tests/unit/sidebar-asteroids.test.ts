import { describe, expect, it } from "vitest";
import {
  blastProgress,
  createAsteroidSequence,
  createAsteroidCompanionSchedule,
  sweptHitDistance,
  asteroidPosition,
  type AsteroidEncounter,
} from "@/lib/sidebar-asteroids";

const flightFrames = Array.from({ length: 101 }, (_, index) => ({
  phase: index * 30,
  progress: blastProgress(index / 100),
}));
function closestPass(e: AsteroidEncounter, height: number) {
  let closest = Infinity;
  for (
    let launch = Math.floor(e.start / 10000) * 10000;
    launch <= e.start + e.duration;
    launch += 10000
  ) {
    let previous: { x: number; y: number } | null = null;
    for (const frame of flightFrames) {
      const now = launch + frame.phase;
      if (now < e.start || now > e.start + e.duration) continue;
      const pos = asteroidPosition(e, now, 190, height);
      const relative = {
        x: 95 - pos.x,
        y: height * (1 - frame.progress) - pos.y,
      };
      closest = Math.min(
        closest,
        previous
          ? sweptHitDistance(previous, relative)
          : Math.hypot(relative.x, relative.y),
      );
      previous = relative;
    }
  }
  return closest;
}

describe("sidebar asteroid encounters", () => {
  it("schedules occasional companions independently without consuming, skipping or rerolling visitors", () => {
    for (const seed of [1, 32, 887, 0xffffffff]) {
      const next = createAsteroidSequence(seed),
        control = createAsteroidSequence(seed);
      const schedule = createAsteroidCompanionSchedule(seed);
      const all: AsteroidEncounter[] = [];
      let now = 4000,
        pairs = 0;
      for (let passage = 0; passage < 1000; passage++) {
        const primary = next(now);
        expect(primary).toEqual(control(now));
        all.push(primary);
        const deadline = schedule(primary);
        let end = primary.start + primary.duration;
        if (deadline != null) {
          pairs++;
          expect(deadline - primary.start).toBeGreaterThanOrEqual(4000);
          expect(deadline - primary.start).toBeLessThanOrEqual(11200);
          // Simulate a slightly late animation frame; no visitor was drawn while pending.
          const companion = next(deadline + 17);
          expect(companion).toEqual(control(deadline + 17));
          expect(companion.index).toBe(primary.index + 1);
          expect(Math.floor(companion.crossing / 10000)).toBeGreaterThan(
            Math.floor(primary.crossing / 10000),
          );
          expect(companion.start).toBeLessThan(end);
          if (primary.impact && companion.impact)
            expect(
              companion.crossing - primary.crossing,
            ).toBeGreaterThanOrEqual(10000);
          all.push(companion);
          end = Math.max(end, companion.start + companion.duration);
        }
        now = end + 6500;
      }
      expect(pairs).toBeGreaterThan(180);
      expect(pairs).toBeLessThan(270);
      for (let offset = 0; offset + 20 <= all.length; offset += 20) {
        const block = all.slice(offset, offset + 20);
        expect(block.filter((e) => e.gold)).toHaveLength(1);
        expect(block.filter((e) => e.impact && !e.gold)).toHaveLength(2);
      }
      const gold = all.filter((e) => e.gold);
      for (let offset = 0; offset + 10 <= gold.length; offset += 10)
        expect(
          gold.slice(offset, offset + 10).filter((e) => e.impact),
        ).toHaveLength(1);
    }
  });

  it("leaves discarded pending companions undrawn and reproduces its separate schedule", () => {
    const a = createAsteroidSequence(887),
      b = createAsteroidSequence(887);
    const scheduleA = createAsteroidCompanionSchedule(887),
      scheduleB = createAsteroidCompanionSchedule(887);
    for (let i = 0; i < 100; i++) {
      const now = i * 47000;
      const primary = a(now);
      expect(primary).toEqual(b(now));
      expect(scheduleA(primary)).toBe(scheduleB(primary));
      // Intentionally abandon every pending companion, like a hidden/disposed field.
    }
  });

  it("guarantees diagonal travel in both directions without changing horizontal pacing", () => {
    const next = createAsteroidSequence(9123);
    const orientations = new Set<string>();
    for (let i = 0; i < 400; i++) {
      const e = next(i * 6137 + 4000);
      expect(Math.abs(e.slope)).toBeGreaterThanOrEqual(60);
      expect(Math.abs(e.slope)).toBeLessThanOrEqual(100);
      const a = asteroidPosition(e, e.start, 190, 436),
        b = asteroidPosition(e, e.start + e.duration, 190, 436);
      expect(b.y - a.y).toBeCloseTo(e.slope, 10);
      expect(b.x - a.x).toBeCloseTo(
        e.direction * (190 + e.size * (e.gold ? 4 : 2)),
        10,
      );
      expect(e.duration).toBe(2 * (e.crossing - e.start));
      expect(e.duration).toBeGreaterThanOrEqual(
        e.impact ? 17200 : e.gold ? 26000 : 28400,
      );
      const originalLaunch = Math.ceil((e.start + 8000) / 10000) * 10000;
      expect(e.crossing).toBe(
        originalLaunch + (e.impact ? 600 : e.gold ? 5000 : 6200),
      );
      orientations.add(`${e.direction}:${Math.sign(e.slope)}`);
      if (e.impact)
        for (const height of [105, 160, 436, 800]) {
          const crossing = asteroidPosition(e, e.crossing, 190, height);
          expect(crossing.x).toBe(95);
          expect(crossing.y).toBeCloseTo(height * (1 - blastProgress(0.2)), 10);
        }
    }
    expect(orientations.size).toBe(4);
  });

  it("keeps every planned normal and gold miss physically clear across all heights and diagonal endpoints", () => {
    let verified = 0;
    for (const seed of [1, 7, 32, 887]) {
      const next = createAsteroidSequence(seed);
      let time = 4000;
      for (let i = 0; i < 200; i++) {
        const encounter = next(time);
        time += encounter.duration + 6500;
        for (const slope of [-100, -60, 60, 100]) {
          const e = { ...encounter, slope };
          for (const height of [105, 160, 436, 800]) {
            const distance = closestPass(e, height);
            if (e.impact) expect(distance).toBeLessThan(e.size * 0.44 + 4);
            else expect(distance).toBeGreaterThan(e.size * 0.44 + 5);
            verified++;
          }
        }
      }
    }
    expect(verified).toBe(12800);
  });

  it("assigns one gold per twenty, two normal hits per twenty and one hit per ten gold visitors", () => {
    for (const seed of [1, 192, 99999, 0xffffffff]) {
      const next = createAsteroidSequence(seed);
      let time = 4000;
      let goldHits = 0;
      for (let block = 0; block < 30; block++) {
        const rocks = Array.from({ length: 20 }, () => {
          const e = next(time);
          time += e.duration + 6500;
          return e;
        });
        expect(rocks.filter((e) => e.gold)).toHaveLength(1);
        expect(rocks.filter((e) => e.impact && !e.gold)).toHaveLength(2);
        goldHits += rocks.filter((e) => e.gold && e.impact).length;
        if (block % 10 === 9) {
          expect(goldHits).toBe(1);
          goldHits = 0;
        }
        for (const e of rocks) {
          expect(e.crossing % 10000).toBe(
            e.impact ? 600 : e.gold ? 5000 : 6200,
          );
          expect(e.start + e.duration / 2).toBe(e.crossing);
          expect(e.duration).toBeGreaterThanOrEqual(17000);
          expect(e.size).toBeGreaterThanOrEqual(e.gold ? 51 : 17);
          expect(e.size).toBeLessThan(e.gold ? 75 : 25);
        }
      }
    }
  });
  it("planned gold misses clear the whole enlarged body, while hit paths intersect", () => {
    const phases = Array.from({ length: 92 }, (_, i) => i * 33);
    const progress = phases.map((phase) => blastProgress(phase / 3000));
    for (const seed of [1, 7, 32, 887]) {
      const next = createAsteroidSequence(seed);
      let time = 4000;
      for (let i = 0; i < 200; i++) {
        const e = next(time);
        time += e.duration + 6500;
        if (!e.gold) continue;
        for (const height of [105, 160, 436, 800]) {
          let distance = Infinity;
          for (
            let launch = Math.ceil(e.start / 10000) * 10000;
            launch < e.start + e.duration;
            launch += 10000
          ) {
            let previous: { x: number; y: number } | null = null;
            for (let k = 0; k < phases.length; k++) {
              const now = launch + phases[k];
              if (now > e.start + e.duration) break;
              const pos = asteroidPosition(e, now, 190, height);
              const relative = {
                x: 95 - pos.x,
                y: height * (1 - progress[k]) - pos.y,
              };
              distance = Math.min(
                distance,
                previous
                  ? sweptHitDistance(previous, relative)
                  : Math.hypot(relative.x, relative.y),
              );
              previous = relative;
            }
          }
          if (e.impact) expect(distance).toBeLessThan(e.size * 0.44 + 3);
          else expect(distance).toBeGreaterThan(e.size * 0.44 + 5);
        }
      }
    }
  });
  it("places intended encounters on the easing curve and decelerates", () => {
    expect(blastProgress(0)).toBeCloseTo(0, 6);
    expect(blastProgress(1)).toBeCloseTo(1, 6);
    expect(blastProgress(0.2)).toBeGreaterThan(0.55);
    const first = blastProgress(0.2) - blastProgress(0.1);
    const last = blastProgress(0.9) - blastProgress(0.8);
    expect(first).toBeGreaterThan(last * 5);
  });
  it("detects a fast projectile crossing between frames, but not a nearby miss", () => {
    expect(sweptHitDistance({ x: 0, y: 40 }, { x: 0, y: -40 })).toBe(0);
    expect(sweptHitDistance({ x: 30, y: 40 }, { x: 30, y: -40 })).toBe(30);
    expect(sweptHitDistance({ x: 5, y: 5 }, { x: 5, y: 5 })).toBeCloseTo(
      Math.sqrt(50),
    );
  });
});
