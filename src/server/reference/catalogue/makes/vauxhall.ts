import { PUBLISHED, v } from "../build";
import type { MakeSource } from "../types";

export const vauxhall: MakeSource = {
  make: "Vauxhall",
  generations: [
    {
      model: "Corsa",
      bodyStyle: "hatchback",
      curve: "standard",
      years: [2012, 2014],
      groupSource: PUBLISHED("Corsa D (2006–2014)"),
      variants: [
        v("1.2 S 3dr", "petrol", "manual", 3, 1229, 70, 3, 10_500),
        v("1.4 SE 5dr", "petrol", "manual", 5, 1398, 100, 7, 13_500),
        v("1.3 CDTi Exclusiv 5dr", "diesel", "manual", 5, 1248, 75, 5, 13_000),
      ],
    },
    {
      model: "Corsa",
      bodyStyle: "hatchback",
      curve: "standard",
      years: [2015, 2019],
      groupSource: PUBLISHED("Corsa E (2014–2019)"),
      variants: [
        v("1.2 Sting 3dr", "petrol", "manual", 3, 1229, 70, 2, 10_500),
        v("1.4 SRi 5dr", "petrol", "manual", 5, 1398, 90, 6, 14_000),
        v("1.0T ecoFLEX SE 5dr", "petrol", "manual", 5, 999, 115, 10, 15_500),
        v("VXR 3dr", "petrol", "manual", 3, 1598, 205, 29, 19_000),
      ],
    },
    {
      model: "Corsa",
      bodyStyle: "hatchback",
      curve: "standard",
      years: [2020, 2026],
      groupSource: PUBLISHED("Corsa F (2019–)"),
      variants: [
        v("1.2 SE 5dr", "petrol", "manual", 5, 1199, 75, 7, 16_500),
        v("1.2 Turbo SRi 5dr", "petrol", "manual", 5, 1199, 100, 13, 19_500),
        v("1.2 Turbo Elite auto 5dr", "petrol", "automatic", 5, 1199, 130, 18, 23_000),
        v("Electric GS 5dr", "electric", "automatic", 5, null, 136, 22, 32_000),
      ],
    },
    {
      model: "Astra",
      bodyStyle: "hatchback",
      curve: "standard",
      years: [2012, 2015],
      groupSource: PUBLISHED("Astra J (2009–2015)"),
      variants: [
        v("1.4 Exclusiv 5dr", "petrol", "manual", 5, 1398, 100, 8, 16_000),
        v("1.6 SRi 5dr", "petrol", "manual", 5, 1598, 115, 14, 18_500),
        v("1.7 CDTi SRi 5dr", "diesel", "manual", 5, 1686, 110, 13, 19_500),
      ],
    },
    {
      model: "Astra",
      bodyStyle: "hatchback",
      curve: "standard",
      years: [2016, 2021],
      groupSource: PUBLISHED("Astra K (2015–2021)"),
      variants: [
        v("1.0T Tech Line 5dr", "petrol", "manual", 5, 999, 105, 10, 17_500, [2016, 2019]),
        v("1.4T SRi 5dr", "petrol", "manual", 5, 1399, 125, 13, 19_000, [2016, 2019]),
        v("1.6 CDTi Elite 5dr", "diesel", "manual", 5, 1598, 136, 17, 23_000, [2016, 2019]),
        v("1.2 Turbo SRi Nav 5dr", "petrol", "manual", 5, 1199, 130, 15, 21_000, [2020, 2021]),
      ],
    },
    {
      model: "Astra",
      bodyStyle: "hatchback",
      curve: "standard",
      years: [2022, 2026],
      groupSource: PUBLISHED("Astra L (2022–)"),
      variants: [
        v("1.2 Turbo Design 5dr", "petrol", "manual", 5, 1199, 110, 15, 23_500),
        v("1.2 Turbo GS 5dr", "petrol", "manual", 5, 1199, 130, 18, 27_000),
        v("1.6 Hybrid GS auto 5dr", "hybrid", "automatic", 5, 1598, 180, 24, 35_000),
        v("Electric GS 5dr", "electric", "automatic", 5, null, 156, 26, 38_000, [2024, 2026]),
      ],
    },
    {
      model: "Mokka",
      bodyStyle: "suv",
      curve: "standard",
      years: [2021, 2026],
      groupSource: PUBLISHED("Mokka (2021–)"),
      variants: [
        v("1.2 Turbo Design", "petrol", "manual", 5, 1199, 100, 15, 22_000),
        v("1.2 Turbo GS", "petrol", "manual", 5, 1199, 130, 18, 25_500),
        v("Electric Griffin", "electric", "automatic", 5, null, 136, 22, 33_000),
      ],
    },
  ],
};
