// The verification, reset and existing-account emails (4.4, 4.4b) and the five account closure
// emails (4.7): plain HTML plus a text version, in Kerb's voice. No images or tracking. 4.11 sends
// them from the jobs table; the templates stay the same.

import { PRIVACY_EMAIL } from "#/server/account/constants";

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!,
  );

const firstName = (name: string) => name.trim().split(/\s+/)[0] || "there";

const DEMO_LINE =
  "Kerb is a fictional insurer made for a portfolio project. No real cover is sold.";

interface Layout {
  heading: string;
  body: string;
  after: string;
  /** A button and the link under it; the account closure emails have none */
  link?: { cta: string; url: string };
}

function layout({ heading, body, after, link }: Layout) {
  const button = link
    ? `
      <p style="margin:0 0 24px"><a href="${escapeHtml(link.url)}" style="display:inline-block;padding:14px 24px;border-radius:999px;background:#1b6e54;color:#ffffff;font-weight:700;text-decoration:none">${link.cta}</a></p>`
    : "";
  const linkText = link
    ? `
      <p style="margin:0;font-size:13px;line-height:18px;color:#4a5a51;word-break:break-all">${escapeHtml(link.url)}</p>`
    : "";
  return `<!doctype html>
<html lang="en">
<body style="margin:0;padding:24px;background:#f5f3ee;font-family:Arial,Helvetica,sans-serif;color:#14261d">
  <table role="presentation" width="100%" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px">
    <tr><td style="padding:32px">
      <p style="margin:0 0 24px;font-size:22px;font-weight:700">kerb.</p>
      <h1 style="margin:0 0 16px;font-size:22px">${heading}</h1>
      <p style="margin:0 0 24px;font-size:16px;line-height:24px">${body}</p>${button}
      <p style="margin:0 0 8px;font-size:14px;line-height:20px;color:#4a5a51">${after}</p>${linkText}
    </td></tr>
  </table>
  <p style="max-width:520px;margin:16px auto 0;font-size:12px;line-height:16px;color:#4a5a51">${DEMO_LINE}</p>
</body>
</html>`;
}

export function verifyEmail({ name, url }: { name: string; url: string }): EmailContent {
  const hello = `Hi ${firstName(name)},`;
  return {
    subject: "Confirm your email for Kerb",
    html: layout({
      heading: "Confirm your email",
      body: `${escapeHtml(hello)} tap the button to confirm this is your email address.`,
      link: { cta: "Confirm my email", url },
      after: "The link works for 6 hours. If you didn't make a Kerb account, ignore this email.",
    }),
    text: `${hello}\n\nConfirm your email for Kerb:\n${url}\n\nThe link works for 6 hours. If you didn't make a Kerb account, ignore this email.\n\n${DEMO_LINE}\n`,
  };
}

export function resetPasswordEmail({ name, url }: { name: string; url: string }): EmailContent {
  const hello = `Hi ${firstName(name)},`;
  return {
    subject: "Reset your Kerb password",
    html: layout({
      heading: "Reset your password",
      body: `${escapeHtml(hello)} tap the button to choose a new password.`,
      link: { cta: "Choose a new password", url },
      after:
        "The link works once, for one hour. If you didn't ask for this, ignore this email: your password hasn't changed.",
    }),
    text: `${hello}\n\nChoose a new Kerb password:\n${url}\n\nThe link works once, for one hour. If you didn't ask for this, ignore this email: your password hasn't changed.\n\n${DEMO_LINE}\n`,
  };
}

// Sent to the owner when someone signs up with an email that already has an account (4.4b). The
// sign-up itself answers as if it worked, so this is the only place the attempt shows.
export function existingAccountEmail({ name, url }: { name: string; url: string }): EmailContent {
  const hello = `Hi ${firstName(name)},`;
  const after =
    "If it wasn't you, you don't need to do anything: nobody can use your account without your password.";
  return {
    subject: "Someone tried to make a Kerb account with your email",
    html: layout({
      heading: "You already have an account",
      body: `${escapeHtml(hello)} someone just tried to make a new Kerb account with this email. If it was you, log in instead, or reset your password if you've forgotten it.`,
      link: { cta: "Log in to Kerb", url },
      after,
    }),
    text: `${hello}

Someone just tried to make a new Kerb account with this email. If it was you, log in instead, or reset your password if you've forgotten it:
${url}

${after}

${DEMO_LINE}
`,
  };
}

// The account closure emails (4.7, call 18). Short and plain, with no link to act on: each one
// reports something that has already happened. Sent after the commit, to the address on file
// before any change.

const PRIVACY_LINE = `Questions about your data: ${PRIVACY_EMAIL}.`;

function notice(subject: string, heading: string, paragraphs: string[], after: string) {
  return {
    subject,
    html: layout({
      heading,
      body: paragraphs.map(escapeHtml).join("<br><br>"),
      after: escapeHtml(after),
    }),
    text: `${paragraphs.join("\n\n")}\n\n${after}\n\n${DEMO_LINE}\n`,
  };
}

export function accountDeletedEmail(): EmailContent {
  return notice(
    "Your Kerb account has been deleted",
    "Your account has been deleted",
    ["We've deleted your Kerb account and everything in it, as you asked. This can't be undone."],
    `If you didn't do this, email ${PRIVACY_EMAIL}.`,
  );
}

/** `closesOn` is the date as people read it, such as "7 December 2026" */
export function closureRequestedEmail({ closesOn }: { closesOn: string }): EmailContent {
  return notice(
    "Your Kerb account is closing",
    "Your account is closing",
    [
      `Your Kerb account will close on ${closesOn}.`,
      "Closing your account doesn't cancel your cover. Your policies stay in force.",
      "Changed your mind? Sign in before then to keep your account.",
    ],
    PRIVACY_LINE,
  );
}

export function closureCancelledEmail(): EmailContent {
  return notice(
    "You're keeping your Kerb account",
    "You're keeping your account",
    ["You cancelled the closure, so your Kerb account stays open. Nothing else has changed."],
    `If you didn't do this, email ${PRIVACY_EMAIL}.`,
  );
}

export function closureHeldEmail({ claimReference }: { claimReference: string }): EmailContent {
  return notice(
    "Your Kerb account will close after your claim",
    "Your account will close after your claim",
    [
      `Your claim ${claimReference} is still open, so we'll close your account once it's settled.`,
      "You can still sign in until then, and keep your account if you change your mind.",
    ],
    PRIVACY_LINE,
  );
}

export function accountClosedEmail(): EmailContent {
  return notice(
    "Your Kerb account is closed",
    "Your account is closed",
    [
      "Your Kerb account is now closed, and you can no longer sign in.",
      "Closing your account didn't cancel your cover. We keep your policy and claim records for as long as we have to.",
      `To manage a policy or a claim, or to ask about your data, email ${PRIVACY_EMAIL}.`,
    ],
    PRIVACY_LINE,
  );
}
