import { createFileRoute, redirect } from "@tanstack/react-router";

import { HomeSteps } from "#/features/quote/HomeSteps";
import { JourneyShell } from "#/features/quote/JourneyShell";
import { homeSearch } from "#/features/quote/search";
import { checkPostcode } from "#/features/quote/server";

// /quote/home: the home journey (5.7, decision 2). No valid postcode in the link goes back to the
// start with home picked (5.1, call 5). The postcode is checked with postcodes.io once per postcode,
// as /quote/car does (5.2, call 15); only a definite "doesn't exist" goes back to /quote. No answer
// goes in the URL; the step does, with the gate's own params.
export const Route = createFileRoute("/_quote/quote/home")({
  validateSearch: homeSearch,
  beforeLoad: ({ search }) => {
    if (!search.postcode) throw redirect({ to: "/quote", search: { type: "home" } });
  },
  loaderDeps: ({ search }) => ({ postcode: search.postcode }),
  staleTime: Infinity,
  loader: async ({ deps: { postcode } }) => {
    if (!postcode) return;
    const { result } = await checkPostcode({ data: { postcode } }).catch(() => ({
      result: "unavailable" as const,
    }));
    if (result === "not_found") {
      throw redirect({ to: "/quote", search: { type: "home", postcode, error: "postcode" } });
    }
  },
  head: () => ({ meta: [{ title: "Home quote · Kerb" }] }),
  component: HomeQuotePage,
});

function HomeQuotePage() {
  const { postcode, step, after } = Route.useSearch();
  const navigate = Route.useNavigate();
  if (!postcode) return null;

  return (
    <JourneyShell product="home" postcode={postcode}>
      <noscript>
        <p className="quote-noscript">The quote steps need JavaScript turned on.</p>
      </noscript>
      <HomeSteps
        step={step ?? "about"}
        postcode={postcode}
        after={after}
        onStep={(next, opts) =>
          void navigate({
            // The gate's own params go with every move (5.6)
            search: (current) => ({
              ...current,
              step: next,
              auth: undefined,
              after: opts?.after,
            }),
            replace: opts?.replace,
          })
        }
        onRestart={(to) =>
          void navigate(
            to === "retrieve"
              ? { to: "/quote/retrieve", replace: true }
              : { to: "/quote", search: { type: "home" }, replace: true },
          )
        }
        onPostcode={(next) =>
          void navigate({ search: (current) => ({ ...current, postcode: next }), replace: true })
        }
      />
    </JourneyShell>
  );
}
