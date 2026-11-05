// The verification, reset and existing-account emails (4.4, 4.4b): plain HTML plus a text version, in Kerb's voice. No
// images or tracking. 4.11 sends them from the jobs table; the templates stay the same.

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

function layout({ heading, body, cta, url, after }: Record<string, string>) {
  return `<!doctype html>
<html lang="en">
<body style="margin:0;padding:24px;background:#f5f3ee;font-family:Arial,Helvetica,sans-serif;color:#14261d">
  <table role="presentation" width="100%" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px">
    <tr><td style="padding:32px">
      <p style="margin:0 0 24px;font-size:22px;font-weight:700">kerb.</p>
      <h1 style="margin:0 0 16px;font-size:22px">${heading}</h1>
      <p style="margin:0 0 24px;font-size:16px;line-height:24px">${body}</p>
      <p style="margin:0 0 24px"><a href="${escapeHtml(url!)}" style="display:inline-block;padding:14px 24px;border-radius:999px;background:#1b6e54;color:#ffffff;font-weight:700;text-decoration:none">${cta}</a></p>
      <p style="margin:0 0 8px;font-size:14px;line-height:20px;color:#4a5a51">${after}</p>
      <p style="margin:0;font-size:13px;line-height:18px;color:#4a5a51;word-break:break-all">${escapeHtml(url!)}</p>
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
      cta: "Confirm my email",
      url,
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
      cta: "Choose a new password",
      url,
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
      cta: "Log in to Kerb",
      url,
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
