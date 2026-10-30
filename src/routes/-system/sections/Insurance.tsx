import { useState } from "react";

import { CoverageGroup } from "#/components/insurance/CoverageGroup";
import { Timeline } from "#/components/insurance/Timeline";

import { Block, Section } from "../parts";

export function Insurance() {
  const [plan, setPlan] = useState<string | null>("comp");

  return (
    <Section
      id="insurance"
      intro="Domain components for the quote and claims journeys: plan tier cards for “Choose your cover” and the claim progress timeline."
    >
      <Block title="CoverageGroup / CoverageOption">
        <div style={{ maxWidth: 900 }}>
          <CoverageGroup
            label="Choose your cover"
            value={plan}
            onChange={setPlan}
            options={[
              {
                id: "tp",
                name: "Third party",
                description: "The legal minimum",
                price: "£28.10",
                features: [
                  "Damage to others",
                  { label: "Fire and theft", included: false },
                  { label: "Your own car", included: false },
                ],
              },
              {
                id: "tpft",
                name: "Third party, fire & theft",
                description: "Adds fire and theft",
                price: "£31.60",
                features: [
                  "Damage to others",
                  "Fire and theft",
                  { label: "Your own car", included: false },
                ],
              },
              {
                id: "comp",
                name: "Comprehensive",
                description: "Covers your car too",
                price: "£38.20",
                flag: "Most chosen",
                features: [
                  "Damage to others",
                  "Fire and theft",
                  "Your own car",
                  { label: "Windscreen", included: false },
                ],
              },
            ]}
          />
        </div>
      </Block>
      <Block title="Timeline">
        <div style={{ maxWidth: 420 }}>
          <Timeline
            items={[
              { title: "Claim received", meta: "Mon 21 Sep, 18:04", status: "done" },
              { title: "Photos and details checked", meta: "Today, 09:12", status: "done" },
              {
                title: "Assessor reviewing damage",
                meta: "Usually 1–2 working days",
                description:
                  "We'll text you when there's an update. You don't need to do anything.",
                status: "current",
              },
              { title: "Repair booked at an approved garage" },
              { title: "Car back with you" },
            ]}
          />
        </div>
      </Block>
    </Section>
  );
}
