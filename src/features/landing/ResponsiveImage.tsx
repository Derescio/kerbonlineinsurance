import type { ImgHTMLAttributes } from "react";

/** What a vite-imagetools `&as=picture` import gives (see src/imagetools.d.ts). */
export interface Picture {
  sources: Record<string, string>;
  img: { src: string; w: number; h: number };
}

export interface ResponsiveImageProps {
  picture: Picture;
  /** `sizes` for every source, matching the box the CSS gives the image. */
  sizes: string;
  /** The <picture> is the box; CSS crops the image to fill it. */
  className?: string;
  loading: "eager" | "lazy";
  fetchPriority?: ImgHTMLAttributes<HTMLImageElement>["fetchPriority"];
}

/**
 * A decorative photo as AVIF, WebP and JPEG at several widths. Width and height come from the
 * source, so the box is reserved before it loads.
 */
export function ResponsiveImage({
  picture,
  sizes,
  className,
  loading,
  fetchPriority,
}: ResponsiveImageProps) {
  return (
    <picture className={className}>
      {Object.entries(picture.sources).map(([format, srcSet]) => (
        <source key={format} type={`image/${format}`} srcSet={srcSet} sizes={sizes} />
      ))}
      <img
        src={picture.img.src}
        width={picture.img.w}
        height={picture.img.h}
        // Decorative: the copy beside it says everything the photo does
        alt=""
        loading={loading}
        decoding="async"
        fetchPriority={fetchPriority}
      />
    </picture>
  );
}
