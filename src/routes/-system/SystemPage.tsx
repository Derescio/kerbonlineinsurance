import { Wordmark } from "#/components/display/Wordmark";

import { sections } from "./parts";
import { Actions } from "./sections/Actions";
import { Display } from "./sections/Display";
import { Feedback } from "./sections/Feedback";
import { Forms } from "./sections/Forms";
import { Foundations } from "./sections/Foundations";
import { Icons } from "./sections/Icons";
import { Insurance } from "./sections/Insurance";
import { Navigation } from "./sections/Navigation";

export function SystemPage() {
  return (
    <main className="sys">
      <header className="sys__header">
        <Wordmark size={36} descriptor="design system" />
        <h1 className="kb-display-l" style={{ margin: "24px 0 8px" }}>
          Every Kerb token and component
        </h1>
        <p className="kb-body-l" style={{ color: "var(--fg-2)", margin: 0 }}>
          As built, in every state, in the order of the Figma pages.
        </p>
      </header>
      <nav aria-label="Design system sections">
        <ul className="sys__nav">
          {sections.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="kb-body-s">
                {s.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <Foundations />
      <Icons />
      <Actions />
      <Display />
      <Forms />
      <Feedback />
      <Navigation />
      <Insurance />
    </main>
  );
}
