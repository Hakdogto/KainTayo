# Kain Tayo

Kain Tayo is a mobile-first Django restaurant discovery system. It helps users find food places through fast Smart Search, automatic Nearby discovery, and an AI Food Chat that uses Gemini plus Google Places fallback logic.

The system is built for practical restaurant discovery: users can search by dish, cuisine, budget, mood, rating, open-now status, and location. It supports local database restaurants, Google Places results, favorites, recent searches, PWA installation, and presentation-friendly detail pages.

## Main Features

- **Home page**
  - Automatically asks for browser location on load.
  - Shows nearby restaurants using the detected coordinates.
  - Supports manual location override.
  - Sends Home search query and manual location smoothly into Smart Search.

- **Smart Search**
  - Natural-language search for food and restaurants.
  - Parses budget, cuisine, mood, open-now intent, nearby intent, distance, and rating.
  - Combines local database restaurants with Google Places results.
  - Uses distance, rating, keyword match, filters, and optional semantic similarity for ranking.
  - Supports vertical results or horizontal swipe cards.
  - Persists result layout and restores search state after returning from detail pages.

- **Nearby**
  - Automatically detects the user location on page load.
  - Shows nearby local and Google Places restaurants.
  - Supports manual location override and paginated Load More.
  - Supports vertical or horizontal swipe result layout.

- **AI Food Chat**
  - Chat-style AI search page.
  - Calls the grounded AI endpoint only when the user sends a message.
  - Uses Gemini for grounded food suggestions.
  - Validates AI rows so summary text cannot become fake restaurant cards.
  - Retries malformed AI responses with a stricter repair prompt.
  - Falls back to Google Places if Gemini is unavailable or returns unusable rows.
  - Shows compact grouped recommendation cards with rating, price, category, area, address, hours, vibe, highlights, and source links.

- **Favorites and Recent Searches**
  - Session-aware support for anonymous users.
  - Supports both local restaurants and external Google Places favorites.
  - Recent searches store the raw query, parsed filters, coordinates, and timestamp.

- **Restaurant detail pages**
  - Local and external place details share one facts-first detail template.
  - External detail pages are populated from Google Places details.
  - Detail payloads focus on overview, facts, practical info, and action links.

- **PWA and cache freshness**
  - Web app manifest endpoint.
  - Service worker endpoint.
  - Network-first strategy for HTML so deployed UI updates are visible on normal refresh.
  - API routes and service worker script are excluded from runtime caching.
  - PWA install bar supports dismissal.

## Tech Stack

- Python 3.11
- Django 5.2
- Django REST Framework
- PostgreSQL on Render, SQLite fallback locally
- `pgvector` for restaurant embeddings and semantic ranking
- Google Places API for external restaurants, photos, place details, and location resolution
- Gemini API for AI intent parsing, embeddings, and grounded AI Food Chat
- WhiteNoise for static files
- Gunicorn for production serving
- Leaflet map UI with Mapbox token support and OpenStreetMap fallback

## Project Structure

- `ai_restaurant_finder/`
  - Django settings, WSGI/ASGI, and root URL include.
- `restaurants/`
  - Main app containing models, APIs, services, templates, static frontend code, tests, and migrations.
- `restaurants/services/`
  - Search parsing, AI search, Google Places, vector search, recommendations, distance logic, and detail payload builders.
- `restaurants/static/restaurants/js/`
  - Page-specific frontend logic for Home, Smart Search, Nearby, AI Chat, Favorites, Recent, and PWA behavior.
- `restaurants/templates/restaurants/`
  - Django templates for all pages.
- `render.yaml`
  - Render Blueprint configuration.
- `build.sh`
  - Production build command.
- `SystemInfo.md`
  - Full detailed technical guide and presentation reference.
- `SYSTEM_OVERVIEW.md`
  - Concise architecture and system flow overview.

## Key Pages

