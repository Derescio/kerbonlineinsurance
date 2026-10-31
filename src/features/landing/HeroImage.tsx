import hero from "#/assets/hero-home-and-car-evening.jpg?w=480;768;1152;1600&format=avif;webp;jpg&as=picture";

// Half the container from 768px, the full width below (Figma 54:1987, 88:2313, 88:2581)
const sizes = "(min-width: 768px) 50vw, 100vw";

/**
 * The landing's LCP image: AVIF, WebP and JPEG at four widths, built by vite-imagetools.
 * Width and height are set so the box is reserved before it loads; CSS crops it per breakpoint.
 */
export function HeroImage({ className }: { className?: string }) {
  return (
    <picture className={className}>
      {Object.entries(hero.sources).map(([format, srcSet]) => (
        <source key={format} type={`image/${format}`} srcSet={srcSet} sizes={sizes} />
      ))}
      <img
        src={hero.img.src}
        width={hero.img.w}
        height={hero.img.h}
        // Decorative: it repeats nothing the hero copy doesn't say
        alt=""
        loading="eager"
        decoding="async"
        fetchPriority="high"
      />
    </picture>
  );
}
