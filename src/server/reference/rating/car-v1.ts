import { choices, listLookups, postcodeBands, postcodeLookups, ranges } from "./build";
import type { RatingSource } from "./types";

// Car rating v1 (4.8, spec "Rating tables v1"). Kerb's own estimates, calibrated to 2026 UK market
// prices (ABI Q1–Q2 2026, Confused.com and Quotezone Q3 2026, MoneySuperMarket statistics), not any
// insurer's actual rates. Never edit once deployed: add car v2 instead (call 9).

const insuranceGroups = Array.from({ length: 50 }, (_, i) => {
  const group = i + 1;
  // The top band is open-ended for the validator; a group above 50 can't exist
  return [
    String(group),
    group,
    group === 50 ? null : group,
    Number((1.022 ** (group - 15)).toFixed(4)),
  ] as const;
});

export const carV1: RatingSource = {
  product: "car",
  version: 1,
  effectiveFrom: "2026-11-01",
  notes:
    "v1 (4.8): calibrated to ABI, Confused.com, Quotezone and MoneySuperMarket 2026 figures; see plan/phases/04-data-auth/08-reference-data.md",
  parameters: {
    base_rate_pence: 46_000,
    min_premium_pence: 22_500,
    max_premium_pence: 600_000,
    ipt_rate: 0.12,
    fee_pence: 0,
    monthly_credit_charge_rate: 0.1,
    bundle_discount_rate: 0.08,
    young_driver_excess_pence: 25_000,
    refer_insurance_group_min: 45,
    refer_value_pence_min: 7_500_000,
    decline_value_pence_min: 15_000_000,
    decline_young_age_max: 20,
    decline_young_group_min: 30,
    decline_under25_group_min: 40,
    refer_past_claims_min: 3,
    refer_new_licence_years_max: 0,
    refer_new_licence_group_min: 25,
    refer_age_min: 80,
  },
  tiers: [
    // Third party, fire and theft is often no cheaper than comprehensive in the UK
    { coverLevel: "essential", multiplier: 0.96, compulsoryExcessPence: 25_000 },
    { coverLevel: "comprehensive", multiplier: 1, compulsoryExcessPence: 25_000 },
    { coverLevel: "plus", multiplier: 1.18, compulsoryExcessPence: 15_000 },
  ],
  addons: [
    { addon: "breakdown_uk", annualPricePence: 4_500, factors: [], availableToGroups: null },
    { addon: "motor_legal", annualPricePence: 2_500, factors: [], availableToGroups: null },
  ],
  factors: [
    ...ranges("driver_age", [
      ["17-18", 17, 18, 2.4],
      ["19-20", 19, 20, 2],
      ["21-24", 21, 24, 1.5],
      ["25-29", 25, 29, 1.2],
      ["30-39", 30, 39, 1.06],
      ["40-49", 40, 49, 1],
      ["50-59", 50, 59, 0.9],
      ["60-69", 60, 69, 0.84],
      ["70-74", 70, 74, 0.9],
      ["75-79", 75, 79, 1.02],
      ["80+", 80, null, 1.25],
    ]),
    ...ranges("no_claims_years", [
      ["0", 0, 0, 1.5],
      ["1", 1, 1, 1.35],
      ["2", 2, 2, 1.25],
      ["3", 3, 3, 1.16],
      ["4", 4, 4, 1.09],
      ["5", 5, 5, 1.05],
      ["6", 6, 6, 1.03],
      ["7", 7, 7, 1.02],
      ["8", 8, 8, 1.01],
      ["9+", 9, null, 1],
    ]),
    ...ranges("licence_years", [
      ["0", 0, 0, 1.25],
      ["1-2", 1, 2, 1.12],
      ["3-4", 3, 4, 1.05],
      ["5+", 5, null, 1],
    ]),
    ...ranges("insurance_group", insuranceGroups),
    ...ranges("annual_mileage", [
      ["0-5000", 0, 5_000, 0.95],
      ["5001-10000", 5_001, 10_000, 1],
      ["10001-15000", 10_001, 15_000, 1.04],
      ["15001-20000", 15_001, 20_000, 1.08],
      ["20001-30000", 20_001, 30_000, 1.15],
      ["30001+", 30_001, null, 1.25],
    ]),
    ...choices("usage", { social: 0.95, commuting: 1, business: 1.12 }),
    ...choices("overnight_location", { garage: 0.95, driveway: 0.97, street: 1.08 }),
    // EV repairs cost more
    ...choices("fuel_type", { petrol: 1, diesel: 1.02, hybrid: 1.03, electric: 1.08 }),
    ...ranges("vehicle_age", [
      ["0-2", 0, 2, 1.04],
      ["3-7", 3, 7, 1],
      ["8-12", 8, 12, 0.97],
      ["13+", 13, null, 1],
    ]),
    // Last 5 years; 3 or more is referred anyway
    ...ranges("past_claims", [
      ["0", 0, 0, 1],
      ["1", 1, 1, 1.3],
      ["2", 2, 2, 1.65],
      ["3+", 3, null, 1.65],
    ]),
    // In pence; the offered amounts are £0, £100, £250, £500, £750 and £1,000
    ...ranges("voluntary_excess", [
      ["0", 0, 9_999, 1],
      ["100", 10_000, 24_999, 0.98],
      ["250", 25_000, 49_999, 0.95],
      ["500", 50_000, 74_999, 0.91],
      ["750", 75_000, 99_999, 0.89],
      ["1000", 100_000, null, 0.87],
    ]),
    // Each additional driver; an experienced second driver brings a small discount
    ...ranges("named_driver_age", [
      ["17-20", 17, 20, 1.35],
      ["21-24", 21, 24, 1.18],
      ["25-29", 25, 29, 1.05],
      ["30-74", 30, 74, 0.97],
      ["75+", 75, null, 1.05],
    ]),
    ...choices("occupation_band", { A: 0.92, B: 0.95, C: 1, D: 1.08, E: 1.18 }),
    ...postcodeBands("postcode_band"),
  ],
  lookups: [
    ...postcodeLookups("postcode_band", (area) => area.car),
    // The 5.3 dropdown; keys are stored as drivers.occupation. Bands follow the 2025–26 occupation
    // studies (MoneySuperMarket, Quotezone, Honest John)
    ...listLookups("occupation", "occupation_band", [
      {
        band: "A",
        group: null,
        items: [
          ["retired", "Retired"],
          ["police_officer", "Police officer"],
          ["civil_servant", "Civil servant"],
          ["accountant", "Accountant"],
          ["engineer", "Engineer"],
          ["software_developer", "Software developer"],
          ["pharmacist", "Pharmacist"],
          ["librarian", "Librarian"],
          ["architect", "Architect"],
          ["nurse", "Nurse"],
        ],
      },
      {
        band: "B",
        group: null,
        items: [
          ["teacher", "Teacher"],
          ["office_manager", "Office manager"],
          ["administrator", "Administrator"],
          ["solicitor", "Solicitor"],
          ["dentist", "Dentist"],
          ["receptionist", "Receptionist"],
          ["project_manager", "Project manager"],
          ["social_worker", "Social worker"],
          ["firefighter", "Firefighter"],
          ["paramedic", "Paramedic"],
          ["hgv_driver", "HGV driver"],
        ],
      },
      {
        band: "C",
        group: null,
        items: [
          ["doctor", "Doctor"],
          ["sales_assistant", "Sales assistant"],
          ["electrician", "Electrician"],
          ["plumber", "Plumber"],
          ["carpenter", "Carpenter"],
          ["mechanic", "Mechanic"],
          ["hairdresser", "Hairdresser"],
          ["builder", "Builder"],
          ["farmer", "Farmer"],
          ["homemaker", "Homemaker"],
          ["self_employed", "Self-employed (other)"],
        ],
      },
      {
        band: "D",
        group: null,
        items: [
          ["student", "Student"],
          ["chef", "Chef"],
          ["warehouse_operative", "Warehouse operative"],
          ["healthcare_assistant", "Healthcare assistant"],
          ["care_worker", "Care worker"],
          ["bar_staff", "Bar staff"],
          ["delivery_driver", "Delivery driver"],
          ["apprentice", "Apprentice"],
          ["labourer", "Labourer"],
          ["sales_representative", "Sales representative"],
        ],
      },
      {
        band: "E",
        group: null,
        items: [
          ["unemployed", "Unemployed"],
          ["taxi_driver", "Taxi driver"],
          ["musician", "Musician"],
          ["entertainer", "Entertainer"],
          ["professional_sportsperson", "Professional sportsperson"],
        ],
      },
    ]),
  ],
};
