"use client";

import { RefreshCw } from "lucide-react";

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="boot-screen">
      <div className="wordmark">
        1<span>%</span>
        <span className="brand-period">.</span>
      </div>
      <div className="error-message" role="alert">
        <span>
          Something went wrong opening this page. Your saved data is safe.
        </span>
      </div>
      <button className="button primary" onClick={reset}>
        <RefreshCw size={17} />
        Try again
      </button>
      <a className="text-button" href="/">
        Back to Today
      </a>
    </main>
  );
}
