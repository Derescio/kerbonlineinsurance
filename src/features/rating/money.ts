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

/**
 * The representative APR on paying monthly (5.5, decision 8), as a percentage to one decimal place.
 * The credit is the annual total, repaid by 12 payments at 0, 1, … 11 months: the first is taken
 * when cover starts. The rate solves CONC App 1.1's equation, compounded monthly to a year.
 */
export function representativeApr(totalPence: number, paymentPence: number): number {
  const presentValue = (monthly: number) => {
    let sum = 0;
    for (let month = 0; month < 12; month++) sum += paymentPence / (1 + monthly) ** month;
    return sum;
  };
  if (paymentPence * 12 <= totalPence) return 0;
  // The present value falls as the rate rises: halve the gap until it settles
  let low = 0;
  let high = 1;
  for (let i = 0; i < 100; i++) {
    const mid = (low + high) / 2;
    if (presentValue(mid) > totalPence) low = mid;
    else high = mid;
  }
  const annual = (1 + (low + high) / 2) ** 12 - 1;
  return Math.round(annual * 1000) / 10;
}
