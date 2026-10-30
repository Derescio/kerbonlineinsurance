import { useState } from "react";

import { Badge } from "#/components/display/Badge";
import { Card } from "#/components/display/Card";
import { Tag } from "#/components/display/Tag";
import { Wordmark } from "#/components/display/Wordmark";

import { Block, Label, Section } from "../parts";

const tones = [
  "neutral",
  "brand",
  "success",
  "warning",
  "danger",
  "info",
  "accent",
  "inverse",
] as const;

export function Display() {
  const [filters, setFilters] = useState<string[]>(["Open"]);
  const [removable, setRemovable] = useState(["Rear-ended", "Windscreen"]);
  const toggle = (f: string) =>
    setFilters((current) =>
      current.includes(f) ? current.filter((x) => x !== f) : [...current, f],
    );

  return (
    <Section
      id="display"
      intro="Surfaces and labels: Card, Badge (non-interactive status), Tag (interactive chip) and the typeset Wordmark."
    >
      <Block title="Badge">
        <div className="sys__row">
          {tones.map((t) => (
            <Badge key={t} tone={t} dot>
              {t}
            </Badge>
          ))}
        </div>
      </Block>
      <Block title="Tag">
        <Label>Toggle (click or Space)</Label>
        <div className="sys__row sys__block">
          {["Open", "Closed", "Awaiting you"].map((f) => (
            <Tag key={f} selected={filters.includes(f)} onClick={() => toggle(f)}>
              {f}
            </Tag>
          ))}
        </div>
        <Label>Removable</Label>
        <div className="sys__row">
          {removable.map((r, i) => (
            <Tag
              key={r}
              icon="car"
              selected={i === 1}
              onRemove={() => setRemovable((current) => current.filter((x) => x !== r))}
            >
              {r}
            </Tag>
          ))}
        </div>
      </Block>
      <Block title="Card">
        <div className="sys__grid">
          {(["raised", "outline", "sunken", "inverse"] as const).map((v) => (
            <Card key={v} variant={v}>
              <span className="kb-overline" style={{ display: "block", opacity: 0.8 }}>
                KR24 BXL · Volkswagen Golf
              </span>
              <span className="kb-h3" style={{ display: "block", margin: "8px 0 4px" }}>
                Covered until 14 Mar 2027
              </span>
              <span className="kb-body-s">Comprehensive · £350 excess · {v}</span>
            </Card>
          ))}
        </div>
      </Block>
      <Block title="Wordmark">
        <div className="sys__row">
          <Wordmark />
          <Wordmark size={48} />
          <span className="sys__inverse">
            <Wordmark tone="inverse" descriptor="car insurance" />
          </span>
        </div>
      </Block>
    </Section>
  );
}
