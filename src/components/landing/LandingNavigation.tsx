"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import styles from "./landing.module.css";
export function LandingNavigation() {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) {
        setOpen(false);
        toggle.current?.focus();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [open]);
  return (
    <>
      <button
        ref={toggle}
        className={styles.menuToggle}
        aria-expanded={open}
        aria-controls="landing-navigation"
        aria-label={open ? "Close navigation" : "Open navigation"}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <X size={21} /> : <Menu size={21} />}
      </button>
      <nav
        id="landing-navigation"
        aria-label="Main navigation"
        className={`${styles.nav} ${open ? styles.navOpen : ""}`}
        onClick={() => setOpen(false)}
      >
        <a href="#how-it-works">How it works</a>
        <a href="#your-workspace">The workspace</a>
        <a href="#questions">Questions</a>
        <Link href="/sign-in">Sign in</Link>
      </nav>
    </>
  );
}
