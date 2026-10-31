import hero from "#/assets/hero-home-and-car-evening.jpg?w=480;768;1152;1600&format=avif;webp;jpg&as=picture";

import { ResponsiveImage } from "./ResponsiveImage";

// Half the container from 768px, the full width below (Figma 54:1987, 88:2313, 88:2581)
const sizes = "(min-width: 768px) 50vw, 100vw";

/** The landing's LCP image, so it loads eagerly at high priority. CSS crops it per breakpoint. */
export function HeroImage({ className }: { className?: string }) {
  return (
    <ResponsiveImage
      picture={hero}
      sizes={sizes}
      className={className}
      loading="eager"
      fetchPriority="high"
    />
  );
}
