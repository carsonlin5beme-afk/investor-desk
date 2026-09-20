"use client";

import { useEffect, useId, useRef, type CSSProperties } from "react";
import {
  asteroidPosition,
  sweptHitDistance,
  createAsteroidSequence,
  createAsteroidCompanionSchedule,
  type AsteroidEncounter,
} from "@/lib/sidebar-asteroids";
import styles from "./SidebarAsteroids.module.css";
import { useAsteroidImpactSound } from "./AmbientRadio";
import {
  startAsteroidImpact,
  IMPACT_DURATION_MS,
} from "./asteroid-impact-effects";

const silhouettes = [
  "M13 22 20 10 33 7 44 12 53 25 54 37 45 50 30 56 16 49 8 36Z",
  "M9 24 19 12 31 7 47 13 52 26 56 39 43 51 29 54 15 46 7 35Z",
  "M10 19 24 8 39 9 51 20 54 34 47 47 35 56 21 51 9 39 7 29Z",
];

export function SidebarAsteroids() {
  const playImpactSound = useAsteroidImpactSound();
  const id = useId().replace(/:/g, "");
  const field = useRef<HTMLSpanElement>(null);
  const rocks = useRef<(HTMLSpanElement | null)[]>([]);
  const bodies = useRef<(SVGSVGElement | null)[]>([]);
  const silhouettesRef = useRef<(SVGPathElement | null)[]>([]);

  useEffect(() => {
    const host = field.current;
    const beacon = host?.parentElement;
    const sidebar = beacon?.closest<HTMLElement>(".sidebar");
    const portfolios = sidebar?.querySelector<HTMLElement>(".portfolio-nav");
    const navigation = portfolios?.parentElement;
    const pulse = beacon?.querySelector<HTMLElement>('[class*="signalPulse"]');
    const lane = beacon?.querySelector<HTMLElement>('[class*="signalLine"]');
    if (
      !host ||
      !beacon ||
      !sidebar ||
      !pulse ||
      !lane ||
      !window.matchMedia ||
      !window.ResizeObserver ||
      !window.IntersectionObserver
    )
      return;
    type Slot = {
      stone: HTMLSpanElement;
      art: SVGSVGElement;
      path: SVGPathElement;
      encounter: AsteroidEncounter | null;
      impactAt: number;
      previous: { x: number; y: number; time: number } | null;
      clearImpact: () => void;
    };
    const slots: Slot[] = [];
    for (let i = 0; i < 2; i++) {
      const stone = rocks.current[i],
        art = bodies.current[i],
        path = silhouettesRef.current[i];
      if (!stone || !art || !path) return;
      slots.push({
        stone,
        art,
        path,
        encounter: null,
        impactAt: -1,
        previous: null,
        clearImpact: () => {},
      });
    }
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const seed = new Uint32Array(1);
    window.crypto.getRandomValues(seed);
    const next = createAsteroidSequence(seed[0]);
    const scheduleCompanion = createAsteroidCompanionSchedule(seed[0]);
    let frame = 0,
      lastFrame = 0,
      nextAt = 4_000,
      passageIndex = 0;
    let clockTime: number | null = null;
    let companionAt: number | null = null;
    let visible = false,
      width = 0,
      height = 0;
    const clearSlot = (slot: Slot) => {
      slot.clearImpact();
      slot.clearImpact = () => {};
      slot.encounter = null;
      slot.impactAt = -1;
      slot.previous = null;
      slot.stone.style.opacity = "0";
      slot.stone.dataset.active = "false";
      slot.stone.dataset.impact = "false";
      delete slot.stone.dataset.impactTime;
      delete slot.stone.dataset.impactDistance;
    };
    const clearPassage = () => {
      companionAt = null;
      slots.forEach(clearSlot);
      host.style.opacity = "0";
    };
    const spawn = (slot: Slot, time: number) => {
      const encounter = next(time);
      slot.encounter = encounter;
      slot.impactAt = -1;
      slot.previous = null;
      slot.stone.dataset.gold = String(encounter.gold);
      slot.stone.dataset.impact = "false";
      slot.stone.dataset.encounter = String(encounter.index);
      slot.stone.dataset.collision = String(encounter.impact);
      slot.stone.style.setProperty("--rock-size", `${encounter.size}px`);
      slot.path.setAttribute("d", silhouettes[encounter.variant]);
      passageIndex = encounter.index;
      return encounter;
    };
    const measure = () => {
      // Finish softly behind the last visible portfolio row, rather than
      // sending the projectile up through the entire navigation. Keep the
      // asteroid field and flight lane in the same collision coordinates.
      const beaconTop = beacon.getBoundingClientRect().top;
      const list = portfolios?.getBoundingClientRect();
      const nav = navigation?.getBoundingClientRect();
      const fadeTop =
        list && nav
          ? Math.min(list.bottom, nav.bottom) - Math.min(28, list.height / 2)
          : beaconTop;
      const rise = Math.max(0, beaconTop - fadeTop);
      beacon.style.setProperty("--signal-rise", `${rise}px`);
      width = host.clientWidth;
      height = lane.clientHeight;
      slots.forEach((slot) => {
        slot.previous = null;
      });
      sync();
    };
    const stop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      clockTime = null;
      clearPassage();
      host.dataset.running = "false";
    };
    const tick = (timestamp: number) => {
      if (
        !visible ||
        motion.matches ||
        document.visibilityState !== "visible" ||
        height < 105 ||
        width < 80
      ) {
        stop();
        return;
      }
      frame = requestAnimationFrame(tick);
      if (timestamp - lastFrame < 30) return;
      lastFrame = timestamp;
      const animation = pulse.getAnimations()[0];
      const time = animation?.currentTime;
      if (typeof time !== "number" || !Number.isFinite(time)) {
        clearPassage();
        clockTime = null;
        return;
      }
      if (clockTime === null || time < clockTime) {
        clearPassage();
        nextAt = time + 4_000;
      } else if (time - clockTime > 120) {
        // A busy frame does not retire a visible rock or its five-second effect.
        // Drop only stale collision segments and unspawned companion opportunities.
        slots.forEach((slot) => {
          slot.previous = null;
        });
        if (companionAt !== null && time >= companionAt) companionAt = null;
        if (!slots.some((slot) => slot.encounter)) nextAt = time + 4_000;
      }
      clockTime = time;
      if (!slots.some((slot) => slot.encounter) && companionAt === null) {
        if (time < nextAt) return;
        const primary = spawn(slots[0], time);
        companionAt = scheduleCompanion(primary);
        host.style.opacity = "1";
      }
      if (companionAt !== null && time >= companionAt) {
        const fresh = time - companionAt <= 120;
        companionAt = null;
        // A missed opportunity consumes no encounter and never catches up.
        if (fresh) spawn(slots[1], time);
      }
      // One projectile read and one authoritative clock serve both independent rocks.
      let head: {
        x: number;
        y: number;
        fieldLeft: number;
        fieldTop: number;
      } | null = null;
      if (Number(getComputedStyle(pulse).opacity) > 0.08) {
        const h = pulse.getBoundingClientRect(),
          f = host.getBoundingClientRect();
        head = {
          x: h.left + h.width / 2 - f.left,
          y: h.top - f.top,
          fieldLeft: f.left,
          fieldTop: f.top,
        };
      }
      for (const slot of slots) {
        const e = slot.encounter;
        if (!e) continue;
        const progress = (time - e.start) / e.duration;
        if (progress < 0) {
          slot.stone.dataset.active = "false";
          slot.stone.style.opacity = "0";
          continue;
        }
        if (
          (slot.impactAt < 0 && progress >= 1) ||
          (slot.impactAt >= 0 && time - slot.impactAt > IMPACT_DURATION_MS)
        ) {
          clearSlot(slot);
          continue;
        }
        slot.stone.dataset.active = "true";
        if (slot.impactAt >= 0) continue;
        const { x, y } = asteroidPosition(e, time, width, height);
        const opacity =
          Math.min(1, progress / 0.17, (1 - progress) / 0.17) * 0.8;
        slot.stone.style.opacity = String(Math.max(0, opacity));
        // Planned metadata never grants immunity: only the visible head's swept
        // physical path can break a rock, with history owned by this slot.
        if (head && Math.abs(x - width / 2) < e.size * 1.5) {
          const relative = { x: head.x - x, y: head.y - y, time };
          const distance =
            slot.previous &&
            time - slot.previous.time < 120 &&
            time >= slot.previous.time
              ? sweptHitDistance(slot.previous, relative)
              : Math.hypot(relative.x, relative.y);
          slot.previous = relative;
          if (distance <= e.size * 0.44 + 4) {
            slot.impactAt = time;
            slot.stone.dataset.impact = "true";
            slot.stone.dataset.impactTime = String(time);
            slot.stone.dataset.impactDistance = String(distance);
            slot.stone.style.transform = `translate(${x}px, ${y}px)`;
            const clearVisual = startAsteroidImpact(
              sidebar,
              { x: head.fieldLeft + x, y: head.fieldTop + y },
              e.gold,
            );
            const clearSound = playImpactSound(e.gold);
            slot.clearImpact = () => {
              clearVisual();
              clearSound();
            };
            continue;
          }
        } else slot.previous = null;
        slot.stone.style.transform = `translate(${x}px, ${y}px)`;
        slot.art.style.transform = `rotate(${e.angle + e.spin * progress}deg)`;
      }
      if (!slots.some((slot) => slot.encounter) && companionAt === null) {
        nextAt = time + 6_000 + ((passageIndex * 1973) % 5_000);
        host.style.opacity = "0";
      }
    };
    const sync = () => {
      const allowed =
        visible &&
        height >= 105 &&
        width >= 80 &&
        !motion.matches &&
        document.visibilityState === "visible";
      if (!allowed) {
        stop();
        return;
      }
      if (!frame) {
        const time = pulse.getAnimations()[0]?.currentTime;
        clockTime =
          typeof time === "number" && Number.isFinite(time) ? time : null;
        nextAt = (clockTime ?? 0) + 4_000;
        host.dataset.running = "true";
        frame = requestAnimationFrame(tick);
      }
    };
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(host);
    resize.observe(lane);
    resize.observe(beacon);
    resize.observe(sidebar);
    if (portfolios) resize.observe(portfolios);
    if (navigation) {
      resize.observe(navigation);
      navigation.addEventListener("scroll", measure, { passive: true });
    }
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      sync();
    });
    intersection.observe(host);
    motion.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      stop();
      resize.disconnect();
      navigation?.removeEventListener("scroll", measure);
      intersection.disconnect();
      motion.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [playImpactSound]);

  return (
    <span
      ref={field}
      className={styles.field}
      aria-hidden="true"
      data-asteroid-field
    >
      {[0, 1].map((slot) => {
        const rockId = `${id}-${slot}`;
        return (
          <span
            ref={(node) => {
              rocks.current[slot] = node;
            }}
            key={slot}
            className={styles.rock}
            data-asteroid
            data-active="false"
            data-impact="false"
          >
            <svg
              ref={(node) => {
                bodies.current[slot] = node;
              }}
              viewBox="0 0 64 64"
              className={styles.body}
              focusable="false"
            >
              <defs>
                <radialGradient
                  id={`${rockId}-stone`}
                  cx="28%"
                  cy="18%"
                  r="85%"
                >
                  <stop offset="0" stopColor="currentColor" stopOpacity=".46" />
                  <stop
                    offset=".48"
                    stopColor="currentColor"
                    stopOpacity=".15"
                  />
                  <stop offset="1" stopColor="#071015" stopOpacity=".95" />
                </radialGradient>
                <radialGradient
                  id={`${rockId}-gold-crater`}
                  cx="38%"
                  cy="28%"
                  r="80%"
                >
                  <stop offset="0" stopColor="#fff0b4" />
                  <stop offset=".35" stopColor="#e3ad3d" />
                  <stop offset=".7" stopColor="#88601d" />
                  <stop offset="1" stopColor="#241c0c" />
                </radialGradient>
                <radialGradient
                  id={`${rockId}-crater`}
                  cx="68%"
                  cy="75%"
                  r="80%"
                >
                  <stop offset="0" stopColor="currentColor" stopOpacity=".22" />
                  <stop offset=".45" stopColor="#060d10" stopOpacity=".86" />
                  <stop offset="1" stopColor="#020709" />
                </radialGradient>
              </defs>
              <path
                ref={(node) => {
                  silhouettesRef.current[slot] = node;
                }}
                d={silhouettes[0]}
                fill={`url(#${rockId}-stone)`}
                stroke="currentColor"
                strokeWidth=".9"
              />
              <path
                d="M13 22 25 18 33 7M25 18 38 23 44 12M38 23 46 37 54 37M46 37 35 46 30 56M35 46 20 40 16 49M20 40 13 22"
                fill="none"
                stroke="currentColor"
                strokeWidth=".55"
                opacity=".32"
              />
              <g
                fill={`url(#${rockId}-crater)`}
                stroke="currentColor"
                strokeWidth=".7"
              >
                <ellipse
                  cx="25"
                  cy="26"
                  rx="7.5"
                  ry="6.2"
                  transform="rotate(-22 25 26)"
                />
                <ellipse
                  cx="40"
                  cy="37"
                  rx="5.1"
                  ry="6.4"
                  transform="rotate(30 40 37)"
                />
                <ellipse cx="22" cy="43" rx="3.3" ry="2.5" />
                <ellipse cx="39" cy="17" rx="2.1" ry="1.6" />
              </g>
              <g
                className={styles.goldCraters}
                fill={`url(#${rockId}-gold-crater)`}
              >
                <ellipse
                  cx="25"
                  cy="26"
                  rx="6.4"
                  ry="5.1"
                  transform="rotate(-22 25 26)"
                />
                <ellipse
                  cx="40"
                  cy="37"
                  rx="4.1"
                  ry="5.3"
                  transform="rotate(30 40 37)"
                />
                <ellipse cx="22" cy="43" rx="2.4" ry="1.7" />
              </g>
              <path
                d="M18 26Q20 17 29 21M35 37Q36 30 41 31M19 43Q21 40 24 42M11 30 13 36M29 49 33 48"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.05"
                opacity=".74"
              />
              <g fill="currentColor" opacity=".5">
                <circle cx="32" cy="34" r=".7" />
                <circle cx="46" cy="26" r=".7" />
                <circle cx="31" cy="16" r=".5" />
                <circle cx="16" cy="36" r=".6" />
              </g>
            </svg>
            <span className={styles.impact} />
            <span className={styles.fragments}>
              {Array.from({ length: 7 }, (_, i) => (
                <i key={i} style={{ "--fragment": i } as CSSProperties} />
              ))}
            </span>
          </span>
        );
      })}
    </span>
  );
}
