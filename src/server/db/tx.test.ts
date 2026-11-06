import { readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";

import { describe, expect, it } from "vite-plus/test";

describe("transactions", () => {
  it("only src/server/db/tx.ts opens one, so every transaction gets the timeouts", () => {
    const offenders = readdirSync("src", { recursive: true, encoding: "utf8" })
      .filter(
        (file) =>
          /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file) && !file.startsWith("test" + sep),
      )
      .filter((file) =>
        /\.transaction\s*(<[^>]*>)?\s*\(/.test(readFileSync(join("src", file), "utf8")),
      );
    expect(offenders).toEqual([join("server", "db", "tx.ts")]);
  });
});
