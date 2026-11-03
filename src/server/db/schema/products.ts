import { type SQL, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  smallint,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { createdAt, id, oneOf, pence, postcodeDistrictSql, updatedAt } from "./columns";
import { quoteItems } from "./quotes";
import {
  fuelTypes,
  lockTypes,
  overnightLocations,
  propertyTypes,
  type Product,
  vehicleUsages,
} from "./values";

// Product details hang off the quote item (4.2, decision 6). Each table has a fixed `product`
// column and a composite foreign key to quote_items (id, product), so Postgres refuses a vehicle
// on a home item. All go with their item (CASCADE).

/** The fixed `product` column: defaults to, and may only be, this table's product. */
const productColumn = (product: Product) => text().notNull().default(product);

function itemOf(
  table: string,
  columns: { quoteItemId: AnyPgColumn; product: AnyPgColumn },
  product: Product,
): [SQL, ReturnType<typeof foreignKey>] {
  return [
    sql`${columns.product} = '${sql.raw(product)}'`,
    foreignKey({
      name: `${table}_quote_item_fk`,
      columns: [columns.quoteItemId, columns.product],
      foreignColumns: [quoteItems.id, quoteItems.product],
    }).onDelete("cascade"),
  ];
}

export const vehicles = pgTable(
  "vehicles",
  {
    quoteItemId: uuid().primaryKey(),
    product: productColumn("car"),
    // Catalogue fields copied at quote time, so 4.8's catalogue never changes a quote
    make: text().notNull(),
    model: text().notNull(),
    year: smallint().notNull(),
    variant: text().notNull(),
    fuelType: text().notNull(),
    doors: smallint().notNull(),
    insuranceGroup: smallint().notNull(),
    valuePence: pence(),
    registration: text(),
    // Odometer reading
    currentMileage: integer().notNull(),
    annualMileage: integer().notNull(),
    usage: text().notNull(),
    overnightLocation: text().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => {
    const [productCheck, fk] = itemOf("vehicles", t, "car");
    return [
      check("vehicles_product_check", productCheck),
      fk,
      check("vehicles_fuel_type_check", oneOf(t.fuelType, fuelTypes)),
      check("vehicles_doors_check", sql`${t.doors} between 2 and 7`),
      check("vehicles_insurance_group_check", sql`${t.insuranceGroup} between 1 and 50`),
      check("vehicles_value_check", sql`${t.valuePence} >= 0`),
      check("vehicles_mileage_check", sql`${t.currentMileage} >= 0 and ${t.annualMileage} > 0`),
      check("vehicles_usage_check", oneOf(t.usage, vehicleUsages)),
      check("vehicles_overnight_location_check", oneOf(t.overnightLocation, overnightLocations)),
      index().on(t.updatedAt),
    ];
  },
);

export const drivers = pgTable(
  "drivers",
  {
    id: id(),
    quoteItemId: uuid().notNull(),
    product: productColumn("car"),
    isMain: boolean().notNull().default(false),
    firstName: text().notNull(),
    lastName: text().notNull(),
    dateOfBirth: date().notNull(),
    // The list is checked by Zod and rated in 4.8
    occupation: text().notNull(),
    licenceYears: smallint().notNull(),
    noClaimsYears: smallint().notNull(),
    pastClaims: smallint().notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => {
    const [productCheck, fk] = itemOf("drivers", t, "car");
    return [
      check("drivers_product_check", productCheck),
      fk,
      check(
        "drivers_history_check",
        sql`${t.licenceYears} >= 0 and ${t.noClaimsYears} >= 0 and ${t.pastClaims} >= 0`,
      ),
      // One main driver per item
      uniqueIndex("drivers_one_main_idx")
        .on(t.quoteItemId)
        .where(sql`${t.isMain}`),
      index().on(t.quoteItemId),
      index().on(t.updatedAt),
    ];
  },
);

export const properties = pgTable(
  "properties",
  {
    quoteItemId: uuid().primaryKey(),
    product: productColumn("home"),
    // The insured address, which may not be where the customer lives
    addressLine1: text().notNull(),
    addressLine2: text(),
    town: text().notNull(),
    postcode: text().notNull(),
    postcodeDistrict: text().generatedAlwaysAs(postcodeDistrictSql),
    propertyType: text().notNull(),
    yearBuilt: smallint().notNull(),
    bedrooms: smallint().notNull(),
    rebuildCostPence: pence(),
    contentsValuePence: pence(),
    // Security as typed columns, not JSON (decision 16)
    hasAlarm: boolean().notNull(),
    hasSmokeAlarm: boolean().notNull(),
    lockType: text().notNull(),
    pastClaims: smallint().notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => {
    const [productCheck, fk] = itemOf("properties", t, "home");
    return [
      check("properties_product_check", productCheck),
      fk,
      check("properties_property_type_check", oneOf(t.propertyType, propertyTypes)),
      check("properties_lock_type_check", oneOf(t.lockType, lockTypes)),
      check(
        "properties_amounts_check",
        sql`${t.bedrooms} >= 0 and ${t.rebuildCostPence} >= 0 and ${t.contentsValuePence} >= 0 and ${t.pastClaims} >= 0`,
      ),
      index().on(t.updatedAt),
    ];
  },
);

export const businesses = pgTable(
  "businesses",
  {
    quoteItemId: uuid().primaryKey(),
    product: productColumn("business"),
    tradeClass: text().notNull(),
    turnoverPence: pence(),
    employees: integer().notNull(),
    coverSections: text().array().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => {
    const [productCheck, fk] = itemOf("businesses", t, "business");
    return [
      check("businesses_product_check", productCheck),
      fk,
      check("businesses_amounts_check", sql`${t.turnoverPence} >= 0 and ${t.employees} >= 0`),
      index().on(t.updatedAt),
    ];
  },
);
