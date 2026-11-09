// Drizzle schema, one file per area (plan/phases/04-data-auth/02-schema.md). Change a file, then
// `vp run db:generate` and commit both; add the table to data-contract.ts in the same change.
export * from "./account";
export * from "./audit";
export * from "./auth";
export * from "./claims";
export * from "./customers";
export * from "./data";
export * from "./files";
export * from "./notifications";
export * from "./platform";
export * from "./policies";
export * from "./products";
export * from "./quotes";
export * from "./reference";
export * from "./relations";
export * from "./reviews";
export * from "./security";
export * from "./staff";
export * from "./underwriting";
