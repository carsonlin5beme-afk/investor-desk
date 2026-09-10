"use client";
import { AmbientRadioControls } from "@/components/AmbientRadio";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, LockKeyhole, Eye, EyeOff } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { api } from "@/lib/desk-types";
export function ProfileForm({ create = false }: { create?: boolean }) {
  const { data: session, isPending } = authClient.useSession();
  const [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [authenticated, setAuthenticated] = useState(false);
  const [guest, setGuest] = useState<{
    portfolioCount: number;
    entryCount: number;
    expired: boolean;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false),
    [capsLock, setCapsLock] = useState(false);
  const signedIn = authenticated || Boolean(session?.user);
  useEffect(() => {
    const controller = new AbortController();
    void api<{ portfolioCount: number; entryCount: number; expired: boolean }>(
      "/api/guest",
      "GET",
      undefined,
      controller.signal,
    )
      .then(setGuest)
      .catch(() => {});
    return () => controller.abort();
  }, []);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (!signedIn) {
        const result = create
          ? await authClient.signUp.email({
              name: name.trim(),
              email: email.trim(),
              password,
            })
          : await authClient.signIn.email({ email: email.trim(), password });
        if (result.error)
          throw new Error(
            result.error.message ?? "Unable to sign in. Please try again.",
          );
        setAuthenticated(true);
        setPassword("");
      }
      setSaving(true);
      await api("/api/guest/import", "POST", {});
      // Navigate only after the transaction commits. Failed imports keep the guest work for retry.
      window.location.assign("/dashboard");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Connection failed. Please retry.",
      );
      setBusy(false);
      setSaving(false);
    }
  }
  return (
    <form className="profile-form" onSubmit={submit}>
      <div className="profile-radio-row">
        <div className="profile-form-icon">
          <LockKeyhole size={24} />
        </div>
        <AmbientRadioControls />
      </div>
      <h1>
        {signedIn
          ? "Make it yours."
          : create
            ? "Keep your bigger picture."
            : "Welcome back."}
      </h1>
      <p>
        {signedIn
          ? `Signed in${session?.user ? ` as ${session.user.email}` : ""}. Continue to save your temporary guest work to this profile.`
          : create
            ? "An account is optional for exploring. Create one to keep your portfolios, holdings, cash, targets, scenarios, research notes, and trading history."
            : "Sign in to your saved workspace. Your saved guest portfolios, notes, and scenarios will be added automatically."}
      </p>
      {!!guest?.portfolioCount && (
        <div className="info-box" role="status">
          {guest.portfolioCount} guest{" "}
          {guest.portfolioCount === 1 ? "portfolio is" : "portfolios are"} ready
          to save. No rebuilding needed.
        </div>
      )}
      {!!guest?.entryCount && (
        <div className="info-box" role="status">
          Your guest notes, scenarios, and preferences are ready to save with
          this profile.
        </div>
      )}
      {guest?.expired && (
        <div className="error-box" role="status">
          Your previous guest session has ended. Account-saved portfolios are
          unaffected.
        </div>
      )}
      {!signedIn && (
        <fieldset disabled={busy || isPending}>
          {create && (
            <label>
              Profile name
              <input
                required
                autoComplete="name"
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
          )}
          <label>
            Email
            <input
              required
              type="email"
              autoComplete="email"
              maxLength={254}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label htmlFor="profile-password">Password</label>
          <div className="password-field">
            <input
              id="profile-password"
              required
              type={showPassword ? "text" : "password"}
              autoComplete={create ? "new-password" : "current-password"}
              minLength={create ? 12 : 1}
              maxLength={128}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyUp={(e) => setCapsLock(e.getModifierState("CapsLock"))}
              onKeyDown={(e) => setCapsLock(e.getModifierState("CapsLock"))}
              aria-describedby="password-hint"
            />
            <button
              className="icon-button"
              type="button"
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
              onClick={() => setShowPassword((v) => !v)}
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          <small id="password-hint">
            {capsLock ? "Caps Lock is on. " : ""}
            {create
              ? `${password.length} / 12 minimum characters`
              : "Use your local profile password."}
          </small>
          {create && (
            <small>
              Use at least 12 characters. Do not use your brokerage password.
            </small>
          )}
        </fieldset>
      )}
      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}
      <button className="button primary" disabled={busy || isPending}>
        {saving
          ? "Saving your workspace…"
          : busy
            ? "Please wait..."
            : signedIn
              ? "Save and continue"
              : create
                ? "Create profile & save"
                : guest?.portfolioCount || guest?.entryCount
                  ? "Sign in & save workspace"
                  : "Sign in to workspace"}
        <ArrowRight size={17} />
      </button>
      {!signedIn && (
        <p>
          {create ? "Already have a profile?" : "New to Investor Desk?"}{" "}
          <Link href={create ? "/sign-in" : "/sign-up"}>
            {create ? "Sign in" : "Create a profile"}
          </Link>
        </p>
      )}
      {signedIn && (
        <button
          className="text-button"
          type="button"
          disabled={busy}
          onClick={async () => {
            const result = await authClient.signOut();
            if (result.error) {
              setError("Unable to sign out. Try again.");
              return;
            }
            setAuthenticated(false);
            setError("");
          }}
        >
          Use a different account
        </button>
      )}
      <p>
        <Link href="/dashboard">
          {signedIn
            ? "Go to workspace; save guest work later"
            : "Keep exploring as a guest"}
        </Link>
      </p>
      <p className="fine-print">
        Temporary guest work lasts through page refreshes, but is not durable
        storage. Save before ending your browser session, restarting the server,
        or 24 hours of inactivity. Local profiles only; email verification and
        password recovery are not configured. No brokerage connection.
      </p>
    </form>
  );
}
