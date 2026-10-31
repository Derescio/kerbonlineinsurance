import { ClosingCta } from "./ClosingCta";
import { Hero } from "./Hero";
import { HowItWorks } from "./HowItWorks";
import { InsuranceTypes } from "./InsuranceTypes";
import { QuickActions } from "./QuickActions";
import { TrustStrip } from "./TrustStrip";

/** The landing page body, in Figma order (Landing page – Split hero, 53:1936). */
export function LandingPage() {
  return (
    <>
      <Hero />
      <TrustStrip />
      <InsuranceTypes />
      <HowItWorks />
      <QuickActions />
      <ClosingCta />
    </>
  );
}
