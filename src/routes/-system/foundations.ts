// Token names shown on /system. Values are read from the loaded CSS at runtime, so the page shows
// what the browser applies; system.browser.test.tsx fails if a name here stops existing.

export const colorRamps = {
  Evergreen: ["950", "900", "800", "700", "600", "500", "400", "300", "200", "100", "50"].map(
    (s) => `--green-${s}`,
  ),
  Marker: ["500", "400", "300", "100"].map((s) => `--marker-${s}`),
  Stone: ["900", "800", "700", "600", "500", "400", "300", "200", "100", "50", "25", "0"].map(
    (s) => `--stone-${s}`,
  ),
  Red: ["700", "600", "200", "100"].map((s) => `--red-${s}`),
  Amber: ["600", "400", "200", "100"].map((s) => `--amber-${s}`),
  Blue: ["600", "200", "100"].map((s) => `--blue-${s}`),
};

export const semanticColors = {
  Surfaces: [
    "--bg-page",
    "--bg-surface",
    "--bg-surface-hover",
    "--bg-sunken",
    "--bg-inverse",
    "--bg-brand-subtle",
    "--bg-accent",
  ],
  Text: [
    "--fg-1",
    "--fg-2",
    "--fg-3",
    "--fg-4",
    "--fg-brand",
    "--fg-inverse",
    "--fg-inverse-2",
    "--fg-on-primary",
    "--fg-on-accent",
  ],
  Borders: ["--border-1", "--border-2", "--border-strong", "--border-inverse"],
  Actions: [
    "--action-primary",
    "--action-primary-hover",
    "--action-primary-press",
    "--accent",
    "--accent-hover",
  ],
  Status: [
    "--success",
    "--success-bg",
    "--success-border",
    "--warning",
    "--warning-bg",
    "--warning-border",
    "--danger",
    "--danger-hover",
    "--danger-bg",
    "--danger-border",
    "--info",
    "--info-bg",
    "--info-border",
  ],
};

/** Type classes with the Figma text style each one implements and a sample line. */
export const typeStyles = [
  { className: "kb-display-xl", figma: "Display/XL", sample: "Insurance that gets out of the way" },
  { className: "kb-display-l", figma: "Display/L", sample: "You're covered." },
  { className: "kb-h1", figma: "Heading/H1", sample: "Your policy, in plain English" },
  { className: "kb-h2", figma: "Heading/H2", sample: "What happened?" },
  { className: "kb-h-dialog", figma: "Heading/Dialog", sample: "Cancel your policy?" },
  { className: "kb-h3", figma: "Heading/H3", sample: "Comprehensive cover" },
  { className: "kb-h-plan", figma: "Heading/Plan", sample: "Third party, fire and theft" },
  { className: "kb-price", figma: "Heading/Price", sample: "£38.20" },
  { className: "kb-body-l", figma: "Body/L", sample: "We'll text you when the assessor has been." },
  {
    className: "kb-body",
    figma: "Body/M",
    sample: "Your excess is the amount you pay towards a claim.",
  },
  { className: "kb-body-s", figma: "Body/S", sample: "Prices include Insurance Premium Tax." },
  { className: "kb-caption", figma: "Body/Caption", sample: "Updated 2 minutes ago" },
  { className: "kb-overline", figma: "Mono/Overline", sample: "Policy number" },
  { className: "kb-reference", figma: "Mono/Reference", sample: "KRB-P-448120" },
  { className: "kb-plate", figma: "Mono/Plate", sample: "KR24 BXL" },
];

export const spacing = ["0-5", "1", "2", "3", "4", "5", "6", "8", "10", "12", "16", "20"].map(
  (s) => `--space-${s}`,
);

export const radii = ["xs", "sm", "md", "lg", "xl", "pill"].map((s) => `--radius-${s}`);

export const elevation = [
  { token: "--shadow-1", label: "Shadow 1 · rest", use: "Cards at rest" },
  { token: "--shadow-2", label: "Shadow 2 · hover", use: "Hover, dropdowns" },
  { token: "--shadow-3", label: "Shadow 3 · overlay", use: "Dialogs, toasts" },
  { token: "--focus-ring", label: "Focus ring", use: "Buttons :focus-visible" },
];

export const allTokens = [
  ...Object.values(colorRamps).flat(),
  ...Object.values(semanticColors).flat(),
  ...spacing,
  ...radii,
  ...elevation.map((e) => e.token),
];
