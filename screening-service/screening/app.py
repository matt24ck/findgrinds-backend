"""
FastAPI wrapper around the detector.

    POST /screen        {text, message_id?, sender_role?, recipient_is_minor?}
    POST /screen/batch  {items: [{id?, text}]}
    GET  /health

Run locally:
    uvicorn screening.app:app --port 8010
"""

from __future__ import annotations

import os
from typing import Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from .detector import DEFAULT_THRESHOLD, VERSION, screen

MAX_TEXT_CHARS = 10_000

app = FastAPI(
    title="FindGrinds message screening",
    version=VERSION,
    description="Detects off-platform contact solicitation in tutor-to-minor messages. Flags only; never blocks.",
)


def _threshold() -> float:
    raw = os.environ.get("SCREENING_THRESHOLD")
    try:
        return float(raw) if raw else DEFAULT_THRESHOLD
    except ValueError:
        return DEFAULT_THRESHOLD


class ScreenRequest(BaseModel):
    text: str = Field(..., max_length=MAX_TEXT_CHARS)
    message_id: Optional[str] = None
    sender_role: Optional[str] = None
    recipient_is_minor: Optional[bool] = None


class MatchOut(BaseModel):
    category: str
    pattern: str
    excerpt: str
    weight: float


class ScreenResponse(BaseModel):
    flagged: bool
    score: float
    threshold: float
    categories: list[str]
    matches: list[MatchOut]
    version: str
    message_id: Optional[str] = None


class BatchItem(BaseModel):
    id: Optional[str] = None
    text: str = Field(..., max_length=MAX_TEXT_CHARS)


class BatchRequest(BaseModel):
    items: list[BatchItem] = Field(..., max_length=500)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "version": VERSION, "threshold": _threshold()}


@app.post("/screen", response_model=ScreenResponse)
def screen_one(req: ScreenRequest) -> ScreenResponse:
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="text is empty")
    result = screen(req.text, threshold=_threshold())
    return ScreenResponse(**result.to_dict(), message_id=req.message_id)


@app.post("/screen/batch")
def screen_batch(req: BatchRequest) -> dict:
    t = _threshold()
    out = []
    for item in req.items:
        r = screen(item.text, threshold=t).to_dict()
        r["id"] = item.id
        out.append(r)
    return {"results": out, "version": VERSION}
