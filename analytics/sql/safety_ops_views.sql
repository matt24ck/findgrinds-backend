-- Safety operations metrics: read-only views over the existing report, dispute,
-- vetting and user tables. Apply with `npm run analytics:views` (idempotent).
--
-- Everything lives in the `safety_ops` schema so it can be dropped or re-granted
-- as a unit (e.g. `GRANT USAGE ON SCHEMA safety_ops TO analyst; GRANT SELECT ON
-- ALL TABLES IN SCHEMA safety_ops TO analyst;`).
--
-- Base view: safety_ops.reports (one row per report of any type)
-- Metrics:   report_volume_weekly, resolution_time, resolution_time_monthly,
--            dismissal_rate, repeat_reported_users, vetting_approval_rate,
--            dispute_refund_rate, screening_outcomes

CREATE SCHEMA IF NOT EXISTS safety_ops;

-- ---------------------------------------------------------------------------
-- Unified report stream. `subject_user_id` is the person being reported:
--   message  -> the message sender
--   resource -> the tutor who sold the resource
--   review   -> the student who wrote the review (tutors report reviews)
--   dispute  -> the tutor of the disputed session
-- `resolution` collapses the per-table status enums to open / actioned / dismissed.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW safety_ops.reports AS
SELECT
  'message'::text            AS report_type,
  r.id                       AS report_id,
  r.reason::text             AS reason,
  r.status::text             AS status,
  CASE r.status::text WHEN 'PENDING' THEN 'open' WHEN 'DISMISSED' THEN 'dismissed' ELSE 'actioned' END AS resolution,
  r.source::text             AS source,
  r.reporter_id,
  m.sender_id                AS subject_user_id,
  r.created_at,
  r.reviewed_at,
  r.reviewed_by,
  EXTRACT(EPOCH FROM (r.reviewed_at - r.created_at)) / 3600.0 AS hours_to_resolution
FROM message_reports r
LEFT JOIN messages m ON m.id = r.message_id

UNION ALL
SELECT
  'resource', r.id, r.reason::text, r.status::text,
  CASE r.status::text WHEN 'PENDING' THEN 'open' WHEN 'DISMISSED' THEN 'dismissed' ELSE 'actioned' END,
  'user', r.reporter_id, t.user_id, r.created_at, r.reviewed_at, r.reviewed_by,
  EXTRACT(EPOCH FROM (r.reviewed_at - r.created_at)) / 3600.0
FROM resource_reports r
LEFT JOIN resources res ON res.id = r.resource_id
LEFT JOIN tutors t ON t.id = res.tutor_id

UNION ALL
SELECT
  'review', r.id, r.reason::text, r.status::text,
  CASE r.status::text WHEN 'PENDING' THEN 'open' WHEN 'DISMISSED' THEN 'dismissed' ELSE 'actioned' END,
  'user', r.reporter_id, s.student_id, r.created_at, r.reviewed_at, r.reviewed_by,
  EXTRACT(EPOCH FROM (r.reviewed_at - r.created_at)) / 3600.0
FROM review_reports r
LEFT JOIN sessions s ON s.id = r.session_id

UNION ALL
SELECT
  'dispute', d.id, d.reason::text, d.status::text,
  CASE d.status::text WHEN 'PENDING' THEN 'open' WHEN 'DISMISSED' THEN 'dismissed' ELSE 'actioned' END,
  'user', d.reporter_id, t.user_id, d.created_at, d.reviewed_at, d.reviewed_by,
  EXTRACT(EPOCH FROM (d.reviewed_at - d.created_at)) / 3600.0
FROM session_disputes d
LEFT JOIN sessions s ON s.id = d.session_id
LEFT JOIN tutors t ON t.id = s.tutor_id;

-- ---------------------------------------------------------------------------
-- Report volume by category and week (week_start = Monday).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW safety_ops.report_volume_weekly AS
SELECT
  date_trunc('week', created_at)::date AS week_start,
  report_type,
  reason,
  source,
  count(*)                                        AS reports,
  count(*) FILTER (WHERE resolution = 'open')     AS still_open,
  count(*) FILTER (WHERE resolution = 'actioned') AS actioned,
  count(*) FILTER (WHERE resolution = 'dismissed') AS dismissed
FROM safety_ops.reports
GROUP BY 1, 2, 3, 4;

-- ---------------------------------------------------------------------------
-- Time to resolution (hours) for resolved reports, plus the current backlog age.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW safety_ops.resolution_time AS
SELECT
  report_type,
  count(*) FILTER (WHERE resolution <> 'open') AS resolved,
  count(*) FILTER (WHERE resolution = 'open')  AS open,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY hours_to_resolution) FILTER (WHERE resolution <> 'open') AS median_hours,
  percentile_cont(0.9) WITHIN GROUP (ORDER BY hours_to_resolution) FILTER (WHERE resolution <> 'open') AS p90_hours,
  max(EXTRACT(EPOCH FROM (now() - created_at)) / 3600.0) FILTER (WHERE resolution = 'open') AS oldest_open_hours
FROM safety_ops.reports
GROUP BY 1;

