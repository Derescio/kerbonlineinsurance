import { createOTP } from "@better-auth/utils/otp";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function decodeBase32(input: string): Uint8Array {
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of input.replace(/=+$/, "").toUpperCase()) {
    value = (value << 5) | BASE32.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >> bits) & 0xff);
    }
  }
  return Uint8Array.from(bytes);
}

/**
 * The 6-digit code an authenticator app would show for a base32 secret (the `secret` parameter of
 * the otpauth:// URI). Better Auth keys its TOTP on the secret string's bytes, which the URI
 * carries base32-encoded, so decode first. `at` picks another 30-second step; the default is now.
 */
export async function totpNow(secretBase32: string, at?: Date): Promise<string> {
  const otp = createOTP(decodeBase32(secretBase32), { digits: 6, period: 30 });
  if (!at) return otp.totp();
  // hotp(counter) is the code for a time step; totp() only knows the current clock
  return otp.hotp(Math.floor(at.getTime() / 1000 / 30));
}
