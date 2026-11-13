import { Button } from "#/components/actions/Button";
import { Card } from "#/components/display/Card";
import { Alert } from "#/components/feedback/Alert";

// "Let's review your named driver" (5.4b, call 11; Revamp R10): a named driver stopped the quote.
// They're named, never the threshold that stopped them (5.4, decision 14). Removing them prices
// the quote again on the spot.

export function reviewIntro(name: string, outcome: "referred" | "declined"): string {
  return outcome === "declined"
    ? `We can’t offer cover with ${name} as a named driver.`
    : `We need to check a couple of things before we can include ${name}.`;
}

export function DriverReview({
  name,
  outcome,
  onRemove,
  onReview,
}: {
  name: string;
  outcome: "referred" | "declined";
  onRemove: () => void;
  onReview: () => void;
}) {
  return (
    <Card padding="lg" className="quote-review">
      <Alert
        tone="warning"
        announce
        title={
          outcome === "declined"
            ? `We can’t offer cover with ${name} included`
            : `We need to check a couple of things about ${name}`
        }
      >
        {outcome === "declined"
          ? `You can remove ${name} to see a price without them, or review the details you entered.`
          : `You can remove ${name} to see a price now, or review the details you entered.`}
      </Alert>
      <h2 className="kb-h4">What happens if you remove {name}?</h2>
      <p>
        {name} won&rsquo;t be covered to drive your car. Only continue without them if they
        don&rsquo;t need to drive it.
      </p>
      <Button variant="accent" iconRight="arrow-right" onClick={onRemove}>
        Remove {name} and see my price
      </Button>
      <Button variant="secondary" onClick={onReview}>
        Review named driver details
      </Button>
    </Card>
  );
}
