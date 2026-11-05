import { describe, expect, it } from "vite-plus/test";

import { databaseHost } from "./database-host.ts";

describe("databaseHost", () => {
  it("returns only the host", () => {
    expect(databaseHost("postgres://u:s3cretpw@db.example.com:5432/x")).toBe("db.example.com:5432");
  });

  it("returns null for a malformed URL instead of throwing", () => {
    expect(databaseHost("postgres://u:s3cretpw@localhost:abc/x")).toBeNull();
  });
});
