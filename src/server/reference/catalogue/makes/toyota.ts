import { PUBLISHED, v } from "../build";
import type { MakeSource } from "../types";

export const toyota: MakeSource = {
  make: "Toyota",
  generations: [
    {
      model: "Yaris",
      bodyStyle: "hatchback",
      curve: "standard",
      years: [2012, 2019],
      groupSource: PUBLISHED("Yaris Mk3 (2011–2020)", "1.33 Icon group 10 (Parkers)"),
      variants: [
        v("1.0 VVT-i Active 5dr", "petrol", "manual", 5, 998, 69, 3, 11_500),
        v("1.33 VVT-i Icon 5dr", "petrol", "manual", 5, 1329, 99, 10, 14_500),
        v("1.5 Hybrid Icon CVT 5dr", "hybrid", "automatic", 5, 1497, 100, 8, 17_500),
      ],
    },
    {
      model: "Yaris",
      bodyStyle: "hatchback",
      curve: "standard",
      years: [2020, 2026],
      groupSource: PUBLISHED("Yaris Mk4 (2020–)"),
      variants: [
        v("1.5 Hybrid Icon CVT 5dr", "hybrid", "automatic", 5, 1490, 116, 14, 21_500),
        v("1.5 Hybrid Design CVT 5dr", "hybrid", "automatic", 5, 1490, 116, 15, 22_500),
        v("1.5 Hybrid Excel CVT 5dr", "hybrid", "automatic", 5, 1490, 116, 16, 24_500),
      ],
    },
    {
      model: "Corolla",
      bodyStyle: "hatchback",
      curve: "standard",
      years: [2019, 2026],
      groupSource: PUBLISHED("Corolla (2019–)"),
      variants: [
        v("1.8 Hybrid Icon CVT 5dr", "hybrid", "automatic", 5, 1798, 122, 15, 25_000),
        v("1.8 Hybrid Excel CVT 5dr", "hybrid", "automatic", 5, 1798, 140, 17, 29_500),
        v("2.0 Hybrid Design CVT 5dr", "hybrid", "automatic", 5, 1987, 180, 21, 29_000),
      ],
    },
    {
      model: "C-HR",
      bodyStyle: "suv",
      curve: "standard",
      years: [2017, 2023],
      groupSource: PUBLISHED("C-HR Mk1 (2016–2023)"),
      variants: [
        v("1.2T Icon", "petrol", "manual", 5, 1197, 116, 14, 22_000, [2017, 2019]),
        v("1.8 Hybrid Icon CVT", "hybrid", "automatic", 5, 1798, 122, 16, 25_500),
        v("2.0 Hybrid Excel CVT", "hybrid", "automatic", 5, 1987, 184, 21, 32_000, [2020, 2023]),
      ],
    },
    {
      model: "C-HR",
      bodyStyle: "suv",
      curve: "standard",
      years: [2024, 2026],
      groupSource: PUBLISHED("C-HR Mk2 (2024–)"),
      variants: [
        v("1.8 Hybrid Icon CVT", "hybrid", "automatic", 5, 1798, 140, 18, 32_000),
        v("2.0 Hybrid GR Sport CVT", "hybrid", "automatic", 5, 1987, 197, 23, 38_000),
      ],
    },
  ],
};
