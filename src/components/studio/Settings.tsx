"use client";
import { useState } from "react";
import {
  Check,
  Database,
  Layers,
  Moon,
  Sun,
  Monitor,
  Wifi,
  ArrowRight,
} from "lucide-react";
import { DeskModal } from "@/components/DeskModal";
import { MarketDataCheck } from "@/components/MarketDataCheck";
import { type DeskData } from "@/lib/desk-types";
import type { WorkspaceController } from "./useWorkspace";
import { Segmented } from "./Controls";
export function Settings({
  data,
  workspace,
  close,
}: {
  data: DeskData | null;
  workspace: WorkspaceController;
  close: () => void;
}) {
  const [tab, setTab] = useState<"connections" | "assumptions" | "appearance">(
      "connections",
    ),
    [provider, setProvider] = useState<"alpaca" | "tradier" | "schwab">(
      data?.feeds.equityFeed === "schwab" ? "schwab" : "alpaca",
    ),
    [error, setError] = useState("");
  async function appearance(p: Partial<typeof workspace.preferences>) {
    setError("");
    try {
      await workspace.updatePreferences(p);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <DeskModal
      title="Make the desk yours"
      kicker="Connections, clarity & comfort"
      close={close}
    >
      <div className="modal-body settings-body">
        <Segmented
          label="Settings section"
          value={tab}
          options={[
            { value: "connections", label: "Connections" },
            { value: "assumptions", label: "Assumptions" },
            { value: "appearance", label: "Appearance" },
          ]}
          onChange={setTab}
        />
        {tab === "connections" ? (
          <>
            <div className="connection-current">
              <Wifi size={22} />
              <div>
                <strong>
                  {data?.mode === "demo"
                    ? "Exploring with sample data"
                    : "Using market-data providers"}
                </strong>
                <p>
                  Sample stocks and options work without brokerage
                  authorization. Every portfolio and trade here is simulated.
                </p>
              </div>
            </div>
            <div className="connection-steps">
              <div>
                <span>01</span>
                <div>
                  <h3>Choose your setup guide</h3>
                  <p>Use your provider account and the feeds it authorizes.</p>
                  <Segmented
                    label="Market data setup guide"
                    value={provider}
                    options={[
                      { value: "schwab", label: "Schwab stocks + options" },
                      { value: "alpaca", label: "Alpaca stocks + options" },
                      { value: "tradier", label: "Alpaca + Tradier" },
                    ]}
                    onChange={setProvider}
                  />
                </div>
              </div>
              <div>
                <span>02</span>
                <div>
                  <h3>Configure the local connection</h3>
                  <p>
                    {provider === "schwab"
                      ? "App credentials identify your developer app. Live data also needs your separate Schwab authorization and a successful feed check. Sample mode works without linking a brokerage."
                      : "Credentials stay on this machine’s server. Keep sample mode active until your connection checks pass."}
                  </p>
                  <details className="disclosure">
                    <summary>Open server configuration steps</summary>
                    <p>
                      Update the local .env file, then restart the local app to
                      apply these settings. This guide does not change
                      credentials or purchase access.
                    </p>
                    {provider === "schwab" ? (
                      <>
                        <p>
                          In your local project terminal, run{" "}
                          <code>npm run schwab:connect</code> after configuring
                          your approved Schwab app credentials locally.
                          Authorization opens Schwab in your browser;
                          credentials and tokens remain on the server.
                        </p>
                        <pre>{`MARKET_DATA_MODE=demo\nEQUITY_PROVIDER=schwab\nOPTIONS_PROVIDER=schwab\nSCHWAB_CLIENT_ID=your_app_key\nSCHWAB_CLIENT_SECRET=your_app_secret\nSCHWAB_CALLBACK_URL=https://127.0.0.1:8182`}</pre>
                        <p>
                          Register that exact callback in Schwab. The local
                          HTTPS listener uses a private certificate; your
                          browser may ask you to accept it at 127.0.0.1:8182.
                          Restart the app, check access below, then set
                          MARKET_DATA_MODE=live and restart. Run{" "}
                          <code>npm run schwab:status</code> for local
                          authorization status, or{" "}
                          <code>npm run schwab:disconnect</code> to remove local
                          tokens.
                        </p>
                        <p className="fine-print">
                          OAuth approval and feed entitlements are separate.
                          Expired or revoked authorization needs a fresh local
                          connection. Only quotes and option chains are
                          requested; portfolios and orders stay simulated.
                          Detailed activation checks are in
                          docs/schwab-market-data.md.
                        </p>
                      </>
                    ) : (
                      <>
                        <pre>{`MARKET_DATA_MODE=live\nEQUITY_PROVIDER=alpaca\nALPACA_API_KEY=your_key\nALPACA_API_SECRET=your_secret\nALPACA_FEED=sip\nOPTIONS_PROVIDER=${provider}\n${provider === "tradier" ? "TRADIER_API_TOKEN=your_token\n" : ""}ALPHAVANTAGE_API_KEY=your_key`}</pre>
                        <p className="fine-print">
                          SIP and OPRA require appropriate provider access. IEX
                          covers one exchange. Tradier sandbox quotes are
                          delayed. Reference APIs default to Alpaca
                          paper-account keys.
                        </p>
                      </>
                    )}
                  </details>
                </div>
              </div>
              <div>
                <span>03</span>
                <div>
                  <h3>Check your access</h3>
                  <p>
                    Check provider credentials, feed permissions, and quote
                    freshness.
                  </p>
                  <MarketDataCheck />
                </div>
              </div>
            </div>
          </>
        ) : tab === "assumptions" ? (
          <>
            <div className="assumption-card">
              <Database size={22} />
              <h3>Transparent by design.</h3>
              <p>
                A target answers a what-if question. It does not predict a date
                or likelihood.
              </p>
            </div>
            <dl className="detail-list">
              <div>
                <dt>Stock / ETF target</dt>
                <dd>Quantity × target share price</dd>
              </div>
              <div>
                <dt>Company valuation</dt>
                <dd>Market cap ÷ effective shares outstanding</dd>
              </div>
              <div>
                <dt>Option intrinsic</dt>
                <dd>
                  Exercise value at the target, multiplied by contracts and
                  deliverable
                </dd>
              </div>
              <div>
                <dt>Option model</dt>
                <dd>
                  Black–Scholes · 4% rate · zero dividends · remaining time
                </dd>
              </div>
              <div>
                <dt>Volatility</dt>
                <dd>
                  Provider IV when available; a labeled 60% assumption otherwise
                </dd>
              </div>
              <div>
                <dt>Execution</dt>
                <dd>
                  Buys at ask, sells at bid. Limits fill immediately or cancel.
                  No fees.
                </dd>
              </div>
              <div>
                <dt>Untargeted holdings</dt>
                <dd>
                  Stay at current value; unavailable prices are marked as
                  estimates
                </dd>
              </div>
            </dl>
            <p className="fine-print">
              Long positions only. No margin, shorting, adjusted contracts,
              automatic exercise, early exercise, corporate actions, or resting
              orders. Custom scenario assumptions stay in that scenario.
            </p>
          </>
        ) : (
          <>
            <h3>A workspace that feels right.</h3>
            <div className="theme-options">
              {[
                { value: "light", label: "Light", icon: Sun },
                { value: "dark", label: "Dark", icon: Moon },
                { value: "system", label: "System", icon: Monitor },
              ].map((o) => (
                <button
                  className={
                    workspace.preferences.theme === o.value ? "selected" : ""
                  }
                  aria-pressed={workspace.preferences.theme === o.value}
                  key={o.value}
                  onClick={() =>
                    appearance({
                      theme: o.value as "light" | "dark" | "system",
                    })
                  }
                >
                  <o.icon size={24} />
                  <span>{o.label}</span>
                  {workspace.preferences.theme === o.value && (
                    <Check size={15} />
                  )}
                </button>
              ))}
            </div>
            <div className="form-field">
              Workspace density
              <Segmented
                label="Workspace density"
                value={workspace.preferences.density}
                options={[
                  { value: "comfortable", label: "Comfortable" },
                  { value: "compact", label: "Compact" },
                ]}
                onChange={(density) => appearance({ density })}
              />
            </div>
            <label className="check-label">
              <input
                type="checkbox"
                checked={workspace.preferences.privacy}
                onChange={(e) => appearance({ privacy: e.target.checked })}
              />
              Mask workspace monetary values
            </label>
            <p className="fine-print">
              Your preference is{" "}
              {data?.user
                ? "saved with your profile"
                : "temporary until you save your guest workspace"}
              . Motion follows your device’s reduced-motion setting.
            </p>
          </>
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
