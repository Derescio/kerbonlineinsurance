import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vite-plus/test";

const stylesDir = join(import.meta.dirname, "..");

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return cssFiles(path);
    return entry.name.endsWith(".css") ? [path] : [];
  });
}

const files = cssFiles(stylesDir).map((path) => ({ path, css: readFileSync(path, "utf8") }));
const allCss = files.map((f) => f.css).join("\n");

describe("Kerb tokens", () => {
  it("defines every custom property that is used", () => {
    const defined = new Set([...allCss.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
    const used = new Set([...allCss.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]));
    const missing = [...used].filter((name) => !defined.has(name));
    expect(missing).toEqual([]);
  });

  it("never loads anything from another origin", () => {
    const offsite = files.filter(({ css }) => /https?:\/\/|url\(\s*["']?\/\//.test(css));
    expect(offsite.map((f) => f.path)).toEqual([]);
  });
});

describe("self-hosted fonts", () => {
  const fontsCss = readFileSync(join(import.meta.dirname, "fonts.css"), "utf8");
  // Only the faces that download a file; the metric fallbacks use local() fonts
  const webFaces = [...fontsCss.matchAll(/@font-face\s*{([^}]*)}/g)]
    .map((m) => m[1])
    .filter((body) => body.includes("url("));

  it("has a face for each family", () => {
    expect(webFaces.length).toBeGreaterThanOrEqual(3);
  });

  it("swaps and is subset on every face", () => {
    for (const face of webFaces) {
      expect(face).toMatch(/font-display:\s*swap/);
      expect(face).toMatch(/unicode-range:/);
      expect(face).toMatch(/\.woff2/);
    }
  });
});
