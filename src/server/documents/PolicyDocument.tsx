import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { ReactNode } from "react";

import { documentTitles, type PolicyDocumentKind } from "#/features/account/documents";
import { longDay } from "#/features/account/overview-model";
import {
  driverLine,
  excessParts,
  fullName,
  usageLabel,
  wholePounds,
} from "#/features/account/policy-labels";
import { addonCopy } from "#/features/quote/cover";
import { tierName } from "#/features/quote/labels";
import { propertyTypeLabel } from "#/features/quote/schemas/home-steps";
import { formatPounds } from "#/features/rating/money";
import type { PolicyDetail } from "#/server/data/policies";

import { BODY, DISPLAY } from "./fonts";

// The certificate of motor insurance and the policy schedule (6.2, decision 8), drawn from the
// owner's own policy. Every page says it's a demo: these must never pass as proof of cover.

export const DEMO_LINE = "Kerb demo: this is not a real insurance document";

const INK = "#1a1916";
const MUTED = "#5c5950";
const EVERGREEN = "#0b2a22";
const GREEN = "#1f8563";
const RULE = "#dedbd2";
const MARKER = "#eef98f";

// react-pdf turns a line height into points using the font size in the same style (18 when none),
// so every text style sets both
const BODY_TEXT = { fontSize: 10, lineHeight: 1.45 };

const s = StyleSheet.create({
  page: {
    paddingTop: 48,
    paddingBottom: 72,
    paddingHorizontal: 48,
    fontFamily: BODY,
    fontSize: 10,
    color: INK,
  },
  head: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingBottom: 16,
    borderBottomWidth: 2,
    borderBottomColor: EVERGREEN,
  },
  wordmark: { flexDirection: "row", alignItems: "flex-end" },
  wordmarkText: { fontFamily: DISPLAY, fontWeight: 800, fontSize: 24, color: EVERGREEN },
  wordmarkStop: { width: 6, height: 6, marginLeft: 1.5, marginBottom: 5, backgroundColor: GREEN },
  headRight: { alignItems: "flex-end" },
  reference: { fontWeight: 600, ...BODY_TEXT, color: MUTED },
  title: {
    marginTop: 24,
    fontFamily: DISPLAY,
    fontWeight: 700,
    fontSize: 22,
    lineHeight: 1.2,
    color: INK,
  },
  intro: { marginTop: 4, ...BODY_TEXT, color: MUTED },
  section: { marginTop: 20 },
  sectionTitle: {
    fontFamily: DISPLAY,
    fontWeight: 700,
    fontSize: 13,
    lineHeight: 1.3,
    color: EVERGREEN,
    marginBottom: 4,
  },
  row: {
    flexDirection: "row",
    paddingVertical: 5,
    borderBottomWidth: 0.75,
    borderBottomColor: RULE,
  },
  label: { width: "42%", paddingRight: 12, ...BODY_TEXT, color: MUTED },
  value: { width: "58%", ...BODY_TEXT, fontWeight: 600 },
  money: { width: "58%", ...BODY_TEXT, fontWeight: 600, textAlign: "right" },
  total: { borderBottomWidth: 0, borderTopWidth: 1.5, borderTopColor: INK },
  note: { marginTop: 8, ...BODY_TEXT, color: MUTED },
  statement: {
    marginTop: 24,
    padding: 12,
    ...BODY_TEXT,
    backgroundColor: MARKER,
    color: EVERGREEN,
  },
  footerRule: {
    position: "absolute",
    left: 48,
    right: 48,
    bottom: 50,
    height: 0.75,
    backgroundColor: RULE,
  },
  footerText: {
    position: "absolute",
    bottom: 32,
    fontSize: 8.5,
    color: MUTED,
  },
  footerLeft: { left: 48 },
  footerRight: { right: 48 },
});

function Row({
  label,
  children,
  money = false,
}: {
  label: string;
  children: ReactNode;
  money?: boolean;
}) {
  return (
    <View style={s.row} wrap={false}>
      <Text style={s.label}>{label}</Text>
      <Text style={money ? s.money : s.value}>{children}</Text>
    </View>
  );
}

