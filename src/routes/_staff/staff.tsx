import { createFileRoute } from "@tanstack/react-router";

// Placeholder so the guard has something to protect; the real staff area is 6.10.
export const Route = createFileRoute("/_staff/staff")({
  head: () => ({ meta: [{ title: "Staff area · Kerb" }] }),
  component: () => (
    <main id="main" className="page">
      <p>The staff area opens in 6.10.</p>
    </main>
  ),
});
