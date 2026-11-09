import { PUBLISHED, v } from "../build";
import type { MakeSource } from "../types";

// MG, Skoda, Renault, Dacia, Tesla and Land Rover.

export const mg: MakeSource = {
  make: "MG",
  generations: [
    {
      model: "HS",
      bodyStyle: "suv",
      curve: "standard",
      years: [2019, 2026],
      groupSource: PUBLISHED("MG HS (2019–)"),
      variants: [
        v("1.5 T-GDI Excite", "petrol", "manual", 5, 1490, 162, 17, 22_000),
        v("1.5 T-GDI Exclusive DCT", "petrol", "automatic", 5, 1490, 162, 19, 26_500),
        v("1.5 PHEV Trophy auto", "hybrid", "automatic", 5, 1490, 258, 24, 33_500, [2021, 2026]),
      ],
    },
    {
      model: "ZS",
      bodyStyle: "suv",
      curve: "standard",
      years: [2017, 2026],
      groupSource: PUBLISHED("MG ZS (2017–)"),
      variants: [
        v("1.5 VTi-TECH Excite", "petrol", "manual", 5, 1498, 106, 10, 15_000),
        v("1.0 T-GDI Exclusive auto", "petrol", "automatic", 5, 999, 111, 13, 19_500, [2018, 2023]),
        v("1.5 Hybrid+ SE auto", "hybrid", "automatic", 5, 1498, 194, 22, 24_000, [2025, 2026]),
      ],
    },
    {
      model: "ZS",
      bodyStyle: "suv",
      curve: "electric",
      years: [2020, 2026],
      groupSource: PUBLISHED("MG ZS EV (2019–)"),
      variants: [v("EV SE Long Range", "electric", "automatic", 5, null, 156, 21, 30_000)],
    },
    {
      model: "MG4",
      bodyStyle: "hatchback",
      curve: "electric",
      years: [2022, 2026],
      groupSource: PUBLISHED("MG4 EV (2022–)"),
      variants: [
        v("SE 51kWh", "electric", "automatic", 5, null, 170, 27, 26_000),
        v("Trophy Long Range 77kWh", "electric", "automatic", 5, null, 245, 31, 33_000),
        v("XPOWER", "electric", "automatic", 5, null, 435, 40, 37_000, [2023, 2026]),
      ],
    },
  ],
};

export const skoda: MakeSource = {
  make: "Skoda",
  generations: [
    {
      model: "Octavia",
      bodyStyle: "hatchback",
      curve: "standard",
      years: [2012, 2012],
      groupSource: PUBLISHED("Octavia Mk2 (2004–2013)"),
      variants: [v("1.6 TDI S", "diesel", "manual", 5, 1598, 105, 13, 17_500)],
    },
    {
      model: "Octavia",
      bodyStyle: "hatchback",
      curve: "standard",
      years: [2013, 2019],
      groupSource: PUBLISHED("Octavia Mk3 (2013–2020)"),
      variants: [
        v("1.6 TDI SE", "diesel", "manual", 5, 1598, 110, 13, 20_500),
        v("1.0 TSI SE", "petrol", "manual", 5, 999, 115, 12, 19_000, [2016, 2019]),
        v("2.0 TDI SE L", "diesel", "manual", 5, 1968, 150, 18, 24_500),
        v("vRS 2.0 TSI", "petrol", "manual", 5, 1984, 230, 30, 27_500),
      ],
    },
    {
      model: "Octavia",
      bodyStyle: "hatchback",
      curve: "standard",
      years: [2020, 2026],
      groupSource: PUBLISHED("Octavia Mk4 (2020–)"),
      variants: [
        v("1.0 TSI SE Technology", "petrol", "manual", 5, 999, 110, 15, 23_500),
        v("1.5 TSI SE L", "petrol", "manual", 5, 1498, 150, 19, 27_500),
        v("2.0 TDI SE L DSG", "diesel", "automatic", 5, 1968, 150, 21, 31_000),
        v("vRS 2.0 TSI DSG", "petrol", "automatic", 5, 1984, 245, 30, 36_000),
      ],
    },
  ],
};

export const renault: MakeSource = {
  make: "Renault",
  generations: [
    {
      model: "Clio",
      bodyStyle: "hatchback",
      curve: "standard",
      years: [2012, 2012],
      groupSource: PUBLISHED("Clio III (2005–2012)"),
      variants: [v("1.2 Expression 5dr", "petrol", "manual", 5, 1149, 75, 4, 10_500)],
    },
    {
      model: "Clio",
      bodyStyle: "hatchback",
      curve: "standard",
      years: [2013, 2019],
      groupSource: PUBLISHED("Clio IV (2013–2019)"),
      variants: [
        v("1.2 16V Expression+ 5dr", "petrol", "manual", 5, 1149, 75, 4, 11_500),
        v("0.9 TCe Dynamique MediaNav 5dr", "petrol", "manual", 5, 898, 90, 8, 14_000),
        v("1.5 dCi Dynamique 5dr", "diesel", "manual", 5, 1461, 90, 7, 15_500),
      ],
    },
    {
      model: "Clio",
      bodyStyle: "hatchback",
      curve: "standard",
      years: [2020, 2026],
      groupSource: PUBLISHED("Clio V (2019–)"),
      variants: [
        v("1.0 TCe 90 Iconic 5dr", "petrol", "manual", 5, 999, 90, 10, 17_500),
        v("1.0 TCe 90 Techno 5dr", "petrol", "manual", 5, 999, 90, 11, 19_000, [2022, 2026]),
        v(
          "1.6 E-Tech Hybrid Esprit Alpine auto 5dr",
          "hybrid",
          "automatic",
          5,
          1598,
          145,
          17,
          24_000,
          [2021, 2026],
        ),
      ],
    },
  ],
};

