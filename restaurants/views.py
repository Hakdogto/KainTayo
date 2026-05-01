from django.conf import settings
from django.core.cache import cache
from django.core.exceptions import ValidationError
from django.db.models import Count
from django.db.models import Q
from django.db import IntegrityError
from django.http import Http404, HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404, render
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework import status
from rest_framework.decorators import api_view, throttle_classes
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle

from .models import FavoriteExternalPlace, FavoriteRestaurant, Restaurant, SearchHistory
from .serializers import (
    FavoriteExternalPlaceSerializer,
    FavoriteRestaurantSerializer,
    RestaurantSerializer,
    SearchHistorySerializer,
)
from .services.ai_intent import parse_query
from .services.ai_grounded_search import run_grounded_food_search
from .services.external_places import (
    fetch_place_photo,
    get_place_details,
    resolve_location_text,
    search_google_places,
)
from .services.geo import haversine_km
from .services.intent_parser import QueryFilters
from .services.recommendation import recommend_for_user
from .services.detail_summary import build_smart_detail_payload
from .services.vector_search import rank_restaurants_semantic

DEFAULT_LAT = 14.5995
DEFAULT_LON = 120.9842
MAX_QUERY_LENGTH = 220
MAX_SEARCH_RADIUS_KM = 30
AI_SEARCH_DAILY_LIMIT = 12


class AISearchRateThrottle(ScopedRateThrottle):
    scope = "ai_search"


def _clean_query(raw: str) -> str:
    query = str(raw or "").strip()
    if not query:
        raise ValidationError("Query is required.")
    if len(query) > MAX_QUERY_LENGTH:
        raise ValidationError(f"Query is too long. Maximum is {MAX_QUERY_LENGTH} characters.")
    return query


def _safe_float(value, default: float, min_value: float, max_value: float) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return default
    return max(min(parsed, max_value), min_value)


def _search_relevance_score(
    item: dict, parsed, raw_query: str, semantic_similarity: float = 0.0
) -> float:
    score = 0.0
    lowered_query = raw_query.lower()
    name = str(item.get("name", "")).lower()
    cuisine = str(item.get("cuisine", "")).lower()
    address = str(item.get("address", "")).lower()
    description = str(item.get("description", "")).lower()
    rating = float(item.get("rating", 0) or 0)
    distance_km = float(item.get("distance_km", 999) or 999)

    token_hits = 0
    for token in [tok for tok in lowered_query.split() if len(tok) > 2]:
        if token in name or token in cuisine or token in address or token in description:
            token_hits += 1
    score += token_hits * 0.7

    if parsed.cuisine and parsed.cuisine in f"{name} {cuisine} {description}":
        score += 3.0
    if parsed.mood and parsed.mood in f"{description} {address}":
        score += 1.6
    if parsed.open_now and item.get("is_open_now"):
        score += 1.2
    if parsed.budget and item.get("average_cost_for_two"):
        try:
            if int(item["average_cost_for_two"]) <= int(parsed.budget):
                score += 1.0
        except (TypeError, ValueError):
            pass

    score += min(rating, 5.0) * 0.45
    score += max(0, 5 - min(distance_km, 5)) * 0.55
    score += max(0.0, min(semantic_similarity, 1.0)) * 4.0
    return round(score, 3)


def _semantic_search_requested(request) -> bool:
    requested = request.data.get("semantic")
    if requested is None:
        return settings.VECTOR_SEARCH_ENABLED
    if isinstance(requested, bool):
        return requested
    if isinstance(requested, str):
        return requested.strip().lower() in {"1", "true", "yes", "on"}
    return bool(requested)


