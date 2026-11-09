CREATE TABLE "staff_roles" (
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_roles_pkey" PRIMARY KEY("user_id","role"),
	CONSTRAINT "staff_roles_role_check" CHECK ("staff_roles"."role" in ('claims_handler', 'admin'))
);
--> statement-breakpoint
ALTER TABLE "staff_roles" ADD CONSTRAINT "staff_roles_user_id_staff_members_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."staff_members"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_roles_role_index" ON "staff_roles" USING btree ("role");