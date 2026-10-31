// Types for vite-imagetools `as=picture` imports (the package ships none for this query).
declare module "*&as=picture" {
  const picture: {
    /** Srcset per format, e.g. { avif: "a.avif 480w, …", webp: "…" }. */
    sources: Record<string, string>;
    /** Fallback image: the last format and largest width. */
    img: { src: string; w: number; h: number };
  };
  export default picture;
}