function Section({
  title,
  children,
  keepTogether = false,
}: {
  title: string;
  children: ReactNode;
  keepTogether?: boolean;
}) {
  return (
    <View style={s.section} wrap={!keepTogether}>
      <Text style={s.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Frame({
  title,
  intro,
  policy,
  children,
}: {
  title: string;
  intro: string;
  policy: PolicyDetail;
  children: ReactNode;
}) {
  return (
    <Document title={`${title} ${policy.reference}`} author="Kerb (demo)" creator="Kerb">
      <Page size="A4" style={s.page}>
        <View style={s.footerRule} fixed />
        <Text style={[s.footerText, s.footerLeft]} fixed>
          {DEMO_LINE}
        </Text>
        <Text
          style={[s.footerText, s.footerRight]}
          fixed
          render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
        />
        <View style={s.head} fixed>
          <View style={s.wordmark}>
            <Text style={s.wordmarkText}>kerb</Text>
            <View style={s.wordmarkStop} />
          </View>
          <View style={s.headRight}>
            <Text style={s.reference}>{policy.reference}</Text>
            <Text style={s.reference}>Issued {longDay(policy.boughtOn)}</Text>
          </View>
        </View>
        <Text style={s.title}>{title}</Text>
        <Text style={s.intro}>{intro}</Text>
        {children}
      </Page>
    </Document>
  );
}

const period = (policy: PolicyDetail) => `${longDay(policy.startsOn)} to ${longDay(policy.endsOn)}`;

/** Who may drive: every named driver, on the certificate's usual condition */
function entitledToDrive(policy: PolicyDetail): string {
  const names = policy.drivers.map(fullName);
  const listed =
    names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : (names[0] ?? "");
  return `${listed}, provided the person driving holds a licence to drive the vehicle and is not disqualified from holding or obtaining one.`;
}

function limitationsOfUse(usage: string): string {
  const purposes =
    usage === "business"
      ? "social, domestic and pleasure purposes, commuting, and the policyholder\u2019s business"
      : usage === "commuting"
        ? "social, domestic and pleasure purposes, and travel to and from a permanent place of work"
        : "social, domestic and pleasure purposes";
  return `Use for ${purposes}. Not for hire or reward, racing, or any purpose in connection with the motor trade.`;
}

function Certificate({ policy }: { policy: PolicyDetail }) {
  const car = policy.car;
  return (
    <Frame
      title={documentTitles.certificate}
      intro="Keep this with your policy schedule. You may be asked to show it."
      policy={policy}
    >
      <Section title="Certificate">
        <Row label="Certificate number">{policy.reference}</Row>
        <Row label="Registration mark of vehicle">
          {car?.registration ??
            `${car ? `${car.make} ${car.model}` : "Vehicle"} (registration not given)`}
        </Row>
        <Row label="Name of policyholder">{fullName(policy.policyholder)}</Row>
        <Row label="Effective date of the start of insurance">{longDay(policy.startsOn)}</Row>
        <Row label="Date of expiry of insurance">{longDay(policy.endsOn)}</Row>
        <Row label="Persons or classes of persons entitled to drive">{entitledToDrive(policy)}</Row>
        <Row label="Limitations as to use">{limitationsOfUse(car?.usage ?? "social")}</Row>
      </Section>
      <Text style={s.statement}>
        {
          "A real certificate would say: \u201CI hereby certify that the policy to which this certificate relates satisfies the requirements of the relevant law applicable in Great Britain, Northern Ireland, the Isle of Man, the Island of Guernsey, the Island of Jersey and the Island of Alderney.\u201D Kerb is a fictional insurer made for a portfolio project, so this certificate certifies nothing."
        }
      </Text>
    </Frame>
  );
}

function Schedule({ policy }: { policy: PolicyDetail }) {
  const { car, home, policyholder } = policy;
  const excess = excessParts(policy);
  const address = [
    policyholder.addressLine1,
    policyholder.addressLine2,
    policyholder.town,
    policyholder.postcode,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <Frame
      title={documentTitles.schedule}
      intro={`Your ${policy.product === "home" ? "home" : "car"} insurance: who and what is covered, for how long, and what it costs.`}
      policy={policy}
    >
      <Section title="Your policy">
        <Row label="Policy reference">{policy.reference}</Row>
        <Row label="Cover">{tierName(policy.coverLevel)}</Row>
        <Row label="Period of cover">{period(policy)}</Row>
        <Row label="Bought on">{longDay(policy.boughtOn)}</Row>
        <Row label="Quote reference">{policy.quote.reference}</Row>
      </Section>
      <Section title="Policyholder">
        <Row label="Name">{fullName(policyholder)}</Row>
        <Row label="Address">{address}</Row>
      </Section>
      {car ? (
        <Section title="Your car">
          <Row label="Car">{`${car.make} ${car.model} ${car.variant}, ${car.year}`}</Row>
          <Row label="Registration">{car.registration ?? "Not given"}</Row>
          <Row label="Value">{wholePounds(car.valuePence)}</Row>
          <Row label="Use">{usageLabel(car.usage)}</Row>
          {policy.drivers.map((driver) => (
            <Row key={`${driver.firstName}-${driver.lastName}`} label={fullName(driver)}>
              {driverLine(driver)}
            </Row>
          ))}
        </Section>
      ) : null}
      {home ? (
        <Section title="Your home">
          <Row label="Address">
            {[home.addressLine1, home.addressLine2, home.town, home.postcode]
              .filter(Boolean)
              .join(", ")}
          </Row>
          <Row label="Property">{propertyTypeLabel(home.propertyType)}</Row>
          <Row label="Bedrooms">{String(home.bedrooms)}</Row>
          <Row label="Year built">{String(home.yearBuilt)}</Row>
          <Row label="Rebuild cost">{wholePounds(home.rebuildCostPence)}</Row>
          <Row label="Contents">{wholePounds(home.contentsValuePence)}</Row>
          {home.valuablesPence != null ? (
            <Row label="Valuables">{wholePounds(home.valuablesPence)}</Row>
          ) : null}
        </Section>
      ) : null}
      <Section title="Excess">
        <Row label="Total excess">{`${excess.total} (${excess.parts})`}</Row>
      </Section>
      <Section title="Your price for the year" keepTogether>
        <Row label={`${tierName(policy.coverLevel)} cover`} money>
          {formatPounds(policy.coverPremiumPence)}
        </Row>
        {policy.addons.map((addon) => (
          <Row key={addon.addon} label={addonCopy(addon.addon).label} money>
            {formatPounds(addon.annualPricePence)}
          </Row>
        ))}
        {policy.saving ? (
          <Row label={policy.saving.kind === "bundle" ? "Bundle saving" : "Your saving"} money>
            {`\u2212${formatPounds(policy.saving.pence)}`}
          </Row>
        ) : null}
        <View style={[s.row, s.total]} wrap={false}>
          <Text style={s.label}>Premium, before Insurance Premium Tax</Text>
          <Text style={s.money}>{formatPounds(policy.annualPremiumPence)}</Text>
        </View>
        <Text style={s.note}>
          {`Total for quote ${policy.quote.reference}, including Insurance Premium Tax: ${formatPounds(policy.quote.totalPence)}${policy.bundled ? ", for your car and home together" : ""}. `}
          {policy.plan.kind === "monthly"
            ? `Paid monthly: ${formatPounds(policy.plan.instalmentPence)} a month.`
            : "Paid annually, in full."}
        </Text>
      </Section>
    </Frame>
  );
}

export function PolicyDocument({
  kind,
  policy,
}: {
  kind: PolicyDocumentKind;
  policy: PolicyDetail;
}) {
  switch (kind) {
    case "certificate":
      return <Certificate policy={policy} />;
    case "schedule":
      return <Schedule policy={policy} />;
    default: {
      const unhandled: never = kind;
      return unhandled;
    }
  }
}
