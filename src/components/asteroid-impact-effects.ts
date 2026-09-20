import styles from "./AsteroidImpactEffects.module.css";

export const IMPACT_DURATION_MS = 5_000;
const active = new WeakMap<HTMLElement, () => void>();

/** A transient, pointer-transparent response to a verified visible collision. */
export function startAsteroidImpact(
  sidebar: HTMLElement,
  point: { x: number; y: number },
  gold: boolean,
) {
  const root = sidebar.closest<HTMLElement>(".desk-shell");
  if (
    !root ||
    document.visibilityState !== "visible" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  )
    return () => {};
  active.get(root)?.();
  const bounds = sidebar.getBoundingClientRect();
  const width = gold ? window.innerWidth : bounds.width;
  const height = gold ? window.innerHeight : bounds.height;
  const x = point.x - (gold ? 0 : bounds.left);
  const y = point.y - (gold ? 0 : bounds.top);
  const reach = Math.hypot(Math.max(x, width - x), Math.max(y, height - y));
  const layer = document.createElement("div");
  layer.className = `${styles.layer} ${gold ? styles.gold : styles.sage}`;
  layer.dataset.asteroidImpact = gold ? "gold" : "sage";
  layer.setAttribute("aria-hidden", "true");
  layer.style.cssText = `left:${gold ? 0 : bounds.left}px;top:${gold ? 0 : bounds.top}px;width:${width}px;height:${height}px;--impact-x:${x}px;--impact-y:${y}px;--wave-size:${reach * 2.1}px`;
  for (let i = 0; i < 3; i++) {
    const wave = document.createElement("i");
    wave.className = styles.wave;
    wave.style.setProperty("--wave", String(i));
    layer.append(wave);
  }
  for (const name of [styles.aura, styles.core, styles.corona]) {
    const glow = document.createElement("i");
    glow.className = name;
    layer.append(glow);
  }
  for (let i = 0; i < (gold ? 24 : 12); i++) {
    const shard = document.createElement("i");
    shard.className = styles.shard;
    shard.style.setProperty("--angle", `${i * 137.508}deg`);
    shard.style.setProperty(
      "--distance",
      `${(gold ? 110 : 32) + (i % 7) * (gold ? 34 : 8)}px`,
    );
    shard.style.setProperty("--delay", `${(i % 3) * 18}ms`);
    shard.style.setProperty("--weight", `${i % 4 === 0 ? 3 : 1.3}px`);
    layer.append(shard);
  }
  document.body.append(layer);
  const target = gold ? root : sidebar;
  const mode = gold ? styles.goldMode : styles.sageMode;
  target.classList.add(mode);
  let timer: ReturnType<typeof setTimeout>;
  let disposed = false;
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    clearTimeout(timer);
    layer.remove();
    if (active.get(root) === cleanup) {
      target.classList.remove(mode);
      active.delete(root);
    }
  };
  active.set(root, cleanup);
  timer = setTimeout(cleanup, IMPACT_DURATION_MS);
  return cleanup;
}
