export type Vec3 = { x: number; y: number; z: number };
export type RingPaths = { front: string; back: string };
export type RingFrame = {
  radius: number;
  normals: [Vec3, Vec3];
  junction: Vec3;
  paths: [RingPaths, RingPaths];
  flow: [{ first: string; second: string }, { first: string; second: string }];
  rims: [string, string];
  spark: Vec3;
  activeRing: 0 | 1;
  lap: number;
  energy: number;
  opacity: number;
};

const TAU = Math.PI * 2;
const RADIUS = 23;
const PERSPECTIVE = 140;
const SAMPLES = 96;
const radians = (degrees: number) => (degrees * Math.PI) / 180;
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const normalize = (point: Vec3): Vec3 => {
  const length = Math.hypot(point.x, point.y, point.z);
  return { x: point.x / length, y: point.y / length, z: point.z / length };
};
const normalAt = (tilt: number, azimuth: number): Vec3 => ({
  x: Math.sin(tilt) * Math.cos(azimuth),
  y: Math.cos(tilt),
  z: Math.sin(tilt) * Math.sin(azimuth),
});

/** Project into the 64 × 64 SVG; retain world depth for front/back layering. */
export function projectPoint(point: Vec3): Vec3 {
  const scale = PERSPECTIVE / (PERSPECTIVE - point.z);
  return { x: 32 + point.x * scale, y: 32 + point.y * scale, z: point.z };
}

/** The live intersection anchors both circles, so a complete lap can hand off. */
export function ringPoint(normal: Vec3, junction: Vec3, theta: number): Vec3 {
  const tangent = normalize(cross(normal, junction));
  const cosine = Math.cos(theta);
  const sine = Math.hypot(junction.x, junction.y, junction.z) * Math.sin(theta);
  return {
    x: junction.x * cosine + tangent.x * sine,
    y: junction.y * cosine + tangent.y * sine,
    z: junction.z * cosine + tangent.z * sine,
  };
}

const coordinates = (point: Vec3) => {
  const projected = projectPoint(point);
  return `${projected.x.toFixed(3)} ${projected.y.toFixed(3)}`;
};

function arcPath(
  normal: Vec3,
  junction: Vec3,
  start: number,
  sweep: number,
): string {
  const count = Math.ceil((SAMPLES * sweep) / TAU);
  return Array.from(
    { length: count + 1 },
    (_, index) =>
      `${index === 0 ? "M" : "L"}${coordinates(ringPoint(normal, junction, start + (sweep * index) / count))}`,
  ).join("");
}

const smoothstep = (value: number) => value * value * (3 - 2 * value);
function radiusAt(time: number, phase: number): number {
  if (time < 10000) return RADIUS;
  const milliseconds = phase * 10000;
  const scale =
    milliseconds <= 180
      ? 1 - 0.45 * smoothstep(milliseconds / 180)
      : milliseconds < 1200
        ? 0.55 + 0.45 * smoothstep((milliseconds - 180) / 1020)
        : 1;
  return RADIUS * Math.min(1, Math.max(0.55, scale));
}

/** Subpixel drift uses absolute time; only the shell breath resets at launch. */
export function signalBodyMotion(timeMs: number) {
  const time = Number.isFinite(timeMs) ? Math.max(0, timeMs) : 0;
  const phase = time % 10000;
  const angle = (TAU * (time % 14000)) / 14000;
  let scale = 1;
  if (time >= 10000 && phase < 1300) {
    scale =
      phase <= 220
        ? 1 - 0.22 * smoothstep(phase / 220)
        : 0.78 + 0.22 * smoothstep((phase - 220) / 1080);
  }
  return {
    scale,
    x: 0.7 * Math.sin(angle),
    y: 0.9 * Math.sin(angle + Math.PI / 3),
  };
}