def _build_search_assistant_payload(query: str, parsed, results: list[dict]) -> dict:
    reasons = []
    if parsed.cuisine:
        reasons.append(f"cuisine '{parsed.cuisine}'")
    if parsed.budget:
        reasons.append(f"budget <= PHP {parsed.budget}")
    if parsed.near_me:
        reasons.append("near your location")
    if parsed.open_now:
        reasons.append("open now")
    if parsed.min_rating:
        reasons.append(f"rating >= {parsed.min_rating}")

    if reasons:
        reason_text = "Matched using " + ", ".join(reasons[:4]) + "."
    else:
        reason_text = "Matched using semantic relevance, rating, and distance."

    chips = []
    lowered = query.lower()

    def add_chip(label: str, query_text: str):
        if len(chips) >= 4:
            return
        chips.append({"label": label, "query": query_text})

    if "open now" not in lowered:
        add_chip("Only open now", f"{query} open now")
    if "near me" not in lowered and "nearby" not in lowered:
        add_chip("Closer options", f"{query} near me")
    if not parsed.budget:
        add_chip("Cheaper options", f"{query} under 500 pesos")
    elif parsed.budget and parsed.budget < 900:
        add_chip("Wider budget", f"{query} under {parsed.budget + 300} pesos")
    if not parsed.min_rating:
        add_chip("Higher rated", f"{query} 4.5 stars")

    if len(results) < 3:
        add_chip("Broaden search", query.replace("near me", "").strip() or query)
        reason_text = (
            "Few matches found. Try broader distance, a higher budget, or removing strict filters."
        )

    return {"reason": reason_text, "chips": chips[:4]}


def _ensure_session(request) -> str:
    if not request.session.session_key:
        request.session.create()
    return request.session.session_key or ""


def _actor_filter(request) -> dict:
    if request.user.is_authenticated:
        return {"user": request.user}
    return {"session_key": _ensure_session(request)}


def _ai_quota_ok(request) -> tuple[bool, int]:
    actor = _actor_filter(request)
    actor_key = f"user:{request.user.id}" if request.user.is_authenticated else f"session:{actor.get('session_key', '')}"
    cache_key = f"ai_search_daily:{actor_key}"
    hits = int(cache.get(cache_key, 0) or 0)
    if hits >= AI_SEARCH_DAILY_LIMIT:
        return False, 0
    remaining = AI_SEARCH_DAILY_LIMIT - hits - 1
    cache.set(cache_key, hits + 1, timeout=60 * 60 * 24)
    return True, max(remaining, 0)


def _parse_coords(request):
    try:
        lat = float(request.GET.get("latitude", DEFAULT_LAT))
        lon = float(request.GET.get("longitude", DEFAULT_LON))
    except (TypeError, ValueError):
        lat, lon = DEFAULT_LAT, DEFAULT_LON
    return lat, lon


@ensure_csrf_cookie
def home_page(request):
    nearby_spots = Restaurant.objects.order_by("-rating")[:12]
    trending = (
        Restaurant.objects.annotate(favorites_count=Count("favorited_by"))
        .order_by("-is_open_now", "-favorites_count", "-rating", "average_cost_for_two")[:8]
    )
    return render(
        request,
        "restaurants/home.html",
        {
            "nearby_spots": nearby_spots,
            "trending": trending,
            "mapbox_access_token": settings.MAPBOX_ACCESS_TOKEN,
        },
    )


@ensure_csrf_cookie
def search_page(request):
    return render(
        request,
        "restaurants/search.html",
        {
            "mapbox_access_token": settings.MAPBOX_ACCESS_TOKEN,
        },
    )


@ensure_csrf_cookie
def nearby_page(request):
    return render(
        request,
        "restaurants/nearby.html",
        {
            "mapbox_access_token": settings.MAPBOX_ACCESS_TOKEN,
        },
    )


@ensure_csrf_cookie
def ai_search_page(request):
    return render(request, "restaurants/ai_search.html", {})


@ensure_csrf_cookie
def favorites_page(request):
    return render(request, "restaurants/favorites.html", {})


@ensure_csrf_cookie
def recent_page(request):
    return render(request, "restaurants/recent.html", {})


def restaurant_detail_page(request, restaurant_id: int):
    restaurant = get_object_or_404(Restaurant, pk=restaurant_id)
    smart_detail = build_smart_detail_payload(RestaurantSerializer(restaurant).data, is_external=False)
    return render(
        request,
        "restaurants/restaurant_detail.html",
        {
            "restaurant": restaurant,
            "is_external": False,
            "smart_detail": smart_detail,
        },
    )


