"use client";
import { useMemo, useRef, useState } from "react";
import { z } from "zod";
import {
  scenarioSchema,
  validateScenarioPortfolios,
  validateScenarioTax,
} from "@/lib/studio";
import { useSessionDraft } from "./useSessionDraft";
const parseDraft = (input: unknown) => {
  const parsed = scenarioSchema
    .extend({ name: z.string().max(80) })
    .parse(input);
  validateScenarioPortfolios(parsed);
  validateScenarioTax(parsed);
  return parsed;
};
import {
  Copy,
  Plus,
  Save,
  Trash2,
  GitCompareArrows,
  ArrowRight,
  RotateCcw,
} from "lucide-react";
import { type Portfolio, money } from "@/lib/desk-types";
import {
  snapshot,
  scenarioTotalAt,
  scenarioFinancing,
  type SavedScenario,
  type Assumptions,
} from "@/lib/studio";
import { ValueChart } from "./ValueChart";
import { Segmented, SaveState } from "./Controls";
import type { WorkspaceController } from "./useWorkspace";
import { MonthlyScenario } from "./MonthlyScenario";
import { TaxTracker } from "./TaxTracker";
import {
  targetTaxSales,
  targetDaysForSaleDate,
  targetSaleDate,
} from "@/lib/scenario-tax-sales";

export function ScenarioStudio(props: {
  portfolios: Portfolio[];
  workspace: WorkspaceController;
}) {
  const [view, setView] = useState<"monthly" | "targets">("monthly");
  return (
    <div>
      <Segmented
        label="Scenario studio view"
        value={view}
        options={[
          { value: "monthly", label: "Monthly" },
          { value: "targets", label: "Target progress" },
        ]}
        onChange={setView}
      />
      {view === "monthly" ? (
        <MonthlyScenario key={props.workspace.identity} {...props} />
      ) : (
        <TargetScenarioStudio {...props} />
      )}
    </div>
  );
}

