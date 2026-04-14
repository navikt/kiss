CREATE TABLE "user_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nav_ident" text NOT NULL,
	"landing_page" text DEFAULT 'dashboard' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_preferences_nav_ident_unique" UNIQUE("nav_ident")
);
