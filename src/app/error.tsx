"use client";

import { useEffect } from "react";

export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <section className="card stack-sm" role="alert">
      <h1>This screen couldn&apos;t load</h1>
      <p className="muted">Nothing was changed. Check your connection and try again.</p>
      <div className="row">
        <button type="button" className="button" onClick={() => retry()}>
          Try again
        </button>
      </div>
    </section>
  );
}
