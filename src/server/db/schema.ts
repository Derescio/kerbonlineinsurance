// Drizzle schema. Tables arrive in 4.2 (plan/phases/04-data-auth/phase.md); until then the only
// migration is the empty baseline, so the pipeline (deploy step, CI drift check, test setup) runs
// against real files. Change this file, then `vp run db:generate` and commit both.
export {};
