"use client";

import { useEffect, useRef } from "react";
import { createRingFrame, signalBodyMotion } from "@/lib/sidebar-rings";
import { createBlastLaunchClock } from "@/lib/blast-launch-clock";
import { useBlastLaunchSound } from "./AmbientRadio";
import styles from "./SidebarRings.module.css";

const restingFrame = createRingFrame(0);

export function SidebarRings() {
  const playLaunchSound = useBlastLaunchSound();
  const rig = useRef<SVGSVGElement>(null);
  const firstBack = useRef<SVGPathElement>(null);
  const secondBack = useRef<SVGPathElement>(null);
  const firstFront = useRef<SVGPathElement>(null);
  const secondFront = useRef<SVGPathElement>(null);
  const spark = useRef<SVGCircleElement>(null);
  const rims = useRef<(SVGPathElement | null)[]>([]);
  const flow = useRef<(SVGPathElement | null)[]>([]);

  useEffect(() => {
    const host = rig.current;
    const dot = spark.current;
    const orb = host?.parentElement;
    const edgePaths = rims.current;
    const materialPaths = flow.current;
    const paths = [
      [firstBack.current, firstFront.current],
      [secondBack.current, secondFront.current],
    ];
    const beacon = host?.closest<HTMLElement>('[class*="signalBeacon"]');
    const pulse = beacon?.querySelector<HTMLElement>('[class*="signalPulse"]');
    const lane = beacon?.querySelector<HTMLElement>('[class*="signalLine"]');
    if (
      !host ||
      !dot ||
      !orb ||
      !pulse ||
      !lane ||
      paths.some((pair) => pair.some((path) => !path)) ||
      edgePaths.length !== 2 ||
      edgePaths.some((path) => !path) ||
      materialPaths.length !== 4 ||
      materialPaths.some((path) => !path) ||
      !window.matchMedia ||
      !window.ResizeObserver ||
      !window.IntersectionObserver
    )
      return;

    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let visible = false;
    let disposed = false;
    let laneHeight = 0;
    let frame = 0;
    let lastFrame = -Infinity;
    const launchClock = createBlastLaunchClock();
    let clearLaunch = () => {};

    function draw(time: number, showSpark: boolean) {
      const state = createRingFrame(time);
      const body = showSpark
        ? signalBodyMotion(time)
        : { scale: 1, x: 0, y: 0 };
      orb!.style.setProperty("--signal-body-scale", String(body.scale));
      // The complete emitter and flight lane drift together; collision code
      // continues reading the actual translated projectile head.
      for (const element of [orb!, lane!]) {
        element.style.setProperty("--signal-float-x", `${body.x}px`);
        element.style.setProperty("--signal-float-y", `${body.y}px`);
        element.style.transform = `translate(${body.x}px, ${body.y}px)`;
      }
      orb!.style.setProperty("--signal-energy", String(state.energy));
      paths.forEach(([back, front], index) => {
        back?.setAttribute("d", state.paths[index].back);
        front?.setAttribute("d", state.paths[index].front);
        edgePaths[index]?.setAttribute("d", state.rims[index]);
        materialPaths[index * 2]?.setAttribute("d", state.flow[index].first);
        materialPaths[index * 2 + 1]?.setAttribute(
          "d",
          state.flow[index].second,
        );
      });
      dot!.setAttribute("cx", state.spark.x.toFixed(3));
      dot!.setAttribute("cy", state.spark.y.toFixed(3));
      dot!.setAttribute(
        "opacity",
        showSpark
          ? String(state.opacity * (state.spark.z < 0 ? 0.55 : 1))
          : "0",
      );
      host!.dataset.clock = time.toFixed(3);
      host!.dataset.activeRing = String(state.activeRing);
      host!.dataset.radius = state.radius.toFixed(3);
      host!.dataset.energy = state.energy.toFixed(6);
    }

    function allowed() {
      return (
        !disposed &&
        visible &&
        laneHeight > 0 &&
        !motion.matches &&
        document.visibilityState === "visible"
      );
    }

    function drawFromClock(wall = performance.now()) {
      // CSS owns the full ten-second initial charge and all later launches.
      // Only spark laps wrap at ten seconds; plane angles use absolute time.
      const time = pulse!.getAnimations()[0]?.currentTime;
      if (typeof time === "number" && Number.isFinite(time)) {
        draw(time, true);
        if (launchClock.sample(time, wall)) {
          clearLaunch();
          clearLaunch = playLaunchSound();
        }
      } else {
        launchClock.reset();
        clearLaunch();
        clearLaunch = () => {};
        draw(0, false);
      }
    }

    function tick(timestamp: number) {
      frame = 0;
      if (!allowed()) {
        stop();
        return;
      }
      if (timestamp - lastFrame >= 1_000 / 30) {
        lastFrame = timestamp;
        drawFromClock(timestamp);
      }
      frame = requestAnimationFrame(tick);
    }

    function stop() {
      cancelAnimationFrame(frame);
      frame = 0;
      launchClock.reset();
      clearLaunch();
      clearLaunch = () => {};
      host!.dataset.running = "false";
      draw(0, false);
    }

    function sync() {
      if (!allowed()) {
        stop();
        return;
      }
      if (!frame) {
        lastFrame = -Infinity;
        host!.dataset.running = "true";
        drawFromClock();
        frame = requestAnimationFrame(tick);
      }
    }

    const resize = new ResizeObserver(() => {
      laneHeight = lane.clientHeight;
      sync();
    });
    const intersection = new IntersectionObserver(([entry]) => {
      visible =
        entry.isIntersecting &&
        entry.intersectionRect.width > 0 &&
        entry.intersectionRect.height > 0;
      sync();
    });
    laneHeight = lane.clientHeight;
    resize.observe(lane);
    intersection.observe(host);
    motion.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    sync();

    return () => {
      disposed = true;
      stop();
      resize.disconnect();
      intersection.disconnect();
      motion.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [playLaunchSound]);

  return (
    <svg
      ref={rig}
      className={styles.rings}
      viewBox="0 0 64 64"
      focusable="false"
      aria-hidden="true"
      data-sidebar-rings
      data-running="false"
    >
      <g className={styles.rim}>
        {restingFrame.rims.map((path, index) => (
          <path
            key={index}
            ref={(element) => {
              rims.current[index] = element;
            }}
            d={path}
          />
        ))}
      </g>
      <g className={styles.back}>
        <path ref={firstBack} d={restingFrame.paths[0].back} />
        <path ref={secondBack} d={restingFrame.paths[1].back} />
      </g>
      <g className={styles.front}>
        <path ref={firstFront} d={restingFrame.paths[0].front} />
        <path ref={secondFront} d={restingFrame.paths[1].front} />
      </g>
      <g className={styles.flow}>
        {restingFrame.flow.flatMap((ring, index) =>
          [ring.first, ring.second].map((path, part) => (
            <path
              key={`${index}-${part}`}
              ref={(element) => {
                flow.current[index * 2 + part] = element;
              }}
              className={part === 1 ? styles.faintFlow : undefined}
              d={path}
            />
          )),
        )}
      </g>
      <circle
        ref={spark}
        className={styles.spark}
        cx={restingFrame.spark.x.toFixed(3)}
        cy={restingFrame.spark.y.toFixed(3)}
        r="1.65"
        opacity="0"
      />
    </svg>
  );
}
