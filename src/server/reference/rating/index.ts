import { businessV1 } from "./business-v1";
import { carV1 } from "./car-v1";
import { homeV1 } from "./home-v1";
import type { RatingSource } from "./types";

// Every rating version the deploy writes (4.8). A new version is a new file added here; a deployed
// version is never edited (call 9).
export const RATING_SOURCES: readonly RatingSource[] = [carV1, homeV1, businessV1];
