import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { users } from "./auth";
import { claims } from "./claims";
import { createdAt, id, oneOf, updatedAt } from "./columns";
import { reviews } from "./reviews";
import { fileKinds, fileMimes, fileStatuses } from "./values";

// One file a customer gave Kerb (4.10): metadata only, the bytes are in R2 under `object_key`.
// Never the original filename, which can be personal. Rows are never deleted: a removed file is
// `deleted`, and `purged_at` records when its objects left R2, so the daily cleanup finds the rest.
// The owner and the parent are SET NULL, so a deleted account or a discarded draft claim leaves a
// `deleted` row with no personal link.
export const files = pgTable(
  "files",
  {
    id: id(),
    ownerUserId: text().references(() => users.id, { onDelete: "set null" }),
    kind: text().notNull(),
    claimId: uuid().references(() => claims.id, { onDelete: "set null" }),
    reviewId: uuid().references(() => reviews.id, { onDelete: "set null" }),
    status: text().notNull().default("pending"),
    objectKey: text().notNull().unique("files_object_key_unique"),
    // Images only: the 400 px thumbnail
    thumbKey: text(),
    mime: text().notNull(),
    sizeBytes: integer().notNull(),
    // As the browser reported them after resizing
    width: integer(),
    height: integer(),
    confirmedAt: timestamp({ withTimezone: true }),
    purgedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("files_kind_check", oneOf(t.kind, fileKinds)),
    check("files_status_check", oneOf(t.status, fileStatuses)),
    check("files_mime_check", oneOf(t.mime, fileMimes)),
    check("files_size_check", sql`${t.sizeBytes} > 0`),
    check(
      "files_dimensions_check",
      sql`(${t.width} is null or ${t.width} > 0) and (${t.height} is null or ${t.height} > 0)`,
    ),
    // A live file has exactly the parent its kind needs; a deleted one may have lost it
    check(
      "files_parent_check",
      sql`${t.status} = 'deleted' or (${t.kind} in ('claim_photo', 'claim_document') and ${t.claimId} is not null and ${t.reviewId} is null) or (${t.kind} = 'review_photo' and ${t.reviewId} is not null and ${t.claimId} is null)`,
    ),
    check("files_confirmed_check", sql`${t.status} <> 'ready' or ${t.confirmedAt} is not null`),
    index().on(t.ownerUserId),
    index().on(t.claimId),
    index().on(t.reviewId),
    index().on(t.status, t.createdAt),
    index().on(t.updatedAt),
  ],
);
