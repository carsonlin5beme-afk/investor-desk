"use client";
import { useState } from "react";
import {
  BookOpen,
  Plus,
  Save,
  Trash2,
  History,
  ExternalLink,
} from "lucide-react";
import type { Portfolio } from "@/lib/desk-types";
import { z } from "zod";
import { journalSchema } from "@/lib/studio";
import { useSessionDraft } from "./useSessionDraft";
const parseDraft = journalSchema.extend({ title: z.string().max(120) }).parse;
import type { JournalNote } from "@/lib/studio";
import type { WorkspaceController } from "./useWorkspace";
import { SaveState } from "./Controls";
export function Journal({
  workspace,
  portfolios,
  initialSymbol = "",
}: {
  workspace: WorkspaceController;
  portfolios: Portfolio[];
  initialSymbol?: string;
}) {
  const notes = workspace.entries
      .filter((e) => e.key.startsWith("note:"))
      .map((e) => e.value as JournalNote),
    holdings = portfolios.flatMap((p) => p.positions);
  const [draft, setDraft] = useSessionDraft<JournalNote>(
    `investor-desk:${workspace.identity}:journal-draft`,
    parseDraft,
  );
  const [deleted, setDeleted] = useState<JournalNote | null>(null);
  const [search, setSearch] = useState(initialSymbol),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  const start = () => {
    setDraft({
      id: crypto.randomUUID(),
      holdingId: "",
      symbol: initialSymbol,
      title: "",
      body: "",
      source: "",
      reviewDate: "",
      revisions: [],
    });
    setError("");
    setSaved(false);
  };
  const change = (p: Partial<JournalNote>) => {
    setDraft((v) => (v ? { ...v, ...p } : v));
    setSaved(false);
  };
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setBusy(true);
    setError("");
    try {
      const old = notes.find((n) => n.id === draft.id);
      const revisions =
        old && old.body !== draft.body
          ? [
              ...old.revisions,
              { body: old.body, at: new Date().toISOString() },
            ].slice(-20)
          : draft.revisions;
      const next = { ...draft, revisions };
      await workspace.save(`note:${draft.id}`, next);
      setDraft(next);
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="studio-page">
      <div className="section-heading">
        <div>
          <span className="eyebrow">The thinking behind the numbers</span>
          <h2>
            Thesis journal<span className="heading-dot">.</span>
          </h2>
          <p className="muted">
            Capture your conviction. Keep the evidence. Revisit what changed.
          </p>
        </div>
        <button
          className="button primary"
          disabled={workspace.loading}
          onClick={start}
        >
          <Plus size={17} />
          New note
        </button>
      </div>
      {deleted && (
        <div className="undo-banner" role="status">
          <span>“{deleted.title}” removed.</span>
          <button
            className="text-button"
            onClick={async () => {
              try {
                await workspace.save(`note:${deleted.id}`, deleted);
                setDeleted(null);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Undo delete
          </button>
        </div>
      )}
      <div className="journal-search">
        <label>
          <span className="sr-only">Search journal</span>
          <input
            placeholder="Search notes, symbols, or evidence…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        {search && (
          <button className="text-button" onClick={() => setSearch("")}>
            Clear
          </button>
        )}
      </div>
      {draft && (
        <form className="panel journal-editor" onSubmit={save}>
          <div className="two-column">
            <label>
              Title
              <input
                required
                maxLength={120}
                value={draft.title}
                onChange={(e) => change({ title: e.target.value })}
                placeholder="The case for…"
              />
            </label>
            <label>
              Related holding
              <select
                value={draft.holdingId}
                onChange={(e) => {
                  const h = holdings.find((h) => h.id === e.target.value);
                  change({
                    holdingId: e.target.value,
                    symbol: h?.optionDetails?.underlying ?? h?.symbol ?? "",
                  });
                }}
              >
                <option value="">General portfolio thesis</option>
                {holdings.map((h) => (
                  <option value={h.id} key={h.id}>
                    {h.optionDetails?.underlying ?? h.symbol} ·{" "}
                    {portfolios.find((p) => p.id === h.portfolioId)?.name}
                    {h.optionDetails ? " · " + h.optionDetails.right : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Your thesis
            <textarea
              rows={7}
              maxLength={12000}
              value={draft.body}
              onChange={(e) => change({ body: e.target.value })}
              placeholder="Conviction, catalysts, risks, and what would change your mind."
            />
          </label>
          <div className="two-column">
            <label>
              Evidence link
              <input
                type="url"
                value={draft.source}
                maxLength={2000}
                onChange={(e) => change({ source: e.target.value })}
                placeholder="https://…"
              />
            </label>
            <label>
              Review date
              <input
                type="date"
                value={draft.reviewDate}
                onChange={(e) => change({ reviewDate: e.target.value })}
              />
              <small>Shown in your journal when due.</small>
            </label>
          </div>
          <p className="fine-print">
            Draft changes stay in this tab. Save the note to keep it in your
            workspace.
          </p>
          <div className="editor-footer">
            <SaveState busy={busy} error={error} saved={saved} />
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => setDraft(null)}
            >
              Close editor
            </button>
            <button className="button primary" disabled={busy}>
              <Save size={16} />
              Save note
            </button>
          </div>
          {draft.revisions.length > 0 && (
            <details className="disclosure">
              <summary>
                <History size={15} />
                Previous versions ({draft.revisions.length})
              </summary>
              {[...draft.revisions].reverse().map((r, i) => (
                <div className="journal-revision" key={`${r.at}-${i}`}>
                  <small>{new Date(r.at).toLocaleString()}</small>
                  <p>{r.body || "Empty note"}</p>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => change({ body: r.body })}
                  >
                    Restore into editor
                  </button>
                </div>
              ))}
            </details>
          )}
        </form>
      )}
      {!notes.length && !draft && (
        <div className="empty-state">
          <span>
            <BookOpen size={30} />
          </span>
          <h3>Every target starts with a thesis.</h3>
          <p>Keep the ideas and evidence that make your portfolio yours.</p>
          <button className="button secondary" onClick={start}>
            Write your first note
          </button>
        </div>
      )}
      <div className="journal-grid">
        {notes
          .filter((n) =>
            `${n.title} ${n.body} ${n.symbol} ${n.source}`
              .toLowerCase()
              .includes(search.toLowerCase()),
          )
          .map((n) => (
            <article className="panel journal-note" key={n.id}>
              <div className="section-heading">
                <span className="eyebrow">
                  {n.symbol || "Portfolio thesis"}
                </span>
                {n.reviewDate && (
                  <span
                    className={`badge ${n.reviewDate <= new Date().toISOString().slice(0, 10) ? "amber" : "subtle"}`}
                  >
                    Review {n.reviewDate}
                  </span>
                )}
              </div>
              <h3>{n.title}</h3>
              <p className="note-excerpt">{n.body || "No details yet."}</p>
              {n.source && (
                <a
                  href={n.source}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-button"
                >
                  Evidence <ExternalLink size={14} />
                </a>
              )}
              <div className="card-actions">
                <button
                  className="text-button"
                  onClick={() => {
                    setDraft(structuredClone(n));
                    setSaved(false);
                    setError("");
                  }}
                >
                  Read & edit
                </button>
                <button
                  className="icon-button"
                  aria-label={`Delete note ${n.title}`}
                  onClick={async () => {
                    try {
                      await workspace.remove(`note:${n.id}`);
                      setDeleted(n);
                      if (draft?.id === n.id) setDraft(null);
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </article>
          ))}
      </div>
      {error && !draft && (
        <p className="error-box" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
