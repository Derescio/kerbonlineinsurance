import { Checkbox } from "#/components/forms/Checkbox";
import { Input } from "#/components/forms/Input";
import { Radio } from "#/components/forms/Radio";
import { RadioGroup } from "#/components/forms/RadioGroup";
import { Select } from "#/components/forms/Select";
import { Switch } from "#/components/forms/Switch";

import { Block, Label, Section } from "../parts";

const hint = "We use this to work out your price.";
const overnight = ["Driveway", "Garage", "On the street", "Car park"];

export function Forms() {
  return (
    <Section
      id="forms"
      intro="Controls for the quote and claim journeys. Every field has a visible label. Errors say how to fix it: “Enter your full postcode, like E8 3RL”, never “Invalid input”."
    >
      <Block title="Input">
        {(["default", "plate"] as const).map((variant) => (
          <div key={variant} className="sys__grid sys__block">
            <div>
              <Label>Default</Label>
              <Input variant={variant} label="Postcode" defaultValue="E8 3RL" hint={hint} />
            </div>
            <div data-demo-focus>
              <Label>Focus</Label>
              <Input variant={variant} label="Postcode" defaultValue="E8 3RL" hint={hint} />
            </div>
            <div>
              <Label>Error</Label>
              <Input
                variant={variant}
                label="Postcode"
                defaultValue="E8 3RL"
                error="Enter your full postcode, like E8 3RL"
              />
            </div>
            <div>
              <Label>Disabled</Label>
              <Input
                variant={variant}
                label="Postcode"
                defaultValue="E8 3RL"
                hint={hint}
                disabled
              />
            </div>
          </div>
        ))}
        <div className="sys__grid">
          <Input label="Voluntary excess" prefix="£" defaultValue="250" optional />
          <Input label="Annual mileage" suffix="miles" iconLeft="car" defaultValue="8,000" />
          <Input label="Email" type="email" placeholder="you@example.com" />
        </div>
      </Block>
      <Block title="Select">
        <div className="sys__grid">
          <Select
            label="Where is the car kept overnight?"
            options={overnight}
            defaultValue="Driveway"
            hint="Pick the closest match."
          />
          <div data-demo-focus>
            <Select
              label="Where is the car kept overnight?"
              options={overnight}
              defaultValue="Driveway"
              hint="Pick the closest match."
            />
          </div>
          <Select
            label="Where is the car kept overnight?"
            options={overnight}
            placeholder="Choose one"
            error="Choose where the car is kept"
          />
          <Select
            label="Where is the car kept overnight?"
            options={overnight}
            defaultValue="Driveway"
            disabled
          />
        </div>
      </Block>
      <Block title="Checkbox">
        <div className="sys__grid">
          <Checkbox label="Breakdown cover" description="24/7 roadside help across the UK" />
          <Checkbox
            label="Breakdown cover"
            description="24/7 roadside help across the UK"
            defaultChecked
          />
          <Checkbox
            label="Breakdown cover"
            description="24/7 roadside help across the UK"
            disabled
          />
          <Checkbox
            label="Breakdown cover"
            description="24/7 roadside help across the UK"
            defaultChecked
            disabled
          />
        </div>
      </Block>
      <Block title="Radio">
        <div className="sys__grid">
          <RadioGroup legend="How do you want to pay?" hint="You can change this later.">
            <Radio
              name="sys-pay"
              value="monthly"
              label="Monthly"
              description="12 payments of £38.20"
              defaultChecked
            />
            <Radio
              name="sys-pay"
              value="annual"
              label="Annually"
              description="£432.00, save £26.40"
            />
          </RadioGroup>
          <RadioGroup legend="Any claims in the last 5 years?" error="Choose yes or no">
            <Radio name="sys-claims" value="yes" label="Yes" />
            <Radio name="sys-claims" value="no" label="No" />
          </RadioGroup>
          <RadioGroup legend="Disabled">
            <Radio
              name="sys-off"
              value="a"
              label="Monthly"
              description="12 payments of £38.20"
              disabled
            />
            <Radio
              name="sys-off"
              value="b"
              label="Annually"
              description="£432.00, save £26.40"
              defaultChecked
              disabled
            />
          </RadioGroup>
        </div>
      </Block>
      <Block title="Switch">
        <div className="sys__grid">
          <div style={{ display: "grid", gap: 16 }}>
            <Switch label="Auto-renew" />
            <Switch label="Auto-renew" defaultChecked />
          </div>
          <div style={{ display: "grid", gap: 16 }}>
            <Switch label="Auto-renew" disabled />
            <Switch label="Auto-renew" defaultChecked disabled />
          </div>
          <div>
            <Label>Settings row (label at the start)</Label>
            <Switch label="Paperless documents" labelPosition="end" defaultChecked />
          </div>
        </div>
      </Block>
    </Section>
  );
}
