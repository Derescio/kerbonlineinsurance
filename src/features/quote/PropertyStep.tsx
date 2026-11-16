import { useEffect, useRef, useState, type FormEvent } from "react";

import { Button } from "#/components/actions/Button";
import { Input } from "#/components/forms/Input";
import { Select } from "#/components/forms/Select";
import { fieldErrors, focusFirstError } from "#/lib/validation";

import type { DemoAddress } from "./demo-addresses";
import { storedHomeAnswers, storedHomeErrors } from "./home-steps";
import { setHomePostcode, setHomeStepAnswers, type StoredProperty } from "./journey-store";
import { JourneyPage } from "./page-kit";
import { normalisePostcode, postcodeError } from "./postcode";
import { propertySchema, propertyTypeOptions } from "./schemas/home-steps";
import { postcodeNotFoundError } from "./search";
import { findAddresses } from "./server";
import {
  chosen,
  numberText,
  StepActions,
  StepHeading,
  type Errors,
  type StepProps,
} from "./step-kit";

// Property (5.7, decision 4; screen 05, 222:6762, in 5.4b's frame): the address from the postcode,
// or typed in, then the building. Bedrooms isn't drawn, but the price reads it. A new postcode
// redoes the list and drops an address picked from the old one.

const UNAVAILABLE = "We couldn’t look up addresses just now. Enter your address below.";

const bedroomOptions = Array.from({ length: 11 }, (_, n) => ({
  value: String(n),
  label: n === 0 ? "Studio" : String(n),
}));

interface Address {
  line1: string;
  line2: string;
  town: string;
  picked: boolean;
}

const blankAddress: Address = { line1: "", line2: "", town: "", picked: false };

const addressLabel = (a: { line1: string; town: string }) => `${a.line1}, ${a.town}`;

