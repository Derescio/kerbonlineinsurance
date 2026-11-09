import { PUBLISHED, v } from "../build";
import type { MakeSource } from "../types";

// BMW, Mercedes-Benz, Audi, MINI and Porsche. The performance trims are their own generations so
// they can take the prestige depreciation curve (call 7).

export const bmw: MakeSource = {
  make: "BMW",
  generations: [
    {
      model: "1 Series",
      bodyStyle: "hatchback",
      curve: "standard",
      years: [2012, 2019],
      groupSource: PUBLISHED("1 Series F20 (2011–2019)"),
      variants: [
        v("116i SE 5dr", "petrol", "manual", 5, 1598, 136, 17, 20_500, [2012, 2015]),
        v("118i SE 5dr", "petrol", "manual", 5, 1499, 136, 19, 22_500, [2016, 2019]),
        v("118d Sport 5dr", "diesel", "manual", 5, 1995, 143, 22, 24_000),
        v("120d M Sport 5dr", "diesel", "manual", 5, 1995, 190, 27, 28_500),
      ],
    },
    {
      model: "1 Series",
      bodyStyle: "hatchback",
      curve: "standard",
      years: [2020, 2024],
      groupSource: PUBLISHED("1 Series F40 (2019–2024)"),
      variants: [
        v("118i SE 5dr", "petrol", "manual", 5, 1499, 140, 19, 25_000),
        v("118d M Sport 5dr", "diesel", "manual", 5, 1995, 150, 23, 29_500),
        v("128ti auto 5dr", "petrol", "automatic", 5, 1998, 265, 33, 34_000, [2021, 2024]),
      ],
    },
    {
      model: "1 Series",
      bodyStyle: "hatchback",
      curve: "standard",
      years: [2025, 2026],
      groupSource: PUBLISHED("1 Series F70 (2024–)"),
      variants: [v("120 M Sport auto 5dr", "hybrid", "automatic", 5, 1499, 170, 25, 33_000)],
    },
    {
      model: "3 Series",
      bodyStyle: "saloon",
      curve: "standard",
      years: [2012, 2018],
      groupSource: PUBLISHED("3 Series F30 (2012–2019)"),
      variants: [
        v("320i SE", "petrol", "manual", 4, 1997, 184, 26, 28_000),
        v("320d SE", "diesel", "manual", 4, 1995, 184, 28, 30_000),
        v("330e M Sport auto", "hybrid", "automatic", 4, 1998, 252, 31, 37_000, [2016, 2018]),
      ],
    },
    {
      model: "3 Series",
      bodyStyle: "saloon",
      curve: "prestige",
      years: [2014, 2018],
      groupSource: PUBLISHED("M3 F80 (2014–2018)"),
      variants: [v("M3 Competition", "petrol", "manual", 4, 2979, 450, 50, 60_000, [2016, 2018])],
    },
    {
      model: "3 Series",
      bodyStyle: "saloon",
      curve: "standard",
      years: [2019, 2026],
      groupSource: PUBLISHED("3 Series G20 (2019–)"),
      variants: [
        v("318i Sport auto", "petrol", "automatic", 4, 1998, 156, 25, 34_000),
        v("320d M Sport auto", "diesel", "automatic", 4, 1995, 190, 29, 39_000),
        v("330e M Sport auto", "hybrid", "automatic", 4, 1998, 292, 33, 44_000),
      ],
    },
    {
      model: "3 Series",
      bodyStyle: "saloon",
      curve: "prestige",
      years: [2021, 2026],
      groupSource: PUBLISHED("M3 G80 (2021–)"),
      variants: [v("M3 Competition", "petrol", "automatic", 4, 2993, 510, 50, 77_000)],
    },
  ],
};

export const mercedes: MakeSource = {
  make: "Mercedes-Benz",
  generations: [
    {
      model: "A-Class",
      bodyStyle: "hatchback",
      curve: "standard",
      years: [2013, 2017],
      groupSource: PUBLISHED("A-Class W176 (2012–2018)"),
      variants: [
        v("A 180 SE 5dr", "petrol", "manual", 5, 1595, 122, 16, 21_000),
        v("A 200 CDI AMG Sport 5dr", "diesel", "manual", 5, 2143, 136, 22, 26_000),
      ],
    },
    {
      model: "A-Class",
      bodyStyle: "hatchback",
      curve: "standard",
      years: [2018, 2026],
      groupSource: PUBLISHED("A-Class W177 (2018–)"),
      variants: [
        v("A 180 Sport 5dr", "petrol", "manual", 5, 1332, 136, 21, 26_000),
        v("A 200 AMG Line auto 5dr", "petrol", "automatic", 5, 1332, 163, 25, 30_000),
        v(
          "A 250 e AMG Line auto 5dr",
          "hybrid",
          "automatic",
          5,
          1332,
          218,
          31,
          38_000,
          [2020, 2026],
        ),
      ],
    },
    {
      model: "A-Class",
      bodyStyle: "hatchback",
      curve: "prestige",
      years: [2020, 2026],
      groupSource: PUBLISHED(
        "Mercedes-AMG A 45 S (2019–)",
        "group estimated from the A 45 S listings",
      ),
      variants: [
        v("Mercedes-AMG A 45 S 4MATIC+ auto 5dr", "petrol", "automatic", 5, 1991, 421, 47, 60_000),
      ],
    },
  ],
};