def place_detail_page(request, place_id: str):
    details = get_place_details(place_id)
    if not details:
        raise Http404("Place not found")

    photos = details.get("photos") or []
    first_photo = photos[0] if photos else {}

    normalized = {
        "name": details.get("displayName", {}).get("text", "Restaurant"),
        "address": details.get("formattedAddress", ""),
        "rating": details.get("rating", "N/A"),
        "price_level": details.get("priceLevel", "N/A"),
        "phone": details.get("internationalPhoneNumber", ""),
        "website": details.get("websiteUri", ""),
        "maps_url": details.get("googleMapsUri", ""),
        "summary": details.get("editorialSummary", {}).get("text", ""),
        "open_now": details.get("currentOpeningHours", {}).get("openNow", None),
        "photo_name": first_photo.get("name", ""),
        "photo_author": ((first_photo.get("authorAttributions") or [{}])[0].get("displayName", "")),
    }
    smart_detail = build_smart_detail_payload(normalized, is_external=True)

    return render(
        request,
        "restaurants/restaurant_detail.html",
        {
            "restaurant": normalized,
            "is_external": True,
            "smart_detail": smart_detail,
        },
    )


@api_view(["POST"])
def smart_search_api(request):
    try:
        query = _clean_query(request.data.get("query", ""))
    except ValidationError as exc:
        return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    latitude = _safe_float(request.data.get("latitude", DEFAULT_LAT), DEFAULT_LAT, -90, 90)
    longitude = _safe_float(request.data.get("longitude", DEFAULT_LON), DEFAULT_LON, -180, 180)

    parsed = parse_query(query)

    queryset = Restaurant.objects.all()
    if parsed.cuisine:
        queryset = queryset.filter(
            Q(cuisine__icontains=parsed.cuisine) | Q(name__icontains=parsed.cuisine)
        )
    if parsed.budget:
        queryset = queryset.filter(average_cost_for_two__lte=parsed.budget)
    if parsed.open_now:
        queryset = queryset.filter(is_open_now=True)
    if parsed.mood:
        queryset = queryset.filter(
            Q(mood_tags__icontains=parsed.mood) | Q(description__icontains=parsed.mood)
        )
    if parsed.min_rating:
        queryset = queryset.filter(rating__gte=parsed.min_rating)

    restaurants = []
    semantic_scores = {}
    max_distance = min(parsed.max_distance_km or 10, MAX_SEARCH_RADIUS_KM)

    if _semantic_search_requested(request):
        semantic_scores = rank_restaurants_semantic(queryset, query)

    for restaurant in queryset:
        distance_km = haversine_km(latitude, longitude, restaurant.latitude, restaurant.longitude)
        if parsed.near_me and distance_km > max_distance:
            continue

        serialized = RestaurantSerializer(restaurant).data
        serialized["distance_km"] = round(distance_km, 2)
        serialized["source"] = "local_db"
        serialized["place_id"] = ""
        serialized["detail_url"] = f"/restaurant/{restaurant.id}/"
        serialized["semantic_similarity"] = semantic_scores.get(restaurant.id, 0.0)
        restaurants.append(serialized)

    google_results = search_google_places(query, latitude, longitude, parsed, limit=20)
    for restaurant in google_results:
        distance_km = haversine_km(latitude, longitude, restaurant["latitude"], restaurant["longitude"])
        if parsed.near_me and distance_km > max_distance:
            continue
        restaurant["distance_km"] = round(distance_km, 2)
        place_id = restaurant.get("place_id", "")
        restaurant["detail_url"] = f"/place/{place_id}/" if place_id else ""
        restaurants.append(restaurant)

    deduped = {}
    for row in restaurants:
        dedupe_key = (
            f"{row.get('name', '').strip().lower()}|"
            f"{round(row.get('latitude', 0), 4)}|{round(row.get('longitude', 0), 4)}"
        )
        existing = deduped.get(dedupe_key)
        if not existing or row.get("source") == "google_places_new":
            deduped[dedupe_key] = row

    restaurants = list(deduped.values())
    for item in restaurants:
        item["relevance_score"] = _search_relevance_score(
            item,
            parsed,
            query,
            semantic_similarity=float(item.get("semantic_similarity", 0.0) or 0.0),
        )
    restaurants.sort(key=lambda r: (-float(r.get("relevance_score", 0)), r["distance_km"], -float(r["rating"])))

    actor = _actor_filter(request)
    SearchHistory.objects.create(
        user=request.user if request.user.is_authenticated else None,
        session_key=actor.get("session_key", ""),
        raw_query=query,
        interpreted_filters=parsed.to_dict(),
        latitude=latitude,
        longitude=longitude,
    )

    return Response(
        {
            "query": query,
            "parsed_filters": parsed.to_dict(),
            "semantic_enabled": bool(semantic_scores),
            "assistant": _build_search_assistant_payload(query, parsed, restaurants),
            "results": restaurants[:30],
        }
    )


