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
export function useWorkspace(identity: string | null) {
  const [entries, setEntries] = useState<WorkspaceEntry[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const records = useRef<WorkspaceEntry[]>([]),
    generation = useRef(0),
    activeIdentity = useRef<string | null>(null),
    readController = useRef<AbortController | null>(null),
    readPromise = useRef<Promise<void>>(Promise.resolve()),
    queue = useRef<Promise<unknown>>(Promise.resolve());
  const reload = useCallback(() => {
    if (identity === null || activeIdentity.current !== identity)
      return Promise.resolve();
    readController.current?.abort();
    const controller = new AbortController();
    readController.current = controller;
    const g = generation.current;
    const current = () =>
      g === generation.current &&
      activeIdentity.current === identity &&
      !controller.signal.aborted;
    setLoading(true);
    // Read after already queued writes; later writes wait for this read's versions.
    const writes = queue.current;
    const request = (async () => {
      try {
        await writes.catch(() => {});
        if (!current()) return;
        const d = await api<{ entries: WorkspaceEntry[] }>(
          "/api/workspace",
          "GET",
          undefined,
          controller.signal,
        );
        if (current()) {
          records.current = d.entries;
          setEntries(d.entries);
          setError("");
        }
      } catch (e) {
        if (current())
          setError(
            e instanceof Error ? e.message : "Unable to load the workspace.",
          );
      } finally {
        if (current()) setLoading(false);
      }
    })();
    readPromise.current = request;
    return request;
  }, [identity]);
  useEffect(() => {
    activeIdentity.current = identity;
    queue.current = Promise.resolve();
    readPromise.current = Promise.resolve();
    records.current = [];
    setEntries([]);
    setError("");
    setLoading(true);
    void reload();
    return () => {
      generation.current++;
      activeIdentity.current = null;
      readController.current?.abort();
      readController.current = null;
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
      const current = () =>
        identity !== null &&
        activeIdentity.current === identity &&
        g === generation.current;
      if (!current())
        return Promise.reject(
          new Error("Workspace changed. Please reopen your draft."),
        );
      const reading = readPromise.current;
      const pending = queue.current
        .catch(() => {})
        .then(async () => {
          await reading;
          if (!current())
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
    [identity],
  );
  const remove = useCallback(
    (key: string) => {
      const g = generation.current;
      const current = () =>
        identity !== null &&
        activeIdentity.current === identity &&
        g === generation.current;
      if (!current())
        return Promise.reject(
          new Error("Workspace changed. Please reopen this item."),
        );
      const reading = readPromise.current;
      const pending = queue.current
        .catch(() => {})
        .then(async () => {
          await reading;
          if (!current())
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
    },
    [identity],
  );
  const updatePreferences = useCallback(
    (patch: Partial<Preferences>) =>
      save("preferences", (old) => ({
        ...defaultPreferences,
        ...(old as Preferences | undefined),
        ...patch,
      })),
    [save],
  );
  const currentIdentity =
    identity !== null && activeIdentity.current === identity;
  const visibleEntries = currentIdentity ? entries : [];
  const preferences =
    (visibleEntries.find((e) => e.key === "preferences")?.value as
      Preferences | undefined) ?? defaultPreferences;
  useEffect(() => {
    // Loading/error defaults must not replace a previously chosen appearance.
    if (!currentIdentity || loading || error) return;
    applyThemePreference(preferences.theme);
    document.documentElement.dataset.density = preferences.density;
  }, [preferences.theme, preferences.density, currentIdentity, loading, error]);

  return {
    identity,
    entries: visibleEntries,
    loading: !currentIdentity || loading,
    error: currentIdentity ? error : "",
    reload,
    save,
    remove,
    preferences,
    updatePreferences,
  };
}
export type WorkspaceController = ReturnType<typeof useWorkspace>;
