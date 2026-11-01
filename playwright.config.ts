import { defineConfig, devices } from "@playwright/test";

// E2E against a deployed URL (plan/engineering.md section 4): e2e.yml sets BASE_URL to each
// preview or staging deploy. Locally: `vp build && vp preview`, then
// `BASE_URL=http://localhost:4173 vp exec playwright test`.
const baseURL = process.env.BASE_URL ?? "http://localhost:4173";
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

export default defineConfig({
  testDir: "e2e",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    // Vercel Deployment Protection sends anonymous requests to its login page. The bypass header
    // gets through, and the cookie keeps it for navigations the header doesn't cover.
    // Previews also get the Vercel Toolbar script from vercel.live, which the CSP rightly blocks;
    // skipping it keeps the smoke test's "no CSP violations" check about our own code.
    extraHTTPHeaders: {
      "x-vercel-skip-toolbar": "1",
      ...(bypass && { "x-vercel-protection-bypass": bypass, "x-vercel-set-bypass-cookie": "true" }),
    },
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
