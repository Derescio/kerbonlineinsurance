// Today in London as YYYY-MM-DD (6.1): how dates like payments.due_on and policies.ends_on are
// stored, so "due today" and "ended" mean the UK day on the server and in the browser alike.
export function londonDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(now);
}
