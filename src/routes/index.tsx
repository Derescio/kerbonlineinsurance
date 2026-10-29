import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return (
    <main>
      <h1>Kerb Online Insurance Staging Test</h1>
      <p>
        Welcome to Kerb Online Insurance! We provide comprehensive insurance solutions for your
        vehicles, ensuring peace of mind on the road.
      </p>
    </main>
  );
}
