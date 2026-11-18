-- 5.1 (plan P1): one quote.started per journey. Before this index existed, the PR previews and
-- local runs could write the same journey twice (a remount while the first call was in flight),
-- so the extra rows go first, keeping the earliest (ids are uuidv7, so time-ordered). The deletes
-- leave tombstones in deleted_rows through the 0002 trigger, as any delete does.
DELETE FROM "events" e
USING "events" k
WHERE e."name" = 'quote.started'
	AND k."name" = 'quote.started'
	AND e."entity_id" = k."entity_id"
	AND e."id" > k."id";--> statement-breakpoint
CREATE UNIQUE INDEX "events_quote_started_journey_unique" ON "events" USING btree ("entity_id") WHERE "events"."name" = 'quote.started';
