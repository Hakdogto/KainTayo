from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from unittest.mock import patch

from .models import FavoriteExternalPlace, FavoriteRestaurant, Restaurant
from .services.ai_grounded_search import (
    _build_prompt,
    _extract_json_candidate,
    _extract_json_like_results,
    _extract_plaintext_results,
    _normalize_results,
    run_grounded_food_search,
)
from .services.intent_parser import parse_natural_query


@override_settings(SECURE_SSL_REDIRECT=False)
class IntentParserTests(TestCase):
    def test_parse_handles_budget_typos_and_nearby(self):
        parsed = parse_natural_query("Budget under 500, korean, nearyb, open now")

        self.assertEqual(parsed.budget, 500)
        self.assertEqual(parsed.cuisine, "korean")
        self.assertTrue(parsed.near_me)
        self.assertTrue(parsed.open_now)


@override_settings(SECURE_SSL_REDIRECT=False)
class FavoritesApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.restaurant = Restaurant.objects.create(
            name="Test Grill",
            cuisine="korean",
            mood_tags="group",
            description="Demo",
            price_level=1,
            average_cost_for_two=450,
            rating=4.3,
            is_open_now=True,
            latitude=14.60,
            longitude=121.00,
            address="Metro Manila",
        )

    def test_add_favorite_idempotent_for_same_session(self):
        payload = {"restaurant_id": self.restaurant.id}
        first = self.client.post("/api/favorites/add/", payload, format="json")
        second = self.client.post("/api/favorites/add/", payload, format="json")

        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(
            FavoriteRestaurant.objects.filter(restaurant=self.restaurant).count(), 1
        )

    def test_add_external_favorite_idempotent_for_same_session(self):
        payload = {
            "place_id": "places/demo-123",
            "name": "Demo External Place",
            "cuisine": "korean",
            "address": "Santa Rosa, Laguna",
            "detail_url": "/place/places/demo-123/",
            "rating": 4.4,
        }
        first = self.client.post("/api/favorites/add/", payload, format="json")
        second = self.client.post("/api/favorites/add/", payload, format="json")

        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(
            FavoriteExternalPlace.objects.filter(place_id="places/demo-123").count(), 1
        )


