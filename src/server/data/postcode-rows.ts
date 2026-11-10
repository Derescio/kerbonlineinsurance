import { eq } from "drizzle-orm";

import { getDb, type Db } from "#/server/db/client";
import { postcodeAreas } from "#/server/db/schema";

export type { Db };

// postcode_areas (5.2, call 15): postcodes postcodes.io has confirmed, so each is looked up once.
// Plain functions, not defineWrite: a guest's postcode is checked before there's anyone to check,
// so the permission suite skips this module. A row says only that a postcode exists.

export async function findPostcodeArea(postcode: string, db: Db = getDb()): Promise<boolean> {
  const rows = await db
    .select({ postcode: postcodeAreas.postcode })
    .from(postcodeAreas)
    .where(eq(postcodeAreas.postcode, postcode))
    .limit(1);
  return rows.length > 0;
}

export async function insertPostcodeArea(
  row: {
    postcode: string;
    outcode: string;
    adminDistrict: string | null;
    region: string | null;
    country: string;
  },
  db: Db = getDb(),
): Promise<void> {
  await db.insert(postcodeAreas).values(row).onConflictDoNothing();
}
