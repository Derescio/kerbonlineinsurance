import type { AuditKeys } from "../src/server/audit/chain.ts";
import { verifyAuditChain, type Queryable } from "../src/server/audit/verify.ts";

export interface CheckResult {
  name: string;
  ok: boolean;
  // Only ever a verify rowId and reason, never a value from the database
  detail?: string;
}

// What a Neon branch's app role must look like (4.5b). Every check name is fixed text and the
// privilege checks use has_table_privilege, never a real UPDATE, DELETE or TRUNCATE, so a
// misconfigured branch can't lose data to this script.
export async function checkAppRole(client: Queryable, keys: AuditKeys): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  const { rows: who } = await client.query<{ ok: boolean }>(
    "select current_user = 'kerb_app' as ok",
  );
  results.push({ name: "connected as kerb_app", ok: who[0]?.ok === true });

  const { rows: attrs } = await client.query<{ ok: boolean }>(
    `select not (rolsuper or rolcreaterole or rolcreatedb or rolbypassrls) as ok
       from pg_roles where rolname = current_user`,
  );
  results.push({
    name: "no superuser, CREATEROLE, CREATEDB or BYPASSRLS",
    ok: attrs[0]?.ok === true,
  });

  // Matched over pg_roles by name, so a database without neon_superuser (local Docker) still works
  const { rows: member } = await client.query<{ ok: boolean }>(
    `select not exists (
       select 1 from pg_roles r
        where (r.rolname = 'neon_superuser' or r.rolname ~ '^pg_.*_data$')
          and pg_has_role(current_user, r.oid, 'MEMBER')
     ) as ok`,
  );
  results.push({
    name: "not a member of neon_superuser or any pg_*_data role",
    ok: member[0]?.ok === true,
  });

  const { rows: privs } = await client.query<{ ok: boolean }>(
    `select not (
       has_table_privilege(current_user, 'public.audit_log', 'UPDATE')
       or has_any_column_privilege(current_user, 'public.audit_log', 'UPDATE')
       or has_table_privilege(current_user, 'public.audit_log', 'DELETE')
       or has_table_privilege(current_user, 'public.audit_log', 'TRUNCATE')
     ) as ok`,
  );
  results.push({
    name: "UPDATE, DELETE and TRUNCATE on audit_log refused",
    ok: privs[0]?.ok === true,
  });

  const { rows: triggers } = await client.query<{ ok: boolean }>(
    `select count(distinct tgname) = 2 as ok
       from pg_trigger
      where tgrelid = 'public.audit_log'::regclass
        and tgname in ('audit_log_append_only', 'audit_log_record_delete')
        and tgenabled = 'O'`,
  );
  results.push({ name: "audit_log triggers present", ok: triggers[0]?.ok === true });

  const chain = await verifyAuditChain(client, keys);
  results.push(
    chain.ok
      ? { name: "audit chain verifies", ok: true }
      : {
          name: "audit chain verifies",
          ok: false,
          detail: `row ${chain.rowId}: ${chain.reason}`,
        },
  );

  return results;
}