- Home: `/`
- Smart Search: `/search/`
- AI Food Chat: `/ai-search/`
- Nearby: `/nearby/`
- Favorites: `/favorites/`
- Recent Searches: `/recent/`
- Local restaurant detail: `/restaurant/<id>/`
- External Google Place detail: `/place/<place_id>/`

## API Surface

- `POST /api/search/`
  - Smart Search endpoint.
- `GET /api/nearby/`
  - Nearby restaurants endpoint with pagination.
- `POST /api/resolve-location/`
  - Resolves manual location text to coordinates.
- `GET /api/recommendations/`
  - Personalized recommendations based on favorites/history.
- `GET /api/history/`
  - Returns recent searches for the user/session.
- `DELETE /api/history/<id>/`
  - Deletes one recent search entry.
- `GET /api/favorites/`
  - Returns local and external favorites.
- `POST /api/favorites/add/`
  - Adds local restaurant or external Google Place favorite.
- `DELETE /api/favorites/<type>/<id>/`
  - Deletes a local or external favorite.
- `GET /api/place-photo/`
  - Proxies Google Places photo media.
- `POST /api/chat-assistant/`
  - Refines Smart Search queries based on assistant-like follow-up messages.
- `POST /api/ai-search/`
  - AI Food Chat endpoint.
- `GET /manifest.webmanifest`
  - PWA manifest.
- `GET /service-worker.js`
  - Service worker JavaScript.
- `GET /favicon.ico`
  - Redirects to the app icon.

## Smart Search Behavior

Smart Search receives a query and coordinates. The backend:

1. Validates the query and coordinates.
2. Parses the query through `parse_query()`, which may use Gemini intent parsing and falls back to deterministic parsing.
3. Filters local `Restaurant` rows by cuisine, budget, open-now, mood, and rating.
4. Optionally scores local rows with pgvector semantic similarity.
5. Fetches Google Places text-search results around the selected coordinates.
6. Computes distance with the Haversine formula.
7. Deduplicates local and external rows.
8. Scores each result by token match, cuisine, mood, open-now, budget, rating, distance, and semantic similarity.
9. Stores a `SearchHistory` row for the user/session.
10. Returns parsed filters, assistant chips, and the top ranked results.

## AI Food Chat Behavior

AI Food Chat is separate from Smart Search. It uses `/api/ai-search/` and keeps conversation history only in the current page session.

The backend AI flow:

1. Validates the query.
2. Checks daily AI quota and DRF throttle limits.
3. Calls Gemini with grounded search instructions and strict JSON requirements.
4. Parses strict JSON, JSON-like output, or plaintext lists.
5. Rejects invalid rows, including rows where the summary becomes a fake restaurant name.
6. Retries malformed responses with a repair prompt.
7. If Gemini still fails or produces no clean rows, resolves location hints and falls back to Google Places.
8. Converts Places rows into the same AI card schema.
9. Caches the response for 10 minutes.

The frontend AI flow:

1. User sends a message.
2. A user bubble appears.
3. A loading assistant bubble appears.
4. The endpoint returns a summary and grouped cards.
5. The loading bubble is replaced with the AI answer.
6. Errors appear as assistant-style chat bubbles.

## Browser Storage

- Shared tips dismissal:
  - `localStorage.kainTayoTipsDismissedV1`
- Home manual location handoff to Smart Search:
  - `sessionStorage.homeManualLocationForSearchV1`
- Smart Search state restore:
  - `sessionStorage.smartSearchStateV1`
  - `sessionStorage.smartSearchLastOpenedUrl`
- Smart Search layout:
  - `localStorage.smartSearchResultsLayoutV1`
- Nearby layout:
  - `localStorage.nearbyResultsLayoutV1`
- PWA install dismissal:
  - `localStorage.kainTayoPwaInstallDismissedV1`

## Local Development

### 1. Install dependencies

```bash
python -m pip install -r requirements.txt
```

### 2. Environment variables

Useful local values:

```bash
DEBUG=True
SECURE_SSL_REDIRECT=False
SECRET_KEY=local-dev-secret
ALLOWED_HOSTS=127.0.0.1,localhost
CSRF_TRUSTED_ORIGINS=http://127.0.0.1:8000,http://localhost:8000
```

