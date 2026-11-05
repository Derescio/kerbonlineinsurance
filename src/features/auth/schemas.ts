import { z } from "zod";

// The auth forms' rules, shared by the forms and the server. Better Auth enforces the same
// password lengths itself (src/server/auth/auth.ts); the copy follows the 4.3 frames.

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Enter your email address.")
  .pipe(z.email("Enter an email address like name@example.com."));

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters.`)
  .max(PASSWORD_MAX, `Use ${PASSWORD_MAX} characters or fewer.`);

export const signUpSchema = z.object({
  name: z.string().trim().min(1, "Enter your full name.").max(100, "Use 100 characters or fewer."),
  email: emailSchema,
  password: passwordSchema,
  acceptTerms: z.literal(true, "Tick to agree to the terms of use."),
});

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password."),
});

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({ password: passwordSchema });

export type SignUpInput = z.infer<typeof signUpSchema>;
export type SignInInput = z.infer<typeof signInSchema>;
