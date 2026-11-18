import { businessV1 } from "./business-v1";
import { carV1 } from "./car-v1";
import { homeV1 } from "./home-v1";
import { homeV2 } from "./home-v2";
import type { RatingSource } from "./types";

// Every rating version the deploy writes (4.8). A new version is a new file added here; a deployed
// version is never edited (call 9). Home v2 (5.7c) comes last so each product's v1 keeps its place.
export const RATING_SOURCES: readonly RatingSource[] = [carV1, homeV1, businessV1, homeV2];
