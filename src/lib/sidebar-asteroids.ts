/** Decorative encounter planning; no portfolio or market state enters this module. */
export const BLAST_PERIOD_MS = 10_000;
export const BLAST_FLIGHT_MS = 3_000;
const ASTEROID_LEAD_MS = 8_000;

export function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

// Matches signal-travel's cubic-bezier(.12, .72, .3, 1).
export function blastProgress(progress: number) {
  const x = Math.max(0, Math.min(1, progress));
  const curve = (t: number, a: number, b: number) =>
    3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t ** 2 * b + t ** 3;
  let low = 0,
    high = 1;
  for (let i = 0; i < 24; i++) {
    const middle = (low + high) / 2;
    if (curve(middle, 0.12, 0.3) < x) low = middle;
    else high = middle;
  }
  return curve((low + high) / 2, 0.72, 1);
}

export type AsteroidEncounter = {
  index: number;
  gold: boolean;
  impact: boolean;
  start: number;
  crossing: number;
  duration: number;
  size: number;
  direction: number;
  slope: number;
  angle: number;
  spin: number;
  height: number;
  variant: number;
};

/** One gold per twenty; one impact per ten gold visitors, in randomized slots. */
export function createAsteroidSequence(seed: number) {
  const random = seededRandom(seed);
  let index = 0;
  let gold = 0;
  let impacts: number[] = [];
  let goldCount = 0;
  let goldHitSlot = Math.floor(random() * 10);
  return (now: number): AsteroidEncounter => {
    const slot = index % 20;
    if (slot === 0) {
      gold = Math.floor(random() * 20);
      const candidates = Array.from({ length: 20 }, (_, i) => i).filter(
        (i) => i !== gold,
      );
      const first = candidates.splice(
        Math.floor(random() * candidates.length),
        1,
      )[0];
      impacts = [first, candidates[Math.floor(random() * candidates.length)]];
    }
    const isGold = slot === gold;
    if (isGold && goldCount > 0 && goldCount % 10 === 0)
      goldHitSlot = Math.floor(random() * 10);
    const impact = isGold
      ? goldCount++ % 10 === goldHitSlot
      : impacts.includes(slot);
    // Preserve the original pacing and encounter draw stream.
    const launch =
      Math.ceil((now + ASTEROID_LEAD_MS) / BLAST_PERIOD_MS) * BLAST_PERIOD_MS;
    const crossing = launch + (impact ? 600 : isGold ? 5_000 : 6_200);
    const size = (17 + random() * 8) * (isGold ? 3 : 1);
    const direction = random() < 0.5 ? -1 : 1;
    const diagonal = random() - 0.5;
    return {
      index: index++,
      gold: isGold,
      impact,
      start: now,
      crossing,
      duration: 2 * (crossing - now),
      size,
      direction,
      slope: (diagonal < 0 ? -1 : 1) * (60 + Math.abs(diagonal) * 80),
      angle: random() * 360,
      spin: (random() < 0.5 ? -1 : 1) * (18 + random() * 24),
      height: 0.25 + random() * 0.38,
      variant: Math.floor(random() * 3),
    };
  };
}

/** Decide once per primary. A scheduled companion is drawn only when it spawns,
 * using the caller's SAME createAsteroidSequence; pending slots consume no visitor. */
export function createAsteroidCompanionSchedule(seed: number) {
  const random = seededRandom(seed ^ 0x9e3779b9);
  return (primary: AsteroidEncounter): number | null => {
    if (random() >= 0.22) return null;
    const launch =
      Math.floor(primary.crossing / BLAST_PERIOD_MS) * BLAST_PERIOD_MS;
    const entrySpacing = primary.start + 4_000 + random() * 2_000;
    // Cross the next planning-cycle threshold without shifting or rerolling a visitor.
    const nextCycle = launch - ASTEROID_LEAD_MS + 200 + random() * 1_000;
    return Math.max(entrySpacing, nextCycle);
  };
}

/** Closest approach of the projectile relative to the drifting rock this frame. */
export function sweptHitDistance(
  previous: { x: number; y: number },
  current: { x: number; y: number },
) {
  const dx = current.x - previous.x,
    dy = current.y - previous.y;
  const length = dx * dx + dy * dy;
  const t =
    length === 0
      ? 0
      : Math.max(0, Math.min(1, -(previous.x * dx + previous.y * dy) / length));
  return Math.hypot(previous.x + t * dx, previous.y + t * dy);
}

/** Geometry shared by drawing and encounter verification. Gold misses remain
 * well clear of the firing window instead of making rocks immune to a hit. */
export function asteroidPosition(
  e: AsteroidEncounter,
  time: number,
  width: number,
  height: number,
) {
  const progress = (time - e.start) / e.duration;
  const travel = width + e.size * (e.gold ? 4 : 2);
  const x = width / 2 + e.direction * (progress - 0.5) * travel;
  const centerY = e.impact
    ? height * (1 - blastProgress(0.2))
    : height * (e.gold ? 0.64 : e.height);
  const y =
    (e.impact ? centerY : Math.max(20, Math.min(height - 34, centerY))) +
    e.slope * (progress - 0.5);
  return { x, y, progress };
}
