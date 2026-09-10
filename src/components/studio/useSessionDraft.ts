"use client";
import { useEffect, useState } from "react";
/** Drafts survive navigation and refresh in this tab; they are never shared across profiles. */
export function useSessionDraft<T>(key: string, parse: (value: unknown) => T) {
  const [draft, setDraft] = useState<T | null>(null),
    [ready, setReady] = useState("");
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(key);
      setDraft(raw ? parse(JSON.parse(raw)) : null);
    } catch {
      setDraft(null);
    }
    setReady(key);
  }, [key, parse]);
  useEffect(() => {
    if (ready !== key) return;
    try {
      if (draft) sessionStorage.setItem(key, JSON.stringify(draft));
      else sessionStorage.removeItem(key);
    } catch {
      /* Saving the committed record remains available when browser storage is full. */
    }
  }, [key, ready, draft]);
  return [draft, setDraft] as const;
}