@api_view(["GET"])
def nearby_restaurants_api(request):
    latitude, longitude = _parse_coords(request)
    try:
        limit = int(request.GET.get("limit", 12))
    except (TypeError, ValueError):
        limit = 12
    limit = max(1, min(limit, 30))
    try:
        offset = int(request.GET.get("offset", 0))
    except (TypeError, ValueError):
        offset = 0
    offset = max(0, offset)
    parsed = QueryFilters(near_me=True, max_distance_km=6)

    local = []
    for restaurant in Restaurant.objects.filter(is_open_now=True):
        distance_km = haversine_km(latitude, longitude, restaurant.latitude, restaurant.longitude)
        serialized = RestaurantSerializer(restaurant).data
        serialized["distance_km"] = round(distance_km, 2)
        serialized["source"] = "local_db"
        serialized["detail_url"] = f"/restaurant/{restaurant.id}/"
        local.append(serialized)

    google = search_google_places("restaurants near me", latitude, longitude, parsed, limit=12)
    for item in google:
        item["distance_km"] = round(
            haversine_km(latitude, longitude, item["latitude"], item["longitude"]), 2
        )
        place_id = item.get("place_id", "")
        item["detail_url"] = f"/place/{place_id}/" if place_id else ""

    combined = local + google
    combined.sort(key=lambda row: (row.get("distance_km", 999), -float(row.get("rating", 0))))

    deduped = []
    seen = set()
    for row in combined:
        key = f"{row.get('name', '').lower()}|{round(row.get('latitude', 0), 4)}|{round(row.get('longitude', 0), 4)}"
        if key in seen:
            continue
        seen.add(key)
        deduped.append(row)

    page = deduped[offset : offset + limit]
    next_offset = offset + limit if offset + limit < len(deduped) else None
    return Response(
        {
            "results": page,
            "pagination": {
                "offset": offset,
                "limit": limit,
                "next_offset": next_offset,
                "has_more": next_offset is not None,
                "total": len(deduped),
            },
        }
    )


@api_view(["GET"])
def recommendation_api(request):
    session_key = _ensure_session(request)
    suggestions = recommend_for_user(request.user, session_key=session_key)
    return Response({"results": RestaurantSerializer(suggestions, many=True).data})


@api_view(["GET"])
def history_api(request):
    qs = SearchHistory.objects.filter(**_actor_filter(request))[:5]
    return Response(SearchHistorySerializer(qs, many=True).data)


@api_view(["DELETE"])
def delete_history_item_api(request, history_id: int):
    actor_filter = _actor_filter(request)
    deleted, _ = SearchHistory.objects.filter(id=history_id, **actor_filter).delete()
    if deleted == 0:
        return Response({"error": "History item not found."}, status=status.HTTP_404_NOT_FOUND)
    return Response({"status": "deleted"})