export const dacia: MakeSource = {
  make: "Dacia",
  generations: [
    {
      model: "Sandero",
      bodyStyle: "hatchback",
      curve: "standard",
      years: [2013, 2020],
      groupSource: PUBLISHED("Sandero Mk2 (2013–2020)"),
      variants: [
        v("1.2 Access 5dr", "petrol", "manual", 5, 1149, 75, 2, 6_000),
        v("0.9 TCe Laureate 5dr", "petrol", "manual", 5, 898, 90, 9, 9_500),
        v("Stepway 0.9 TCe Laureate 5dr", "petrol", "manual", 5, 898, 90, 10, 10_500),
      ],
    },
    {
      model: "Sandero",
      bodyStyle: "hatchback",
      curve: "standard",
      years: [2021, 2026],
      groupSource: PUBLISHED("Sandero Mk3 (2021–)"),
      variants: [
        v("1.0 SCe Essential 5dr", "petrol", "manual", 5, 999, 67, 2, 12_000),
        v("1.0 TCe Expression 5dr", "petrol", "manual", 5, 999, 90, 8, 14_000),
        v("Stepway 1.0 TCe Expression 5dr", "petrol", "manual", 5, 999, 90, 9, 15_500),
      ],
    },
  ],
};

export const tesla: MakeSource = {
  make: "Tesla",
  generations: [
    {
      model: "Model 3",
      bodyStyle: "saloon",
      curve: "electric",
      years: [2019, 2023],
      groupSource: PUBLISHED("Model 3 (2019–2023)"),
      variants: [
        v("Standard Range Plus", "electric", "automatic", 4, null, 283, 44, 40_000),
        v("Long Range AWD", "electric", "automatic", 4, null, 440, 48, 47_000),
        v("Performance", "electric", "automatic", 4, null, 480, 50, 57_000),
      ],
    },
    {
      model: "Model 3",
      bodyStyle: "saloon",
      curve: "electric",
      years: [2024, 2026],
      groupSource: PUBLISHED(
        "Model 3 Highland (2024–)",
        "RWD 32, Long Range RWD 38 after Thatcham's 2025 reassessment",
      ),
      variants: [
        v("RWD", "electric", "automatic", 4, null, 283, 32, 40_000),
        v("Long Range RWD", "electric", "automatic", 4, null, 366, 38, 46_000, [2025, 2026]),
        v("Performance", "electric", "automatic", 4, null, 510, 50, 60_000),
      ],
    },
    {
      model: "Model Y",
      bodyStyle: "suv",
      curve: "electric",
      years: [2022, 2026],
      groupSource: PUBLISHED(
        "Model Y (2022–)",
        "Long Range RWD 39 after Thatcham's 2025 reassessment (Zego, Carparison)",
      ),
      variants: [
        v("RWD", "electric", "automatic", 5, null, 295, 36, 45_000),
        v("Long Range AWD", "electric", "automatic", 5, null, 514, 45, 54_000, [2022, 2024]),
        v("Long Range RWD", "electric", "automatic", 5, null, 362, 39, 50_000, [2025, 2026]),
        v("Performance", "electric", "automatic", 5, null, 534, 50, 60_000),
      ],
    },
  ],
};

export const landRover: MakeSource = {
  make: "Land Rover",
  generations: [
    {
      model: "Range Rover Sport",
      bodyStyle: "suv",
      curve: "prestige",
      years: [2013, 2022],
      groupSource: PUBLISHED("Range Rover Sport L494 (2013–2022)"),
      variants: [
        v("3.0 SDV6 HSE auto", "diesel", "automatic", 5, 2993, 306, 44, 65_000),
        v(
          "5.0 V8 Supercharged Autobiography Dynamic auto",
          "petrol",
          "automatic",
          5,
          5000,
          518,
          50,
          95_000,
          [2014, 2019],
        ),
        v("3.0 P400 HST auto", "hybrid", "automatic", 5, 2996, 400, 48, 80_000, [2020, 2022]),
      ],
    },
    {
      model: "Range Rover Sport",
      bodyStyle: "suv",
      curve: "prestige",
      years: [2023, 2026],
      groupSource: PUBLISHED("Range Rover Sport L461 (2022–)"),
      variants: [
        v("3.0 D300 Dynamic SE auto", "diesel", "automatic", 5, 2997, 300, 46, 85_000),
        v("3.0 P440e Autobiography auto", "hybrid", "automatic", 5, 2996, 440, 49, 105_000),
      ],
    },
  ],
};
