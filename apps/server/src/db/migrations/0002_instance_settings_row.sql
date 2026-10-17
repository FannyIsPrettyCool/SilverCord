-- The single settings row must always exist; registration starts invite-only (ADR-0001).
INSERT INTO "instance_settings" ("id") VALUES (1) ON CONFLICT DO NOTHING;