function TargetScenarioStudio({
  portfolios,
  workspace,
}: {
  portfolios: Portfolio[];
  workspace: WorkspaceController;
}) {
  const saved = workspace.entries
    .filter((e) => e.key.startsWith("scenario:"))
    .map((e) => e.value as SavedScenario);
  const [draft, setDraft] = useSessionDraft<SavedScenario>(
    `investor-desk:${workspace.identity}:scenario-draft`,
    parseDraft,
  );
  const [deleted, setDeleted] = useState<SavedScenario | null>(null);
  const [compared, setCompared] = useState<string[]>([]),
    [mode, setMode] = useState<"model" | "intrinsic">("model"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [didSave, setDidSave] = useState(false);
  const [saleTiming, setSaleTiming] = useState<{
    id: string;
    dateRaw?: string | null;
    daysRaw?: string;
    error: string;
  } | null>(null);
  const revision = useRef(0);
  const timingIssue =
    draft && saleTiming?.id === draft.id
      ? saleTiming.error
      : draft?.assumptions.daysForward == null && draft
        ? "Choose a sale date or days forward to restore valuation timing."
        : null;
  const current = useMemo(
    () => snapshot(portfolios, "Current targets"),
    [portfolios],
  );
  const scenarios = [current, ...saved.filter((s) => compared.includes(s.id))];
  const series = scenarios.map((s, i) => ({
    id: i === 0 ? "current" : s.id,
    name: s.name,
    color: ["var(--green)", "var(--copper)", "var(--blue)", "var(--purple)"][
      i % 4
    ],
    valueAt: (p: number) => scenarioTotalAt(s, p, mode),
    values: Array.from({ length: 41 }, (_, j) =>
      scenarioTotalAt(s, j / 40, mode),
    ),
  }));
  async function save() {
    if (!draft || timingIssue) return;
    setBusy(true);
    setError("");
    const savedRevision = revision.current;
    try {
      await workspace.save(`scenario:${draft.id}`, draft);
      if (savedRevision === revision.current) setDidSave(true);
      setCompared((v) =>
        [...v.filter((id) => id !== draft.id), draft.id].slice(-3),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const change = (partial: Partial<SavedScenario>) => {
    revision.current++;
    setDraft((old) => (old ? { ...old, ...partial } : old));
    setDidSave(false);
  };
  const assumption = (partial: Partial<Assumptions>) =>
    draft && change({ assumptions: { ...draft.assumptions, ...partial } });
  const changeSaleDate = (date: string | null) => {
    if (!draft) return;
    const days = targetDaysForSaleDate(draft, date);
    if (days == null) {
      revision.current++;
      setDidSave(false);
      assumption({ daysForward: null });
      setSaleTiming({
        id: draft.id,
        dateRaw: date,
        error:
          "Enter a sale date on or after capture, within the 10-year model horizon.",
      });
      return;
    }
    setSaleTiming(null);
    assumption({ daysForward: days });
  };
  return (
    <section className="studio-page">
      <div className="section-heading">
        <div>
          <span className="eyebrow">A place for a different possibility</span>
          <h2>
            Target progress<span className="heading-dot">.</span>
          </h2>
          <p className="muted">
            Save a snapshot. Change the assumptions. Compare the whole picture.
          </p>
        </div>
        <button
          className="button primary"
          disabled={!portfolios.length || workspace.loading}
          onClick={() => {
            revision.current++;
            setSaleTiming(null);
            setDraft(snapshot(portfolios, `Scenario ${saved.length + 1}`));
            setError("");
            setDidSave(false);
          }}
        >
          <Plus size={17} />
          New scenario
        </button>
      </div>
      <div className="panel scenario-comparison">
        <div className="section-heading">
          <h3>Compare your possibilities</h3>
          <Segmented
            label="Scenario valuation"
            value={mode}
            options={[
              { value: "model", label: "Model estimate" },
              { value: "intrinsic", label: "Intrinsic targets" },
            ]}
            onChange={setMode}
          />
        </div>
        <ValueChart series={series} label="Saved scenario comparison" />
        <p className="fine-print">
          Totals are net equity after frozen margin debt and modeled interest.
          Loan terms are captured per portfolio; option model interest is a
          separate assumption.
        </p>
        <div className="comparison-totals">
          {scenarios.map((s) => (
            <div key={s.id}>
              <span>{s.name}</span>
              <strong>{money(scenarioTotalAt(s, 1, mode), 0)}</strong>
              <small>
                {s === current
                  ? "Current workspace"
                  : "Snapshot · " + new Date(s.capturedAt).toLocaleDateString()}
              </small>
            </div>
          ))}
        </div>
        <p className="fine-print">
          Each saved scenario preserves its holdings, cash, quotes, and model
          date. Comparisons show hypothetical target progress, not performance
          or probability.
        </p>
      </div>
      {deleted && (
        <div className="undo-banner" role="status">
          <span>“{deleted.name}” removed.</span>
          <button
            className="text-button"
            onClick={async () => {
              try {
                await workspace.save(`scenario:${deleted.id}`, deleted);
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
      <div className="scenario-library">
        <div className="section-heading">
          <h3>
            Your saved scenarios <span className="muted">{saved.length}</span>
          </h3>
          <span className="muted">
            Compare up to three with your current targets
          </span>
        </div>
        {!saved.length ? (
          <div className="empty-inline">
            <GitCompareArrows size={25} />
            <div>
              <strong>Give your next what-if a name.</strong>
              <p>
                Scenarios are independent snapshots. Editing one keeps your
                actual portfolio targets intact.
              </p>
            </div>
          </div>
        ) : (
          <div className="scenario-cards">
            {saved.map((s) => (
              <article key={s.id} className="scenario-card">
                <div>
                  <span className="eyebrow">
                    {s.assets.length} holdings · {s.portfolioNames.join(", ")}
                  </span>
                  <h3>{s.name}</h3>
                  <strong>{money(scenarioTotalAt(s, 1, mode), 0)}</strong>
                  <p>{s.notes || "A saved view of your investment thesis."}</p>
                </div>
                <div className="card-actions">
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={compared.includes(s.id)}
                      disabled={
                        !compared.includes(s.id) && compared.length >= 3
                      }
                      onChange={(e) =>
                        setCompared((v) =>
                          e.target.checked
                            ? [...v, s.id]
                            : v.filter((id) => id !== s.id),
                        )
                      }
                    />
                    Compare
                  </label>
                  <button
                    className="text-button"
                    onClick={() => {
                      revision.current++;
                      setSaleTiming(null);
                      setDraft(structuredClone(s));
                      setDidSave(false);
                      setError("");
                    }}
                  >
                    Edit <ArrowRight size={14} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`Duplicate ${s.name}`}
                    onClick={() => {
                      revision.current++;
                      setSaleTiming(null);
                      setDraft({
                        ...structuredClone(s),
                        id: crypto.randomUUID(),
                        name: s.name.slice(0, 70) + " copy",
                      });
                      setDidSave(false);
                    }}
                  >
                    <Copy size={15} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`Delete ${s.name}`}
                    onClick={async () => {
                      setError("");
                      try {
                        await workspace.remove(`scenario:${s.id}`);
                        setDeleted(s);
                        setCompared((v) => v.filter((id) => id !== s.id));
                        if (draft?.id === s.id) setDraft(null);
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
        )}
      </div>
      {draft && (
        <section className="panel scenario-editor">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Your assumptions, made visible</span>
              <h3>Edit scenario</h3>
            </div>
            <button
              className="text-button"
              onClick={() => {
                revision.current++;
                setSaleTiming(null);
                setDraft(null);
                setError("");
              }}
            >
              Close editor
            </button>
          </div>
          <div className="two-column">
            <label>
              Scenario name
              <input
                maxLength={80}
                value={draft.name}
                onChange={(e) => change({ name: e.target.value })}
              />
            </label>
            <label>
              Cash in this scenario ($)
              <input
                type="number"
                min={0}
                step=".01"
                value={draft.cash}
                onChange={(e) => change({ cash: Number(e.target.value) })}
              />
            </label>
          </div>
          <label>
            What is your thesis?
            <textarea
              rows={3}
              maxLength={4000}
              value={draft.notes}
              onChange={(e) => change({ notes: e.target.value })}
              placeholder="What would have to be true for this scenario to happen?"
            />
          </label>
          <div className="scenario-targets">
            {draft.assets.map((a, index) => (
              <div key={a.id}>
                <div>
                  <strong>{a.label}</strong>
                  <small>
                    {a.quantity} {a.option ? "contracts" : "shares"} ·{" "}
                    {money(a.currentValue)} current
                  </small>
                </div>
                <label>
                  <span>{a.symbol} target ($)</span>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    placeholder="Keep current value"
                    value={a.target ?? ""}
                    onChange={(e) =>
                      change({
                        assets: draft.assets.map((v, i) =>
                          i === index
                            ? {
                                ...v,
                                target:
                                  e.target.value === ""
                                    ? null
                                    : Number(e.target.value),
                              }
                            : v,
                        ),
                      })
                    }
                  />
                </label>
              </div>
            ))}
          </div>
          <details className="disclosure">
            <summary>Option model assumptions</summary>
            <div className="three-column">
              <label>
                Option model risk-free rate (%)
                <input
                  type="number"
                  min={-10}
                  max={50}
                  step=".1"
                  value={draft.assumptions.rate * 100}
                  onChange={(e) =>
                    assumption({ rate: Number(e.target.value) / 100 })
                  }
                />
              </label>
              <label>
                IV override (%)
                <input
                  type="number"
                  min={1}
                  max={500}
                  step={1}
                  value={
                    draft.assumptions.iv == null
                      ? ""
                      : draft.assumptions.iv * 100
                  }
                  placeholder="Use each quote's IV"
                  onChange={(e) =>
                    assumption({
                      iv:
                        e.target.value === ""
                          ? null
                          : Number(e.target.value) / 100,
                    })
                  }
                />
              </label>
              <label>
                Days forward
                <input
                  type="number"
                  min={0}
                  max={3650}
                  step="any"
                  value={
                    saleTiming?.id === draft.id && saleTiming.daysRaw != null
                      ? saleTiming.daysRaw
                      : (draft.assumptions.daysForward ?? "")
                  }
                  onChange={(e) => {
                    const raw = e.target.value,
                      days = Number(raw);
                    if (
                      !raw.trim() ||
                      !Number.isFinite(days) ||
                      days < 0 ||
                      days > 3650
                    ) {
                      revision.current++;
                      setDidSave(false);
                      assumption({ daysForward: null });
                      setSaleTiming({
                        id: draft.id,
                        daysRaw: raw,
                        dateRaw: null,
                        error:
                          "Enter a finite number of days from 0 to 3650, or choose a valid sale date.",
                      });
                      return;
                    }
                    setSaleTiming(null);
                    assumption({ daysForward: days });
                  }}
                />
              </label>
            </div>
            <p className="fine-print">
              European Black–Scholes approximation, zero dividends, standard
              deliverables. Expiration uses intrinsic value. An IV override
              applies to every option in this saved scenario.
            </p>
            <button
              className="text-button"
              onClick={() => {
                setSaleTiming(null);
                assumption({ rate: 0.04, iv: null, daysForward: 0 });
              }}
            >
              <RotateCcw size={14} />
              Reset assumptions
            </button>
          </details>
          <ValueChart
            label={`${draft.name} preview`}
            series={[
              {
                id: draft.id,
                name: draft.name,
                color: "var(--green)",
                valueAt: (p: number) => scenarioTotalAt(draft, p, mode),
                values: Array.from({ length: 41 }, (_, i) =>
                  scenarioTotalAt(draft, i / 40, mode),
                ),
              },
            ]}
          />
          <p className="fine-print">
            Margin debt{" "}
            <span className="private-value">
              {money(
                draft.portfolioSnapshots?.reduce(
                  (sum, p) => sum + p.margin.debt,
                  0,
                ) ?? 0,
              )}
            </span>
            , new interest{" "}
            <span className="private-value">
              {money(scenarioFinancing(draft)?.interest)}
            </span>{" "}
            over {scenarioFinancing(draft)?.elapsedDays ?? "unavailable"}{" "}
            Eastern calendar days. Daily compounding uses each captured 360/365
            basis. Draft changes stay in this tab. Save the scenario to preserve
            it in your workspace.
          </p>
          <TaxTracker
            assets={draft.assets}
            settings={draft.tax}
            sales={targetTaxSales(draft, mode, !timingIssue)}
            onChange={(tax) => change({ tax })}
            scenarioId={draft.id}
            capturedAt={draft.capturedAt}
            context={`Full liquidation at 100% targets · ${mode === "model" ? "Model estimate" : "Intrinsic targets"}. The sale date is the option model and financing valuation date.`}
            saleDate={
              saleTiming?.id === draft.id && "dateRaw" in saleTiming
                ? saleTiming.dateRaw
                : targetSaleDate(draft)
            }
            onSaleDate={changeSaleDate}
          />
          {timingIssue && (
            <p className="error-box" role="alert">
              {timingIssue} Valuation timing is unknown; tax and future
              financing are unavailable until repaired.
            </p>
          )}
          <div className="editor-footer">
            <SaveState busy={busy} error={error} saved={didSave} />
            <button
              className="button primary"
              onClick={save}
              disabled={busy || !draft.name.trim() || Boolean(timingIssue)}
            >
              <Save size={16} />
              {busy ? "Saving…" : "Save scenario"}
            </button>
          </div>
        </section>
      )}
      {error && !draft && (
        <p className="error-box" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
