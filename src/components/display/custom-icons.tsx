import type { LucideProps } from "lucide-react";

// Kerb's own glyphs for insurance types Lucide doesn't cover, drawn in Figma on the Lucide grid
// (Insurance types, 110:2583 condo, 110:2585 tenant, 110:2588 land, 110:2591 pet). They take the
// same props as a Lucide icon, so icons.ts can register them. Figma draws them with a 1.8 stroke,
// which is kept here.

const stroke = 1.8;

function Glyph({
  size = 24,
  color = "currentColor",
  strokeWidth: _strokeWidth,
  absoluteStrokeWidth: _absolute,
  children,
  ...rest
}: LucideProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {children}
    </svg>
  );
}

export function Condo(props: LucideProps) {
  return (
    <Glyph {...props}>
      <path d="M5 21V3H19V21M5 21H3M5 21H10M19 21H14M19 21H21M10 21H14M10 21V18H14V21M9 7H10M14 7H15M9 11H10M14 11H15M9 15H10M14 15H15" />
    </Glyph>
  );
}

export function Tenant(props: LucideProps) {
  return (
    <Glyph {...props}>
      <path d="M12 9C12 11.2091 10.2091 13 8 13C5.79086 13 4 11.2091 4 9C4 6.79086 5.79086 5 8 5C10.2091 5 12 6.79086 12 9Z" />
      <path d="M11 12L14 15M14 15L17 18M14 15L17 12M17 18L20 21M17 18L20 15" />
    </Glyph>
  );
}

export function Land(props: LucideProps) {
  return (
    <Glyph {...props}>
      <path d="M3 17L9 9L14 15L17 11L21 17M3 21H21M16 5H16.01" />
      <path d="M19 5C19 6.10457 18.1046 7 17 7C15.8954 7 15 6.10457 15 5C15 3.89543 15.8954 3 17 3C18.1046 3 19 3.89543 19 5Z" />
    </Glyph>
  );
}

export function Pet(props: LucideProps) {
  return (
    <Glyph {...props}>
      <path d="M8 14C7 16 4 17 5 20C6 23 10 20 12 20C14 20 18 23 19 20C20 17 17 16 16 14C14 11 10 11 8 14Z" />
      <path d="M7 10C7 11.6569 6.10457 13 5 13C3.89543 13 3 11.6569 3 10C3 8.34315 3.89543 7 5 7C6.10457 7 7 8.34315 7 10Z" />
      <path d="M12 6C12 7.65685 11.1046 9 10 9C8.89543 9 8 7.65685 8 6C8 4.34315 8.89543 3 10 3C11.1046 3 12 4.34315 12 6Z" />
      <path d="M18 6C18 7.65685 17.1046 9 16 9C14.8954 9 14 7.65685 14 6C14 4.34315 14.8954 3 16 3C17.1046 3 18 4.34315 18 6Z" />
      <path d="M23 11C23 12.6569 22.1046 14 21 14C19.8954 14 19 12.6569 19 11C19 9.34315 19.8954 8 21 8C22.1046 8 23 9.34315 23 11Z" />
    </Glyph>
  );
}
