import { describe, expect, it } from "vite-plus/test";

import { postcodeError } from "./postcode";
import {
  checkStart,
  comingSoonRedirect,
  comingSoonSearch,
  journeySearch,
  startSearch,
  typeError,
} from "./search";

describe("startSearch", () => {
  it("normalises a postcode from the link and keeps a known type", () => {
    expect(startSearch({ postcode: "e83rl" })).toEqual({ postcode: "E8 3RL" });
    expect(startSearch({ type: "landlord" })).toEqual({ type: "landlord" });
  });

  it("drops a bad value quietly, whatever the parser made of it", () => {
    expect(startSearch({ postcode: "E8" })).toEqual({});
    expect(startSearch({ postcode: 123 })).toEqual({});
    expect(startSearch({ postcode: ["E8 3RL", "N1 9GU"] })).toEqual({});
    expect(startSearch({ postcode: { a: 1 } })).toEqual({});
    expect(startSearch({ type: "van" })).toEqual({});
    expect(startSearch({ type: 1 })).toEqual({});
  });

  it("keeps what was typed after a no-JS submit, so it can be fixed", () => {
    expect(startSearch({ type: "home", postcode: "nope", next: 1 })).toEqual({
      type: "home",
      postcode: "nope",
      next: 1,
    });
    expect(startSearch({ postcode: "e83rl", next: "1" })).toEqual({ postcode: "e83rl", next: 1 });
    expect(startSearch({ postcode: 123, next: 1 })).toEqual({ postcode: "123", next: 1 });
  });

  it("returns a dropped key as undefined, so the router can't merge the raw value back", () => {
    const search = startSearch({ postcode: "nope", type: "van", next: 2 });
    expect(Object.entries(search)).toEqual([
      ["type", undefined],
      ["postcode", undefined],
      ["next", undefined],
    ]);
    expect(Object.keys(journeySearch({ postcode: "nope" }))).toEqual(["postcode"]);
    expect(Object.keys(comingSoonSearch({}))).toEqual(["type", "postcode"]);
  });

  it("drops any other next", () => {
    expect(startSearch({ next: 2 })).toEqual({});
    expect(startSearch({ next: "yes" })).toEqual({});
  });
});

describe("journeySearch and comingSoonSearch", () => {
  it("keep a valid postcode, normalised, and drop a bad one", () => {
    expect(journeySearch({ postcode: "e8 3rl" })).toEqual({ postcode: "E8 3RL" });
    expect(journeySearch({ postcode: "E8", type: "car" })).toEqual({});
    expect(comingSoonSearch({ type: "pet", postcode: "e83rl" })).toEqual({
      type: "pet",
      postcode: "E8 3RL",
    });
    expect(comingSoonSearch({ type: "van", postcode: 7 })).toEqual({});
  });
});

describe("checkStart", () => {
  it("sends car and home to their journey with the tidy postcode", () => {
    expect(checkStart({ type: "car", postcode: "e8 3rl" })).toEqual({
      ok: true,
      to: "/quote/car",
      search: { postcode: "E8 3RL" },
    });
    expect(checkStart({ type: "home", postcode: "N19GU" })).toEqual({
      ok: true,
      to: "/quote/home",
      search: { postcode: "N1 9GU" },
    });
  });

  it("sends a coming-soon type on, with or without a postcode", () => {
    expect(checkStart({ type: "pet" })).toEqual({
      ok: true,
      to: "/quote/coming-soon",
      search: { type: "pet" },
    });
    expect(checkStart({ type: "pet", postcode: "  " })).toEqual({
      ok: true,
      to: "/quote/coming-soon",
      search: { type: "pet" },
    });
    expect(checkStart({ type: "pet", postcode: "E83RL" })).toEqual({
      ok: true,
      to: "/quote/coming-soon",
      search: { type: "pet", postcode: "E8 3RL" },
    });
  });

  it("refuses a bad postcode even for a coming-soon type", () => {
    expect(checkStart({ type: "pet", postcode: "bad" })).toEqual({
      ok: false,
      errors: { postcode: postcodeError },
    });
  });

  it("needs a full postcode for car and home", () => {
    expect(checkStart({ type: "car" })).toEqual({ ok: false, errors: { postcode: postcodeError } });
    expect(checkStart({ type: "home", postcode: "E8" })).toEqual({
      ok: false,
      errors: { postcode: postcodeError },
    });
  });

  it("asks for a type, and only checks a postcode that was given", () => {
    expect(checkStart({})).toEqual({ ok: false, errors: { type: typeError } });
    expect(checkStart({ postcode: "E8 3RL" })).toEqual({ ok: false, errors: { type: typeError } });
    expect(checkStart({ postcode: "E8" })).toEqual({
      ok: false,
      errors: { type: typeError, postcode: postcodeError },
    });
  });
});

describe("comingSoonRedirect", () => {
  it("sends a type that isn't coming soon back to the start, keeping the search", () => {
    expect(comingSoonRedirect({ type: "car", postcode: "E8 3RL" })).toEqual({
      type: "car",
      postcode: "E8 3RL",
    });
    expect(comingSoonRedirect({})).toEqual({});
    expect(comingSoonRedirect({ postcode: "E8 3RL" })).toEqual({ postcode: "E8 3RL" });
  });

  it("lets a coming-soon type through", () => {
    expect(comingSoonRedirect({ type: "landlord" })).toBeNull();
  });
});

it("has the type error's copy", () => {
  expect(typeError).toBe("Choose what you'd like to insure.");
});
