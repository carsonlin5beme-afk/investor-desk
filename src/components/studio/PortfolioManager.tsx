"use client";
import { useState } from "react";
import { Pin, Archive, ArrowUp, ArrowDown, Copy, Check } from "lucide-react";
import { api, type Portfolio } from "@/lib/desk-types";
import { snapshot } from "@/lib/studio";
import { DeskModal } from "@/components/DeskModal";
import type { WorkspaceController } from "./useWorkspace";
export function PortfolioManager({
  portfolios,
  workspace,
  close,
  saved,
}: {
  portfolios: Portfolio[];
  workspace: WorkspaceController;
  close: () => void;
  saved: () => void;
}) {
  const [names, setNames] = useState<Record<string, string>>({}),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const prefs = workspace.preferences,
    ids = [
      ...prefs.order.filter((id) => portfolios.some((p) => p.id === id)),
      ...portfolios.map((p) => p.id).filter((id) => !prefs.order.includes(id)),
    ],
    ordered = ids.map((id) => portfolios.find((p) => p.id === id)!);
  async function action(run: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError("");
    try {
      await run();
      saved();
      setMessage(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <DeskModal
      title="Your portfolio collection"
      kicker="A place for every ambition"
      wide
      close={close}
      busy={busy}
    >
      <div className="modal-body">
        <p className="muted">
          Rename, pin, or reorder your portfolios. Archived portfolios stay
          saved and remain included in your overview totals.
        </p>
        {ordered.map((p, i) => (
          <div className="manage-portfolio" key={p.id}>
            <label>
              Portfolio name
              <input
                maxLength={80}
                value={names[p.id] ?? p.name}
                onChange={(e) =>
                  setNames((v) => ({ ...v, [p.id]: e.target.value }))
                }
              />
            </label>
            <div className="card-actions">
              <button
                className="button secondary"
                disabled={
                  busy ||
                  !(names[p.id] ?? p.name).trim() ||
                  !names[p.id] ||
                  names[p.id] === p.name
                }
                onClick={() =>
                  action(
                    () =>
                      api(`/api/portfolios/${p.id}`, "PATCH", {
                        name: names[p.id],
                      }),
                    "Portfolio renamed",
                  )
                }
              >
                <Check size={15} />
                Save name
              </button>
              <button
                className="icon-button"
                disabled={busy}
                aria-label={`${prefs.pinned.includes(p.id) ? "Unpin" : "Pin"} ${p.name}`}
                aria-pressed={prefs.pinned.includes(p.id)}
                onClick={() =>
                  action(
                    () =>
                      workspace.save("preferences", {
                        ...prefs,
                        pinned: prefs.pinned.includes(p.id)
                          ? prefs.pinned.filter((id) => id !== p.id)
                          : [...prefs.pinned, p.id],
                      }),
                    "Pin updated",
                  )
                }
              >
                <Pin size={17} />
              </button>
              <button
                className="icon-button"
                disabled={busy}
                aria-label={`${prefs.archived.includes(p.id) ? "Restore" : "Archive"} ${p.name}`}
                aria-pressed={prefs.archived.includes(p.id)}
                onClick={() =>
                  action(
                    () =>
                      workspace.save("preferences", {
                        ...prefs,
                        archived: prefs.archived.includes(p.id)
                          ? prefs.archived.filter((id) => id !== p.id)
                          : [...prefs.archived, p.id],
                      }),
                    "Collection updated",
                  )
                }
              >
                <Archive size={17} />
              </button>
              <button
                className="icon-button"
                disabled={busy || i === 0}
                aria-label={`Move ${p.name} up`}
                onClick={() => {
                  const order = [...ids];
                  [order[i - 1], order[i]] = [order[i], order[i - 1]];
                  void action(
                    () => workspace.save("preferences", { ...prefs, order }),
                    "Order updated",
                  );
                }}
              >
                <ArrowUp size={17} />
              </button>
              <button
                className="icon-button"
                disabled={busy || i === ordered.length - 1}
                aria-label={`Move ${p.name} down`}
                onClick={() => {
                  const order = [...ids];
                  [order[i + 1], order[i]] = [order[i], order[i + 1]];
                  void action(
                    () => workspace.save("preferences", { ...prefs, order }),
                    "Order updated",
                  );
                }}
              >
                <ArrowDown size={17} />
              </button>
              <button
                className="text-button"
                disabled={busy}
                onClick={() => {
                  const s = snapshot([p], `${p.name.slice(0, 60)} scenario`);
                  void action(
                    () => workspace.save(`scenario:${s.id}`, s),
                    "Snapshot added to Scenario studio",
                  );
                }}
              >
                <Copy size={15} />
                Save as scenario
              </button>
            </div>
          </div>
        ))}
        {message && (
          <p className="save-state" role="status">
            <Check size={16} />
            {message}
          </p>
        )}
        {error && (
          <p className="error-box" role="alert">
            {error}
          </p>
        )}
      </div>
    </DeskModal>
  );
}
