import json
import urllib.error
import urllib.request

from django.conf import settings

from .intent_parser import QueryFilters, parse_natural_query


def _build_prompt(query: str) -> str:
    return (
        "Extract restaurant filters and respond as JSON only. "
        "Keys: budget(number|null), cuisine(string|null), mood(string|null), "
        "open_now(boolean), near_me(boolean), max_distance_km(number|null), "
        "min_rating(number|null). "
        "Rules: budget is total for 2 people in PHP; cuisine and mood should be lowercase short labels. "
        f"Query: {query}"
    )


def _to_int_or_none(value):
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _to_float_or_none(value):
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _safe_query_filters(data: dict) -> QueryFilters:
    return QueryFilters(
        budget=_to_int_or_none(data.get("budget")),
        cuisine=(str(data.get("cuisine")).strip().lower() if data.get("cuisine") else None),
        mood=(str(data.get("mood")).strip().lower() if data.get("mood") else None),
        open_now=bool(data.get("open_now", False)),
        near_me=bool(data.get("near_me", False)),
        max_distance_km=_to_float_or_none(data.get("max_distance_km")),
        min_rating=_to_float_or_none(data.get("min_rating")),
    )


def _extract_output_text(body: dict) -> str:
    if body.get("output_text"):
        return str(body.get("output_text")).strip()

    chunks = []
    for output_item in body.get("output", []):
        for content_item in output_item.get("content", []):
            if content_item.get("type") in {"output_text", "text"} and content_item.get("text"):
                chunks.append(str(content_item.get("text")))
    return "\n".join(chunks).strip()


def parse_with_gemini(query: str) -> QueryFilters | None:
    if not settings.GEMINI_API_KEY:
        return None

    payload = {
        "contents": [
            {
                "parts": [
                    {"text": "You are a strict JSON extractor. Return only valid JSON."},
                    {"text": _build_prompt(query)},
                ]
            }
        ],
        "generationConfig": {
            "temperature": 0,
        },
    }

    request = urllib.request.Request(
        (
            f"https://generativelanguage.googleapis.com/v1beta/models/"
            f"{settings.GEMINI_MODEL}:generateContent?key={settings.GEMINI_API_KEY}"
        ),
        method="POST",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            body = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return None

    text = ""
    for candidate in body.get("candidates", []):
        content = candidate.get("content", {})
        for part in content.get("parts", []):
            if part.get("text"):
                text += str(part.get("text")) + "\n"
    text = text.strip()
    if not text:
        return None

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return None

    if not isinstance(parsed, dict):
        return None
    return _safe_query_filters(parsed)


def parse_query(query: str) -> QueryFilters:
    fallback = parse_natural_query(query)
    ai_filters = parse_with_gemini(query)
    if not ai_filters:
        return fallback

    return QueryFilters(
        budget=ai_filters.budget or fallback.budget,
        cuisine=ai_filters.cuisine or fallback.cuisine,
        mood=ai_filters.mood or fallback.mood,
        open_now=bool(ai_filters.open_now or fallback.open_now),
        near_me=bool(ai_filters.near_me or fallback.near_me),
        max_distance_km=ai_filters.max_distance_km or fallback.max_distance_km,
        min_rating=ai_filters.min_rating or fallback.min_rating,
    )
