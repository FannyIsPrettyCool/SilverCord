-- Extensions needed by later phases: trigram search (BRIEF §5.7) and case-insensitive text.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS citext;