export function PropertyStep({
  journey,
  today,
  revalidate,
  onBack,
  onDone,
  onPostcode,
  tabs,
  aside,
}: StepProps & {
  /** The URL follows a changed postcode */
  onPostcode: (postcode: string) => void;
}) {
  const stored = storedHomeAnswers(journey, "property") as StoredProperty | undefined;
  const [postcode, setPostcode] = useState(journey.postcode);
  const [postcodeMessage, setPostcodeMessage] = useState<string | null>(null);
  const [addresses, setAddresses] = useState<DemoAddress[]>([]);
  const [listedFor, setListedFor] = useState(journey.postcode);
  const [address, setAddress] = useState<Address | null>(() =>
    stored?.address ? { ...blankAddress, ...stored.address } : null,
  );
  const [manual, setManual] = useState(() => stored?.address?.picked === false);
  const [form, setForm] = useState(() => ({
    propertyType: stored?.propertyType ?? "",
    yearBuilt: numberText(stored?.yearBuilt),
    bedrooms: numberText(stored?.bedrooms),
    rebuildCostPounds: numberText(stored?.rebuildCostPounds),
  }));
  const [errors, setErrors] = useState<Errors>(() =>
    revalidate ? storedHomeErrors(journey, "property", today) : {},
  );
  const formRef = useRef<HTMLFormElement>(null);

  async function lookUp(code: string) {
    setPostcodeMessage(null);
    try {
      const answer = await findAddresses({ data: { postcode: code } });
      setAddresses(answer.addresses);
      if (answer.result === "found") setListedFor(code);
      if (answer.result === "not_found") setPostcodeMessage(postcodeNotFoundError);
      if (answer.result === "unavailable") {
        setPostcodeMessage(UNAVAILABLE);
        setManual(true);
      }
      return answer.result;
    } catch {
      setPostcodeMessage(UNAVAILABLE);
      setManual(true);
      return "unavailable" as const;
    }
  }

  // The list for the journey's postcode, once
  useEffect(() => {
    void lookUp(journey.postcode);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the first postcode only
  }, []);

  async function findAddress() {
    const code = normalisePostcode(postcode);
    if (!code) {
      setPostcodeMessage(postcodeError);
      return;
    }
    const result = await lookUp(code);
    if (result === "not_found" || code === journey.postcode) return;
    // A new postcode: the journey and the URL follow it, and a picked address goes (decision 4)
    setHomePostcode(code);
    onPostcode(code);
    if (!address || address.picked) setAddress(null);
  }

  function pick(id: string) {
    const found = addresses.find((a) => a.id === id);
    setAddress(
      found ? { ...blankAddress, ...found, line2: found.line2 ?? "", picked: true } : null,
    );
  }

  function typeIn(change: Partial<Address>) {
    setAddress((current) => ({ ...(current ?? blankAddress), ...change, picked: false }));
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const result = fieldErrors(propertySchema(Number(today.slice(0, 4))), {
      address: address ?? undefined,
      propertyType: chosen(form.propertyType),
      yearBuilt: form.yearBuilt,
      bedrooms: chosen(form.bedrooms),
      rebuildCostPounds: form.rebuildCostPounds,
    });
    if (result.errors) {
      setErrors(result.errors);
      focusFirstError(formRef.current);
      return;
    }
    setHomeStepAnswers("property", result.data);
    onDone();
  }

  const pickedId = address?.picked
    ? (addresses.find((a) => a.line1 === address.line1 && a.town === address.town)?.id ?? "")
    : "";
  const addressError = errors.address;

  return (
    <JourneyPage
      heading={
        <StepHeading
          overline="Home insurance / Your details"
          title="Tell us about your property"
          intro="We’ve brought your postcode across. Choose your address, then check the property details."
        />
      }
      tabs={tabs}
      aside={aside}
      asideLabel="Your home and help"
    >
      <form ref={formRef} className="quote-form" onSubmit={submit} noValidate>
        <section className="quote-panel" aria-labelledby="address-heading">
          <h2 id="address-heading" className="kb-h3 quote-panel__title">
            Your address
          </h2>
          <div className="quote-fields quote-fields--lookup">
            <Input
              label="Postcode"
              autoComplete="postal-code"
              hint="From your link. Change it if needed."
              value={postcode}
              error={postcodeMessage ?? undefined}
              onChange={(e) => setPostcode(e.target.value)}
            />
            <Button type="button" variant="secondary" onClick={() => void findAddress()}>
              Find address
            </Button>
          </div>
          {manual ? (
            <>
              <Input
                label="Address line 1"
                autoComplete="address-line1"
                value={address?.line1 ?? ""}
                error={errors["address.line1"] ?? addressError}
                onChange={(e) => typeIn({ line1: e.target.value })}
              />
              <Input
                label="Address line 2"
                optional
                autoComplete="address-line2"
                value={address?.line2 ?? ""}
                error={errors["address.line2"]}
                onChange={(e) => typeIn({ line2: e.target.value })}
              />
              <Input
                label="Town or city"
                autoComplete="address-level2"
                value={address?.town ?? ""}
                error={errors["address.town"]}
                onChange={(e) => typeIn({ town: e.target.value })}
              />
            </>
          ) : (
            <>
              <Select
                label="Select your address"
                placeholder="Choose your address"
                hint={addresses.length ? `Addresses found for ${listedFor}` : undefined}
                options={addresses.map((a) => ({ value: a.id, label: addressLabel(a) }))}
                value={pickedId}
                error={addressError}
                onChange={(e) => pick(e.target.value)}
              />
              <button
                type="button"
                className="quote-link"
                onClick={() => {
                  setManual(true);
                  setAddress(null);
                }}
              >
                Enter address manually
              </button>
            </>
          )}
        </section>

        <section className="quote-panel" aria-labelledby="building-heading">
          <h2 id="building-heading" className="kb-h3 quote-panel__title">
            About the building
          </h2>
          <div className="quote-fields">
            <Select
              label="Property type"
              placeholder="Choose a type"
              options={propertyTypeOptions}
              value={form.propertyType}
              error={errors.propertyType}
              onChange={(e) => setForm((f) => ({ ...f, propertyType: e.target.value }))}
            />
            <Input
              label="Year built"
              inputMode="numeric"
              maxLength={4}
              hint="Use the year the property was built."
              value={form.yearBuilt}
              error={errors.yearBuilt}
              onChange={(e) => setForm((f) => ({ ...f, yearBuilt: e.target.value }))}
            />
            <Select
              label="Bedrooms"
              placeholder="Choose"
              options={bedroomOptions}
              value={form.bedrooms}
              error={errors.bedrooms}
              onChange={(e) => setForm((f) => ({ ...f, bedrooms: e.target.value }))}
            />
          </div>
          <Input
            label="Rebuild cost"
            inputMode="numeric"
            prefix="£"
            hint="The cost to rebuild your home, not its market value. Include demolition, materials and professional fees."
            value={form.rebuildCostPounds}
            error={errors.rebuildCostPounds}
            onChange={(e) => setForm((f) => ({ ...f, rebuildCostPounds: e.target.value }))}
          />
        </section>

        <StepActions onBack={onBack} submit="Continue to contents" />
      </form>
    </JourneyPage>
  );
}