export const audi: MakeSource = {
  make: "Audi",
  generations: [
    {
      model: "A3",
      bodyStyle: "hatchback",
      curve: "standard",
      years: [2013, 2020],
      groupSource: PUBLISHED("A3 Sportback 8V (2013–2020)"),
      variants: [
        v("1.4 TFSI Sport Sportback", "petrol", "manual", 5, 1395, 125, 19, 23_000, [2013, 2016]),
        v("1.0 TFSI SE Sportback", "petrol", "manual", 5, 999, 116, 14, 22_000, [2017, 2020]),
        v("2.0 TDI S line Sportback", "diesel", "manual", 5, 1968, 150, 24, 27_500),
      ],
    },
    {
      model: "A3",
      bodyStyle: "hatchback",
      curve: "prestige",
      years: [2015, 2020],
      groupSource: PUBLISHED("RS 3 Sportback 8V (2015–2020)"),
      variants: [
        v("RS 3 Sportback quattro S tronic", "petrol", "automatic", 5, 2480, 400, 44, 45_000),
      ],
    },
    {
      model: "A3",
      bodyStyle: "hatchback",
      curve: "standard",
      years: [2021, 2026],
      groupSource: PUBLISHED("A3 Sportback 8Y (2020–)"),
      variants: [
        v("30 TFSI Sport Sportback", "petrol", "manual", 5, 999, 110, 18, 27_000),
        v("35 TFSI S line S tronic Sportback", "petrol", "automatic", 5, 1498, 150, 24, 32_500),
        v("40 TFSI e S line S tronic Sportback", "hybrid", "automatic", 5, 1395, 204, 29, 38_000),
      ],
    },
    {
      model: "A3",
      bodyStyle: "hatchback",
      curve: "prestige",
      years: [2022, 2026],
      groupSource: PUBLISHED("RS 3 Sportback 8Y (2021–)"),
      variants: [
        v("RS 3 Sportback quattro S tronic", "petrol", "automatic", 5, 2480, 400, 46, 56_000),
      ],
    },
  ],
};

export const mini: MakeSource = {
  make: "MINI",
  generations: [
    {
      model: "Hatch",
      bodyStyle: "hatchback",
      curve: "standard",
      years: [2012, 2013],
      groupSource: PUBLISHED("MINI Hatch R56 (2006–2014)"),
      variants: [
        v("One 3dr", "petrol", "manual", 3, 1598, 98, 9, 13_500),
        v("Cooper 3dr", "petrol", "manual", 3, 1598, 122, 15, 15_500),
      ],
    },
    {
      model: "Hatch",
      bodyStyle: "hatchback",
      curve: "standard",
      years: [2014, 2023],
      groupSource: PUBLISHED("MINI Hatch F56 (2014–2024)"),
      variants: [
        v("One 3dr", "petrol", "manual", 3, 1198, 102, 9, 15_500),
        v("Cooper 3dr", "petrol", "manual", 3, 1499, 136, 15, 17_500),
        v("Cooper S 3dr", "petrol", "manual", 3, 1998, 192, 25, 21_000),
      ],
    },
    {
      model: "Hatch",
      bodyStyle: "hatchback",
      curve: "electric",
      years: [2020, 2023],
      groupSource: PUBLISHED("MINI Electric F56 (2020–2024)"),
      variants: [v("Electric Level 1 3dr", "electric", "automatic", 3, null, 184, 21, 27_500)],
    },
    {
      model: "Hatch",
      bodyStyle: "hatchback",
      curve: "standard",
      years: [2024, 2026],
      groupSource: PUBLISHED("MINI Cooper F66 (2024–)"),
      variants: [
        v("Cooper C Classic auto 3dr", "petrol", "automatic", 3, 1499, 156, 18, 23_000),
        v("Cooper S Exclusive auto 3dr", "petrol", "automatic", 3, 1998, 204, 26, 28_500),
      ],
    },
    {
      model: "Hatch",
      bodyStyle: "hatchback",
      curve: "electric",
      years: [2024, 2026],
      groupSource: PUBLISHED("MINI Cooper Electric J01 (2024–)"),
      variants: [v("Cooper E Classic 3dr", "electric", "automatic", 3, null, 184, 20, 30_000)],
    },
  ],
};

export const porsche: MakeSource = {
  make: "Porsche",
  generations: [
    {
      model: "911",
      bodyStyle: "coupe",
      curve: "prestige",
      years: [2012, 2018],
      groupSource: PUBLISHED("911 991 (2011–2019)"),
      variants: [
        v("Carrera", "petrol", "manual", 2, 3436, 350, 50, 72_000, [2012, 2015]),
        v("Carrera S", "petrol", "manual", 2, 3800, 400, 50, 82_000, [2012, 2015]),
        v("Carrera", "petrol", "manual", 2, 2981, 370, 50, 77_000, [2016, 2018]),
        v("Carrera S", "petrol", "manual", 2, 2981, 420, 50, 87_000, [2016, 2018]),
      ],
    },
    {
      model: "911",
      bodyStyle: "coupe",
      curve: "prestige",
      years: [2019, 2026],
      groupSource: PUBLISHED("911 992 (2019–)"),
      variants: [
        v("Carrera PDK", "petrol", "automatic", 2, 2981, 385, 50, 85_000, [2020, 2026]),
        v("Carrera S PDK", "petrol", "automatic", 2, 2981, 450, 50, 98_000),
      ],
    },
  ],
};
