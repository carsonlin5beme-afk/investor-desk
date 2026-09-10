"use client";
import Link from "next/link";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="document-page">
      <span className="eyebrow">LET’S PICK UP WHERE YOU LEFT OFF</span>
      <h1>The desk needs a moment.</h1>
      <p>
        We couldn’t finish loading this view. Retry to reconnect to your
        workspace.
      </p>
      <div className="card-actions">
        <button className="button primary" onClick={reset}>
          Try again
        </button>
        <Link href="/dashboard" className="button secondary">
          Workspace home
        </Link>
      </div>
    </main>
  );
}
