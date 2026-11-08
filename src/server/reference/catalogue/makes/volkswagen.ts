import { PUBLISHED, v } from "../build";
import type { MakeSource } from "../types";

export const volkswagen: MakeSource = {
  make: "Volkswagen",
  generations: [
    {
      model: "Golf",
      bodyStyle: "hatchback",
      curve: "standard",
      years: [2012, 2012],
      groupSource: PUBLISHED("Golf Mk6 (2008–2012)"),
      variants: [
        v("1.4 S 5dr", "petrol", "manual", 5, 1390, 80, 7, 16_500),
        v("1.6 TDI Match 5dr", "diesel", "manual", 5, 1598, 105, 14, 20_000),
        v("GTI 3dr", "petrol", "manual", 3, 1984, 207, 35, 25_500),
      ],
    },
    {
      model: "Golf",
      bodyStyle: "hatchback",
      curve: "standard",
      years: [2013, 2019],
      groupSource: PUBLISHED("Golf Mk7 (2013–2019)"),
      variants: [
        v("1.2 TSI S 5dr", "petrol", "manual", 5, 1197, 85, 10, 17_500),
        v("1.4 TSI Match 5dr", "petrol", "manual", 5, 1395, 125, 16, 21_000),
        v("2.0 TDI GT 5dr", "diesel", "manual", 5, 1968, 150, 21, 25_500),
        v("GTI 5dr", "petrol", "manual", 5, 1984, 230, 30, 29_000),
        v("Golf R 4Motion DSG 5dr", "petrol", "automatic", 5, 1984, 300, 37, 34_000, [2014, 2019]),
      ],
    },
    {
      model: "Golf",
      bodyStyle: "hatchback",
      curve: "standard",
      years: [2020, 2026],
      groupSource: PUBLISHED("Golf Mk8 (2020–)"),
      variants: [
        v("1.0 TSI Life 5dr", "petrol", "manual", 5, 999, 110, 14, 24_000),
        v("1.5 eTSI Style DSG 5dr", "hybrid", "automatic", 5, 1498, 150, 19, 29_500),
        v("2.0 TDI R-Line 5dr", "diesel", "manual", 5, 1968, 150, 21, 31_000),
        v("GTI 5dr", "petrol", "manual", 5, 1984, 245, 33, 37_000),
        v("Golf R 4Motion DSG 5dr", "petrol", "automatic", 5, 1984, 320, 40, 45_000, [2021, 2026]),
      ],
    },
    {
      model: "Polo",
      bodyStyle: "hatchback",
      curve: "standard",
      years: [2012, 2017],
      groupSource: PUBLISHED("Polo Mk5 (2009–2017)"),
      variants: [
        v("1.2 S 5dr", "petrol", "manual", 5, 1198, 60, 3, 11_500),
        v("1.2 TSI SE 5dr", "petrol", "manual", 5, 1197, 90, 9, 14_000),
        v("1.4 TDI SE 5dr", "diesel", "manual", 5, 1422, 75, 8, 15_500, [2014, 2017]),
      ],
    },
    {
      model: "Polo",
      bodyStyle: "hatchback",
      curve: "standard",
      years: [2018, 2026],
      groupSource: PUBLISHED("Polo Mk6 (2017–)"),
      variants: [
        v("1.0 SE 5dr", "petrol", "manual", 5, 999, 80, 4, 16_500),
        v("1.0 TSI 95 Match 5dr", "petrol", "manual", 5, 999, 95, 11, 18_500),
        v("1.0 TSI R-Line DSG 5dr", "petrol", "automatic", 5, 999, 110, 15, 22_500),
        v("GTI DSG 5dr", "petrol", "automatic", 5, 1984, 207, 30, 27_000, [2019, 2026]),
      ],
    },
    {
      model: "T-Roc",
      bodyStyle: "suv",
      curve: "standard",
      years: [2018, 2026],
      groupSource: PUBLISHED("T-Roc (2017–)"),
      variants: [
        v("1.0 TSI SE", "petrol", "manual", 5, 999, 115, 13, 22_000),
        v("1.5 TSI Design", "petrol", "manual", 5, 1498, 150, 18, 25_500),
        v("2.0 TDI SEL", "diesel", "manual", 5, 1968, 150, 20, 29_000),
        v("R 4Motion DSG", "petrol", "automatic", 5, 1984, 300, 37, 42_000, [2020, 2026]),
      ],
    },
    {
      model: "Tiguan",
      bodyStyle: "suv",
      curve: "standard",
      years: [2012, 2015],
      groupSource: PUBLISHED("Tiguan Mk1 (2007–2016)"),
      variants: [
        v("1.4 TSI Match", "petrol", "manual", 5, 1390, 160, 18, 24_000),
        v("2.0 TDI SE", "diesel", "manual", 5, 1968, 140, 20, 25_000),
      ],
    },
    {
      model: "Tiguan",
      bodyStyle: "suv",
      curve: "standard",
      years: [2016, 2023],
      groupSource: PUBLISHED("Tiguan Mk2 (2016–2023)"),
      variants: [
        v("1.4 TSI SE", "petrol", "manual", 5, 1395, 125, 15, 25_000),
        v("2.0 TDI SE Nav", "diesel", "manual", 5, 1968, 150, 20, 29_000),
        v("2.0 TDI R-Line 4Motion DSG", "diesel", "automatic", 5, 1968, 190, 24, 36_000),
      ],
    },
    {
      model: "Tiguan",
      bodyStyle: "suv",
      curve: "standard",
      years: [2024, 2026],
      groupSource: PUBLISHED("Tiguan Mk3 (2024–)"),
      variants: [
        v("1.5 eTSI Life DSG", "hybrid", "automatic", 5, 1498, 150, 20, 34_000),
        v("1.5 eHybrid Elegance DSG", "hybrid", "automatic", 5, 1498, 204, 25, 45_000),
      ],
    },
    {
      model: "ID.3",
      bodyStyle: "hatchback",
      curve: "electric",
      years: [2020, 2026],
      groupSource: PUBLISHED("ID.3 (2020–)"),
      variants: [
        v("Pro Life 58kWh", "electric", "automatic", 5, null, 204, 25, 37_000),
        v("Pro S 77kWh", "electric", "automatic", 5, null, 204, 27, 43_000),
        v("GTX 79kWh", "electric", "automatic", 5, null, 326, 33, 47_000, [2024, 2026]),
      ],
    },
  ],
};
