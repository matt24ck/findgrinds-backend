-- Tutor offer (Sept 2026): tutor join links, 0% fees for referred students, free Professional month.
--
-- In development `sequelize.sync({ alter: true })` applies the equivalent changes on boot.
-- For production run this explicitly (psql "$DATABASE_URL" -f this-file). Every statement is
-- idempotent, so it is safe to re-run.
--
--   * users.referred_by_tutor_id / referred_at   who signed up through which tutor's join link
--   * tutors.invite_code                         the tutor's join-link code (unique)
--   * tutors.pro_month_activated_at / _ends_at   free Professional month
--   * sessions.referral_fee_waived               platform fee waived for this booking

ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by_tutor_id UUID;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_at TIMESTAMP WITH TIME ZONE;
CREATE INDEX IF NOT EXISTS users_referred_by_tutor_id ON users (referred_by_tutor_id);

ALTER TABLE tutors ADD COLUMN IF NOT EXISTS invite_code VARCHAR(16);
ALTER TABLE tutors ADD COLUMN IF NOT EXISTS pro_month_activated_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE tutors ADD COLUMN IF NOT EXISTS pro_month_ends_at TIMESTAMP WITH TIME ZONE;

DO $$
BEGIN
  ALTER TABLE tutors ADD CONSTRAINT tutors_invite_code_key UNIQUE (invite_code);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS referral_fee_waived BOOLEAN NOT NULL DEFAULT false;
