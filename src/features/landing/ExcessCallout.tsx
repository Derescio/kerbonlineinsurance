import { cx } from "#/lib/cx";

/**
 * Excess callout (Figma part 53:1945): a card over the hero photo that explains the excess in plain
 * English. The figures are an example, which the label says.
 */
export function ExcessCallout({ className }: { className?: string }) {
  return (
    <aside className={cx("excess", className)} aria-label="Example excess">
      <p className="excess__label">Voluntary excess</p>
      <p className="excess__amount">£250</p>
      <p className="excess__text">
        Plus £100 compulsory excess, £350 total. We'll always show this up front.
      </p>
    </aside>
  );
}
