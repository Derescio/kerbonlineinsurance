import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return (
    <main>
      <h1 className="kb-display-l">Kerb Online Insurance</h1>
      <p className="kb-body-l">
        Welcome to Kerb Online Insurance! We provide comprehensive insurance solutions for your
        vehicles, ensuring peace of mind on the road.
      </p>
    </main>
  );
}
