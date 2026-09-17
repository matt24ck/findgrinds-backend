"""
Off-platform contact solicitation detector.

Screens a single chat message (typically a tutor writing to a student who is,
or must be treated as, a minor) for attempts to move the relationship off the
platform: phone numbers, messaging-app handles, "let's move to ...", meet-up
requests, secrecy cues and off-platform payment.

Design notes
------------
* Rule-based on purpose. The volume is small, the harm is high, and a rule
  set is auditable: every flag carries the exact category/pattern/excerpt that
  fired, so a reviewer can see *why* in the queue. Precision/recall on the
  hand-labelled set (data/labelled_messages.jsonl) is reported in EVAL.md and
  enforced by tests/test_detector.py.
* Obfuscation-aware. Digits spelled out ("zero eight seven"), letter O for 0,
  separators inside numbers and app names ("w.h.a.t.s.a.p.p", "what's app",
  "wh4ts4pp") are normalised before matching.
* Scores are combined with a noisy-OR over categories, so one strong signal
  flags on its own and several weak ones add up. Legitimate platform context
  ("on the video call", "book through the app") halves the weak signals.
* It is a detector feeding human review, not a gate. Nothing here blocks a
  message.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field, asdict
from typing import Iterable

VERSION = "2026.09.1"
DEFAULT_THRESHOLD = 0.5

# --------------------------------------------------------------------------- #
# Result types
# --------------------------------------------------------------------------- #


@dataclass
class Match:
    category: str
    pattern: str
    excerpt: str
    weight: float


@dataclass
class ScreeningResult:
    flagged: bool
    score: float
    threshold: float
    categories: list[str]
    matches: list[Match]
    version: str = VERSION

    def to_dict(self) -> dict:
        d = asdict(self)
        d["score"] = round(self.score, 4)
        return d


# --------------------------------------------------------------------------- #
# Normalisation
# --------------------------------------------------------------------------- #

_QUOTES = str.maketrans({"‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-"})


def normalise(text: str) -> str:
    """Lowercase, fold unicode, straighten quotes, collapse whitespace."""
    text = unicodedata.normalize("NFKC", text or "")
    text = text.translate(_QUOTES).lower()
    return re.sub(r"[ \t\r\f\v]+", " ", text)


def _letters_with_separators(word: str) -> str:
    """Regex that matches `word` with up to two junk chars between letters (w.h.a.t.s app)."""
    return r"[\W_]{0,2}".join(re.escape(ch) for ch in word)


# Leet / homoglyph substitutions used when someone writes "wh4ts4pp" or "sn@p".
_LEET = str.maketrans({"0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "!": "i"})


def deleet(text: str) -> str:
    """Apply leet substitutions to tokens that mix letters and digits/symbols (never to pure numbers)."""

    def fix(m: re.Match) -> str:
        tok = m.group(0)
        if re.search(r"[a-z]", tok) and re.search(r"[0-9@$!]", tok):
            return tok.translate(_LEET)
        return tok

    return re.sub(r"[a-z0-9@$!]+", fix, text)


# --------------------------------------------------------------------------- #
# Phone numbers
# --------------------------------------------------------------------------- #

_DIGIT_WORDS = {
    "zero": "0", "oh": "0", "o": "0",
    "one": "1", "two": "2", "three": "3", "four": "4", "five": "5",
    "six": "6", "seven": "7", "eight": "8", "nine": "9",
}
_DIGITISH = re.compile(
    r"\+|\b00\d*|\bo\d+\b|\d+|\b(?:zero|oh|one|two|three|four|five|six|seven|eight|nine|o)\b",
    re.I,
)
_SEP_OK = re.compile(r"^[\s().\-/,]*$")
_NUMERIC_CONTEXT_EXCLUDE = re.compile(
    r"(isbn|iban|bic|ref(erence)?|order|invoice|receipt|account|acc(ount)? no|student no|exam no|"
    r"candidate|#|€|eur|euro|\$|£|page|pg|p\.|chapter|ch\.|question|q\.|q|ex(ercise)?|section|room|"
    r"track|id|code|pin|serial|version|v)\s*[:.]?\s*$",
    re.I,
)
_PHONE_PREFIX = re.compile(r"^(\+|00|0|353|44)")


def _token_digits(tok: str) -> str:
    t = tok.lower()
    if t == "+":
        return "+"
    if t in _DIGIT_WORDS:
        return _DIGIT_WORDS[t]
    if t.startswith("o") and t[1:].isdigit():
        return "0" + t[1:]
    return re.sub(r"\D", "", t)


def find_phone_numbers(text: str) -> list[tuple[str, str]]:
    """
    Return (excerpt, normalised_digits) for runs that look like a phone number.

    A run is a sequence of digit-ish tokens (digits, spelled digits, letter-O)
    separated only by spaces, dots, dashes, slashes, commas or brackets.
    """
    found: list[tuple[str, str]] = []
    tokens = list(_DIGITISH.finditer(text))
    i = 0
    while i < len(tokens):
        j = i
        while j + 1 < len(tokens):
            between = text[tokens[j].end(): tokens[j + 1].start()]
            if len(between) <= 3 and _SEP_OK.match(between):
                j += 1
            else:
                break
        group = tokens[i: j + 1]
        raw = "".join(_token_digits(t.group(0)) for t in group)
        has_plus = raw.startswith("+")
        digits = raw.lstrip("+")
        # Only count spelled-out runs when they are long enough to be deliberate.
        word_tokens = sum(1 for t in group if t.group(0).isalpha())
        real_digit_tokens = len(group) - word_tokens
        if 9 <= len(digits) <= 14 and (has_plus or _PHONE_PREFIX.match(digits)) and (
            real_digit_tokens >= 1 or word_tokens >= 9
        ):
            start = group[0].start()
            before = text[max(0, start - 14): start]
            if not _NUMERIC_CONTEXT_EXCLUDE.search(before):
                excerpt = text[start: group[-1].end()]
                found.append((excerpt, ("+" if has_plus else "") + digits))
        i = j + 1
    return found


# --------------------------------------------------------------------------- #
# Rule table
# --------------------------------------------------------------------------- #

CATEGORY_PHONE = "phone_number"
CATEGORY_EMAIL = "email_address"
CATEGORY_APP = "messaging_app"
CATEGORY_MOVE = "move_off_platform"
CATEGORY_MEETUP = "meetup_request"
CATEGORY_SECRECY = "secrecy"
CATEGORY_PAYMENT = "off_platform_payment"

_APP_NAMES = {
    # name: (weight when merely named, weight with "add/message me on"/"my X" context)
    "whatsapp": (0.6, 0.85),
    "snapchat": (0.6, 0.85),
    "instagram": (0.55, 0.85),
    "telegram": (0.55, 0.85),
    "discord": (0.45, 0.8),  # "discord between the characters": below threshold unless in contact context
    "facetime": (0.5, 0.8),
    "messenger": (0.45, 0.8),
    "tiktok": (0.45, 0.8),
    "viber": (0.5, 0.8),
    "imessage": (0.5, 0.8),
    "wechat": (0.5, 0.8),
    "kik": (0.5, 0.8),
    "insta": (0.45, 0.8),    # "insta-famous": below threshold unless in contact context
    "snap": (0.0, 0.8),      # too common as a verb: only with context
    "signal": (0.0, 0.8),    # "the signal is bad": only with context
    "facebook": (0.35, 0.75),
    "fb": (0.0, 0.7),
    "ig": (0.0, 0.7),
}

# "add me on snap", "hit me up on snap", "my snap is", "snap: ", "get signal", "find me on insta"
_APP_CONTEXT_BEFORE = (
    r"(?:(?:add|find|follow|message|msg|text|reach|contact|get|hit|ping|dm)\s+me(?:\s+up)?\s+(?:on|at|via|through|over)\s+"
    r"|(?:my|your|ur)\s+|(?:on|via|over|through)\s+|(?:get|download|install|use|try)\s+(?:the\s+)?)"
)
_APP_CONTEXT_AFTER = r"(?:\s*(?:is|handle|name|username|user|id)\b|\s*me\b|\s*[:@])"

_EMAIL = re.compile(r"[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}", re.I)
_HANDLE = re.compile(r"(?<![\w.])@[a-z][a-z0-9_.]{2,}", re.I)


def _rx(p: str) -> re.Pattern:
    return re.compile(p, re.I)


# (category, weight, pattern, label)
_RULES: list[tuple[str, float, re.Pattern, str]] = [
    # --- moving off-platform -------------------------------------------------
    (CATEGORY_MOVE, 0.7, _rx(
        r"\b(?:let'?s|lets|we (?:can|could|should)|can we|why don'?t we|maybe we|we'?ll|i'?ll)\s+(?:move|take|continue|switch|chat|talk|do)\b[^.!?\n]{0,30}?"
        r"\b(?:to|over to|onto|on|off|via|by)\s+(?:text|texts|texting|whatsapp|snap|snapchat|insta|instagram|telegram|discord|signal|email|"
        r"(?:the |my |your )?phone|calls?|facetime|messenger|dms?|somewhere else|something else|another app|a different app|private|privately|elsewhere)\b"
    ), "let's move to"),
    (CATEGORY_MOVE, 0.7, _rx(r"\b(?:let'?s|lets|we (?:can|could|should)|can we)\s+(?:take|move|continue)\s+(?:this|it|the|our)?\s*(?:conversation|chat|things)?\s*(?:elsewhere|somewhere (?:else|more private|private|quieter)|off here|offline|private|privately)\b"), "take this elsewhere"),
    (CATEGORY_MOVE, 0.7, _rx(r"\b(?:off|outside(?: of)?|away from|not (?:on|through|via))\s+(?:the |this |of the )?(?:app|platform|site|website|findgrinds|find grinds|chat here|messaging)\b|\boff (?:of )?here\b|\boff this\b"), "off the app/platform"),
    (CATEGORY_MOVE, 0.6, _rx(r"\b(?:don'?t|do not|no need to|stop|avoid)\s+(?:need to |have to )?(?:use|using|message|messaging|go through|bother with)\s+(?:the |this )?(?:app|platform|site|website|findgrinds|chat)\b"), "don't use the app"),
    (CATEGORY_MOVE, 0.6, _rx(r"\b(?:message|msg|text|contact|reach|ping|chat to|chat with|talk to)\s+(?:me|you)\s+(?:directly|privately|outside|elsewhere|somewhere else|off here|off this)\b|\bdon'?t reply (?:on )?here\b"), "message me directly"),
    (CATEGORY_MOVE, 0.6, _rx(r"\b(?:dm|pm)\s+me\b|\bsend me a (?:dm|pm)\b|\bin (?:my |your |the )?(?:dms|pms)\b"), "dm me"),
    (CATEGORY_MOVE, 0.55, _rx(r"\btext me\b|\b(?:send|ping|shoot|fire|drop) me a (?:text|message on|dm|pm)\b|\btext you\b"), "text me"),
    (CATEGORY_MOVE, 0.5, _rx(r"\b(?:call|ring|phone) me\s+(?:on|at|anytime|any time|later|tonight|tomorrow|after|when|whenever|if)\b|\bgive me a (?:call|ring|shout|buzz)\b|\b(?:call|ring) you\s+(?:on|at|later|tonight)\b"), "call me"),
    (CATEGORY_MOVE, 0.55, _rx(r"\b(?:my|your|ur)\s+(?:mobile|phone|cell)?\s*(?:number|no\.?|digits)\b|\bwhat'?s your number\b|\bsend (?:me |you )?(?:my|your|ur) number\b|\bgive me (?:the|your|ur) (?:number|digits|mobile)\b|\byour own phone\b|\b(?:my|the) (?:mobile |phone |cell )?number(?:'s|\s+is\b|\s*:)"), "exchange numbers"),
    (CATEGORY_MOVE, 0.55, _rx(r"\b(?:email|e-mail|mail) me\b|\bmy (?:email|e-mail) (?:is|address)\b|\b(?:send|drop) (?:me )?(?:an? )?(?:email|e-mail)\b"), "email me"),
    (CATEGORY_MOVE, 0.55, _rx(r"\b(?:private|personal)\s+(?:chat|line|number|phone|email|account)\b"), "private channel"),
    # --- meet-ups -------------------------------------------------------------
    (CATEGORY_MEETUP, 0.4, _rx(r"\bmeet\s*up\b|\bmeet ?ups?\b|\blink up\b|\bcatch up in person\b"), "meet up"),
    (CATEGORY_MEETUP, 0.6, _rx(r"\b(?:meet\s*up|link up)\b[^.!?\n]{0,30}\b(?:in town|at the weekend|this weekend|sometime|some time|properly|outside|for a|somewhere|alone|after school|after class|without|just us)\b"), "meet up (qualified)"),
    (CATEGORY_MEETUP, 0.55, _rx(r"\bhang out\b|\bhangout\b"), "hang out"),
    (CATEGORY_MEETUP, 0.45, _rx(r"\bmeet (?:you|me|up with you|with you)\s+(?:in person|somewhere|outside|after|alone|privately|at my|at your|at the|in town|for a|by the)\b|\bmeet in person\b"), "meet in person"),
    (CATEGORY_MEETUP, 0.5, _rx(r"\bsomewhere (?:quiet|quieter|private|more private|else|nobody|no one)\b|\bschool gates?\b|\boutside (?:the |your )?school\b"), "quiet spot / school gate"),
    (CATEGORY_MEETUP, 0.5, _rx(r"\bcome (?:over|round|around)(?:\s+to\s+(?:mine|ours|my|our)\b|(?=\s*(?:tomorrow|tonight|later|after|on|at|and|some|when|whenever|if|[,.!?]|$)))|\bcome to (?:mine|ours|my (?:house|place|flat|apartment|home|room|gaff))\b|\bcall (?:over|round) to (?:me|mine|my)\b|\bcome round\b"), "come over"),
    (CATEGORY_MEETUP, 0.5, _rx(r"\b(?:pick you up|collect you|drop you (?:home|off)|give you a lift|lift home|in my car|drive you)\b"), "lift / car"),
    (CATEGORY_MEETUP, 0.5, _rx(r"\b(?:go for|grab|get|meet (?:up )?for) (?:a |some )?(?:coffee|food|lunch|dinner|drink|pizza|ice ?cream|smoothie|mcdonald'?s)\b|\b(?:go(?:ing)? to|hit) the (?:cinema|movies|beach|park)\b"), "social outing"),
    (CATEGORY_MEETUP, 0.35, _rx(r"\b(?:at|to|in) (?:my|your|ur) (?:house|place|flat|apartment|home|room|gaff)\b|\b(?:at|to) (?:mine|ours)\b"), "private location"),
    (CATEGORY_MEETUP, 0.45, _rx(r"\bafter (?:school|class|training|practice)\b[^.!?\n]{0,25}\b(?:meet|see you|come|wait|pick)\b|\b(?:meet|see you|come|wait|pick)\b[^.!?\n]{0,25}\bafter (?:school|class|training|practice)\b"), "after school"),
    (CATEGORY_MEETUP, 0.5, _rx(r"\b(?:on your own|by yourself|alone)\b[^.!?\n]{0,20}\b(?:come|meet|call|see)\b|\b(?:come|meet|call|see)\b[^.!?\n]{0,20}\b(?:on your own|by yourself|alone)\b"), "alone"),
    # --- secrecy (strong on its own) -----------------------------------------
    (CATEGORY_SECRECY, 0.9, _rx(r"\b(?:don'?t|do not|no need to|never|without)\s+(?:tell|telling|mention|let|inform)\s*(?:it to |to )?(?:your |ur |you'?re )?(?:parents|mam|mum|mom|ma|dad|da|folks|family|guardian|anyone|any ?one|the school|your teacher)\b"), "don't tell your parents"),
    (CATEGORY_SECRECY, 0.85, _rx(r"\b(?:our|a) (?:little )?secret\b|\bkeep (?:this|it|that) (?:between|just between|to) (?:us|ourselves|yourself)\b|\bbetween (?:you and me|us two|the two of us)\b|\bthis stays between us\b"), "our secret"),
    (CATEGORY_SECRECY, 0.85, _rx(r"\bwhen (?:your|ur) (?:parents|mam|mum|mom|dad|folks|family) (?:aren'?t|are not|won'?t be|isn'?t|is not) (?:home|around|there|in|about|watching)\b|\bwhile (?:your|ur) (?:parents|mam|mum|mom|dad|folks) (?:are|is) (?:out|away|at work|asleep)\b"), "when parents aren't home"),
    (CATEGORY_SECRECY, 0.75, _rx(r"\bjust (?:the two of us|us two|you and me|you and i|us)\b|\bno one else\b|\bnobody else needs to know\b|\bdelete (?:this|these|our) (?:message|messages|chat)\b"), "just the two of us"),
    (CATEGORY_SECRECY, 0.7, _rx(r"\bwithout (?:your|ur) (?:parents|mam|mum|mom|dad|folks|family|guardian)\b"), "without your parents"),
    (CATEGORY_SECRECY, 0.7, _rx(r"\b(?:don'?t|do not|no need to) mention (?:it|this|that|any of this)?\s*(?:on here|here|in the app|on the app|to anyone)\b"), "don't mention it here"),
    (CATEGORY_SECRECY, 0.7, _rx(r"\b(?:my|the) (?:parents|folks|family|housemates|wife|husband|partner) (?:won'?t|aren'?t|will not|are not|isn'?t) (?:be )?(?:there|home|around|in|about)\b"), "nobody else will be there"),
    # --- off-platform payment --------------------------------------------------
    (CATEGORY_PAYMENT, 0.65, _rx(r"\bpay (?:me )?(?:in |by |with )?cash\b|\bcash in hand\b|\bcash only\b|\bbring cash\b|\bcharge cash\b|\bcash (?:is|would be|'?d be) (?:fine|grand|easier|better|handier)\b"), "cash"),
    (CATEGORY_PAYMENT, 0.6, _rx(r"\b(?:half price|cheaper|discount|knock \w+ off|tenner off|fiver off)\b[^.!?\n]{0,30}\bcash\b|\bcash\b[^.!?\n]{0,30}\b(?:half price|cheaper|discount|knock \w+ off|tenner off|fiver off)\b"), "cash discount"),
    (CATEGORY_PAYMENT, 0.6, _rx(r"\b(?:my|on|via|through|by|use|using|send|pay|get|got|have|has) (?:a |an |the )?(?:revolut|paypal|n26|iban|bank details)\b|\b(?:revolut|paypal|n26|iban)\s*(?:me|is|:|@|link|details)\b|\bbank transfer\b|\btransfer (?:it|the money|the fee|payment) (?:to me|directly|straight)\b"), "bank/revolut"),
    (CATEGORY_PAYMENT, 0.65, _rx(r"\bpay me directly\b|\bpay (?:me )?(?:direct|directly|outside|off the app|off platform)\b|\bsort (?:me|it) out (?:directly|in cash|yourself)\b"), "pay me directly"),
    (CATEGORY_PAYMENT, 0.65, _rx(r"\b(?:skip|avoid|dodge|without|save on|get around|no) the (?:platform |booking |service |website |app )?(?:fee|fees|commission|cut|charge)\b|\bcheaper if\b[^.!?\n]{0,40}\b(?:direct|directly|cash|outside|off the app|privately)\b|\b(?:direct|directly|cash|outside|off the app|privately)\b[^.!?\n]{0,40}\bcheaper\b"), "skip the fee"),
]

# Signals that the sender is talking about the platform's own channels. Halves the
# weak, ambiguous categories (meet-ups, bare app names, "text me") but never the
# strong ones: a phone number, an email, secrecy or off-platform payment mean the
# same thing whether or not the app is mentioned in the same breath.
_PLATFORM_CONTEXT = _rx(
    r"\b(?:through|via|on|in|using|inside)\s+(?:the|this|our)\s+(?:app|platform|site|website|chat|booking|checkout)\b|"
    r"\b(?:on|in|through|via) here\b|\bon findgrinds\b|\bvideo (?:call|session|room|lesson|link)\b|\bzoom\b|\bdaily\.co\b|\bmeeting link\b|"
    r"\bbook(?:ed|ing)?\s+(?:a |the |your |another |us )?(?:session|slot|lesson|grind)\b|\bin (?:the|our|your) (?:session|lesson|grind|class)\b|"
    r"\bin-person session\b|\b(?:you|your \w+|they|she|he) booked\b|\bbooked for\b|"
    r"\bstripe\b|\bthe app will\b|\bthe platform (?:will|handles|takes care)\b"
)
# "...directly rather than through here" / "don't go through the platform" name the platform
# only to reject it, so those mentions must not count as platform context.
_PLATFORM_NEGATED = _rx(
    r"\b(?:rather than|instead of|not|no need to|don'?t|without|than|off|away from|avoid|stop)\s+(?:\w+\s+){0,3}?"
    r"(?:through|via|on|in|using)\s+(?:the|this|our)?\s*(?:app|platform|site|website|chat|here)\b"
)
_DAMPENED = {CATEGORY_MEETUP, CATEGORY_APP, CATEGORY_MOVE}


# --------------------------------------------------------------------------- #
# Scoring
# --------------------------------------------------------------------------- #


def _excerpt(text: str, start: int, end: int, pad: int = 12) -> str:
    return text[max(0, start - pad): min(len(text), end + pad)].strip()


def _app_matches(text: str) -> Iterable[Match]:
    for name, (bare_w, ctx_w) in _APP_NAMES.items():
        body = _letters_with_separators(name)
        ctx = re.compile(rf"(?:{_APP_CONTEXT_BEFORE}(?:{body})\b|\b(?:{body}){_APP_CONTEXT_AFTER})", re.I)
        m = ctx.search(text)
        if m:
            yield Match(CATEGORY_APP, f"app:{name}+context", _excerpt(text, m.start(), m.end()), ctx_w)
            continue
        if bare_w > 0:
            m = re.search(rf"(?<![a-z]){body}(?![a-z])", text, re.I)
            if m:
                yield Match(CATEGORY_APP, f"app:{name}", _excerpt(text, m.start(), m.end()), bare_w)


def screen(text: str, threshold: float = DEFAULT_THRESHOLD) -> ScreeningResult:
    """Screen one message. Deterministic and side-effect free."""
    norm = normalise(text)
    norm_leet = deleet(norm)
    matches: list[Match] = []

    for excerpt, digits in find_phone_numbers(norm):
        matches.append(Match(CATEGORY_PHONE, f"phone:{digits}", excerpt, 0.9))

    for m in _EMAIL.finditer(norm):
        matches.append(Match(CATEGORY_EMAIL, "email", _excerpt(norm, m.start(), m.end()), 0.8))

    matches.extend(_app_matches(norm_leet))

    # A bare @handle that is not an email address.
    for m in _HANDLE.finditer(norm):
        if not _EMAIL.search(norm[max(0, m.start() - 40): m.end() + 40]):
            matches.append(Match(CATEGORY_APP, "handle:@", _excerpt(norm, m.start(), m.end()), 0.5))
            break

    for category, weight, rx, label in _RULES:
        m = rx.search(norm_leet)
        if m:
            matches.append(Match(category, label, _excerpt(norm_leet, m.start(), m.end()), weight))

    platform_context = bool(_PLATFORM_CONTEXT.search(norm)) and not _PLATFORM_NEGATED.search(norm)

    # Combine: top weight per category (+0.1 for a second distinct hit), noisy-OR across categories.
    per_cat: dict[str, list[float]] = {}
    for m in matches:
        w = m.weight
        if platform_context and m.category in _DAMPENED:
            w *= 0.5
        per_cat.setdefault(m.category, []).append(w)

    score = 0.0
    if per_cat:
        keep = 1.0
        for ws in per_cat.values():
            ws.sort(reverse=True)
            w = ws[0] + (0.1 if len(ws) > 1 else 0.0)
            keep *= 1.0 - min(w, 0.98)
        score = 1.0 - keep

    categories = sorted(per_cat, key=lambda c: -max(per_cat[c]))
    return ScreeningResult(
        flagged=score >= threshold,
        score=score,
        threshold=threshold,
        categories=categories,
        matches=matches,
    )
