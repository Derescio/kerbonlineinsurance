// Every read exported here needs a row in the permission suite's `cases`, and every by-id read
// needs its `owner` set there. The suite also scans this folder for reads missing from this file.
// Every protected read. The permission suite iterates these exports, so a read left out of here is
// a read left out of the suite.
export * from "./claims";
export * from "./policies";
export * from "./referrals";
// Not protected reads: the account state and the closure and delete queries (4.7), for callers
// that already know who is asking. The suite's completeness scan skips this module.
export * from "./account";
