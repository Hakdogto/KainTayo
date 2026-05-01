import json
import re
import urllib.error
import urllib.request

from django.conf import settings
from django.core.cache import cache


def _build_prompt(query: str, location_hint: str = "") -> str:
    location_text = f" Prioritize places near: {location_hint}." if location_hint else ""
    return (
        "You are a restaurant and food store discovery assistant."
        " Return JSON only with schema:"
        ' {"summary": string, "results": [{"name": string, "category": string, "why": string, '
        '"area": string, "price_hint": string, "source_url": string, "confidence": number}]}.'
        " Include 5-8 results max. Only include food-related businesses like restaurants, cafes,"
        " bakeries, milk tea, groceries, and food stalls."
        " Exclude unrelated businesses."
        " Keep each reason concise and practical."
        f"{location_text}"
        f" User request: {query}"
    )


def _build_plaintext_fallback_prompt(query: str, location_hint: str = "") -> str:
    location_text = f" near {location_hint}" if location_hint else ""
    return (
        "List 6 food-related places only (restaurants/cafes/bakeries/milk tea). "
        "Return plain text lines only in this exact format: "
        "Name - short reason. "
        "No JSON. No markdown. No code fences. "
        f"Query: {query}{location_text}"
    )


def _fallback_payload(query: str) -> dict:
    return {
        "summary": "AI grounding is unavailable right now. Please refine your food query and try again.",
        "results": [],
        "query": query,
        "grounded_ok": False,
        "error_code": "grounding_unavailable",
    }


def _extract_json_candidate(text: str):
    cleaned = str(text or "").strip()
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    object_match = re.search(r"\{[\s\S]*\}", cleaned)
    if object_match:
        try:
            return json.loads(object_match.group(0))
        except json.JSONDecodeError:
            pass

    array_match = re.search(r"\[[\s\S]*\]", cleaned)
    if array_match:
        try:
            parsed = json.loads(array_match.group(0))
            return {"summary": "Here are grounded food suggestions.", "results": parsed}
        except json.JSONDecodeError:
            pass
    return None


def _extract_json_like_results(text: str) -> dict | None:
    cleaned = str(text or "")
    summary_match = re.search(r'"summary"\s*:\s*"([^"]+)"', cleaned)
    summary = summary_match.group(1).strip() if summary_match else "Here are grounded food suggestions."

    names = re.findall(r'"name"\s*:\s*"([^"]+)"', cleaned)
    if not names:
        return None
    categories = re.findall(r'"category"\s*:\s*"([^"]+)"', cleaned)
    whys = re.findall(r'"why"\s*:\s*"([^"]+)"', cleaned)
    areas = re.findall(r'"area"\s*:\s*"([^"]+)"', cleaned)
    prices = re.findall(r'"price_hint"\s*:\s*"([^"]+)"', cleaned)

    results = []
    for index, name in enumerate(names[:8]):
        clean_name = str(name).strip()
        if not clean_name:
            continue
        results.append(
            {
                "name": clean_name[:120],
                "category": (categories[index] if index < len(categories) else "restaurant")[:80],
                "why": (whys[index] if index < len(whys) else "Recommended based on grounded search.")[:220],
                "area": (areas[index] if index < len(areas) else "")[:140],
                "price_hint": (prices[index] if index < len(prices) else "")[:80],
                "source_url": "",
                "confidence": 0.55,
            }
        )

    if not results:
        return None
    return {"summary": summary[:180], "results": results}


def _extract_plaintext_results(text: str) -> dict | None:
    cleaned = str(text or "").strip()
    if not cleaned:
        return None

    lines = [line.strip() for line in cleaned.splitlines() if line.strip()]
    if not lines:
        return None

    summary = lines[0][:180]
    candidates = []
    for line in lines:
        if any(token in line.lower() for token in ["```", '"summary"', '"results"', "{", "}", "[", "]"]):
            continue
        if line.strip().upper() in {"RESTAURANT", "JSON"}:
            continue
        line = re.sub(r"^\d+[\).\-\s]+", "", line).strip()
        line = re.sub(r"^[\-\*\u2022]\s*", "", line).strip()
        if len(line) < 4:
            continue

        parts = re.split(r"\s+[-:]\s+", line, maxsplit=1)
        name = parts[0].strip(" -*•")
        why = parts[1].strip() if len(parts) > 1 else line
        if not name:
            continue
        candidates.append(
            {
                "name": name[:120],
                "category": "restaurant",
                "why": why[:220],
                "area": "",
                "price_hint": "",
                "source_url": "",
                "confidence": 0.45,
            }
        )
        if len(candidates) >= 8:
            break

    if not candidates:
        return None
    return {"summary": summary, "results": candidates}


