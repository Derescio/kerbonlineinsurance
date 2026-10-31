import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_site/")({ component: Home });

// Placeholder until the hero and landing parts land (3.2, 3.3)
function Home() {
  return (
    <div className="site-container" style={{ paddingBlock: "var(--space-16)" }}>
      <h1 className="kb-display-l">Kerb Online Insurance</h1>
      <p className="kb-body-l">
        Welcome to Kerb Online Insurance! We provide comprehensive insurance solutions for your
        vehicles, ensuring peace of mind on the road.
      </p>
    </div>
  );
}
