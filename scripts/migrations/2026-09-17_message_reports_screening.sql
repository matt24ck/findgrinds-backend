-- message_reports: support automated screening reports.
--
-- In development `sequelize.sync({ alter: true })` applies the equivalent changes on boot.
-- For production run this explicitly (psql "$DATABASE_URL" -f this-file). Every statement is
-- idempotent, so it is safe to re-run.
--
--   * new reason value        off_platform_contact
--   * reporter_id nullable    (automated reports have no reporting user)
--   * source                  'user' | 'auto_screening'
--   * metadata                jsonb screening result (score, categories, matches, screenerVersion)
--   * unique indexes          one user report per (message, reporter); one automated report per message

ALTER TYPE "enum_message_reports_reason" ADD VALUE IF NOT EXISTS 'off_platform_contact';

DO $$
BEGIN
  CREATE TYPE "enum_message_reports_source" AS ENUM ('user', 'auto_screening');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE message_reports ALTER COLUMN reporter_id DROP NOT NULL;
ALTER TABLE message_reports ADD COLUMN IF NOT EXISTS source "enum_message_reports_source" NOT NULL DEFAULT 'user';
ALTER TABLE message_reports ADD COLUMN IF NOT EXISTS metadata jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS message_reports_message_reporter_unique
  ON message_reports (message_id, reporter_id);
CREATE UNIQUE INDEX IF NOT EXISTS message_reports_auto_screening_unique
  ON message_reports (message_id) WHERE source = 'auto_screening';
