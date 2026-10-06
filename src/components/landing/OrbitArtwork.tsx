"use client";

import { useEffect, useRef, useState } from "react";
import { mountLandingOrbit, type OrbitMotionState } from "@/lib/landing-orbit";
import styles from "./orbit-hero.module.css";

export function OrbitArtwork() {
  const stage = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const controller = useRef<ReturnType<typeof mountLandingOrbit> | null>(null);
  const [motion, setMotion] = useState<OrbitMotionState>({
    label: "Static artwork",
    disabled: true,
    paused: false,
  });
  useEffect(() => {
    if (!stage.current || !host.current) return;
    const stageElement = stage.current;
    const hostElement = host.current;
    const mount = () => {
      controller.current?.dispose();
      controller.current = mountLandingOrbit(
        stageElement,
        hostElement,
        setMotion,
      );
    };
    const leave = () => {
      controller.current?.dispose();
      controller.current = null;
    };
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) mount();
    };
    mount();
    window.addEventListener("pagehide", leave);
    window.addEventListener("pageshow", restore);
    return () => {
      leave();
      window.removeEventListener("pagehide", leave);
      window.removeEventListener("pageshow", restore);
    };
  }, []);
  return (
    <>
      <div
        ref={stage}
        className={styles.scene}
        data-orbit-stage
        data-state="static"
      >
        <picture>
          <source
            media="(max-width: 760px)"
            srcSet="/landing/investor-orbit-mobile.webp"
            width={600}
            height={2023}
          />
          {/* Captured from this renderer's initial pose, with the same camera. */}
          <img
            src="/landing/investor-orbit-desktop.webp"
            alt=""
            width={1600}
            height={2512}
            fetchPriority="high"
            decoding="async"
            className={styles.fallback}
          />
        </picture>
        <div ref={host} className={styles.canvasHost} aria-hidden="true" />
        <button
          type="button"
          className={styles.motionHitArea}
          disabled={motion.disabled}
          aria-label={motion.label}
          aria-pressed={motion.paused}
          onClick={() => controller.current?.toggle()}
        />
      </div>
    </>
  );
}