/** Integrated material turns; 25 integer turns make every 10-second seam continuous. */
export function materialSpinTurns(timeMs: number): number {
  const time = Number.isFinite(timeMs) ? timeMs : 0;
  const phase = (((time % 10000) + 10000) % 10000) / 10000;
  return 25 * Math.floor(time / 10000) + 15 * phase + 10 * phase ** 3;
}

function circlePaths(normal: Vec3, junction: Vec3): RingPaths {
  const points = Array.from({ length: SAMPLES }, (_, index) =>
    ringPoint(normal, junction, (TAU * index) / SAMPLES),
  );
  const paths: RingPaths = { front: "", back: "" };
  let previousSide: keyof RingPaths | null = null;
  const append = (side: keyof RingPaths, start: Vec3, end: Vec3) => {
    if (side !== previousSide) paths[side] += `M${coordinates(start)}`;
    paths[side] += `L${coordinates(end)}`;
    previousSide = side;
  };
  for (let index = 0; index < SAMPLES; index++) {
    const start = points[index];
    // Reuse the actual first point to close the sampled circle without drift.
    const end = points[(index + 1) % SAMPLES];
    const startSide = start.z >= 0 ? "front" : "back";
    const endSide = end.z >= 0 ? "front" : "back";
    if (startSide === endSide) {
      append(startSide, start, end);
      continue;
    }
    // Split this edge at z=0 rather than skipping an edge at each transition.
    const fraction = start.z / (start.z - end.z);
    const intersection = {
      x: start.x + (end.x - start.x) * fraction,
      y: start.y + (end.y - start.y) * fraction,
      z: 0,
    };
    append(startSide, start, intersection);
    append(endSide, intersection, end);
  }
  return paths;
}

/** Deterministic animation geometry. Time is elapsed milliseconds, not frame count. */
export function createRingFrame(timeMs: number): RingFrame {
  const time = Number.isFinite(timeMs) ? timeMs : 0;
  const phase = (((time % 10000) + 10000) % 10000) / 10000;
  const radius = radiusAt(time, phase);
  // Reduce before multiplying so even very large finite times remain bounded.
  const rotation = (TAU * (((time % 24000) + 24000) % 24000)) / 24000;
  const normals: [Vec3, Vec3] = [
    normalAt(radians(55), radians(25) + rotation),
    normalAt(radians(75), radians(155) - rotation),
  ];
  // Different polar tilts keep this cross product away from zero for all time.
  const intersection = normalize(cross(normals[0], normals[1]));
  const junction = {
    x: intersection.x * radius,
    y: intersection.y * radius,
    z: intersection.z * radius,
  };
  const energy = phase * phase;
  const laps = 8 * energy;
  const lap = Math.floor(laps);
  const activeRing = (lap % 2) as 0 | 1;
  // Full-cycle material turns are integers. Reduce them before trigonometry,
  // retaining phase precision even when a large elapsed time is supplied.
  const materialAngle = TAU * ((15 * phase + 10 * phase ** 3) % 1);
  const flowFor = (normal: Vec3, angle: number) => ({
    first: arcPath(normal, junction, angle, radians(100)),
    second: arcPath(normal, junction, angle + radians(190), radians(65)),
  });
  const innerJunction = {
    x: junction.x * 0.95,
    y: junction.y * 0.95,
    z: junction.z * 0.95,
  };
  return {
    radius,
    normals,
    junction,
    paths: [
      circlePaths(normals[0], junction),
      circlePaths(normals[1], junction),
    ],
    flow: [
      flowFor(normals[0], materialAngle),
      flowFor(normals[1], -materialAngle),
    ],
    rims: [
      arcPath(normals[0], innerJunction, 0, TAU) + "Z",
      arcPath(normals[1], innerJunction, 0, TAU) + "Z",
    ],
    spark: projectPoint(
      ringPoint(normals[activeRing], junction, TAU * (laps - lap)),
    ),
    activeRing,
    lap,
    energy,
    opacity: 0.32 + 0.68 * energy,
  };
}
