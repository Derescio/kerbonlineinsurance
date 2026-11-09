import { Badge } from "#/components/display/Badge";
import { Radio } from "#/components/forms/Radio";
import { RadioGroup } from "#/components/forms/RadioGroup";

import { isBuyable, quoteTypes, type ProductId } from "./products";

export interface TypePickerProps {
  value?: ProductId;
  onChange: (id: ProductId) => void;
  error?: string;
}

/**
 * The seven insurance types as radio cards, in screen 01's order (Figma 222:6702). Native radios
 * named `type`, so arrow keys move the choice and the form posts it without JavaScript. The legend
 * repeats the page's h1 for screen readers only.
 */
export function TypePicker({ value, onChange, error }: TypePickerProps) {
  return (
    <RadioGroup legend="What would you like to insure?" error={error} className="quote-types">
      {quoteTypes.map(({ id, label }) => {
        const buyable = isBuyable(id);
        return (
          <Radio
            key={id}
            name="type"
            value={id}
            label={label}
            checked={value === id}
            onChange={() => onChange(id)}
            description={
              <Badge tone={buyable ? "success" : "neutral"}>
                {buyable ? "Available now" : "Coming soon"}
              </Badge>
            }
            className="quote-type"
          />
        );
      })}
    </RadioGroup>
  );
}
