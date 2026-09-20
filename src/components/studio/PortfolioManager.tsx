"use client";
import { useEffect, useRef, useState } from "react";
import {
  Pin,
  Archive,
  ArrowUp,
  ArrowDown,
  Copy,
  Check,
  Trash2,
} from "lucide-react";
import { api, type Portfolio } from "@/lib/desk-types";
import { snapshot } from "@/lib/studio";
import { DeskModal } from "@/components/DeskModal";
import type { WorkspaceController } from "./useWorkspace";
import styles from "./portfolio-manager.module.css";
export function PortfolioManager({
  portfolios,
  workspace,
  close,
  saved,
  deleted,
}: {
  portfolios: Portfolio[];
  workspace: WorkspaceController;
  close: () => void;
  saved: () => void;
  deleted: (id: string, confirmed?: boolean) => void;
}) {
  const [names, setNames] = useState<Record<string, string>>({}),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [confirmation, setConfirmation] = useState<Portfolio | null>(null);
  const deleteButtons = useRef(new Map<string, HTMLButtonElement>());
  const restoreFocus = useRef<string | null>(null);
  useEffect(() => {
    if (!confirmation && restoreFocus.current) {
      deleteButtons.current.get(restoreFocus.current)?.focus();
      restoreFocus.current = null;
    }
  }, [confirmation]);
  useEffect(() => {
    if (confirmation && !portfolios.some((p) => p.id === confirmation.id)) {
      // A refreshed snapshot can confirm absence after a lost DELETE response
      // or deletion in another tab, without claiming this request succeeded.
      deleted(confirmation.id, false);
    }
  }, [confirmation, portfolios, deleted]);
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
  async function removePortfolio() {
    if (!confirmation || busy) return;
    setBusy(true);
    setError("");
    try {
      await api(
        `/api/portfolios/${encodeURIComponent(confirmation.id)}`,
        "DELETE",
        {
          name: confirmation.name,
        },
      );
      deleted(confirmation.id);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to delete this portfolio.",
      );
      saved();
    } finally {
      setBusy(false);
    }
  }
  return (
    <DeskModal
      title={confirmation ? "Delete portfolio?" : "Your portfolio collection"}
      kicker={confirmation ? "Your workspace" : "A place for every ambition"}
      wide
      close={close}
      busy={busy}
    >
      <div className="modal-body">
        {confirmation ? (
          <>
            <p>
              Delete <strong>{confirmation.name}</strong> and its holdings,
              cash, and activity?
            </p>
            <p className="muted">
              This cannot be undone. Saved scenarios remain available.
            </p>
            <div className="card-actions">
              <button
                autoFocus
                className="button secondary"
                disabled={busy}
                onClick={() => {
                  restoreFocus.current = confirmation.id;
                  setConfirmation(null);
                  setError("");
                }}
              >
                Keep portfolio
              </button>
              <button
                className={`button ${styles.deleteButton}`}
                disabled={busy}
                onClick={() => void removePortfolio()}
              >
                <Trash2 size={16} />
                {busy ? "Deleting…" : "Delete portfolio"}
              </button>
            </div>
          </>
        ) : (
          <>
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
                    disabled={busy}
                    aria-label={`Delete ${p.name}`}
                    ref={(node) => {
                      if (node) deleteButtons.current.set(p.id, node);
                      else deleteButtons.current.delete(p.id);
                    }}
                    onClick={() => {
                      setConfirmation(p);
                      setError("");
                      setMessage("");
                    }}
                  >
                    <Trash2 size={15} />
                    Delete
                  </button>
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
                        () =>
                          workspace.save("preferences", { ...prefs, order }),
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
                        () =>
                          workspace.save("preferences", { ...prefs, order }),
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
                      const s = snapshot(
                        [p],
                        `${p.name.slice(0, 60)} scenario`,
                      );
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
          </>
        )}
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
