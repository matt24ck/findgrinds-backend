# Message screening service

A small Python (FastAPI) service that screens **tutor messages sent to minors** for
off-platform contact solicitation and flags them into the existing message report
queue. It detects, it never blocks.

What it looks for:

| category | examples |
|---|---|
| `phone_number` | `087 123 4567`, `+353 87…`, `o87 123 4567`, `zero eight seven one two…` |
| `email_address` | any email address |
| `messaging_app` | WhatsApp / Snapchat / Instagram / Telegram / Discord / FaceTime … handles, incl. `wh4ts4pp`, `w.h.a.t.s.a.p.p`, `snap chat` |
| `move_off_platform` | "let's move this to text", "take this off the app", "message me directly", "what's your number", "email me" |
| `meetup_request` | "come over to mine", "pick you up after school", "grab a coffee", "meet me at the school gate" |
| `secrecy` | "don't tell your mam", "our secret", "when your parents aren't home", "delete these messages" |
| `off_platform_payment` | "pay me cash", "Revolut me", "skip the platform fee", "cheaper if you pay directly" |

Each category has weighted rules; the message score is a noisy-OR across categories,
and anything at or above the threshold (default **0.5**) is flagged. Mentions of the
platform's own channels ("on the video call", "book through the app") halve the weak
categories (meet-ups, bare app names, "text me") but never the strong ones.

## Measured performance

See [EVAL.md](EVAL.md) (regenerate with `python evaluate.py`). Summary on the
held-out half of the 310-message hand-labelled set at threshold 0.5 is in that file's
first table; `tests/test_detector.py` fails CI if precision drops below 0.92 or recall
below 0.88 on that split.

The labelled set (`data/labelled_messages.jsonl`) is hand-written: 155 solicitation
messages (plain and obfuscated numbers, app handles, moving off-platform, meet-ups,
secrecy, cash) and 155 benign tutor messages chosen to be hard (numbers, dates, prices,
chapter references, "phone" as a device, "snap" as a verb, "cash flow", legitimate
in-person session logistics, parent references). Odd ids are `dev` (visible while
writing the rules), even ids are `test` (held out). Real traffic is messier than this
set; treat the numbers as an upper bound and re-measure on production samples.

Honesty note on the split: after the first full evaluation, two rule bugs surfaced by
held-out errors were fixed (a loose "number is" pattern that matched "mass number is 12",
and the bare word "discord" firing on literary use), so the test split is not perfectly
blind for those two rules. The remaining misses are deliberately adversarial spelled-out
numbers ("eighty seven, one two three ...").

## Run it

```bash
cd screening-service
python -m venv .venv && . .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn screening.app:app --port 8010             # http://localhost:8010/docs
pytest                                            # unit tests + precision/recall floor
python evaluate.py --errors                       # metrics, threshold sweep, EVAL.md
```

Docker: `docker build -t findgrinds-screening . && docker run -p 8010:8010 findgrinds-screening`.

## API

`POST /screen`

```json
{ "text": "text me on 087 123 4567", "message_id": "uuid", "sender_role": "TUTOR", "recipient_is_minor": true }
```

```json
{ "flagged": true, "score": 0.96, "threshold": 0.5,
  "categories": ["phone_number", "move_off_platform"],
  "matches": [{ "category": "phone_number", "pattern": "phone:0871234567", "excerpt": "text me on 087 123 4567", "weight": 0.9 }],
  "version": "2026.09.1", "message_id": "uuid" }
```

`POST /screen/batch` takes `{ "items": [{ "id", "text" }] }` (max 500) for backfills.
`GET /health` reports the version and active threshold (`SCREENING_THRESHOLD` env).

## How the Node backend uses it

`src/services/screeningService.ts` calls `POST /screen` from the message-send route
when the sender is the conversation's tutor and the student must be treated as a
minor (no date of birth on file counts as a minor). A flagged result creates a
`message_reports` row with `source = 'auto_screening'`, `reason = 'off_platform_contact'`,
`reporter_id = NULL` and the screening result in `metadata`, then emails the admin
queue link (never the message text). Configure with `SCREENING_SERVICE_URL`
(unset = screening off, logged at boot) and `SCREENING_TIMEOUT_MS` (default 2500).

The call is fire-and-forget with a short timeout: a slow or dead screener never
delays or blocks delivery. A partial unique index guarantees at most one automated
report per message.

## Changing the rules

1. Add examples to `data/labelled_messages.jsonl` first (both the case you want caught
   and the benign near-miss you are worried about).
2. Edit `screening/detector.py`.
3. `python evaluate.py --errors` and read every false positive and negative.
4. Bump `VERSION` so reports record which rule set flagged them.