CREATE OR REPLACE VIEW safety_ops.resolution_time_monthly AS
SELECT
  date_trunc('month', created_at)::date AS month,
  report_type,
  count(*) FILTER (WHERE resolution <> 'open') AS resolved,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY hours_to_resolution) FILTER (WHERE resolution <> 'open') AS median_hours,
  percentile_cont(0.9) WITHIN GROUP (ORDER BY hours_to_resolution) FILTER (WHERE resolution <> 'open') AS p90_hours
FROM safety_ops.reports
GROUP BY 1, 2;

-- ---------------------------------------------------------------------------
-- Dismissal rate by type and reason. High dismissal = reason is noisy (or the
-- reporting UI is steering people to the wrong category).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW safety_ops.dismissal_rate AS
SELECT
  report_type,
  reason,
  count(*)                                         AS reports,
  count(*) FILTER (WHERE resolution <> 'open')     AS resolved,
  count(*) FILTER (WHERE resolution = 'dismissed') AS dismissed,
  count(*) FILTER (WHERE resolution = 'actioned')  AS actioned,
  round(
    count(*) FILTER (WHERE resolution = 'dismissed')::numeric
    / NULLIF(count(*) FILTER (WHERE resolution <> 'open'), 0), 3
  ) AS dismissal_rate
FROM safety_ops.reports
GROUP BY 1, 2;

-- ---------------------------------------------------------------------------
-- Users who have been the subject of two or more reports (any type).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW safety_ops.repeat_reported_users AS
SELECT
  r.subject_user_id                                 AS user_id,
  u.user_type::text                                 AS user_type,
  u.email,
  u.account_status::text                            AS account_status,
  count(*)                                          AS reports,
  count(DISTINCT r.report_type)                     AS report_types,
  count(DISTINCT r.reporter_id)                     AS distinct_reporters,
  count(*) FILTER (WHERE r.resolution = 'actioned') AS actioned,
  count(*) FILTER (WHERE r.resolution = 'open')     AS open,
  min(r.created_at)                                 AS first_reported_at,
  max(r.created_at)                                 AS last_reported_at
FROM safety_ops.reports r
JOIN users u ON u.id = r.subject_user_id
GROUP BY 1, 2, 3, 4
HAVING count(*) >= 2;

-- ---------------------------------------------------------------------------
-- Garda vetting: approval rate and review latency by submission month.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW safety_ops.vetting_approval_rate AS
SELECT
  date_trunc('month', submitted_at)::date AS month,
  count(*)                                       AS submitted,
  count(*) FILTER (WHERE status = 'APPROVED')    AS approved,
  count(*) FILTER (WHERE status = 'REJECTED')    AS rejected,
  count(*) FILTER (WHERE status = 'PENDING')     AS pending,
  round(
    count(*) FILTER (WHERE status = 'APPROVED')::numeric
    / NULLIF(count(*) FILTER (WHERE status IN ('APPROVED', 'REJECTED')), 0), 3
  ) AS approval_rate,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (reviewed_at - submitted_at)) / 3600.0)
    FILTER (WHERE reviewed_at IS NOT NULL) AS median_review_hours
FROM garda_vetting
GROUP BY 1;

-- ---------------------------------------------------------------------------
-- Session disputes: refund rate by month and reason, with refunded value.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW safety_ops.dispute_refund_rate AS
SELECT
  date_trunc('month', d.created_at)::date AS month,
  d.reason::text                           AS reason,
  count(*)                                       AS disputes,
  count(*) FILTER (WHERE d.status = 'REFUNDED')  AS refunded,
  count(*) FILTER (WHERE d.status = 'DISMISSED') AS dismissed,
  count(*) FILTER (WHERE d.status = 'PENDING')   AS pending,
  round(
    count(*) FILTER (WHERE d.status = 'REFUNDED')::numeric
    / NULLIF(count(*) FILTER (WHERE d.status <> 'PENDING'), 0), 3
  ) AS refund_rate,
  count(*) FILTER (WHERE d.tutor_response IS NOT NULL) AS with_tutor_response,
  coalesce(sum(s.price) FILTER (WHERE d.status = 'REFUNDED'), 0) AS refunded_value_eur
FROM session_disputes d
LEFT JOIN sessions s ON s.id = d.session_id
GROUP BY 1, 2;

-- ---------------------------------------------------------------------------
-- Automated screening outcomes: what reviewers did with auto-flagged messages.
-- confirmed_rate is the production precision proxy for the screener.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW safety_ops.screening_outcomes AS
SELECT
  date_trunc('week', created_at)::date AS week_start,
  count(*)                                        AS flagged,
  count(*) FILTER (WHERE status = 'REVIEWED')     AS confirmed,
  count(*) FILTER (WHERE status = 'DISMISSED')    AS dismissed,
  count(*) FILTER (WHERE status = 'PENDING')      AS open,
  round(
    count(*) FILTER (WHERE status = 'REVIEWED')::numeric
    / NULLIF(count(*) FILTER (WHERE status <> 'PENDING'), 0), 3
  ) AS confirmed_rate,
  round(avg((metadata ->> 'score')::numeric), 3)  AS avg_score
FROM message_reports
WHERE source = 'auto_screening'
GROUP BY 1;
