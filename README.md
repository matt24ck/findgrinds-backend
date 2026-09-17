# FindGrinds backend

Express + TypeScript + Sequelize (PostgreSQL) API for [findgrinds.ie](https://findgrinds.ie), Ireland's
Junior/Leaving Cert grinds marketplace. The Next.js frontend lives in the sibling
`findgrinds-frontend` repository.

```bash
npm install
cp .env.example .env            # fill in DATABASE_URL, JWT_SECRET (32+ random chars), Stripe, Resend
npm run dev                     # http://localhost:3001
npm run typecheck
npm test                        # safety-path integration tests (needs Postgres, see below)
```

## Age policy

FindGrinds fails closed on age. A user is treated as under 18 unless we hold a date of
birth that proves otherwise: a missing, malformed or implausible date of birth is a minor
for every safeguarding decision in the app, not an adult. Concretely, `User.isMinor()`
returns true when `date_of_birth` is null, students must supply a date of birth at signup
(the API rejects a student signup without one), and a student who is or is treated as a
minor can only send pre-written messages to tutors until a parent or guardian links their
account. We chose this over "unknown means adult" because the cost of the two mistakes is
not symmetric: wrongly restricting an adult to pre-written messages is an inconvenience
they can fix in one step, while wrongly giving a 15-year-old a free-text private channel to
an adult stranger is the exact failure a tutoring platform exists to prevent.

The date of birth is self-declared and we do not pretend otherwise; it is a policy floor,
not identity verification. To stop the obvious workaround (declare 15 at signup, edit to 19
later) the value is write-once: an account with no date of birth may add one through
`PUT /api/auth/date-of-birth`, after which it is immutable through the API and corrections
go through support with a human in the loop. Accounts created before this policy have no
date of birth and are therefore treated as minors until they add one from the student
dashboard. Tutor messages to anyone treated as a minor are additionally screened for
off-platform contact solicitation (see below), and the screener, unlike the age check,
fails open: a screening outage never blocks delivery, it only loses a detection signal.

## Trust and safety components

| piece | where | what it does |
|---|---|---|
| Message screening service | [`screening-service/`](screening-service/) (Python, FastAPI) | Screens tutor messages to minors for phone numbers, WhatsApp/Snapchat handles, "let's move to", meet-ups, secrecy and cash. Flags into the message report queue (`reason = off_platform_contact`, `source = auto_screening`); never blocks. Hand-labelled 310-message set with measured precision/recall in [`screening-service/EVAL.md`](screening-service/EVAL.md). |
| Node client | `src/services/screeningService.ts` | Called from the message-send route; 2.5 s timeout, fail-open, one automated report per message (partial unique index). Enable with `SCREENING_SERVICE_URL`. |
| Safety-ops metrics | [`analytics/`](analytics/) | `safety_ops.*` SQL views (report volume by category/week, median time to resolution, dismissal rate by reason, users with 2+ reports, vetting approval rate, dispute refund rate, screening outcomes). `npm run analytics:views` applies them; `analytics/safety_ops_metrics.ipynb` reads them and writes up findings (uses clearly-labelled synthetic history when real volume is thin). |
| AI assistant evals | [`evals/ai-assistant/`](evals/ai-assistant/) | 27 adversarial cases (invented tutor, out-of-catalogue, budget ceiling, prompt injection in a tutor bio and a resource description, minor asking for a phone number, off-platform payment, ...) run with `npm run test:evals` and in CI when `ANTHROPIC_API_KEY_FINDGRINDS` is set. The system prompt now states that tool results are untrusted user content and carries explicit safety rules. |
| Safety-path tests | [`tests/safety/`](tests/safety/) | Age gate, parent linking, report de-duplication (user and automated), dispute state transitions, the refund path. `npm test`. |
| Hygiene | `src/config/jwt.ts`, `src/middleware/rateLimit.ts`, `src/services/reportNotifications.ts` | No JWT fallback secret (boot fails on a missing/placeholder `JWT_SECRET`); per-IP rate limits on signup/login/password routes and the public AI chat; report emails carry a link to the admin queue and never the message text. |

## Schema change for existing databases

`message_reports` gained a nullable `reporter_id`, a `source` enum, a `metadata` jsonb column,
the `off_platform_contact` reason and two unique indexes. Development picks this up from
`sequelize.sync({ alter: true })` on boot; for production run
[`scripts/migrations/2026-09-17_message_reports_screening.sql`](scripts/migrations/2026-09-17_message_reports_screening.sql)
(idempotent) before deploying.

## Running the tests

`npm test` runs the Jest suite against a throwaway Postgres database. It uses
`TEST_DATABASE_URL`, or `DATABASE_URL` with the database name swapped for `findgrinds_test`,
creates the database if needed and **drops and recreates its public schema** on every run.
The name must end in `_test`; anything else is refused. Stripe, email, video and S3 are
mocked; the screening service is stubbed at the HTTP boundary.

The CI workflow ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs the type-check,
the safety tests, the SQL views, the Python screening tests and (with the secret) the AI
evals on every push and pull request.

## Message screening in one paragraph

When a tutor sends a message in a conversation whose student is treated as a minor, the
route fires `screeningService.screenTutorMessage` in the background. It posts the text to
`POST /screen` on the Python service, and if the result is at or above the threshold it
inserts a `message_reports` row with `source = 'auto_screening'`, `reporter_id = NULL`, the
categories and score in `metadata`, and emails the on-call address a link to the queue. The
admin queue shows these alongside user reports, labelled "Automated screening", and
`safety_ops.screening_outcomes` tracks how many reviewers confirm versus dismiss, which is
the screener's production precision.

## Layout

```
src/
  app.ts              Express app (no listen) - shared by the server and tests
  index.ts            boot: config checks, DB sync, listen
  config/jwt.ts       JWT secret policy, sign/verify
  middleware/         auth, rateLimit
  models/             Sequelize models (User.isMinor fails closed; MessageReport has source/metadata)
  routes/             REST routes
  services/           stripe, email, ai, search, screening, reportNotifications, ...
  utils/age.ts        date-of-birth parsing and the minor decision
tests/                Jest safety-path suite (+ setup/ for the test database and mocks)
evals/ai-assistant/   adversarial eval cases, fixtures, runner
analytics/            safety_ops SQL views + notebook
screening-service/    Python screening service, labelled data, evaluation
scripts/              make-admin, apply-safety-views
```
