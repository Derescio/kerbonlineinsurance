// The occupation list and its bands (4.8, call 11), shared by every version that rates occupation:
// car v1 and home v2 (5.7c, decision 4). Bands follow the 2025–26 occupation studies
// (MoneySuperMarket, Quotezone, Honest John). A deployed version copies these rows into its own
// tables, so changing this list means a new version of each product that reads it.

export const OCCUPATION_BANDS: readonly {
  band: string;
  group: string | null;
  items: readonly [string, string][];
}[] = [
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
];
