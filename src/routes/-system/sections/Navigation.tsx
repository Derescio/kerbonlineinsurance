import { useState } from "react";

import { Stepper } from "#/components/navigation/Stepper";
import { TabPanel, Tabs } from "#/components/navigation/Tabs";

import { Block, Label, Section } from "../parts";

const steps = ["Your car", "About you", "Cover", "Pay"];

export function Navigation() {
  const [tab, setTab] = useState("cover");
  const [period, setPeriod] = useState("monthly");

  return (
    <Section
      id="navigation"
      intro="Tabs switch between sibling views (Cover / Documents / Drivers, Open / Closed). Stepper shows progress through the quote and claim journeys; keep to 3–5 steps with 1–2 word labels."
    >
      <Block title="Tabs">
        {/* Tabs never wrap; on a phone the row scrolls inside its block */}
        <div className="sys__scroll sys__block">
          <div
            className="sys__row"
            style={{ gap: 48, alignItems: "flex-start", flexWrap: "nowrap", width: "max-content" }}
          >
            <div>
              <Tabs
                id="sys-policy"
                label="Policy sections"
                value={tab}
                onChange={setTab}
                items={[
                  { id: "cover", label: "Cover" },
                  { id: "documents", label: "Documents" },
                  { id: "drivers", label: "Drivers" },
                  { id: "claims", label: "Claims", count: 1 },
                ]}
              />
              <TabPanel
                tabsId="sys-policy"
                value={tab}
                className="kb-body-s"
                style={{ paddingTop: 16 }}
              >
                Showing the {tab} panel. Use ← → Home End.
              </TabPanel>
            </div>
            <Tabs
              id="sys-period"
              label="Payment period"
              variant="pill"
              value={period}
              onChange={setPeriod}
              items={[
                { id: "monthly", label: "Monthly" },
                { id: "annually", label: "Annually" },
              ]}
            />
          </div>
        </div>
      </Block>
      <Block title="Stepper">
        <div className="sys__scroll">
          {[0, 1, 2, 3].map((current) => (
            <div key={current} className="sys__block" style={{ minWidth: 560 }}>
              <Label>Step {current + 1}: default, compact, bar</Label>
              <div style={{ display: "grid", gap: 16, maxWidth: 560 }}>
                <Stepper
                  steps={steps}
                  current={current}
                  label={`Quote progress, step ${current + 1}`}
                />
                <Stepper
                  steps={steps}
                  current={current}
                  variant="compact"
                  label={`Compact, step ${current + 1}`}
                />
                <div style={{ width: 320 }}>
                  <Stepper
                    steps={steps}
                    current={current}
                    variant="bar"
                    label={`Bar, step ${current + 1}`}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </Block>
    </Section>
  );
}
