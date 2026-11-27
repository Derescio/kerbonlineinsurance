-- 6.3c (plan/phases/06-account-claims/03c-car-and-home-changes.md, decision 1): policy_changes
-- takes three more kinds, car_replaced, home_contents and home_security. The check only widens, so
-- every existing row still passes it; nothing to dedupe or backfill.
ALTER TABLE "policy_changes" DROP CONSTRAINT "policy_changes_kind_check";--> statement-breakpoint
ALTER TABLE "policy_changes" ADD CONSTRAINT "policy_changes_kind_check" CHECK ("policy_changes"."kind" in ('address', 'driver_added', 'driver_removed', 'cover', 'car_replaced', 'home_contents', 'home_security'));
