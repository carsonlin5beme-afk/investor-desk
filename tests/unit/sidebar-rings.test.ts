import { describe, expect, it } from "vitest";
import {
  createRingFrame,
  materialSpinTurns,
  projectPoint,
  ringPoint,
  signalBodyMotion,
  type Vec3,
} from "@/lib/sidebar-rings";

const TAU = Math.PI * 2;
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const length = (point: Vec3) => Math.hypot(point.x, point.y, point.z);
const distance = (a: Vec3, b: Vec3) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const unproject = (point: Vec3): Vec3 => ({
  x: ((point.x - 32) * (140 - point.z)) / 140,
  y: ((point.y - 32) * (140 - point.z)) / 140,
  z: point.z,
});
const commands = (path: string) =>
  [...path.matchAll(/([ML])(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)].map(
    (match) => ({
      command: match[1],
      x: Number(match[2]),
      y: Number(match[3]),
    }),
  );

describe("sidebar ring geometry", () => {
  it("shares a monotonic quadratic charge energy with opacity and resets it at launch", () => {
    for (const cycle of [0, 10000, 20000]) {
      let previous = -1;
      for (const elapsed of [0, 1000, 2500, 5000, 7500, 9999.999]) {
        const frame = createRingFrame(cycle + elapsed);
        expect(frame.energy).toBeCloseTo((elapsed / 10000) ** 2, 12);
        expect(frame.energy).toBeGreaterThan(previous);
        expect(frame.opacity).toBeCloseTo(0.32 + 0.68 * frame.energy, 12);
        previous = frame.energy;
      }
      expect(createRingFrame(cycle).energy).toBe(0);
      expect(createRingFrame(cycle + 9999.999).energy).toBeGreaterThan(
        0.999999,
      );
      expect(createRingFrame(cycle + 10000)).toMatchObject({
        energy: 0,
        opacity: 0.32,
        lap: 0,
      });
    }
  });

  it("rotates the two polar-tilted normals at constant opposite azimuth rates", () => {
    const initial = createRingFrame(0);
    expect(Math.atan2(initial.normals[0].z, initial.normals[0].x)).toBeCloseTo(
      (25 * Math.PI) / 180,
      12,
    );
    expect(Math.atan2(initial.normals[1].z, initial.normals[1].x)).toBeCloseTo(
      (155 * Math.PI) / 180,
      12,
    );
    for (let time = 0; time <= 48000; time += 2000) {
      const before = createRingFrame(time);
      const after = createRingFrame(time + 137);
      for (const index of [0, 1] as const) {
        const a = before.normals[index],
          b = after.normals[index];
        const angle = Math.atan2(a.x * b.z - a.z * b.x, a.x * b.x + a.z * b.z);
        expect(angle).toBeCloseTo(
          ((index === 0 ? 1 : -1) * TAU * 137) / 24000,
          12,
        );
        expect(a.y).toBeCloseTo(
          Math.cos(((index === 0 ? 55 : 75) * Math.PI) / 180),
          12,
        );
      }
    }
  });

  it("keeps a nondegenerate shared intersection and the spark on its active circle throughout a full rotation", () => {
    for (let time = 0; time <= 24000; time += 83) {
      const frame = createRingFrame(time);
      const [a, b] = frame.normals;
      expect(length(a)).toBeCloseTo(1, 12);
      expect(length(b)).toBeCloseTo(1, 12);
      expect(Math.sqrt(Math.max(0, 1 - dot(a, b) ** 2))).toBeGreaterThanOrEqual(
        Math.sin((20 * Math.PI) / 180) - 1e-12,
      );
      expect(length(frame.junction)).toBeCloseTo(frame.radius, 11);
      expect(dot(a, frame.junction)).toBeCloseTo(0, 11);
      expect(dot(b, frame.junction)).toBeCloseTo(0, 11);
      const spark = unproject(frame.spark);
      expect(length(spark)).toBeCloseTo(frame.radius, 10);
      expect(dot(frame.normals[frame.activeRing], spark)).toBeCloseTo(0, 10);
      const phase = (time % 10000) / 10000;
      expect(frame.lap).toBe(Math.floor(8 * phase ** 2));
      expect(frame.activeRing).toBe(frame.lap % 2);
      expect(frame.opacity).toBeCloseTo(0.32 + 0.68 * phase ** 2, 12);
    }
  });

  it("hands off only at the live shared junction with no position jump at any lap or charge reset", () => {
    const epsilon = 0.0001;
    for (const cycle of [0, 10000, 20000]) {
      for (let lap = 1; lap <= 8; lap++) {
        const time = cycle + 10000 * Math.sqrt(lap / 8);
        const before = createRingFrame(time - epsilon);
        const after = createRingFrame(time + epsilon);
        const at = createRingFrame(time);
        expect(before.activeRing).toBe((lap - 1) % 2);
        expect(after.activeRing).toBe(lap % 2);
        expect(distance(before.spark, after.spark)).toBeLessThan(0.001);
        expect(distance(unproject(before.spark), at.junction)).toBeLessThan(
          0.001,
        );
        expect(distance(unproject(after.spark), at.junction)).toBeLessThan(
          0.001,
        );
        for (const normal of at.normals) {
          expect(
            distance(ringPoint(normal, at.junction, 0), at.junction),
          ).toBeLessThan(1e-12);
          expect(
            distance(ringPoint(normal, at.junction, TAU), at.junction),
          ).toBeLessThan(1e-12);
        }
      }
    }
    expect(
      distance(createRingFrame(0).junction, createRingFrame(5000).junction),
    ).toBeGreaterThan(1);
  });

  it("splits a closed 96-edge sampled circle into finite front and back paths without long transition gaps", () => {
    for (const time of [0, 1300, 5200, 9700, 12000, 17000, 23999]) {
      const frame = createRingFrame(time);
      expect(frame.paths[0]).not.toEqual(frame.paths[1]);
      for (const paths of frame.paths) {
        let edges = 0;
        for (const path of [paths.front, paths.back]) {
          expect(path.startsWith("M")).toBe(true);
          const points = commands(path);
          expect(points.length).toBeGreaterThan(40);
          for (let index = 0; index < points.length; index++) {
            const point = points[index];
            expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(
              true,
            );
            expect(point.x).toBeGreaterThan(0);
            expect(point.x).toBeLessThan(64);
            expect(point.y).toBeGreaterThan(0);
            expect(point.y).toBeLessThan(64);
            if (point.command === "L") {
              edges++;
              const previous = points[index - 1];
              expect(
                Math.hypot(point.x - previous.x, point.y - previous.y),
              ).toBeLessThan(2.5);
            }
          }
        }
        expect(edges).toBe(98); // Every edge remains; the two z=0 crossings split two edges.
      }
      for (const coordinate of [frame.spark.x, frame.spark.y]) {
        expect(coordinate).toBeGreaterThan(0);
        expect(coordinate).toBeLessThan(64);
      }
      expect(Math.abs(frame.spark.z)).toBeLessThanOrEqual(23);
    }
  });

  it("assigns projected path vertices to the correct world-depth side", () => {
    const frame = createRingFrame(0);
    frame.paths.forEach((paths, index) => {
      const normal = frame.normals[index];
      for (const side of ["front", "back"] as const) {
        for (const point of commands(paths[side])) {
          // Intersect the view ray with this ring's plane, independently of the path generator.
          const offsetDot =
            normal.x * (point.x - 32) + normal.y * (point.y - 32);
          const depth = -offsetDot / (normal.z - offsetDot / 140);
          expect(side === "front" ? depth >= -0.01 : depth <= 0.01).toBe(true);
        }
      }
    });
  });

  it("has a deterministic static frame, sanitizes invalid times, and supports finite negative or huge times", () => {
    const staticFrame = createRingFrame(0);
    expect(staticFrame).toEqual(createRingFrame(0));
    expect(staticFrame.spark).toEqual(projectPoint(staticFrame.junction));
    expect(staticFrame).toMatchObject({ activeRing: 0, lap: 0, opacity: 0.32 });
    for (const time of [NaN, Infinity, -Infinity])
      expect(createRingFrame(time)).toEqual(staticFrame);
    for (const time of [
      -1,
      -10000,
      -24000,
      Number.MAX_VALUE,
      -Number.MAX_VALUE,
    ]) {
      const frame = createRingFrame(time);
      expect(Object.values(frame.spark).every(Number.isFinite)).toBe(true);
      expect(
        frame.paths.every(
          (paths) => !/NaN|Infinity/.test(paths.front + paths.back),
        ),
      ).toBe(true);
      expect(frame.opacity).toBeGreaterThanOrEqual(0.32);
      expect(frame.opacity).toBeLessThan(1);
      expect(length(unproject(frame.spark))).toBeCloseTo(frame.radius, 10);
    }
    expect(createRingFrame(-1)).toEqual(createRingFrame(119999)); // lcm(24s, 10s)
  });

  it("contracts both rings and their shared spark after launch, with no initial collapse or radius discontinuity", () => {
    for (const time of [0, 90, 180, 690, 1200, 9999, 10000]) {
      expect(createRingFrame(time).radius).toBe(23);
    }
    for (const cycle of [10000, 20000, 30000]) {
      expect(createRingFrame(cycle + 90).radius).toBeCloseTo(23 * 0.775, 12);
      expect(createRingFrame(cycle + 180).radius).toBeCloseTo(23 * 0.55, 12);
      expect(createRingFrame(cycle + 690).radius).toBeCloseTo(23 * 0.775, 12);
      expect(createRingFrame(cycle + 1200).radius).toBe(23);
      for (const elapsed of [0, 90, 180, 400, 690, 1000, 1200]) {
        const frame = createRingFrame(cycle + elapsed);
        expect(frame.radius).toBeGreaterThanOrEqual(23 * 0.55);
        expect(frame.radius).toBeLessThanOrEqual(23);
        expect(length(frame.junction)).toBeCloseTo(frame.radius, 11);
        expect(length(unproject(frame.spark))).toBeCloseTo(frame.radius, 11);
        for (const normal of frame.normals) {
          expect(
            length(ringPoint(normal, frame.junction, Math.PI / 2)),
          ).toBeCloseTo(frame.radius, 11);
        }
        frame.rims.forEach((path, index) => {
          expect(path.endsWith("Z")).toBe(true);
          expect(commands(path)).toHaveLength(97);
          const inner = {
            x: frame.junction.x * 0.95,
            y: frame.junction.y * 0.95,
            z: frame.junction.z * 0.95,
          };
          const expected = projectPoint(
            ringPoint(frame.normals[index], inner, 0),
          );
          const actual = commands(path)[0];
          expect(
            Math.hypot(actual.x - expected.x, actual.y - expected.y),
          ).toBeLessThan(0.001);
        });
      }
      for (const boundary of [0, 180, 1200]) {
        expect(
          Math.abs(
            createRingFrame(cycle + boundary - 0.0001).radius -
              createRingFrame(cycle + boundary + 0.0001).radius,
          ),
        ).toBeLessThan(1e-8);
      }
    }
  });

  it("spins two uneven elongated arcs per ring in opposite directions at the integrated 1.5–4.5 rps charge rate", () => {
    for (const time of [100, 2500, 5000, 9900, 12500]) {
      const phase = (time % 10000) / 10000;
      const turnsPerSecond =
        (materialSpinTurns(time + 0.01) - materialSpinTurns(time - 0.01)) /
        0.00002;
      expect(turnsPerSecond).toBeCloseTo(1.5 + 3 * phase ** 2, 6);
      const frame = createRingFrame(time);
      frame.flow.forEach((arcs, index) => {
        for (const name of ["first", "second"] as const) {
          const points = commands(arcs[name]);
          expect(points).toHaveLength(name === "first" ? 28 : 19);
          expect(points.filter((point) => point.command === "M")).toHaveLength(
            1,
          );
          const start =
            (index === 0 ? 1 : -1) * TAU * materialSpinTurns(time) +
            (name === "first" ? 0 : (190 * Math.PI) / 180);
          const expected = projectPoint(
            ringPoint(frame.normals[index], frame.junction, start),
          );
          expect(
            Math.hypot(points[0].x - expected.x, points[0].y - expected.y),
          ).toBeLessThan(0.001);
          const sweep = ((name === "first" ? 100 : 65) * Math.PI) / 180;
          const end = projectPoint(
            ringPoint(frame.normals[index], frame.junction, start + sweep),
          );
          expect(
            Math.hypot(points.at(-1)!.x - end.x, points.at(-1)!.y - end.y),
          ).toBeLessThan(0.001);
        }
      });
    }
  });

  it("keeps material arc positions continuous at each charge reset while the planes keep moving", () => {
    for (const time of [10000, 20000, 30000]) {
      expect(materialSpinTurns(time)).toBe((time / 10000) * 25);
      const before = createRingFrame(time - 0.0001);
      const after = createRingFrame(time + 0.0001);
      for (const index of [0, 1] as const) {
        for (const name of ["first", "second"] as const) {
          const a = commands(before.flow[index][name]);
          const b = commands(after.flow[index][name]);
          expect(a).toHaveLength(b.length);
          for (let point = 0; point < a.length; point++) {
            expect(
              Math.hypot(a[point].x - b[point].x, a[point].y - b[point].y),
            ).toBeLessThan(0.002);
          }
        }
      }
    }
  });
});

describe("sidebar sphere body motion", () => {
  it("keeps the initial body full and contracts only after a real launch", () => {
    for (const time of [0, 110, 220, 1300, 9999, 10000])
      expect(signalBodyMotion(time).scale).toBe(1);
    for (const cycle of [10000, 20000, 30000]) {
      expect(signalBodyMotion(cycle + 110).scale).toBeCloseTo(0.89, 12);
      expect(signalBodyMotion(cycle + 220).scale).toBeCloseTo(0.78, 12);
      expect(signalBodyMotion(cycle + 760).scale).toBeCloseTo(0.89, 12);
      expect(signalBodyMotion(cycle + 1300).scale).toBe(1);
      for (const boundary of [0, 220, 1300])
        expect(
          Math.abs(
            signalBodyMotion(cycle + boundary - 0.001).scale -
              signalBodyMotion(cycle + boundary + 0.001).scale,
          ),
        ).toBeLessThan(1e-8);
    }
  });

  it("drifts on a bounded absolute clock without a jump at charge boundaries", () => {
    for (let time = 0; time <= 28000; time += 113) {
      const motion = signalBodyMotion(time);
      expect(Math.abs(motion.x)).toBeLessThanOrEqual(0.7);
      expect(Math.abs(motion.y)).toBeLessThanOrEqual(0.9);
      expect(motion.scale).toBeGreaterThanOrEqual(0.78);
      expect(motion.scale).toBeLessThanOrEqual(1);
      const repeat = signalBodyMotion(time + 14000);
      expect(repeat.x).toBeCloseTo(motion.x, 12);
      expect(repeat.y).toBeCloseTo(motion.y, 12);
    }
    for (const time of [10000, 14000, 20000]) {
      const before = signalBodyMotion(time - 0.001);
      const after = signalBodyMotion(time + 0.001);
      expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(
        0.00001,
      );
    }
    for (const time of [NaN, Infinity, -Infinity, -1])
      expect(signalBodyMotion(time)).toEqual(signalBodyMotion(0));
  });
});
