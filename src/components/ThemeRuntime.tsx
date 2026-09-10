"use client";
import { useEffect } from "react";
export function ThemeRuntime() {
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => {
      if (document.documentElement.dataset.themePreference === "system") {
        document.documentElement.dataset.theme = media.matches
          ? "dark"
          : "light";
      }
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return null;
}
