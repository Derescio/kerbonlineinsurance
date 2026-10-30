import { useEffect, useState, type ReactNode } from "react";

import { Card } from "#/components/display/Card";

/** The eight sections, in Figma page order. Drives the nav and the section ids. */
export const sections = [
  { id: "foundations", title: "Foundations" },
  { id: "icons", title: "Icons" },
  { id: "actions", title: "Actions" },
  { id: "display", title: "Display" },
  { id: "forms", title: "Forms" },
  { id: "feedback", title: "Feedback" },
  { id: "navigation", title: "Navigation" },
  { id: "insurance", title: "Insurance" },
] as const;

export type SectionId = (typeof sections)[number]["id"];

export function Section({
  id,
  intro,
  children,
}: {
  id: SectionId;
  intro: string;
  children: ReactNode;
}) {
  const title = sections.find((s) => s.id === id)!.title;
  return (
    <section id={id} className="sys__section" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="kb-h1">
        {title}
      </h2>
      <p className="sys__intro kb-body">{intro}</p>
      {children}
    </section>
  );
}

/** One specimen block: an overline title over an outlined card. */
export function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="sys__block">
      <h3 className="sys__block-title kb-overline">{title}</h3>
      <Card variant="outline">{children}</Card>
    </div>
  );
}

/** A caption above a specimen inside a block. */
export function Label({ children }: { children: ReactNode }) {
  return <span className="sys__label kb-caption">{children}</span>;
}

/**
 * A custom property's computed value, read in the browser after hydration (empty on the server,
 * so server and client render the same first).
 */
export function useCssVar(name: string) {
  const [value, setValue] = useState("");
  useEffect(() => {
    setValue(getComputedStyle(document.documentElement).getPropertyValue(name).trim());
  }, [name]);
  return value;
}
