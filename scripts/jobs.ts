import { existsSync } from "node:fs";

import { createServer, createServerModuleRunner } from "vite-plus";

import { AuditKeyError, parseKeys } from "../src/server/audit/chain.ts";
import { databaseHost } from "./database-host.ts";
import { failureLine } from "./reset-two-factor-core.ts";

// The jobs crons, run by hand (4.11, spec call 14): Vercel Cron only calls Production.
//   vp run jobs:run                                   (the 6-hourly retry run)
//   vp run jobs:daily                                 (queue today's daily jobs, then run them)
//   NOW=2026-12-08T03:00:00Z vp run jobs:daily        (a run "later": due closures, stale uploads)
//   SEND_EMAILS=1 vp run jobs:run                     (really send email jobs through Resend)
// It runs the app's own runner, loaded through Vite's module runner so the `#/` imports resolve.
// Emails are counted and dropped unless SEND_EMAILS=1: the dev database is full of seeded
// addresses. Prints the database host and counts, never an email or a key.

// Locally the URL comes from .env.local (Neon `dev`), as in drizzle.config.ts. A DATABASE_URL already
// set in the shell wins (loadEnvFile never overrides), so `prod` is an explicit choice.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const mode = process.argv[2];
if (mode !== "run" && mode !== "daily") {
  console.error("Usage: node scripts/jobs.ts run|daily");
  process.exit(1);
}

// Closures write audit rows
try {
  parseKeys(process.env.AUDIT_HMAC_KEYS, process.env.AUDIT_HMAC_ACTIVE_VERSION);
} catch (error) {
  if (!(error instanceof AuditKeyError)) throw error;
  console.error(
    `Audit keys are not set or invalid (${error.reason}): see .env.example, "Audit (4.5b)".`,
  );
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}
const host = databaseHost(url);
if (!host) {
  console.error("DATABASE_URL is not a valid URL.");
  process.exit(1);
}

const now = process.env.NOW ? new Date(process.env.NOW) : new Date();
if (Number.isNaN(now.getTime())) {
  console.error("NOW is not a valid ISO date, e.g. NOW=2026-12-08T03:00:00Z.");
  process.exit(1);
}
const sendEmails = process.env.SEND_EMAILS === "1";

console.log(`Database: ${host}`);
console.log(`Bucket: ${process.env.R2_BUCKET?.trim() || "(R2_BUCKET is not set)"}`);
console.log(`Now: ${now.toISOString()}`);
console.log(`Emails: ${sendEmails ? "sent through Resend" : "dropped (SEND_EMAILS=1 sends them)"}`);

// One module runner, so the jobs and closeDb share the app's single pool
const server = await createServer({
  configFile: false,
  appType: "custom",
  logLevel: "error",
  resolve: { tsconfigPaths: true },
  server: { middlewareMode: true, hmr: false, ws: false },
});
const runner = createServerModuleRunner(server.environments.ssr, { hmr: false });

let code = 0;
let closeDb: (() => Promise<void>) | undefined;
try {
  const client = await runner.import<typeof import("../src/server/db/client.ts")>(
    "/src/server/db/client.ts",
  );
  const jobs = await runner.import<typeof import("../src/server/jobs/runner.ts")>(
    "/src/server/jobs/runner.ts",
  );
  const daily = await runner.import<typeof import("../src/server/jobs/daily.ts")>(
    "/src/server/jobs/daily.ts",
  );
  closeDb = client.closeDb;
  const db = client.getDb();

  let dropped = 0;
  const deferred: Promise<unknown>[] = [];
  let sendEmail: import("../src/server/email/send.ts").SendEmail = async () => {
    dropped++;
  };
  if (sendEmails) {
    const deps = await runner.import<typeof import("../src/server/jobs/deps.ts")>(
      "/src/server/jobs/deps.ts",
    );
    sendEmail = deps.jobDeps().sendEmail;
  }
  const deps = { sendEmail, defer: (work: Promise<unknown>) => void deferred.push(work) };

  if (mode === "daily") console.log(`Queued ${await daily.queueDailyJobs(db, now)} daily jobs.`);
  const result = await jobs.runDueJobs(db, deps, now);
  // The emails closures queued run straight after them, as they would after a request
  while (deferred.length > 0) await Promise.all(deferred.splice(0));

  console.log(
    `Ran ${result.ran}: done ${result.done}, failed ${result.failed}, dead ${result.dead}. Emails not sent: ${dropped}.`,
  );
  if (result.failed + result.dead > 0) code = 1;
} catch (error) {
  code = 1;
  // Name and SQLSTATE only: a message can carry row data
  console.error(failureLine(error));
} finally {
  await closeDb?.().catch(() => {});
  await runner.close().catch(() => {});
  await server.close().catch(() => {});
}
process.exit(code);
