ALTER TABLE "staff_members" DROP CONSTRAINT "staff_members_role_check";--> statement-breakpoint
DROP INDEX "staff_members_role_index";--> statement-breakpoint
ALTER TABLE "staff_members" DROP COLUMN "role";