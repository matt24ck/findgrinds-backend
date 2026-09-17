from fastapi.testclient import TestClient

from screening.app import app

client = TestClient(app)


def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_screen_flags_and_echoes_message_id():
    r = client.post("/screen", json={"text": "text me on 087 123 4567", "message_id": "m1", "sender_role": "TUTOR", "recipient_is_minor": True})
    assert r.status_code == 200
    body = r.json()
    assert body["flagged"] is True
    assert body["message_id"] == "m1"
    assert "phone_number" in body["categories"]
    assert body["matches"][0]["category"] == "phone_number"


def test_screen_clean_message():
    r = client.post("/screen", json={"text": "See you on the video call at 7:30"})
    assert r.status_code == 200
    assert r.json()["flagged"] is False
    assert r.json()["categories"] == []


def test_screen_rejects_empty_text():
    assert client.post("/screen", json={"text": "   "}).status_code == 400
    assert client.post("/screen", json={}).status_code == 422


def test_batch():
    r = client.post("/screen/batch", json={"items": [{"id": "a", "text": "add me on snap"}, {"id": "b", "text": "well done today"}]})
    assert r.status_code == 200
    results = {x["id"]: x["flagged"] for x in r.json()["results"]}
    assert results == {"a": True, "b": False}
