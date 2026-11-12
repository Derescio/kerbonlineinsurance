// Money rules (5.4, spec decision 6). Amounts are whole pence; each line is rounded once, half up.

/** IPT on a rounded premium */
export function ipt(pence: number, rate: number): number {
  return Math.round(pence * rate);
}

/** A tier's or add-on's monthly figure as stored (before IPT), with the credit charge */
export function storedMonthly(annualPence: number, creditChargeRate: number): number {
  return Math.round((annualPence * (1 + creditChargeRate)) / 12);
}

/** Each of the 12 payments the visitor sees: the total with IPT, plus the credit charge */
export function monthlyPayment(totalPence: number, creditChargeRate: number): number {
  return Math.round((totalPence * (1 + creditChargeRate)) / 12);
}

const pounds = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 2,
});

export function formatPounds(pence: number): string {
  return pounds.format(pence / 100);
}