@override_settings(SECURE_SSL_REDIRECT=False)
class SearchApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        Restaurant.objects.create(
            name="Quiet Korean Place",
            cuisine="korean",
            mood_tags="quiet,date",
            description="Quiet vibe and affordable menu",
            price_level=1,
            average_cost_for_two=450,
            rating=4.7,
            is_open_now=True,
            latitude=14.5995,
            longitude=120.9842,
            address="Manila",
        )

    def test_search_returns_results_for_natural_query(self):
        response = self.client.post(
            "/api/search/",
            {
                "query": "date place under 500 pesos quiet near me",
                "latitude": 14.5995,
                "longitude": 120.9842,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("results", data)
        self.assertIn("parsed_filters", data)
        self.assertEqual(data["parsed_filters"].get("budget"), 500)
        self.assertTrue(data["parsed_filters"].get("near_me"))


@override_settings(SECURE_SSL_REDIRECT=False, REST_FRAMEWORK={
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        "anon": "200/min",
        "user": "200/min",
        "ai_search": "50/min",
    },
})
class AiGroundedSearchApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    @patch("restaurants.views.run_grounded_food_search")
    def test_ai_search_returns_structured_payload(self, mock_grounded):
        mock_grounded.return_value = {
            "summary": "Top picks",
            "results": [
                {
                    "name": "Demo Ramen House",
                    "category": "restaurant",
                    "why": "Strong reviews",
                    "area": "Makati",
                    "price_hint": "PHP 300-500",
                    "source_url": "https://example.com",
                    "confidence": 0.9,
                }
            ],
            "query": "ramen makati",
        }
        response = self.client.post("/api/ai-search/", {"query": "ramen makati"}, format="json")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("summary", data)
        self.assertIn("results", data)
        self.assertIn("remaining", data)
        self.assertEqual(data["results"][0]["name"], "Demo Ramen House")

    @patch("restaurants.views.run_grounded_food_search")
    def test_ai_search_quota_limit_blocks_extra_calls(self, mock_grounded):
        mock_grounded.return_value = {"summary": "ok", "results": [], "query": "test"}
        for _ in range(12):
            response = self.client.post("/api/ai-search/", {"query": "food qc"}, format="json")
            self.assertEqual(response.status_code, 200)

        blocked = self.client.post("/api/ai-search/", {"query": "food qc"}, format="json")
        self.assertEqual(blocked.status_code, 429)


class AiGroundedSearchParsingTests(TestCase):
    def test_ai_prompt_prioritizes_local_specialty_results(self):
        prompt = _build_prompt("best chicken in santa rosa laguna")

        self.assertIn("standout local or specialty spots", prompt)
        self.assertIn("generic chains", prompt)
        self.assertIn('"group": string', prompt)
        self.assertIn('"highlights": string', prompt)
        self.assertIn("Never use the summary as a result card", prompt)

    def test_extract_json_candidate_handles_fenced_json(self):
        text = """```json
{"summary":"ok","results":[{"name":"A"}]}
```"""
        parsed = _extract_json_candidate(text)
        self.assertIsInstance(parsed, dict)
        self.assertEqual(parsed.get("summary"), "ok")

    def test_extract_json_candidate_handles_embedded_json(self):
        text = 'Result:\\n{"summary":"ok","results":[{"name":"B"}]}\\nthanks'
        parsed = _extract_json_candidate(text)
        self.assertIsInstance(parsed, dict)
        self.assertEqual(parsed.get("summary"), "ok")

    def test_extract_plaintext_results_handles_numbered_lines(self):
        text = """Top places to try:
1. Ramen Nagi - Famous broth and reliable quality.
2. Ippudo - Great tonkotsu and side dishes.
3. Kyu Ramen: Budget-friendly bowls in town."""
        parsed = _extract_plaintext_results(text)
        self.assertIsInstance(parsed, dict)
        self.assertTrue(len(parsed.get("results", [])) >= 2)
        self.assertEqual(parsed["results"][0]["category"], "restaurant")

    def test_extract_json_like_results_handles_noisy_text(self):
        text = """
```json
"summary": "Top ramen in Santa Rosa",
"results": [
  "name": "Ramen Gami",
  "category": "Ramen Restaurant",
  "why": "Rich broth",
  "area": "Santa Rosa",
  "price_hint": "$$"
]
```"""
        parsed = _extract_json_like_results(text)
        self.assertIsInstance(parsed, dict)
        self.assertEqual(parsed.get("summary"), "Top ramen in Santa Rosa")
        self.assertGreaterEqual(len(parsed.get("results", [])), 1)

    def test_normalize_results_rejects_summary_as_restaurant_card(self):
        summary = (
            "Discover the top spots for chicken in Santa Rosa Laguna, from classic "
            "Filipino fried and grilled favorites to savory roasted options."
        )
        parsed = {
            "summary": summary,
            "results": [
                {
                    "name": summary,
                    "category": "restaurant",
                    "group": "Top Picks",
                    "highlights": summary,
                }
            ],
        }

        self.assertEqual(_normalize_results(parsed), [])

    @override_settings(GEMINI_API_KEY="demo-key", GEMINI_MODEL="demo-model")
    @patch("restaurants.services.ai_grounded_search._call_gemini")
    def test_grounded_search_repairs_when_parsed_rows_are_invalid(self, mock_call):
        bad_summary = "Discover the top spots for chicken in Santa Rosa Laguna."
        mock_call.side_effect = [
            {
                "candidates": [
                    {
                        "content": {
                            "parts": [
                                {
                                    "text": (
                                        '{"summary": "'
                                        + bad_summary
                                        + '", "results": [{"name": "'
                                        + bad_summary
                                        + '", "category": "restaurant", "highlights": "'
                                        + bad_summary
                                        + '"}]}'
                                    )
                                }
                            ]
                        }
                    }
                ]
            },
            {
                "candidates": [
                    {
                        "content": {
                            "parts": [
                                {
                                    "text": (
                                        '{"summary": "Best chicken picks in Santa Rosa.", '
                                        '"results": [{"name": "24 Chicken Balibago", '
                                        '"group": "Fried & Boneless Chicken", '
                                        '"category": "Chicken", '
                                        '"why": "Known for Korean-style boneless chicken.", '
                                        '"highlights": "Crunchy boneless chicken with saucy flavors.", '
                                        '"area": "Santa Rosa, Laguna", '
                                        '"rating_hint": "4.9", '
                                        '"review_hint": "492 reviews", '
                                        '"confidence": 0.9}]}'
                                    )
                                }
                            ]
                        }
                    }
                ]
            },
        ]

        payload = run_grounded_food_search("best chicken santa rosa repair test")

        self.assertEqual(payload["results"][0]["name"], "24 Chicken Balibago")
        self.assertEqual(mock_call.call_count, 2)


@override_settings(SECURE_SSL_REDIRECT=False)
class PageRoutesTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_favorites_page_renders(self):
        response = self.client.get("/favorites/")
        self.assertEqual(response.status_code, 200)

    def test_recent_page_renders(self):
        response = self.client.get("/recent/")
        self.assertEqual(response.status_code, 200)
