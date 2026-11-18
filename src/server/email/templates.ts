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

// The policy confirmation (5.6, decision 9): sent once a purchase commits, with what You're
// covered shows and a link to the account. `car` is empty for a quote with no car on it (5.7), and
// `home` names the insured address on a home or bundle (5.7b).
export interface PolicyConfirmedParams {
  name: string;
  policyReference: string;
  car: string;
  /** The insured address, or empty; missing on a job queued before 5.7b */
  home?: string;
  startsOn: string;
  endsOn: string;
  amount: string;
  url: string;
}

export function policyConfirmedEmail(p: PolicyConfirmedParams): EmailContent {
  const hello = `Hi ${firstName(p.name)},`;
  const details = [
    `Policy: ${p.policyReference}`,
    ...(p.car ? [`Car: ${p.car}`] : []),
    ...(p.home ? [`Home: ${p.home}`] : []),
    `Cover starts: ${p.startsOn}`,
    `Cover ends: ${p.endsOn}`,
    `Payment: ${p.amount}`,
  ];
  const after = "You can see your policy in your account at any time.";
  return {
    subject: `You're covered: Kerb policy ${p.policyReference}`,
    html: layout({
      heading: "You're covered",
      body: `${escapeHtml(hello)} your Kerb insurance is confirmed.<br><br>${details.map(escapeHtml).join("<br>")}`,
      link: { cta: "Go to my account", url: p.url },
      after,
    }),
    text: `${hello}\n\nYour Kerb insurance is confirmed.\n\n${details.join("\n")}\n\nGo to your account:\n${p.url}\n\n${after}\n\n${DEMO_LINE}\n`,
  };
}

// A payment Kerb couldn't honour (5.6b, decision 6): the purchase didn't go through, so the money
// went back. `reason` says why in plain words; nothing to act on, so the link is the account.
export interface PaymentRefundedParams {
  name: string;
  reason: string;
  url: string;
}

export function paymentRefundedEmail(p: PaymentRefundedParams): EmailContent {
  const hello = `Hi ${firstName(p.name)},`;
  const lines = [
    "We couldn’t complete your purchase, so we’ve refunded your payment in full and won’t take any more.",
    p.reason,
  ];
  const after = "A refund can take 5 to 10 working days to reach your account.";
  return {
    subject: "We’ve refunded your payment",
    html: layout({
      heading: "We’ve refunded your payment",
      body: `${escapeHtml(hello)} ${lines.map(escapeHtml).join("<br><br>")}`,
      link: { cta: "Go to my account", url: p.url },
      after,
    }),
    text: `${hello}\n\n${lines.join("\n\n")}\n\nGo to your account:\n${p.url}\n\n${after}\n\n${DEMO_LINE}\n`,
  };
}

// A monthly instalment Stripe couldn't take (5.6b, decision 8). Stripe retries for a while and the
// cover stays in force, so this asks for a new card; sent once per failed invoice.
export function paymentFailedEmail({ name, url }: { name: string; url: string }): EmailContent {
  const hello = `Hi ${firstName(name)},`;
  const line = "Update your card so your cover continues.";
  const after = "We’ll try the payment again over the next few days.";
  return {
    subject: "We couldn’t take this month’s payment",
    html: layout({
      heading: "We couldn’t take this month’s payment",
      body: `${escapeHtml(hello)} ${escapeHtml(line)}`,
      link: { cta: "Update my card", url },
      after,
    }),
    text: `${hello}\n\nWe couldn’t take this month’s payment. ${line}\n\nUpdate your card:\n${url}\n\n${after}\n\n${DEMO_LINE}\n`,
  };
}

// Stripe gave up on a failed instalment, so the subscription is unpaid and the policy lapsed
// (5.6b, decision 8). A new card pays what was owed while covered and resumes the cover.
export function coverLapsedEmail({ name, url }: { name: string; url: string }): EmailContent {
  const hello = `Hi ${firstName(name)},`;
  const line = "Update your card to resume your cover.";
  const stopped = "We couldn’t take your payments, so your cover has stopped.";
  const after = "If you don’t, we’ll cancel your policy 30 days after your cover stopped.";
  return {
    subject: "You’re no longer covered",
    html: layout({
      heading: "You’re no longer covered",
      body: `${escapeHtml(hello)} ${escapeHtml(stopped)} ${escapeHtml(line)}`,
      link: { cta: "Update my card", url },
      after,
    }),
    text: `${hello}\n\nYou’re no longer covered. We couldn’t take your payments, so your cover has stopped. ${line}\n\nUpdate your card:\n${url}\n\n${after}\n\n${DEMO_LINE}\n`,
  };
}

// The payment owed from while they were covered went through, so a lapsed policy is active again
// (5.6b, decision 8).
export function coverResumedEmail({ name, url }: { name: string; url: string }): EmailContent {
  const hello = `Hi ${firstName(name)},`;
  const line = "Thanks for updating your card. Your payment went through, so you’re covered again.";
  const after = "Your monthly payments carry on from your new card.";
  return {
    subject: "Your cover has resumed",
    html: layout({
      heading: "Your cover has resumed",
      body: `${escapeHtml(hello)} ${escapeHtml(line)}`,
      link: { cta: "See my payments", url },
      after,
    }),
    text: `${hello}\n\nYour cover has resumed. ${line}\n\nSee your payments:\n${url}\n\n${after}\n\n${DEMO_LINE}\n`,
  };
}

// A policy lapsed for 30 days, cancelled by the daily job (5.6b, decision 8). It can't be resumed.
export function policyCancelledUnpaidEmail({
  name,
  url,
}: {
  name: string;
  url: string;
}): EmailContent {
  const hello = `Hi ${firstName(name)},`;
  const line = "Your policy has been cancelled because we couldn’t take your payments.";
  const after = "You won’t be charged again. You can get a new quote at any time.";
  return {
    subject: "Your policy has been cancelled",
    html: layout({
      heading: "Your policy has been cancelled",
      body: `${escapeHtml(hello)} ${escapeHtml(line)}`,
      link: { cta: "See my payments", url },
      after,
    }),
    text: `${hello}\n\n${line}\n\nSee your payments:\n${url}\n\n${after}\n\n${DEMO_LINE}\n`,
  };
}
