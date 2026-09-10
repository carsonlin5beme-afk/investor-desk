"use client";
import { useEffect, useState, type ComponentPropsWithoutRef } from "react";

type Props = Omit<ComponentPropsWithoutRef<"input">, "type">;

export function ScenarioRange(props: Props) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Form extensions can annotate SSR inputs before React hydrates them. Mount
  // just this control afterward, without suppressing genuine hydration errors.
  if (!mounted) return <span data-range-placeholder="" aria-hidden="true" />;
  return <input {...props} type="range" />;
}