def _build_request_payload(query: str, location_hint: str, tool_variant: str, strict_json: bool) -> dict:
    payload = {
        "system_instruction": {
            "parts": [
                {
                    "text": (
                        "Only return food and restaurant related businesses. Output valid JSON only."
                    )
                }
            ]
        },
        "contents": [{"parts": [{"text": _build_prompt(query, location_hint=location_hint)}]}],
        "generationConfig": {
            "temperature": 0.2,
            "maxOutputTokens": 1200,
        },
    }
    if strict_json:
        payload["generationConfig"]["responseMimeType"] = "application/json"
    if tool_variant == "google_search":
        payload["tools"] = [{"google_search": {}}]
    elif tool_variant == "google_search_retrieval":
        payload["tools"] = [{"google_search_retrieval": {}}]
    return payload


def _build_plaintext_request_payload(query: str, location_hint: str) -> dict:
    return {
        "contents": [
            {
                "parts": [
                    {"text": _build_plaintext_fallback_prompt(query=query, location_hint=location_hint)}
                ]
            }
        ],
        "generationConfig": {
            "temperature": 0.2,
            "maxOutputTokens": 1000,
        },
    }


def _call_gemini(payload: dict, timeout: int = 12):
    request = urllib.request.Request(
        (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            f"{settings.GEMINI_MODEL}:generateContent?key={settings.GEMINI_API_KEY}"
        ),
        method="POST",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def run_grounded_food_search(query: str, location_hint: str = "") -> dict:
    if not settings.GEMINI_API_KEY:
        return _fallback_payload(query)

    cache_key = f"ai_grounded:{query.strip().lower()}|{location_hint.strip().lower()}"
    cached = cache.get(cache_key)
    if isinstance(cached, dict):
        return cached

    attempts = [
        ("google_search", True),
        ("google_search_retrieval", False),
        ("none", False),
    ]
    body = None
    last_error_code = "network_error"

    for tool_variant, strict_json in attempts:
        request_payload = _build_request_payload(
            query=query,
            location_hint=location_hint,
            tool_variant=tool_variant,
            strict_json=strict_json,
        )
        try:
            body = _call_gemini(request_payload, timeout=12)
            break
        except urllib.error.HTTPError as exc:
            if exc.code in {400, 404}:
                last_error_code = "invalid_request"
                continue
            last_error_code = "network_error"
            continue
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ValueError):
            last_error_code = "network_error"
            continue

    if not isinstance(body, dict):
        payload = _fallback_payload(query)
        payload["error_code"] = last_error_code
        return payload

    text_parts = []
    for candidate in body.get("candidates", []):
        content = candidate.get("content", {})
        for part in content.get("parts", []):
            if part.get("text"):
                text_parts.append(str(part.get("text")))
    text = "\n".join(text_parts).strip()
    if not text:
        return _fallback_payload(query)

    parsed = _extract_json_candidate(text)
    if not isinstance(parsed, dict):
        parsed = _extract_json_like_results(text)
    if not isinstance(parsed, dict):
        parsed = _extract_plaintext_results(text)
    if not isinstance(parsed, dict):
        try:
            retry_body = _call_gemini(
                _build_plaintext_request_payload(query, location_hint),
                timeout=8,
            )
            retry_text_parts = []
            for candidate in retry_body.get("candidates", []):
                content = candidate.get("content", {})
                for part in content.get("parts", []):
                    if part.get("text"):
                        retry_text_parts.append(str(part.get("text")))
            retry_text = "\n".join(retry_text_parts).strip()
            parsed = _extract_plaintext_results(retry_text)
            if isinstance(parsed, dict):
                parsed["summary"] = (
                    parsed.get("summary")
                    or "Here are restaurant suggestions from AI fallback formatting."
                )
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ValueError):
            parsed = None
    if not isinstance(parsed, dict):
        payload = _fallback_payload(query)
        payload["error_code"] = "parse_error"
        return payload

    results = parsed.get("results", [])
    if not isinstance(results, list):
        results = []

    normalized = []
    for row in results[:8]:
        if not isinstance(row, dict):
            continue
        category = str(row.get("category", "")).strip().lower()
        name = str(row.get("name", "")).strip()
        if not name:
            continue
        try:
            confidence = float(row.get("confidence", 0) or 0)
        except (TypeError, ValueError):
            confidence = 0
        normalized.append(
            {
                "name": name,
                "category": category or "restaurant",
                "why": str(row.get("why", "")).strip()[:220],
                "area": str(row.get("area", "")).strip()[:140],
                "price_hint": str(row.get("price_hint", "")).strip()[:80],
                "source_url": str(row.get("source_url", "")).strip()[:350],
                "confidence": max(0.0, min(confidence, 1.0)),
            }
        )

    final_payload = {
        "summary": str(parsed.get("summary", "")).strip()
        or "Here are food-related places based on grounded web results.",
        "results": normalized,
        "query": query,
        "grounded_ok": True,
        "error_code": "",
    }
    cache.set(cache_key, final_payload, timeout=60 * 10)
    return final_payload
