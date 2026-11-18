-- 5.6b final review (plan/phases/05-quote/06b-stripe-payments.md, notes from the build):
-- payments.voided_at, set when Kerb voids a month's invoice because the cover had lapsed. The row
-- stays `failed`, but a voided month is never owed, so a policy that lapses a second time can
-- still resume. A new nullable column with no index or constraint: nothing to backfill or dedupe.
ALTER TABLE "payments" ADD COLUMN "voided_at" timestamp with time zone;
