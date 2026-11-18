import { describe, expect, it } from "vite-plus/test";

import { aboutIntro, licenceIntro, namedIntro } from "./intros";
import { golf } from "./journey-fixtures";

// Copy that names the visitor drops a clause it can't fill, never shows a blank (5.4b, call 13)

const alex = { firstName: "Alex", lastName: "Morgan" };

describe("the step intros", () => {
  it("names the car on About you, or leaves it out", () => {
    expect(aboutIntro(golf)).toBe(
      "We’ll use this information to build your quote for the 2021 Volkswagen Golf.",
    );
    expect(aboutIntro(undefined)).toBe("We’ll use this information to build your quote.");
  });

  it("names the driver and the car on Licence and driving, dropping what's missing", () => {
    expect(licenceIntro(alex, golf)).toBe(
      "A few more details about Alex Morgan and how the Volkswagen Golf is used.",
    );
    expect(licenceIntro(undefined, golf)).toBe(
      "A few more details about how the Volkswagen Golf is used.",
    );
    expect(licenceIntro(alex, undefined)).toBe(
      "A few more details about Alex Morgan and how the car is used.",
    );
  });

  it("names the car on Named drivers, or says 'your car'", () => {
    expect(namedIntro(golf)).toBe(
      "Add anyone else who needs to drive the Volkswagen Golf. You’ll remain the main driver.",
    );
    expect(namedIntro(undefined)).toBe(
      "Add anyone else who needs to drive your car. You’ll remain the main driver.",
    );
  });
});
