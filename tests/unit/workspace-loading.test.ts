// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  useWorkspace,
  type WorkspaceController,
} from "@/components/studio/useWorkspace";
import {
  defaultPreferences,
  type Preferences,
  type WorkspaceEntry,
} from "@/lib/studio";

vi.mock("@/lib/theme", () => ({ applyThemePreference: vi.fn() }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
type Pending = {
  method: string;
  signal?: AbortSignal;
  body?: { key: string; value: Preferences; version: number };
  resolve: (value: Response) => void;
};
let pending: Pending[];
let root: Root | undefined;
let host: HTMLDivElement;
let workspace: WorkspaceController;
const response = (body: unknown) =>
  ({ ok: true, json: async () => body }) as Response;
const entry = (version: number, privacy = false): WorkspaceEntry => ({
  key: "preferences",
  value: { ...defaultPreferences, privacy },
  version,
  updatedAt: "2026-09-13T01:00:00Z",
});
function Probe({ identity }: { identity: string | null }) {
  workspace = useWorkspace(identity);
  return createElement("div", null, JSON.stringify(workspace.entries));
}
async function render(identity: string | null) {
  await act(() => {
    root ??= createRoot(host);
    root.render(createElement(Probe, { identity }));
  });
}
beforeEach(() => {
  pending = [];
  host = document.createElement("div");
  document.body.append(host);
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_url: string, options: RequestInit = {}) =>
        new Promise<Response>((resolve) =>
          pending.push({
            method: options.method ?? "GET",
            signal: options.signal ?? undefined,
            body: options.body ? JSON.parse(String(options.body)) : undefined,
            resolve,
          }),
        ),
    ),
  );
});
afterEach(async () => {
  if (root) await act(() => root!.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

it("does not fetch or permit writes before identity resolves, then loads that identity only once", async () => {
  await render(null);
  expect(pending).toHaveLength(0);
  expect(workspace.loading).toBe(true);
  await expect(
    workspace.save("preferences", defaultPreferences),
  ).rejects.toThrow("Workspace changed");
  await render("profile-a");
  expect(pending).toHaveLength(1);
  await act(() => pending[0].resolve(response({ entries: [entry(4, true)] })));
  expect(workspace.preferences.privacy).toBe(true);
  expect(workspace.loading).toBe(false);
  await render("profile-a");
  expect(pending).toHaveLength(1);
});

it("aborts old identity reads, rejects stale callbacks and ignores late responses", async () => {
  await render("profile-a");
  const oldSave = workspace.save;
  await render("profile-b");
  expect(pending[0].signal!.aborted).toBe(true);
  expect(workspace.entries).toEqual([]);
  await expect(oldSave("preferences", defaultPreferences)).rejects.toThrow(
    "Workspace changed",
  );
  expect(pending).toHaveLength(2);
  await act(() => pending[1].resolve(response({ entries: [entry(7, false)] })));
  await act(() => pending[0].resolve(response({ entries: [entry(99, true)] })));
  expect(workspace.entries[0].version).toBe(7);
  expect(workspace.preferences.privacy).toBe(false);
});

it("keeps versioned functional mutations serialized within the resolved identity", async () => {
  await render("profile-a");
  await act(() => pending[0].resolve(response({ entries: [entry(4)] })));
  let first!: Promise<WorkspaceEntry>, second!: Promise<WorkspaceEntry>;
  await act(() => {
    first = workspace.save("preferences", (old) => ({
      ...(old as Preferences),
      privacy: true,
    }));
    second = workspace.save("preferences", (old) => ({
      ...(old as Preferences),
      density: "compact",
    }));
  });
  expect(pending).toHaveLength(2);
  expect(pending[1].body?.version).toBe(4);
  await act(() => pending[1].resolve(response({ entry: entry(5, true) })));
  expect(pending).toHaveLength(3);
  expect(pending[2].body?.version).toBe(5);
  expect(pending[2].body?.value).toMatchObject({
    privacy: true,
    density: "compact",
  });
  await act(() =>
    pending[2].resolve(
      response({ entry: { ...entry(6, true), value: pending[2].body!.value } }),
    ),
  );
  await Promise.all([first, second]);
  expect(workspace.entries[0].version).toBe(6);
});

it("aborts a pending reload on unmount", async () => {
  await render("guest");
  await act(() => root!.unmount());
  root = undefined;
  expect(pending[0].signal!.aborted).toBe(true);
  await act(() => pending[0].resolve(response({ entries: [entry(1)] })));
  expect(pending).toHaveLength(1);
});

it("orders a reload between existing and later saves without dropping mutations or using stale versions", async () => {
  await render("profile-a");
  await act(() => pending[0].resolve(response({ entries: [entry(4)] })));
  let first!: Promise<WorkspaceEntry>,
    second!: Promise<WorkspaceEntry>,
    reload!: Promise<void>;
  await act(() => {
    first = workspace.save("preferences", (old) => ({
      ...(old as Preferences),
      privacy: true,
    }));
  });
  expect(pending[1].method).toBe("PUT");
  await act(() => {
    reload = workspace.reload();
    second = workspace.save("preferences", (old) => ({
      ...(old as Preferences),
      density: "compact",
    }));
  });
  expect(pending).toHaveLength(2);
  await act(() => pending[1].resolve(response({ entry: entry(5, true) })));
  expect(pending.map((request) => request.method)).toEqual([
    "GET",
    "PUT",
    "GET",
  ]);
  expect(workspace.preferences.privacy).toBe(true);
  await act(() => pending[2].resolve(response({ entries: [entry(6, true)] })));
  expect(pending).toHaveLength(4);
  expect(pending[3].body).toMatchObject({
    version: 6,
    value: { privacy: true, density: "compact" },
  });
  await act(() =>
    pending[3].resolve(
      response({ entry: { ...entry(7, true), value: pending[3].body!.value } }),
    ),
  );
  await Promise.all([first, reload, second]);
  expect(workspace.entries[0].version).toBe(7);
});
