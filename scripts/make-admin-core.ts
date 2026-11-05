import type pg from "pg";

// Raw SQL on purpose: package scripts run under plain `node`, and src/ imports have no file
// extensions, so a script can't import the app's data layer (same reason as db-deploy.ts).

export type MakeAdminReason = "no_user" | "unverified" | "already_staff" | "bad_name";

export class MakeAdminError extends Error {
  readonly reason: MakeAdminReason;
  constructor(reason: MakeAdminReason) {
    super(reason);
    this.name = "MakeAdminError";
    this.reason = reason;
  }
}

export async function makeAdmin(
  client: pg.ClientBase,
  email: string,
  displayName: string,
): Promise<{ userId: string; staffCode: string }> {
  const name = displayName.trim();
  if (name === "") throw new MakeAdminError("bad_name");
  // Better Auth stores emails lowercase
  const normalised = email.trim().toLowerCase();

  await client.query("begin");
  try {
    const found = await client.query<{ id: string; email_verified: boolean }>(
      "select id, email_verified from users where email = $1",
      [normalised],
    );
    const user = found.rows[0];
    if (!user) throw new MakeAdminError("no_user");
    if (!user.email_verified) throw new MakeAdminError("unverified");

    const existing = await client.query("select 1 from staff_members where user_id = $1", [
      user.id,
    ]);
    if (existing.rowCount) throw new MakeAdminError("already_staff");

    // The unique constraint on staff_code catches two scripts racing for the same number
    const next = await client.query<{ n: number }>(
      "select coalesce(max(substring(staff_code from 3)::int), 0) + 1 as n from staff_members",
    );
    const staffCode = `H-${String(next.rows[0]!.n).padStart(3, "0")}`;

    await client.query(
      "insert into staff_members (user_id, display_name, staff_code) values ($1, $2, $3)",
      [user.id, name, staffCode],
    );
    await client.query("insert into staff_roles (user_id, role) values ($1, 'admin')", [user.id]);
    await client.query("commit");
    return { userId: user.id, staffCode };
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}
