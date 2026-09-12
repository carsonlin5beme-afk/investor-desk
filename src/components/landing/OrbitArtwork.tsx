"use client";

import Image from "next/image";
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
    const hero = stageElement.closest<HTMLElement>("[data-orbit-hero]");
    const header = hero
      ?.closest("[data-landing-page]")
      ?.querySelector("header");
    const fit = () => {
      if (header && hero)
        hero.style.setProperty(
          "--landing-header-height",
          `${header.getBoundingClientRect().height}px`,
        );
    };
    const resize =
      typeof ResizeObserver === "function" ? new ResizeObserver(fit) : null;
    if (header) resize?.observe(header);
    fit();
    return () => {
      leave();
      resize?.disconnect();
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
        <Image
          src="/landing/investor-orbit-v1.png"
          alt=""
          fill
          priority
          sizes="(max-width: 2000px) 100vw, 2000px"
          className={styles.fallback}
        />
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
