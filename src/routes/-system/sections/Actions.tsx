import { Button } from "#/components/actions/Button";
import { IconButton } from "#/components/actions/IconButton";

import { Block, Label, Section } from "../parts";

const variants = ["primary", "accent", "secondary", "ghost", "danger"] as const;
const sizes = ["sm", "md", "lg"] as const;

export function Actions() {
  return (
    <Section
      id="actions"
      intro="Pill buttons for every tappable action with a text label. Accent is the single hero call to action, never two per view. Labels are verbs in sentence case."
    >
      <Block title="Button">
        {variants.map((v) => (
          <div key={v} className="sys__block">
            <Label>{v}</Label>
            <div className="sys__row">
              {sizes.map((s) => (
                <Button key={s} variant={v} size={s}>
                  Continue
                </Button>
              ))}
              <Button variant={v} disabled>
                Continue
              </Button>
              <Button variant={v} iconRight="arrow-right">
                Continue
              </Button>
              <Button variant={v} iconLeft="download">
                Documents
              </Button>
              <Button variant={v} loading>
                Saving
              </Button>
            </div>
          </div>
        ))}
      </Block>
      <Block title="IconButton">
        <div className="sys__row">
          {(["ghost", "secondary", "primary"] as const).map((v) =>
            sizes.map((s) => (
              <IconButton
                key={v + s}
                icon="menu"
                label={`Menu (${v}, ${s})`}
                variant={v}
                size={s}
              />
            )),
          )}
          <span className="sys__inverse">
            {sizes.map((s) => (
              <IconButton
                key={s}
                icon="x"
                label={`Close (inverse, ${s})`}
                variant="inverse"
                size={s}
              />
            ))}
          </span>
        </div>
      </Block>
    </Section>
  );
}
