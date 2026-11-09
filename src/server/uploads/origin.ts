// The R2 S3 endpoint for an account (4.10, decision 1). Import-free: security-headers.ts uses it,
// and vite.config.ts loads that file at config time.

const ACCOUNT_ID = /^[0-9a-f]{32}$/;

/** `https://<account-id>.r2.cloudflarestorage.com`, or null for a missing or malformed id */
export function r2Origin(accountId: string | undefined): string | null {
  const id = accountId?.trim();
  return id && ACCOUNT_ID.test(id) ? `https://${id}.r2.cloudflarestorage.com` : null;
}
