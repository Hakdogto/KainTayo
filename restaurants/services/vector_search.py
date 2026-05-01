import json
import urllib.error
import urllib.request

from django.conf import settings
from django.db.models import QuerySet

from restaurants.models import Restaurant


def build_restaurant_embedding_text(restaurant: Restaurant) -> str:
    return " | ".join(
        [
            restaurant.name or "",
            restaurant.cuisine or "",
            restaurant.mood_tags or "",
            restaurant.description or "",
            restaurant.address or "",
        ]
    ).strip()


def embed_text(text: str) -> list[float] | None:
    if not settings.GEMINI_API_KEY or not text.strip():
        return None

    payload = {
        "model": f"models/{settings.GEMINI_EMBEDDING_MODEL}",
        "content": {"parts": [{"text": text}]},
    }
    request = urllib.request.Request(
        (
            f"https://generativelanguage.googleapis.com/v1beta/models/"
            f"{settings.GEMINI_EMBEDDING_MODEL}:embedContent?key={settings.GEMINI_API_KEY}"
        ),
        method="POST",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )

    try:
        with urllib.request.urlopen(request, timeout=12) as response:
            body = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return None

    values = body.get("embedding", {}).get("values", [])
    if not isinstance(values, list) or not values:
        return None
    try:
        return [float(v) for v in values]
    except (TypeError, ValueError):
        return None


def update_restaurant_embedding(restaurant: Restaurant) -> bool:
    vector = embed_text(build_restaurant_embedding_text(restaurant))
    if not vector:
        return False
    restaurant.embedding = vector
    restaurant.save(update_fields=["embedding", "updated_at"])
    return True


def rank_restaurants_semantic(queryset: QuerySet, query_text: str) -> dict[int, float]:
    if not settings.VECTOR_SEARCH_ENABLED:
        return {}

    query_vector = embed_text(query_text)
    if not query_vector:
        return {}

    try:
        from pgvector.django import CosineDistance
    except Exception:
        return {}

    ranked = (
        queryset.exclude(embedding__isnull=True)
        .annotate(cosine_distance=CosineDistance("embedding", query_vector))
        .values("id", "cosine_distance")
    )

    score_map: dict[int, float] = {}
    for row in ranked:
        distance = float(row.get("cosine_distance", 1.0) or 1.0)
        similarity = max(0.0, min(1.0, 1.0 - distance))
        score_map[int(row["id"])] = round(similarity, 4)
    return score_map
