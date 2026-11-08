import { PUBLISHED, v } from "../build";
import type { MakeSource } from "../types";

export const nissan: MakeSource = {
  make: "Nissan",
  generations: [
    {
      model: "Qashqai",
      bodyStyle: "suv",
      curve: "standard",
      years: [2012, 2013],
      groupSource: PUBLISHED("Qashqai J10 (2007–2013)"),
      variants: [
        v("1.6 Acenta", "petrol", "manual", 5, 1598, 115, 13, 18_000),
        v("1.5 dCi N-Tec", "diesel", "manual", 5, 1461, 110, 14, 20_500),
      ],
    },
    {
      model: "Qashqai",
      bodyStyle: "suv",
      curve: "standard",
      years: [2014, 2020],
      groupSource: PUBLISHED("Qashqai J11 (2014–2021)"),
      variants: [
        v("1.2 DIG-T Acenta", "petrol", "manual", 5, 1197, 115, 13, 19_500, [2014, 2018]),
        v("1.5 dCi N-Connecta", "diesel", "manual", 5, 1461, 110, 14, 23_000),
        v("1.6 dCi Tekna Xtronic", "diesel", "automatic", 5, 1598, 130, 19, 28_500),
        v("1.3 DIG-T N-Connecta", "petrol", "manual", 5, 1332, 140, 16, 24_500, [2019, 2020]),
      ],
    },
    {
      model: "Qashqai",
      bodyStyle: "suv",
      curve: "standard",
      years: [2021, 2026],
      groupSource: PUBLISHED("Qashqai J12 (2021–)"),
      variants: [
        v("1.3 DiG-T MHEV Acenta Premium", "hybrid", "manual", 5, 1332, 140, 16, 27_500),
        v("1.3 DiG-T MHEV 158 N-Connecta", "hybrid", "manual", 5, 1332, 158, 18, 30_000),
        v("e-Power Tekna", "hybrid", "automatic", 5, 1497, 190, 22, 37_000, [2022, 2026]),
      ],
    },
    {
      model: "Juke",
      bodyStyle: "suv",
      curve: "standard",
      years: [2012, 2019],
      groupSource: PUBLISHED("Juke F15 (2010–2019)"),
      variants: [
        v("1.6 Visia", "petrol", "manual", 5, 1598, 94, 8, 14_000),
        v("1.5 dCi Acenta", "diesel", "manual", 5, 1461, 110, 12, 17_500),
        v("1.2 DIG-T N-Connecta", "petrol", "manual", 5, 1197, 115, 14, 18_500, [2015, 2019]),
      ],
    },
    {
      model: "Juke",
      bodyStyle: "suv",
      curve: "standard",
      years: [2020, 2026],
      groupSource: PUBLISHED("Juke F16 (2019–)"),
      variants: [
        v("1.0 DIG-T Acenta", "petrol", "manual", 5, 999, 114, 12, 20_000),
        v("1.0 DIG-T N-Connecta", "petrol", "manual", 5, 999, 114, 13, 22_000),
        v("1.6 Hybrid Tekna", "hybrid", "automatic", 5, 1598, 143, 17, 28_000, [2022, 2026]),
      ],
    },
    {
      model: "Micra",
      bodyStyle: "hatchback",
      curve: "standard",
      years: [2012, 2016],
      groupSource: PUBLISHED("Micra K13 (2010–2017)"),
      variants: [
        v("1.2 Visia 5dr", "petrol", "manual", 5, 1198, 80, 3, 10_500),
        v("1.2 Acenta 5dr", "petrol", "manual", 5, 1198, 80, 4, 11_500),
      ],
    },
    {
      model: "Micra",
      bodyStyle: "hatchback",
      curve: "standard",
      years: [2017, 2023],
      groupSource: PUBLISHED("Micra K14 (2017–2023)"),
      variants: [
        v("1.0 Visia+ 5dr", "petrol", "manual", 5, 998, 71, 3, 13_000, [2017, 2019]),
        v("0.9 IG-T Acenta 5dr", "petrol", "manual", 5, 898, 90, 8, 15_000, [2017, 2019]),
        v("1.0 IG-T Acenta 5dr", "petrol", "manual", 5, 999, 100, 9, 16_500, [2019, 2023]),
        v("1.0 IG-T N-Sport 5dr", "petrol", "manual", 5, 999, 100, 11, 18_500, [2019, 2023]),
      ],
    },
    {
      model: "Leaf",
      bodyStyle: "hatchback",
      curve: "electric",
      years: [2012, 2017],
      groupSource: PUBLISHED("Leaf Mk1 (2011–2017)"),
      variants: [
        v("Acenta 24kWh", "electric", "automatic", 5, null, 109, 21, 26_000),
        v("Tekna 30kWh", "electric", "automatic", 5, null, 109, 22, 30_000, [2016, 2017]),
      ],
    },
    {
      model: "Leaf",
      bodyStyle: "hatchback",
      curve: "electric",
      years: [2018, 2024],
      groupSource: PUBLISHED("Leaf Mk2 (2018–2024)"),
      variants: [
        v("Acenta 40kWh", "electric", "automatic", 5, null, 150, 21, 28_000),
        v("N-Connecta 40kWh", "electric", "automatic", 5, null, 150, 22, 30_000),
        v("e+ Tekna 62kWh", "electric", "automatic", 5, null, 217, 25, 36_000, [2019, 2024]),
      ],
    },
  ],
};
