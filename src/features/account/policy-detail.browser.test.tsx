import { describe, expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { renderWithRouter } from "#/test/router";

import { DocumentsPage } from "./DocumentsPage";
import { Overview } from "./Overview";
import { policy } from "./overview.fixtures";
import { PoliciesPage } from "./PoliciesPage";
import { homeDetail, policyDetail } from "./policy-detail.fixtures";
import { PolicyDetailPage } from "./PolicyDetailPage";

// Policy detail, Policies and Documents (6.2; Figma Policy overview 183:3507), from their data.

const today = "2026-11-20";
const stat = (label: string) => page.getByRole("group", { name: label });

const showDetail = (detail = policyDetail()) =>
  renderWithRouter(<PolicyDetailPage policy={detail} today={today} />, "/account/policies/x");

describe("Policy detail, a car (frame 183:3507)", () => {
  it("leads with the plate, status, car and reference, and links back to all policies", async () => {
    await showDetail();
    await expect
      .element(page.getByRole("link", { name: "All policies" }))
      .toHaveAttribute("href", "/account/policies");
    await expect.element(page.getByText("KR24 BXL")).toBeVisible();
    await expect.element(page.getByText("Active", { exact: true })).toBeVisible();
    await expect
      .element(page.getByRole("heading", { level: 1 }))
      .toHaveTextContent("Volkswagen Golf");
    await expect.element(page.getByText("KRB-818784 · 1.5 TSI Life, 2021")).toBeVisible();
  });

  it("downloads the certificate from its button", async () => {
    await showDetail();
    const certificate = page.getByRole("link", { name: "Certificate", exact: true });
    await expect
      .element(certificate)
      .toHaveAttribute("href", "/api/policies/KRB-818784/documents/certificate");
    await expect
      .element(certificate)
      .toHaveAttribute("download", "Kerb-KRB-818784-certificate.pdf");
  });

  it("has the four stat cards: cover, excess with what it's made of, the instalment and renewal", async () => {
    await showDetail();
    await expect.element(stat("Cover").getByText("Comprehensive")).toBeVisible();
    await expect.element(stat("Excess").getByText("£250")).toBeVisible();
    await expect
      .element(stat("Excess").getByRole("button", { name: "What makes up the excess" }))
      .toBeVisible();
    await expect
      .element(stat("Excess").getByRole("tooltip"))
      .toHaveTextContent("£100 compulsory + £150 voluntary");
    await expect.element(stat("Per month").getByText("£44.70")).toBeVisible();
    await expect.element(stat("Per month").getByText("Car and home together")).toBeVisible();
    await expect.element(stat("Renews").getByText("14 Mar 2027")).toBeVisible();
  });

  it("names a compulsory-only excess as that", async () => {
    await showDetail(policyDetail({ compulsoryExcessPence: 25_000, voluntaryExcessPence: 0 }));
    await expect.element(stat("Excess").getByRole("tooltip")).toHaveTextContent("£250 compulsory");
  });

  it("shows a year's price for an annual payer, with no bundle line", async () => {
    await showDetail(policyDetail({ plan: { kind: "annual" }, bundled: false }));
    await expect.element(stat("A year").getByText("£491.00")).toBeVisible();
    await expect.element(stat("Per month")).not.toBeInTheDocument();
    await expect.element(page.getByText("Car and home together")).not.toBeInTheDocument();
  });

  it("lists the drivers, main driver first", async () => {
    await showDetail();
    const drivers = page.getByRole("region", { name: "Drivers" });
    await expect.element(drivers.getByText("Main driver · 9 years licence")).toBeVisible();
    expect(
      drivers
        .getByRole("listitem")
        .elements()
        .map((item) => item.textContent),
    ).toEqual([
      "MPMaya PatelMain driver · 9 years licence",
      "DPDev PatelSpouse or civil partner · 3 years licence",
    ]);
  });

  it("has the certificate and the schedule, dated the day it was bought", async () => {
    await showDetail();
    const documents = page.getByRole("region", { name: "Documents" });
    await expect.element(documents.getByText("Certificate of motor insurance")).toBeVisible();
    await expect.element(documents.getByText("Policy schedule")).toBeVisible();
    await expect.element(documents.getByText("PDF · 14 Mar 2026").first()).toBeVisible();
    await expect
      .element(documents.getByRole("link", { name: "Download Policy schedule, KRB-818784" }))
      .toHaveAttribute("href", "/api/policies/KRB-818784/documents/schedule");
  });

  it("has no action that leads nowhere yet: Start a claim, Make a change, + Add", async () => {
    await showDetail();
    for (const name of [/start a claim/i, /make a change/i, /add/i]) {
      await expect.element(page.getByRole("link", { name })).not.toBeInTheDocument();
      await expect.element(page.getByRole("button", { name })).not.toBeInTheDocument();
    }
  });
});

describe("Policy detail, other statuses", () => {
  it("lapsed: the message, Manage payments and no certificate, but the schedule", async () => {
    await showDetail(policyDetail({ status: "lapsed" }));
    await expect.element(stat("Status").getByText("Lapsed")).toBeVisible();
    await expect.element(stat("Status").getByText(/Your payment didn’t go through/)).toBeVisible();
    await expect
      .element(stat("Status").getByRole("link", { name: "Manage payments" }))
      .toHaveAttribute("href", "/account/billing");
    await expect
      .element(page.getByRole("link", { name: "Certificate", exact: true }))
      .not.toBeInTheDocument();
    const documents = page.getByRole("region", { name: "Documents" });
    await expect
      .element(documents.getByText("Certificate of motor insurance"))
      .not.toBeInTheDocument();
    await expect.element(documents.getByText("Policy schedule")).toBeVisible();
  });

  it("starting later: the start date, and the certificate", async () => {
    await showDetail(policyDetail({ startsOn: "2026-12-03", endsOn: "2027-12-02" }));
    await expect.element(page.getByText("Starts 3 Dec", { exact: true })).toBeVisible();
    await expect.element(stat("Starts").getByText("3 Dec 2026")).toBeVisible();
    await expect
      .element(page.getByRole("link", { name: "Certificate", exact: true }))
      .toBeVisible();
  });

  it("cancelled: the day it was cancelled, and no certificate", async () => {
    await showDetail(policyDetail({ status: "cancelled", cancelledOn: "2026-10-02" }));
    await expect.element(stat("Cancelled").getByText("2 Oct 2026")).toBeVisible();
    await expect
      .element(page.getByRole("link", { name: "Certificate", exact: true }))
      .not.toBeInTheDocument();
  });

  it("ended: the day it ended, and no certificate", async () => {
    await showDetail(policyDetail({ startsOn: "2025-03-14", endsOn: "2026-03-13" }));
    await expect.element(stat("Ended").getByText("13 Mar 2026")).toBeVisible();
    await expect
      .element(page.getByRole("link", { name: "Certificate", exact: true }))
      .not.toBeInTheDocument();
  });
});

describe("Policy detail, a home", () => {
  it("is titled by the address, with the property type and postcode by the reference", async () => {
    await showDetail(homeDetail());
    await expect
      .element(page.getByRole("heading", { level: 1 }))
      .toHaveTextContent("11 Rosebery Gardens, London");
    await expect.element(page.getByText("KRB-552019 · Terraced house, N8 8SH")).toBeVisible();
    await expect.element(stat("Cover").getByText("Plus")).toBeVisible();
    await expect.element(stat("A year").getByText("£547.80")).toBeVisible();
  });

  it("has Your home instead of Drivers, no Certificate button and only the schedule", async () => {
    await showDetail(homeDetail());
    const home = page.getByRole("region", { name: "Your home" });
    await expect.element(home.getByText("£420,000")).toBeVisible();
    await expect.element(home.getByText("£50,000")).toBeVisible();
    await expect.element(home.getByText("£8,000")).toBeVisible();
    await expect.element(home.getByText("1905")).toBeVisible();
    await expect.element(page.getByRole("region", { name: "Drivers" })).not.toBeInTheDocument();
    await expect
      .element(page.getByRole("link", { name: "Certificate", exact: true }))
      .not.toBeInTheDocument();
    const documents = page.getByRole("region", { name: "Documents" });
    await expect.element(documents.getByText("Policy schedule")).toBeVisible();
    expect(documents.getByRole("link").elements()).toHaveLength(1);
  });

  it("leaves out valuables when none were stated", async () => {
    const detail = homeDetail();
    await showDetail({ ...detail, home: { ...detail.home!, valuablesPence: null } });
    await expect
      .element(page.getByRole("region", { name: "Your home" }).getByText("Valuables"))
      .not.toBeInTheDocument();
  });
});

describe("Policies (/account/policies)", () => {
  it("lists every policy, cancelled too, each a link to its page", async () => {
    await renderWithRouter(
      <PoliciesPage
        policies={[policy(), policy({ id: "old", reference: "KRB-100001", status: "cancelled" })]}
        today={today}
      />,
      "/account/policies",
    );
    await expect
      .element(page.getByRole("heading", { level: 1 }))
      .toHaveTextContent("Your policies");
    await expect
      .element(page.getByRole("link", { name: /Volkswagen Golf.*Active/ }))
      .toHaveAttribute("href", "/account/policies/KRB-482913");
    await expect
      .element(page.getByRole("link", { name: /Volkswagen Golf.*Cancelled/ }))
      .toHaveAttribute("href", "/account/policies/KRB-100001");
    await expect.element(page.getByText("Policies", { exact: true })).not.toBeInTheDocument();
  });

  it("offers a quote when there are no policies", async () => {
    await renderWithRouter(<PoliciesPage policies={[]} today={today} />, "/account/policies");
    await expect.element(page.getByText("You don’t have any policies yet.")).toBeVisible();
    await expect
      .element(page.getByRole("link", { name: "Get a quote" }))
      .toHaveAttribute("href", "/quote");
  });
});

describe("Documents (/account/documents)", () => {
  const home = policy({
    id: "home",
    reference: "KRB-552019",
    product: "home",
    coverLevel: "plus",
    label: { kind: "home", line1: "11 Rosebery Gardens", town: "London" },
    boughtOn: "2026-04-02",
  });

  it("groups each policy's documents under what it insures and its reference", async () => {
    await renderWithRouter(
      <DocumentsPage policies={[policy(), home]} today={today} />,
      "/account/documents",
    );
    const car = page.getByRole("region", { name: "Volkswagen Golf" });
    await expect.element(car.getByText("KRB-482913")).toBeVisible();
    await expect
      .element(car.getByRole("link", { name: "Volkswagen Golf" }))
      .toHaveAttribute("href", "/account/policies/KRB-482913");
    await expect
      .element(car.getByRole("link", { name: /^Download Certificate/ }))
      .toHaveAttribute("href", "/api/policies/KRB-482913/documents/certificate");
    await expect.element(car.getByText("PDF · 14 Mar 2026").first()).toBeVisible();

    const house = page.getByRole("region", { name: "11 Rosebery Gardens, London" });
    await expect.element(house.getByText("Policy schedule")).toBeVisible();
    await expect.element(house.getByText("Certificate of motor insurance")).not.toBeInTheDocument();
    await expect.element(house.getByText("PDF · 2 Apr 2026")).toBeVisible();
  });

  it("has no certificate for a lapsed car", async () => {
    await renderWithRouter(
      <DocumentsPage policies={[policy({ status: "lapsed" })]} today={today} />,
      "/account/documents",
    );
    await expect.element(page.getByText("Certificate of motor insurance")).not.toBeInTheDocument();
    await expect.element(page.getByText("Policy schedule")).toBeVisible();
  });

  it("says documents appear after buying, with no policies", async () => {
    await renderWithRouter(<DocumentsPage policies={[]} today={today} />, "/account/documents");
    await expect
      .element(
        page.getByText(
          "You don’t have any documents yet. They’ll appear here when you buy a policy.",
        ),
      )
      .toBeVisible();
    await expect
      .element(page.getByRole("link", { name: "Get a quote" }))
      .toHaveAttribute("href", "/quote");
  });
});

describe("Overview rows (6.2, decision 2)", () => {
  it("link to each policy's page", async () => {
    await renderWithRouter(
      <Overview
        name="Maya Patel"
        policies={[policy()]}
        nextPayment={{ kind: "none" }}
        now={new Date("2026-11-20T09:00:00Z")}
      />,
      "/account",
    );
    await expect
      .element(page.getByRole("link", { name: /Volkswagen Golf/ }))
      .toHaveAttribute("href", "/account/policies/KRB-482913");
  });
});
