import { Icon } from "#/components/display/Icon";
import { icons, type IconName } from "#/components/display/icons";

import { Section } from "../parts";

export function Icons() {
  const names = Object.keys(icons) as IconName[];
  return (
    <Section
      id="icons"
      intro={`The ${names.length} Lucide icons Kerb uses, at 24px in currentColor. Add one to icons.ts when a screen needs it; the id is the Lucide name.`}
    >
      <div className="sys__icons">
        {names.map((name) => (
          <div key={name} className="sys__icon">
            <Icon name={name} size={24} />
            <code>{name}</code>
          </div>
        ))}
      </div>
    </Section>
  );
}
