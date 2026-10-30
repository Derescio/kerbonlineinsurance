import { Block, Label, Section, useCssVar } from "../parts";
import { colorRamps, elevation, radii, semanticColors, spacing, typeStyles } from "../foundations";

function Swatch({ token }: { token: string }) {
  const value = useCssVar(token);
  return (
    <div className="sys__swatch">
      <div className="sys__swatch-chip" style={{ background: `var(${token})` }} />
      <code>{token}</code>
      <code>{value}</code>
    </div>
  );
}

function Swatches({ groups }: { groups: Record<string, string[]> }) {
  return Object.entries(groups).map(([name, tokens]) => (
    <div key={name} className="sys__block">
      <Label>{name}</Label>
      <div className="sys__swatches">
        {tokens.map((t) => (
          <Swatch key={t} token={t} />
        ))}
      </div>
    </div>
  ));
}

function SpaceRow({ token }: { token: string }) {
  const value = useCssVar(token);
  return (
    <div className="sys__token sys__row">
      <div className="sys__space-bar" style={{ width: `var(${token})` }} />
      <code>
        {token} {value}
      </code>
    </div>
  );
}

function Radius({ token }: { token: string }) {
  const value = useCssVar(token);
  return (
    <div className="sys__token">
      <div className="sys__radius" style={{ borderRadius: `var(${token})` }} />
      <code>
        {token} {value}
      </code>
    </div>
  );
}

export function Foundations() {
  return (
    <Section
      id="foundations"
      intro="Every swatch, type sample, radius and shadow, read from the CSS the browser has loaded. Use the semantic colours in components; the primitives are what they point to."
    >
      <Block title="Colour: primitives">
        <Swatches groups={colorRamps} />
      </Block>
      <Block title="Colour: semantic (use these)">
        <Swatches groups={semanticColors} />
      </Block>
      <Block title="Typography">
        {typeStyles.map((t) => (
          <div key={t.className} className="sys__type">
            <div>
              <span className="kb-body-s">{t.figma}</span>
              <code className="kb-caption" style={{ display: "block", color: "var(--fg-3)" }}>
                .{t.className}
              </code>
            </div>
            <div className={t.className}>{t.sample}</div>
          </div>
        ))}
      </Block>
      <Block title="Spacing (4px base)">
        {spacing.map((t) => (
          <SpaceRow key={t} token={t} />
        ))}
      </Block>
      <Block title="Radii">
        <div className="sys__row">
          {radii.map((t) => (
            <Radius key={t} token={t} />
          ))}
        </div>
      </Block>
      <Block title="Elevation and focus">
        <div className="sys__grid">
          {elevation.map((e) => (
            <div key={e.token} className="sys__shadow" style={{ boxShadow: `var(${e.token})` }}>
              <span className="kb-body-s" style={{ fontWeight: 600, display: "block" }}>
                {e.label}
              </span>
              <span className="kb-caption">{e.use}</span>
            </div>
          ))}
        </div>
      </Block>
    </Section>
  );
}
