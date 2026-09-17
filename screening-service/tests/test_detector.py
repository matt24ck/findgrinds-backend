import json
from pathlib import Path

import pytest

from screening.detector import DEFAULT_THRESHOLD, find_phone_numbers, screen

DATA = Path(__file__).resolve().parent.parent / "data" / "labelled_messages.jsonl"

# Regression floors, deliberately below the measured numbers in EVAL.md so that
# a rule change that materially hurts either metric fails CI, while ordinary
# small movements do not.
PRECISION_FLOOR = 0.92
RECALL_FLOOR = 0.88


def load_rows():
    with DATA.open(encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


@pytest.mark.parametrize(
    "text",
    [
        "Text me on 087 123 4567",
        "my number is zero eight seven one two three four five six seven",
        "add me on snap: seanb_grinds",
        "add me on wh4ts4pp",
        "w.h.a.t.s.a.p.p me",
        "lets move this to whats app",
        "Can we take this off the app?",
        "dont tell your mam about this",
        "It's cheaper if you pay me directly in cash",
        "come to mine tomorrow, my parents won't be there",
        "Email me at sean.byrne@gmail.com",
    ],
)
def test_flags_solicitation(text):
    r = screen(text)
    assert r.flagged, (text, r.score, r.matches)


@pytest.mark.parametrize(
    "text",
    [
        "Do questions 1, 2, 3, 4, 5, 6, 7, 8, 9 and 10 for Thursday",
        "See you on the video call at 7:30",
        "The 2019 Paper 2 Question 6 is the one to practise",
        "Bring your phone so you can photograph the board",
        "The ISBN for the textbook is 978-0-7171-8657-5",
        "The atomic number of carbon is 6 and its mass number is 12",
        "Let's move to chapter 5 next week",
        "Ask your parents to text me through the app if they need to reschedule",
        "Snap decision but let's do Paper 1 next week instead",
        "Discord between the two characters is the theme of Act 2",
        "Cash flow statements are in chapter 12 of the business book",
    ],
)
def test_does_not_flag_benign(text):
    r = screen(text)
    assert not r.flagged, (text, r.score, r.matches)


def test_phone_number_normalisation():
    assert find_phone_numbers("ring 087 123 4567")[0][1] == "0871234567"
    assert find_phone_numbers("o87-123-4567")[0][1] == "0871234567"
    assert find_phone_numbers("+353 87 123 4567")[0][1] == "+353871234567"
    assert find_phone_numbers("zero eight seven one two three four five six seven")[0][1] == "0871234567"
    assert find_phone_numbers("questions 1 2 3 4 5 6 7 8 9 10") == []
    assert find_phone_numbers("ISBN 978-0-7171-8657-5") == []
    assert find_phone_numbers("300,000,000 m/s") == []


def test_result_is_deterministic_and_serialisable():
    a, b = screen("text me on 087 123 4567"), screen("text me on 087 123 4567")
    assert a.to_dict() == b.to_dict()
    d = a.to_dict()
    assert set(d) >= {"flagged", "score", "threshold", "categories", "matches", "version"}
    assert d["threshold"] == DEFAULT_THRESHOLD
    assert 0.0 <= d["score"] <= 1.0
    assert d["matches"][0]["category"] == "phone_number"


def test_empty_and_whitespace_messages_are_clean():
    assert not screen("").flagged
    assert not screen("   \n  ").flagged


def test_precision_and_recall_floor_on_held_out_split():
    rows = [r for r in load_rows() if r["split"] == "test"]
    assert len(rows) >= 100, "held-out split unexpectedly small"
    tp = fp = fn = 0
    for r in rows:
        flagged = screen(r["text"]).flagged
        if r["label"] == 1 and flagged:
            tp += 1
        elif r["label"] == 0 and flagged:
            fp += 1
        elif r["label"] == 1 and not flagged:
            fn += 1
    precision = tp / (tp + fp)
    recall = tp / (tp + fn)
    assert precision >= PRECISION_FLOOR, f"precision {precision:.3f} < {PRECISION_FLOOR} (fp={fp})"
    assert recall >= RECALL_FLOOR, f"recall {recall:.3f} < {RECALL_FLOOR} (fn={fn})"