Optional integrations:

- `DATABASE_URL`
- `MAPBOX_ACCESS_TOKEN`
- `GOOGLE_MAPS_API_KEY`
- `GEMINI_API_KEY`
- `GEMINI_MODEL`
- `GEMINI_EMBEDDING_MODEL`
- `VECTOR_SEARCH_ENABLED`
- `API_ANON_RATE_LIMIT`
- `API_USER_RATE_LIMIT`
- `API_AI_SEARCH_RATE_LIMIT`

### 3. Migrate and run

```bash
python manage.py migrate
python manage.py runserver
```

Optional embedding backfill:

```bash
python manage.py backfill_embeddings --only-missing
```

## Quality Checks

```bash
python manage.py check
python manage.py test
node --check restaurants/static/restaurants/js/ai_search.js
```

## Demo Checklist 

This is a quick, repeatable flow to demonstrate that the system is complete, stable, and includes voice + AI/pgvector value.

### Setup

```bash
python -m pip install -r requirements.txt
python manage.py migrate
python manage.py runserver
```

Then seed demo data (optional, for a consistent live demo):

```bash
curl -X POST http://127.0.0.1:8000/api/seed/
```

### Demo flow

- Home + nearby
  - Open `http://127.0.0.1:8000/`.
  - Allow location, or use the manual location fields.
  - Confirm nearby cards render and detail navigation works.

- Smart Search + voice (English/Filipino/Taglish)
  - Open `http://127.0.0.1:8000/search/`.
  - Tap the mic and try phrases like:
    - “samgyup malapit sa akin”
    - “ramen bukas ngayon”
    - “mas mura na korean food”
  - Confirm the query is normalized (e.g. “near me”, “open now”) and results appear.

- Favorites CRUD (create/read/update/delete)
  - From Search results, tap **Save**.
  - Visit `http://127.0.0.1:8000/favorites/`.
  - API checks (optional):

```bash
curl -s http://127.0.0.1:8000/api/favorites/
# Update an external favorite (PATCH):
# curl -X PATCH -H "Content-Type: application/json" -d '{"name":"Updated","rating":4.8}' http://127.0.0.1:8000/api/favorites/external/<id>/
# Delete:
# curl -X DELETE http://127.0.0.1:8000/api/favorites/external/<id>/
```

- Recent searches CRUD (create/read/update/delete)
  - Perform a few searches.
  - Visit `http://127.0.0.1:8000/recent/`.
  - API checks (optional):

```bash
curl -s http://127.0.0.1:8000/api/history/
# Update (PATCH):
# curl -X PATCH -H "Content-Type: application/json" -d '{"raw_query":"ramen near me open now"}' http://127.0.0.1:8000/api/history/<id>/
# Delete:
# curl -X DELETE http://127.0.0.1:8000/api/history/<id>/
```

- AI Food Chat (Gemini + grounded fallback)
  - Open `http://127.0.0.1:8000/ai-search/`.
  - Ask a grounded query like: “best chicken in Santa Rosa Laguna under 500”.
  - Confirm the response shows structured cards and the quota counter decreases.

## Deployment on Render

The project includes `render.yaml` and `build.sh`.

Render build:

```bash
sed -i 's/\r$//' build.sh && bash build.sh
```

Render start:

```bash
python manage.py migrate && gunicorn ai_restaurant_finder.wsgi:application
```

Required Render environment variables:

- `SECRET_KEY`
- `DEBUG=False`
- `DATABASE_URL`
- `ALLOWED_HOSTS`
- `CSRF_TRUSTED_ORIGINS`

Optional but recommended:

- `GOOGLE_MAPS_API_KEY`
- `GEMINI_API_KEY`
- `MAPBOX_ACCESS_TOKEN`

## More Documentation

- `SYSTEM_OVERVIEW.md` gives the concise architecture view.
- `SystemInfo.md` gives the detailed technical explanation and boss presentation guide.
