import { describe, expect, it } from "vite-plus/test";

import { POSTCODE_AREAS_V1, type PostcodeArea, UK_POSTCODE_AREAS } from "./postcode-areas";

const byArea = new Map<string, PostcodeArea>(POSTCODE_AREAS_V1.map((row) => [row.area, row]));
const area = (code: string) => byArea.get(code)!;
const meanCar = (region: string) => {
  const rows = POSTCODE_AREAS_V1.filter((row) => row.region === region);
  return rows.reduce((sum, row) => sum + row.car, 0) / rows.length;
};

describe("POSTCODE_AREAS_V1", () => {
  it("lists exactly the 121 UK areas, once each", () => {
    expect(POSTCODE_AREAS_V1.map((row) => row.area)).toEqual([...UK_POSTCODE_AREAS]);
  });

  it("gives every area three bands from 1 to 10, a label and a reason", () => {
    for (const row of POSTCODE_AREAS_V1) {
      for (const band of [row.car, row.buildings, row.contents]) {
        expect(band, row.area).toBeGreaterThanOrEqual(1);
        expect(band, row.area).toBeLessThanOrEqual(10);
      }
      expect(row.label, row.area).not.toBe("");
      expect(row.reason, row.area).not.toBe("");
    }
  });

  // The spec's example people (call 22) are priced on these bands
  it("holds the anchors the example people use", () => {
    expect(area("LS")).toMatchObject({ car: 5, buildings: 4, contents: 6 });
    expect(area("E")).toMatchObject({ car: 9, buildings: 6, contents: 9 });
    expect(area("EX").car).toBe(2);
    expect(area("BS").car).toBe(5);
    expect(area("SY")).toMatchObject({ buildings: 7, contents: 2 });
    expect(area("DE").contents).toBe(4);
    expect(area("NG").contents).toBe(5);
    expect(area("G").contents).toBe(6);
  });

  it("runs the right way round", () => {
    for (const code of ["WC", "E", "N", "B"])
      expect(area(code).car, code).toBeGreaterThanOrEqual(8);
    for (const code of ["LD", "HS", "ZE"]) expect(area(code).car, code).toBeLessThanOrEqual(2);
    expect(meanCar("London")).toBeGreaterThan(meanCar("South West"));
  });
});
