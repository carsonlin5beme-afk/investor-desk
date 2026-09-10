"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { applyThemePreference } from "@/lib/theme";
import { api } from "@/lib/desk-types";
import {
  defaultPreferences,
  type Preferences,
  type WorkspaceEntry,
  type WorkspaceValue,
} from "@/lib/studio";
export function useWorkspace(identity: string) {
  const [entries, setEntries] = useState<WorkspaceEntry[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const records = useRef<WorkspaceEntry[]>([]),
    generation = useRef(0),
    queue = useRef<Promise<unknown>>(Promise.resolve());
  const reload = useCallback(async () => {
    const g = ++generation.current;
    setLoading(true);
    try {
      const d = await api<{ entries: WorkspaceEntry[] }>("/api/workspace");
      if (g === generation.current) {
        records.current = d.entries;
        setEntries(d.entries);
        setError("");
      }
    } catch (e) {
      if (g === generation.current) setError((e as Error).message);
    } finally {
      if (g === generation.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    records.current = [];
    setEntries([]);
    void reload();
    return () => {
      generation.current++;
    };
  }, [identity, reload]);
  const save = useCallback(
    (
      key: string,
      value:
        | WorkspaceValue
        | ((previous: WorkspaceValue | undefined) => WorkspaceValue),
    ) => {
      const g = generation.current;
      const pending = queue.current
        .catch(() => {})
        .then(async () => {
          if (g !== generation.current)
            throw new Error("Workspace changed. Please reopen your draft.");
          const previous = records.current.find((e) => e.key === key);
          const d = await api<{ entry: WorkspaceEntry }>(
            "/api/workspace",
            "PUT",
            {
              key,
              value:
                typeof value === "function" ? value(previous?.value) : value,
              version: previous?.version ?? 0,
            },
          );
          if (g === generation.current) {
            records.current = [
              ...records.current.filter((e) => e.key !== key),
              d.entry,
            ];
            setEntries(records.current);
            setError("");
          }
          return d.entry;
        });
      queue.current = pending;
      return pending;
    },
    [],
  );
  const remove = useCallback((key: string) => {
    const g = generation.current;
    const pending = queue.current
      .catch(() => {})
      .then(async () => {
        if (g !== generation.current)
          throw new Error("Workspace changed. Please reopen this item.");
        const old = records.current.find((e) => e.key === key);
        if (!old) return;
        await api("/api/workspace", "DELETE", { key, version: old.version });
        if (g === generation.current) {
          records.current = records.current.filter((e) => e.key !== key);
          setEntries(records.current);
        }
      });
    queue.current = pending;
    return pending;
  }, []);
  const updatePreferences = useCallback(
    (patch: Partial<Preferences>) =>
      save("preferences", (old) => ({
        ...defaultPreferences,
        ...(old as Preferences | undefined),
        ...patch,
      })),
    [save],
  );
  const preferences =
    (entries.find((e) => e.key === "preferences")?.value as
      Preferences | undefined) ?? defaultPreferences;
  useEffect(() => {
    // Loading/error defaults must not replace a previously chosen appearance.
    if (loading || error) return;
    applyThemePreference(preferences.theme);
    document.documentElement.dataset.density = preferences.density;
  }, [preferences.theme, preferences.density, loading, error]);

  return {
    identity,
    entries,
    loading,
    error,
    reload,
    save,
    remove,
    preferences,
    updatePreferences,
  };
}
export type WorkspaceController = ReturnType<typeof useWorkspace>;
