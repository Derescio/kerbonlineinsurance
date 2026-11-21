import bricolage700 from "@fontsource/bricolage-grotesque/files/bricolage-grotesque-latin-700-normal.woff?inline";
import bricolage800 from "@fontsource/bricolage-grotesque/files/bricolage-grotesque-latin-800-normal.woff?inline";
import instrument400 from "@fontsource/instrument-sans/files/instrument-sans-latin-400-normal.woff?inline";
import instrument600 from "@fontsource/instrument-sans/files/instrument-sans-latin-600-normal.woff?inline";
import { Font } from "@react-pdf/renderer";

// The brand faces for the PDFs (6.2, decision 7). react-pdf can't use variable fonts, so these
// are the static WOFF weights, inlined as data URLs: the serverless bundle then carries them, with
// no file path to resolve at run time. No mono face: fontkit can't read Plex Mono's WOFF, and its
// WOFF2 draws no glyphs.

export const DISPLAY = "Bricolage Grotesque";
export const BODY = "Instrument Sans";

let registered = false;

export function registerDocumentFonts(): void {
  if (registered) return;
  Font.register({
    family: DISPLAY,
    fonts: [
      { src: bricolage700, fontWeight: 700 },
      { src: bricolage800, fontWeight: 800 },
    ],
  });
  Font.register({
    family: BODY,
    fonts: [
      { src: instrument400, fontWeight: 400 },
      { src: instrument600, fontWeight: 600 },
    ],
  });
  // Words are never split across lines with a hyphen
  Font.registerHyphenationCallback((word) => [word]);
  registered = true;
}
