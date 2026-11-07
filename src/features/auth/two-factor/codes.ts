// What people type into the two-factor screens, and how the setup step shows its secrets (4.6).
// Backup codes are XXXXX-XXXXX in capitals and digits: the server makes them that way
// (src/server/auth/auth.ts, customBackupCodesGenerate), so upper-casing what's typed is safe.

export const TOTP_LENGTH = 6;

/** "123 456" → "123456": spaces, dashes and anything else that isn't a digit go */
export function normaliseTotp(value: string): string {
  return value.replace(/\D/g, "");
}

export const isTotp = (code: string) => /^\d{6}$/.test(code);

/** "abcde12345" or " abcde-12345 " → "ABCDE-12345" */
export function normaliseBackupCode(value: string): string {
  const bare = value.replace(/[\s-]/g, "").toUpperCase();
  return bare.length === 10 ? `${bare.slice(0, 5)}-${bare.slice(5)}` : bare;
}

export const isBackupCode = (code: string) => /^[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(code);

/** The base32 secret inside an otpauth:// URI, or "" */
export function setupKeyFrom(totpURI: string): string {
  try {
    return new URL(totpURI).searchParams.get("secret") ?? "";
  } catch {
    return "";
  }
}

/** "JBSWY3DPEHPK3PXPK4ZQ" → "JBSW Y3DP EHPK 3PXP K4ZQ", easier to type into an app */
export function formatSetupKey(key: string): string {
  return key.match(/.{1,4}/g)?.join(" ") ?? "";
}

/** kerb-backup-codes.txt */
export function backupCodesFile(codes: readonly string[]): string {
  return `Kerb backup codes. Each code works once.\n\n${codes.join("\n")}\n`;
}
