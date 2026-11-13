// Every read exported here needs a row in the permission suite's `cases`, and every by-id read
// needs its `owner` set there. The suite also scans this folder for reads missing from this file.
// Every protected read. The permission suite iterates these exports, so a read left out of here is
// a read left out of the suite.
export * from "./claims";
// Uploads (4.10): the four reads; the writes (createUpload and the rest) are `kind: "write"`
export * from "./files";
export * from "./policies";
// Saved quotes, the pay page and the purchase (5.6): owner-only
export * from "./quotes";
export * from "./referrals";
// Not protected reads: the account state and what's on file (4.7), for callers that already know
// who is asking. The suite's completeness scan skips this module. Named, so the raw writes behind
// closure and delete (deleteUserRow, insertClosure, lockUser and the rest) stay in
// "#/server/data/account", imported only by src/server/account.
export {
  getAccountState,
  hasRecordsOnFile,
  openClaimReference,
  recordsOnFile,
  type AccountState,
  type RecordsOnFile,
} from "./account";
