import Link from "next/link";

export default function NotFound() {
  return (
    <section className="card stack-sm">
      <h1>Page not found</h1>
      <p className="muted">That page doesn&apos;t exist.</p>
      <div className="row">
        <Link className="button" href="/">
          Go to Today
        </Link>
      </div>
    </section>
  );
}