@api_view(["GET"])
def favorites_api(request):
    actor = _actor_filter(request)
    local_qs = FavoriteRestaurant.objects.filter(**actor).select_related("restaurant")
    external_qs = FavoriteExternalPlace.objects.filter(**actor)

    local_items = []
    for entry in local_qs:
        local_items.append(
            {
                "id": entry.id,
                "type": "local",
                "created_at": entry.created_at,
                "name": entry.restaurant.name,
                "cuisine": entry.restaurant.cuisine,
                "detail_url": f"/restaurant/{entry.restaurant_id}/",
                "rating": entry.restaurant.rating,
            }
        )

    external_items = []
    for entry in external_qs:
        external_items.append(
            {
                "id": entry.id,
                "type": "external",
                "created_at": entry.created_at,
                "name": entry.name,
                "cuisine": entry.cuisine,
                "detail_url": entry.detail_url or (f"/place/{entry.place_id}/" if entry.place_id else ""),
                "rating": entry.rating,
            }
        )

    merged = sorted(local_items + external_items, key=lambda x: x["created_at"], reverse=True)
    for row in merged:
        if hasattr(row["created_at"], "isoformat"):
            row["created_at"] = row["created_at"].isoformat()
    return Response(merged)


@api_view(["DELETE"])
def delete_favorite_api(request, favorite_type: str, favorite_id: int):
    actor_filter = _actor_filter(request)
    normalized_type = str(favorite_type or "").strip().lower()
    if normalized_type == "local":
        deleted, _ = FavoriteRestaurant.objects.filter(id=favorite_id, **actor_filter).delete()
    elif normalized_type == "external":
        deleted, _ = FavoriteExternalPlace.objects.filter(id=favorite_id, **actor_filter).delete()
    else:
        return Response(
            {"error": "favorite_type must be 'local' or 'external'."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if deleted == 0:
        return Response({"error": "Favorite item not found."}, status=status.HTTP_404_NOT_FOUND)
    return Response({"status": "deleted"})


@api_view(["POST"])
def add_favorite_api(request):
    restaurant_id = request.data.get("restaurant_id")
    place_id = str(request.data.get("place_id", "")).strip()

    actor = _actor_filter(request)
    actor_user = request.user if request.user.is_authenticated else None
    actor_session_key = actor.get("session_key", "")

    if restaurant_id:
        try:
            restaurant_id = int(restaurant_id)
        except (TypeError, ValueError):
            return Response({"error": "restaurant_id must be numeric."}, status=status.HTTP_400_BAD_REQUEST)

        restaurant = get_object_or_404(Restaurant, pk=restaurant_id)

        try:
            favorite, created = FavoriteRestaurant.objects.get_or_create(
                user=actor_user,
                session_key=actor_session_key,
                restaurant=restaurant,
            )
        except IntegrityError:
            favorite = FavoriteRestaurant.objects.filter(
                user=actor_user,
                session_key=actor_session_key,
                restaurant=restaurant,
            ).first()
            if not favorite:
                return Response(
                    {"error": "Unable to save favorite right now. Please try again."},
                    status=status.HTTP_409_CONFLICT,
                )
            created = False

        response_status = status.HTTP_201_CREATED if created else status.HTTP_200_OK
        return Response(FavoriteRestaurantSerializer(favorite).data, status=response_status)

    if not place_id:
        return Response(
            {"error": "restaurant_id or place_id is required."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    name = str(request.data.get("name", "External place")).strip()[:255]
    cuisine = str(request.data.get("cuisine", "")).strip()[:120]
    address = str(request.data.get("address", "")).strip()[:255]
    detail_url = str(request.data.get("detail_url", "")).strip()[:255] or f"/place/{place_id}/"
    rating_raw = request.data.get("rating")
    rating = None
    try:
        if rating_raw not in [None, ""]:
            rating = float(rating_raw)
    except (TypeError, ValueError):
        rating = None

    favorite, created = FavoriteExternalPlace.objects.get_or_create(
        user=actor_user,
        session_key=actor_session_key,
        place_id=place_id,
        defaults={
            "name": name or "External place",
            "cuisine": cuisine,
            "address": address,
            "detail_url": detail_url,
            "rating": rating,
        },
    )
    if not created:
        changed = False
        if name and favorite.name != name:
            favorite.name = name
            changed = True
        if cuisine and favorite.cuisine != cuisine:
            favorite.cuisine = cuisine
            changed = True
        if address and favorite.address != address:
            favorite.address = address
            changed = True
        if detail_url and favorite.detail_url != detail_url:
            favorite.detail_url = detail_url
            changed = True
        if rating is not None and favorite.rating != rating:
            favorite.rating = rating
            changed = True
        if changed:
            favorite.save(
                update_fields=["name", "cuisine", "address", "detail_url", "rating"]
            )

    response_status = status.HTTP_201_CREATED if created else status.HTTP_200_OK
    return Response(
        {"id": favorite.id, "type": "external", **FavoriteExternalPlaceSerializer(favorite).data},
        status=response_status,
    )


@api_view(["POST"])
def seed_demo_data_api(request):
    if Restaurant.objects.exists():
        return Response({"status": "already_seeded"})

    demo_data = [
        {
            "name": "Seoul Garden Grill",
            "cuisine": "korean",
            "mood_tags": "group,casual",
            "description": "Affordable samgyupsal with unlimited side dishes.",
            "price_level": 2,
            "average_cost_for_two": 900,
            "rating": 4.6,
            "is_open_now": True,
            "latitude": 14.5547,
            "longitude": 121.0244,
            "address": "Makati, Metro Manila",
        },
        {
            "name": "Zen Ramen House",
            "cuisine": "ramen",
            "mood_tags": "quiet,date",
            "description": "Warm tonkotsu ramen spot for cozy nights.",
            "price_level": 2,
            "average_cost_for_two": 650,
            "rating": 4.5,
            "is_open_now": True,
            "latitude": 14.5906,
            "longitude": 121.0292,
            "address": "Ortigas, Pasig",
        },
        {
            "name": "Moonlight Bistro",
            "cuisine": "italian",
            "mood_tags": "romantic,quiet",
            "description": "Date-night pasta and candle-lit ambiance.",
            "price_level": 3,
            "average_cost_for_two": 1400,
            "rating": 4.8,
            "is_open_now": True,
            "latitude": 14.5652,
            "longitude": 121.036,
            "address": "BGC, Taguig",
        },
        {
            "name": "Kanto Burger Lab",
            "cuisine": "burger",
            "mood_tags": "casual,group",
            "description": "Budget burgers with big flavor.",
            "price_level": 1,
            "average_cost_for_two": 450,
            "rating": 4.3,
            "is_open_now": False,
            "latitude": 14.6101,
            "longitude": 121.037,
            "address": "Quezon City",
        },
        {
            "name": "Harbor Seafood Table",
            "cuisine": "filipino",
            "mood_tags": "family,group",
            "description": "Fresh seafood and Filipino favorites near the bay.",
            "price_level": 3,
            "average_cost_for_two": 1200,
            "rating": 4.7,
            "is_open_now": True,
            "latitude": 14.5764,
            "longitude": 120.9822,
            "address": "Manila Bay",
        },
    ]

    Restaurant.objects.bulk_create([Restaurant(**row) for row in demo_data])
    return Response({"status": "seeded", "count": len(demo_data)})


@api_view(["GET"])
def place_photo_api(request):
    photo_name = request.query_params.get("name", "").strip()
    try:
        max_width = int(request.query_params.get("max_width", 480))
    except (TypeError, ValueError):
        max_width = 480
    max_width = max(1, min(max_width, 4800))

    cache_key = f"place_photo:{photo_name}:{max_width}"
    cached = cache.get(cache_key)
    if cached:
        response = HttpResponse(cached["bytes"], content_type=cached["content_type"])
        response["Cache-Control"] = "public, max-age=86400"
        return response

    photo_bytes, content_type = fetch_place_photo(photo_name, max_width=max_width)
    if not photo_bytes:
        return Response({"error": "Photo not found."}, status=status.HTTP_404_NOT_FOUND)

    cache.set(
        cache_key,
        {"bytes": photo_bytes, "content_type": content_type},
        timeout=60 * 60 * 24,
    )
    response = HttpResponse(photo_bytes, content_type=content_type)
    response["Cache-Control"] = "public, max-age=86400"
    return response


@api_view(["POST"])
def resolve_location_api(request):
    country = str(request.data.get("country", "")).strip()
    region = str(request.data.get("region", "")).strip()
    city = str(request.data.get("city", "")).strip()

    resolved = resolve_location_text(country=country, region=region, city=city)
    if not resolved or resolved.get("latitude") is None or resolved.get("longitude") is None:
        return Response(
            {"error": "Could not resolve that location. Try a clearer city/region/country."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    return Response(
        {
            "latitude": resolved["latitude"],
            "longitude": resolved["longitude"],
            "label": resolved.get("label", ""),
        }
    )


@api_view(["POST"])
def chat_assistant_api(request):
    query = str(request.data.get("query", "")).strip()
    latest_user_message = str(request.data.get("message", "")).strip().lower()
    latitude = _safe_float(request.data.get("latitude", DEFAULT_LAT), DEFAULT_LAT, -90, 90)
    longitude = _safe_float(request.data.get("longitude", DEFAULT_LON), DEFAULT_LON, -180, 180)

    if not query:
        return Response({"error": "query is required."}, status=status.HTTP_400_BAD_REQUEST)
    if not latest_user_message:
        return Response({"error": "message is required."}, status=status.HTTP_400_BAD_REQUEST)

    suggested_query = query
    assistant_text = "I updated your search."

    if any(token in latest_user_message for token in ["cheaper", "budget", "lower price"]):
        if "under" in query.lower() or "below" in query.lower():
            suggested_query = f"{query} but cheaper"
        else:
            suggested_query = f"{query} under 500 pesos"
        assistant_text = "I prioritized cheaper options."
    elif any(token in latest_user_message for token in ["nearer", "nearer please", "closer", "near me"]):
        suggested_query = f"{query} near me"
        assistant_text = "I prioritized places closer to your location."
    elif "open now" in latest_user_message or "currently open" in latest_user_message:
        suggested_query = f"{query} open now"
        assistant_text = "I filtered to places that are open now."
    elif any(token in latest_user_message for token in ["quiet", "date", "romantic"]):
        suggested_query = f"{query} quiet date place"
        assistant_text = "I adjusted results for a quieter date-night vibe."
    elif any(token in latest_user_message for token in ["korean", "pizza", "chicken", "burger", "ramen"]):
        suggested_query = latest_user_message
        assistant_text = "I switched to that cuisine preference."
    else:
        suggested_query = f"{query} {latest_user_message}".strip()
        assistant_text = "I used your message to refine the search."

    parsed = parse_query(suggested_query)
    max_distance = min(parsed.max_distance_km or 8, MAX_SEARCH_RADIUS_KM)

    queryset = Restaurant.objects.all()
    if parsed.cuisine:
        queryset = queryset.filter(
            Q(cuisine__icontains=parsed.cuisine) | Q(name__icontains=parsed.cuisine)
        )
    if parsed.budget:
        queryset = queryset.filter(average_cost_for_two__lte=parsed.budget)
    if parsed.open_now:
        queryset = queryset.filter(is_open_now=True)
    if parsed.mood:
        queryset = queryset.filter(
            Q(mood_tags__icontains=parsed.mood) | Q(description__icontains=parsed.mood)
        )
    if parsed.min_rating:
        queryset = queryset.filter(rating__gte=parsed.min_rating)

    restaurants = []
    semantic_scores = {}
    if _semantic_search_requested(request):
        semantic_scores = rank_restaurants_semantic(queryset, suggested_query)

    for restaurant in queryset:
        distance_km = haversine_km(latitude, longitude, restaurant.latitude, restaurant.longitude)
        if parsed.near_me and distance_km > max_distance:
            continue
        serialized = RestaurantSerializer(restaurant).data
        serialized["distance_km"] = round(distance_km, 2)
        serialized["source"] = "local_db"
        serialized["place_id"] = ""
        serialized["detail_url"] = f"/restaurant/{restaurant.id}/"
        serialized["semantic_similarity"] = semantic_scores.get(restaurant.id, 0.0)
        restaurants.append(serialized)

    google_results = search_google_places(suggested_query, latitude, longitude, parsed, limit=12)
    for restaurant in google_results:
        distance_km = haversine_km(latitude, longitude, restaurant["latitude"], restaurant["longitude"])
        if parsed.near_me and distance_km > max_distance:
            continue
        restaurant["distance_km"] = round(distance_km, 2)
        place_id = restaurant.get("place_id", "")
        restaurant["detail_url"] = f"/place/{place_id}/" if place_id else ""
        restaurants.append(restaurant)

    deduped = {}
    for row in restaurants:
        dedupe_key = (
            f"{row.get('name', '').strip().lower()}|"
            f"{round(row.get('latitude', 0), 4)}|{round(row.get('longitude', 0), 4)}"
        )
        existing = deduped.get(dedupe_key)
        if not existing or row.get("source") == "google_places_new":
            deduped[dedupe_key] = row

    ranked = list(deduped.values())
    for item in ranked:
        item["relevance_score"] = _search_relevance_score(
            item,
            parsed,
            suggested_query,
            semantic_similarity=float(item.get("semantic_similarity", 0.0) or 0.0),
        )
    ranked.sort(key=lambda r: (-float(r.get("relevance_score", 0)), r["distance_km"], -float(r["rating"])))

    return Response(
        {
            "assistant_message": assistant_text,
            "suggested_query": suggested_query,
            "parsed_filters": parsed.to_dict(),
            "semantic_enabled": bool(semantic_scores),
            "results": ranked[:20],
        }
    )


@api_view(["POST"])
@throttle_classes([AISearchRateThrottle])
def ai_grounded_search_api(request):
    try:
        query = _clean_query(request.data.get("query", ""))
    except ValidationError as exc:
        return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    allowed, remaining = _ai_quota_ok(request)
    if not allowed:
        return Response(
            {"error": "Daily AI search limit reached. Please try again tomorrow.", "remaining": 0},
            status=status.HTTP_429_TOO_MANY_REQUESTS,
        )

    location_hint = str(request.data.get("location_hint", "")).strip()[:140]
    payload = run_grounded_food_search(query=query, location_hint=location_hint)
    payload["empty_results"] = not bool(payload.get("results"))
    payload["grounded_ok"] = bool(payload.get("grounded_ok", False))
    payload["remaining"] = remaining
    return Response(payload)


def manifest_json(request):
    payload = {
        "name": "Kain Tayo",
        "short_name": "KainTayo",
        "description": "Find restaurants and food stores faster with normal or AI search.",
        "start_url": "/",
        "display": "standalone",
        "background_color": "#0b0f19",
        "theme_color": "#111827",
        "icons": [
            {
                "src": "/static/restaurants/icons/logo.svg",
                "sizes": "any",
                "type": "image/svg+xml",
                "purpose": "any maskable",
            }
        ],
    }
    return JsonResponse(payload, content_type="application/manifest+json")


def service_worker_js(request):
    script = """
const STATIC_CACHE = "kain-tayo-static-v1";
const RUNTIME_CACHE = "kain-tayo-runtime-v1";
const STATIC_ASSETS = ["/", "/search/", "/nearby/", "/ai-search/", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== STATIC_CACHE && key !== RUNTIME_CACHE)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/api/")) return;
  const acceptsHtml = event.request.headers.get("accept")?.includes("text/html");

  if (acceptsHtml) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(RUNTIME_CACHE).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request).then((cached) => cached || caches.match("/")))
    );
    return;
  }

  event.respondWith(caches.match(event.request).then((cached) => {
    if (cached) return cached;
    return fetch(event.request).then((response) => {
      const clone = response.clone();
      caches.open(RUNTIME_CACHE).then((cache) => cache.put(event.request, clone));
      return response;
    });
  }));
});
"""
    response = HttpResponse(script, content_type="application/javascript")
    response["Service-Worker-Allowed"] = "/"
    return response
