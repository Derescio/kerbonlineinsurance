import { createFileRoute, redirect } from "@tanstack/react-router";

import { DriverSteps } from "#/features/quote/DriverSteps";
import { JourneyShell } from "#/features/quote/JourneyShell";
import { carSearch } from "#/features/quote/search";
import { checkPostcode } from "#/features/quote/server";
import { VehicleStep } from "#/features/quote/VehicleStep";

// /quote/car: the car journey. No valid postcode in the link goes back to the start with car picked
// (5.1, call 5). The postcode is checked with postcodes.io once per postcode: the loader depends on
// it alone and never goes stale, so moving between the vehicle views doesn't check again (5.2,
// call 15; plan P4). Only a definite "doesn't exist" goes back to /quote.
export const Route = createFileRoute("/_quote/quote/car")({
  validateSearch: carSearch,
  beforeLoad: ({ search }) => {
    if (!search.postcode) throw redirect({ to: "/quote", search: { type: "car" } });
  },
  loaderDeps: ({ search }) => ({ postcode: search.postcode }),
  staleTime: Infinity,
  loader: async ({ deps: { postcode } }) => {
    if (!postcode) return;
    const { result } = await checkPostcode({ data: { postcode } }).catch(() => ({
      result: "unavailable" as const,
    }));
    if (result === "not_found") {
      throw redirect({ to: "/quote", search: { type: "car", postcode, error: "postcode" } });
    }
  },
  head: () => ({ meta: [{ title: "Car quote · Kerb" }] }),
  component: CarQuotePage,
});

function CarQuotePage() {
  const { postcode, vehicle, step } = Route.useSearch();
  const navigate = Route.useNavigate();
  if (!postcode) return null;

  // The driver steps and the holding quote view (5.3, call 5); no answer goes in the URL
  if (step) {
    return (
      <JourneyShell product="car" postcode={postcode}>
        <noscript>
          <p className="quote-noscript">The quote steps need JavaScript turned on.</p>
        </noscript>
        <DriverSteps
          step={step}
          onStep={(next, opts) =>
            void navigate({
              search: (current) => ({ ...current, vehicle: undefined, step: next }),
              replace: opts?.replace,
            })
          }
        />
      </JourneyShell>
    );
  }

  return (
    <JourneyShell product="car" postcode={postcode}>
      <noscript>
        <p className="quote-noscript">The car step needs JavaScript turned on.</p>
      </noscript>
      <VehicleStep
        view={vehicle ?? "plate"}
        onView={(next) =>
          void navigate({
            search: (current) => ({ ...current, vehicle: next === "plate" ? undefined : next }),
          })
        }
        onContinue={() =>
          void navigate({
            search: (current) => ({ ...current, vehicle: undefined, step: "about" }),
          })
        }
      />
    </JourneyShell>
  );
}
