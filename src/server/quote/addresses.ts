import { demoAddresses, type DemoAddress } from "#/features/quote/demo-addresses";
import { normalisePostcode } from "#/features/quote/postcode";
import { findPostcodeTown } from "#/server/data/postcode-rows";

import { checkPostcodeExists, type PostcodeCheck, type PostcodeCheckDeps } from "./postcode";

// The Property step's address lookup (5.7, decision 4): 5.2's postcode check, then made-up
// addresses in the postcode's district (the outcode when postcodes.io names none). Nothing is
// listed unless the postcode is found: the step then offers manual entry.

export interface AddressLookup {
  result: PostcodeCheck;
  addresses: DemoAddress[];
}

export async function findAddressesFor(
  input: string,
  headers: Headers,
  deps: PostcodeCheckDeps = {},
): Promise<AddressLookup> {
  const result = await checkPostcodeExists(input, headers, deps);
  const postcode = normalisePostcode(input);
  if (result !== "found" || !postcode) return { result, addresses: [] };

  let town: string | null = null;
  try {
    town = await findPostcodeTown(postcode, deps.db);
  } catch (error) {
    // The district only names the town: the outcode stands in
    console.warn("address lookup: district read failed", error);
  }
  return { result, addresses: demoAddresses(postcode, town ?? postcode.split(" ")[0]!) };
}
