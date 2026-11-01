export default function NotFound() {
  return (
    <main className="boot-screen">
      <div className="wordmark">
        1<span>%</span>
        <span className="brand-period">.</span>
      </div>
      <div className="error-message" role="alert">
        <span>This page could not be found.</span>
      </div>
      <a className="button primary" href="/">
        Back to Today
      </a>
    </main>
  );
}
