import { formatPounds } from "#/features/rating/money";

import type { Payment } from "./journey-store";

// "Choose how you'd like to pay" on Your quote (5.4b, call 10; Revamp R09): annual or 12 monthly
// payments as two cards in one radio group. Monthly's total payable is the 12 payments added up,
// so it's what the visitor actually pays.

export function PayChoice({
  annualPence,
  monthlyPaymentPence,
  value,
  onChange,
  legend = "Choose how you’d like to pay",
}: {
  annualPence: number;
  monthlyPaymentPence: number;
  value: Payment;
  onChange: (value: Payment) => void;
  /** Confirm and pay asks "How would you like to pay?" (5.6, decision 6) */
  legend?: string;
}) {
  const options = [
    {
      value: "annual" as const,
      title: "Pay annually",
      note: "One payment for the year",
      amount: annualPence,
      per: "/year",
      total: annualPence,
    },
    {
      value: "monthly" as const,
      title: "Pay monthly",
      note: "12 monthly payments",
      amount: monthlyPaymentPence,
      per: "/month",
      total: monthlyPaymentPence * 12,
    },
  ];
  return (
    <fieldset className="quote-pay">
      <legend className="quote-pay__legend">{legend}</legend>
      <div className="quote-pay__options">
        {options.map((option) => (
          <div key={option.value} className="quote-pay__option">
            <label
              className={`quote-pay__card${value === option.value ? " quote-pay__card--checked" : ""}`}
            >
              <input
                type="radio"
                name="payment"
                value={option.value}
                checked={value === option.value}
                onChange={() => onChange(option.value)}
              />
              <span className="quote-pay__title">{option.title}</span>
              <span className="quote-pay__note">{option.note}</span>
              <span className="quote-pay__amount">
                <span className="kb-price">{formatPounds(option.amount)}</span>{" "}
                <span className="quote-pay__per">{option.per}</span>
              </span>
            </label>
            <p className="quote-pay__total">Total payable {formatPounds(option.total)}</p>
          </div>
        ))}
      </div>
    </fieldset>
  );
}
