# SystemInfo

This document is the detailed technical guide for Kain Tayo. It explains the complete system logic, page behavior, backend flows, AI behavior, data model, browser state, deployment setup, and presentation points.

The goal is to make the system easy to understand for development, maintenance, and technical presentation.

## 1. System Summary

Kain Tayo is a restaurant discovery web application. It helps users answer practical food questions such as:

- "Where can I eat chicken near Santa Rosa?"
- "Quiet place in BGC under 1000"
- "Pizza nearby"
- "Korean restaurant open now"
- "Cheap burger near me"

The system has three discovery paths:

1. **Home discovery**
   - Automatically detects user location.
   - Shows nearby restaurants and quick search entry points.

2. **Smart Search**
   - Fast structured search using local database restaurants plus Google Places.
   - Best for direct user searches where the system should return ranked restaurant cards and map markers.

3. **AI Food Chat**
   - Chat-style AI experience.
   - Best for natural recommendation questions.
   - Uses Gemini first, validates AI output, repairs malformed responses, and falls back to Google Places if needed.

The system also includes:

- Nearby browsing.
- Favorites.
- Recent searches.
- Detail pages.
- PWA install support.
- Service worker caching.
- Deployment configuration for Render.

## 2. High-Level Architecture

Kain Tayo is a Django web application with server-rendered templates and JavaScript-powered interactive pages.

### Request Flow

1. Browser requests a page such as `/search/`.
2. Django renders the template.
3. The template loads page-specific JavaScript and shared CSS.
4. JavaScript handles interactions and calls API endpoints.
5. Django APIs process the request.
6. APIs return JSON.
7. JavaScript renders result cards, maps, status text, layout changes, and chat bubbles.

### Main Runtime Layers

- **Template layer**
  - Django templates in `restaurants/templates/restaurants/`.
  - Defines page structure and server-rendered initial content.

- **Frontend behavior layer**
  - JavaScript files in `restaurants/static/restaurants/js/`.
  - Handles browser geolocation, search forms, voice input, maps, cards, state restore, favorites, recent searches, and PWA install UI.

- **Backend API layer**
  - Django views in `restaurants/views.py`.
  - Exposes endpoints for search, nearby, AI search, favorites, history, location resolution, photos, manifest, and service worker.

- **Service layer**
  - Business logic modules in `restaurants/services/`.
  - Includes intent parsing, Gemini calls, Google Places calls, vector search, recommendations, distance calculations, and detail summaries.

- **Database layer**
  - Django ORM models in `restaurants/models.py`.
  - Stores local restaurants, history, favorites, external place favorites, and future user preferences.

## 3. Technology Stack

### Backend

- Python 3.11
- Django 5.2
- Django REST Framework
- Django ORM
- PostgreSQL in production
- SQLite fallback locally
- `pgvector` for embedding storage
- Gunicorn in production
- WhiteNoise for static file serving

### Frontend

- Django templates
- Vanilla JavaScript
- CSS in `styles.css`
- Leaflet map UI
- Browser Geolocation API
- Web Speech API for voice input where supported
- localStorage and sessionStorage for UX continuity

### External APIs

- Google Places API
  - Text search
  - Place details
  - Place photos
  - Location text resolution
- Gemini API
  - AI intent parsing
  - Embeddings
  - Grounded AI Food Chat

### Deployment

- Render
- `render.yaml`
- `build.sh`
- WhiteNoise static collection
- PostgreSQL via `DATABASE_URL`

## 4. Project Folder Map

### Root

- `README.md`
  - Quick developer guide and feature summary.
- `SYSTEM_OVERVIEW.md`
  - Concise architecture overview.
- `SystemInfo.md`
  - This full technical and presentation guide.
- `manage.py`
  - Django command entry point.
- `requirements.txt`
  - Python dependencies.
- `render.yaml`
  - Render Blueprint.
- `build.sh`
  - Render build script.
- `db.sqlite3`
  - Local SQLite database when no `DATABASE_URL` is configured.

### `ai_restaurant_finder/`

- `settings.py`
  - Django, database, REST framework, static files, external API keys, security, and deployment settings.
- `urls.py`
  - Routes root URLs into `restaurants.urls`.
- `wsgi.py` and `asgi.py`
  - Production/application entry points.

### `restaurants/`

- `models.py`
  - Database models.
- `serializers.py`
  - API serializers.
- `views.py`
  - Page views and API endpoints.
- `urls.py`
  - Page and API routes.
- `tests.py`
  - Unit/API tests.
- `services/`
  - Search, AI, Google Places, embeddings, recommendations, geo, and detail logic.
- `templates/restaurants/`
  - HTML templates.
- `static/restaurants/js/`
  - Frontend page logic.
- `static/restaurants/css/styles.css`
  - Global styling and responsive UI.
- `management/commands/backfill_embeddings.py`
  - Embedding generation command.

## 5. Data Model and Database Logic

### Restaurant

`Restaurant` is the local database restaurant model.

Important fields:

- `name`
  - Restaurant name.
- `cuisine`
  - Main cuisine/category.
- `mood_tags`
  - Comma-like text tags such as quiet, date, family, group, casual.
- `description`
  - Searchable description.
- `price_level`
  - 1 to 4 style price tier.
- `average_cost_for_two`
  - Used for budget filtering.
- `rating`
  - Used for ranking and display.
- `is_open_now`
  - Used for open-now filtering.
- `latitude`, `longitude`
  - Used for distance calculations and map markers.
- `address`
  - Display and search text.
- `embedding`
  - 768-dimensional vector for semantic ranking.

Indexes:

- `cuisine`
- `is_open_now`
- descending `rating`
- `average_cost_for_two`

These support common Smart Search filters and ranking.

### SearchHistory

Stores recent searches.

Fields:

- `user`
  - Authenticated user when available.
- `session_key`
  - Anonymous session fallback.
- `raw_query`
  - Original search text.
- `interpreted_filters`
  - Parsed query filters as JSON.
- `latitude`, `longitude`
  - Search coordinates.
- `searched_at`
  - Timestamp.

Recent searches are scoped by authenticated user or session key.

### FavoriteRestaurant

Stores favorites for local database restaurants.

Important behavior:

- Supports logged-in users.
- Supports anonymous users through `session_key`.
- Unique constraints prevent duplicate favorites per actor.

### FavoriteExternalPlace

Stores favorites for Google Places results.

Fields include:

- `place_id`
- `name`
- `cuisine`
- `address`
- `detail_url`
- `rating`
- `user` or `session_key`

This model exists because Google Places results are not stored in the `Restaurant` table.

### UserPreference

Stores future preference profile fields:

- preferred cuisines
- max budget
- vibe

The current recommendation service primarily uses favorites and history, but this model is available for future personalization.

## 6. Backend Routing and API Surface

Routes are defined in `restaurants/urls.py`.

### Page Routes

- `/`
  - Home page.
- `/search/`
  - Smart Search.
- `/ai-search/`
  - AI Food Chat.
- `/nearby/`
  - Nearby restaurants.
- `/favorites/`
  - Favorites.
- `/recent/`
  - Recent searches.
- `/restaurant/<id>/`
  - Local restaurant detail.
- `/place/<place_id>/`
  - External Google Place detail.

### API Routes

- `POST /api/search/`
  - Main Smart Search API.
- `GET /api/nearby/`
  - Nearby API.
- `POST /api/resolve-location/`
  - Manual location resolution.
- `GET /api/recommendations/`
  - Personalized local recommendations.
- `GET /api/history/`
  - Recent search list.
- `DELETE /api/history/<id>/`
  - Delete a recent search.
- `GET /api/favorites/`
  - Favorite list.
- `POST /api/favorites/add/`
  - Add favorite.
- `DELETE /api/favorites/<type>/<id>/`
  - Delete favorite.
- `GET /api/place-photo/`
  - Proxy Google Place photo.
- `POST /api/chat-assistant/`
  - Smart Search refinement assistant.
- `POST /api/ai-search/`
  - AI Food Chat API.
- `POST /api/seed/`
  - Demo data seed endpoint.

### PWA Routes

- `/manifest.webmanifest`
- `/service-worker.js`
- `/favicon.ico`

## 7. Page-by-Page System Logic

### Home Page

Template:

- `restaurants/templates/restaurants/home.html`

Frontend:

- `restaurants/static/restaurants/js/home.js`

Backend:

- `home_page()` in `views.py`
- `/api/nearby/`
- `/api/resolve-location/`

Flow:

1. Django renders Home with initial nearby/trending server data.
2. `home.js` runs on page load.
3. It calls `detectHomeLocation()`.
4. Browser asks for geolocation permission.
5. If allowed:
   - coordinates are captured.
   - `/api/nearby/` loads nearby restaurants.
   - the nearby cards update.
6. If denied/unavailable:
   - system falls back to Metro Manila coordinates.
7. Manual location form can resolve country/region/city through `/api/resolve-location/`.
8. When manual location resolves:
   - nearby cards refresh.
   - location data is saved into `sessionStorage.homeManualLocationForSearchV1`.
9. When user searches from Home:
   - query goes to `/search/?q=<query>`.
   - Smart Search reads the query and handed-off manual location.

Important Home behavior:

- Quick chips submit exact label-style queries.
- Tips can be dismissed and stay hidden.
- Manual location is available but visually secondary.

### Smart Search Page

Template:

- `restaurants/templates/restaurants/search.html`

Frontend:

- `restaurants/static/restaurants/js/search.js`

Backend:

- `smart_search_api()` in `views.py`

Flow:

1. User arrives at `/search/`.
2. If URL has `q`, that query wins over restored session state.
3. If Home saved manual location, Smart Search applies it and does not overwrite it with auto-detect.
4. Otherwise Smart Search can auto-detect location.
5. User submits query by button, Enter, voice, or chip.
6. Frontend calls `POST /api/search/`.
7. Backend parses, filters, merges, ranks, saves history, and returns results.
8. Frontend renders:
   - parsed filters
   - result cards
   - map markers
   - assistant chips
   - empty states when needed
9. Result layout can be vertical or swipe.
10. Search state is stored so users can open a detail page and return without losing results.

### Nearby Page

Template:

- `restaurants/templates/restaurants/nearby.html`

Frontend:

- `restaurants/static/restaurants/js/nearby.js`

Backend:

- `nearby_restaurants_api()` in `views.py`

Flow:

1. Nearby page opens.
2. `detectLocation()` runs automatically.
3. If geolocation succeeds, the current coordinates become the user location.
4. If it fails, the page falls back gracefully.
5. Frontend calls `/api/nearby/?latitude=...&longitude=...&limit=...&offset=...`.
6. Backend combines local open restaurants and Google Places.
7. Results are sorted by distance and rating.
8. Frontend renders cards and map markers.
9. Load More uses the returned pagination `next_offset`.
10. Layout toggle switches between vertical and horizontal swipe.

### AI Food Chat Page

Template:

- `restaurants/templates/restaurants/ai_search.html`

Frontend:

- `restaurants/static/restaurants/js/ai_search.js`

Backend:

- `ai_grounded_search_api()` in `views.py`
- `run_grounded_food_search()` in `ai_grounded_search.py`

Flow:

1. Page renders a chat shell.
2. Initial assistant welcome bubble appears.
3. User enters a natural language food question.
4. Frontend appends a user bubble.
5. Frontend appends a typing/loading assistant bubble.
6. Frontend posts to `/api/ai-search/`.
7. Backend checks quota and throttle.
8. Backend runs Gemini grounded search.
9. Backend validates the response and repairs/falls back if needed.
10. Frontend replaces loading bubble with:
    - short summary
    - grouped recommendation cards
11. Errors show as assistant-style error bubbles.

AI Chat memory:

- The `messages` array is page-local only.
- Refreshing the page clears conversation memory.

### Favorites Page

Template:

- `restaurants/templates/restaurants/favorites.html`

Frontend:

- `restaurants/static/restaurants/js/favorites.js`

Backend:

- `favorites_api()`
- `add_favorite_api()`
- `delete_favorite_api()`

Flow:

1. Page loads.
2. JS fetches `/api/favorites/`.
3. Backend reads favorites for user or session.
4. Local and external favorites are merged and sorted by creation time.
5. Frontend renders cards.
6. Delete button calls the delete API.

### Recent Searches Page

Template:

- `restaurants/templates/restaurants/recent.html`

Frontend:

- `restaurants/static/restaurants/js/recent.js`

Backend:

- `history_api()`
- `delete_history_item_api()`

Flow:

1. Page loads.
2. JS fetches `/api/history/`.
3. Backend returns latest five searches for user/session.
4. User can delete individual history rows.

### Detail Pages

Template:

- `restaurants/templates/restaurants/restaurant_detail.html`

Backend:

- `restaurant_detail_page()`
- `place_detail_page()`
- `build_smart_detail_payload()`

Local detail flow:

1. URL `/restaurant/<id>/`.
2. Backend loads `Restaurant`.
3. Serializer converts it to data.
4. `build_smart_detail_payload()` creates practical display sections.
5. Template renders facts and actions.

External detail flow:

1. URL `/place/<place_id>/`.
2. Backend calls Google Places details API.
3. Response is normalized.
4. `build_smart_detail_payload()` creates the same display structure.
5. Template renders the same detail UI.

## 8. Smart Search Technical Flow

Smart Search is the main deterministic search engine.

Endpoint:

- `POST /api/search/`

Input:

- `query`
- `latitude`
- `longitude`
- optional `semantic`

### Step 1: Query Validation

`_clean_query()`:

- converts raw input to string
- trims whitespace
- rejects empty query
- rejects query longer than `MAX_QUERY_LENGTH` of 220 characters

Coordinates are validated with `_safe_float()`:

- latitude clamped from -90 to 90
- longitude clamped from -180 to 180

### Step 2: Intent Parsing

`parse_query()` is called from `services/ai_intent.py`.

Parsing strategy:

1. Try Gemini intent parsing if available.
2. Convert Gemini JSON into `QueryFilters`.
3. If Gemini fails, use deterministic parser from `intent_parser.py`.

`QueryFilters` can contain:

- `budget`
- `cuisine`
- `mood`
- `open_now`
- `near_me`
- `max_distance_km`
- `min_rating`

### Step 3: Local Database Filtering

The backend starts with all `Restaurant` rows.

Filters:

- cuisine:
  - `cuisine__icontains`
  - `name__icontains`
- budget:
  - `average_cost_for_two <= parsed.budget`
- open now:
  - `is_open_now=True`
- mood:
  - `mood_tags__icontains`
  - `description__icontains`
- rating:
  - `rating >= parsed.min_rating`

### Step 4: Semantic Ranking

If semantic search is enabled:

- `rank_restaurants_semantic()` runs.
- It embeds the query using Gemini embeddings.
- It compares query embedding against stored `Restaurant.embedding`.
- It returns similarity scores per restaurant ID.

Semantic scores affect ranking but do not replace structured filters.

### Step 5: Distance Calculation

For each local result:

- distance from search coordinates to restaurant coordinates is computed through `haversine_km()`.
- distance is stored as `distance_km`.

If `near_me` is active:

- results farther than max distance are excluded.
- max distance is capped by `MAX_SEARCH_RADIUS_KM`.

### Step 6: Google Places Merge

`search_google_places()` runs a Places Text Search around the selected coordinates.

It uses:

- query text
- parsed cuisine
- parsed mood
- parsed budget as Google `priceLevels`
- parsed open-now flag
- location bias radius

External results are normalized into restaurant-like dictionaries.

### Step 7: Deduplication

Local and external rows are deduplicated by:

- normalized name
- rounded latitude
- rounded longitude

If there is a duplicate, Google Places can replace the local row when it has fresher place data.

### Step 8: Scoring

`_search_relevance_score()` calculates result score.

Signals:

- keyword hits in name, cuisine, address, description
- cuisine match
- mood match
- open-now match
- budget match
- rating
- distance
- semantic similarity

Sort order:

1. higher relevance score
2. shorter distance
3. higher rating

### Step 9: History

Each Smart Search creates a `SearchHistory` row with:

- user or session
- raw query
- interpreted filters
- coordinates

### Step 10: Response

Response contains:

- `query`
- `parsed_filters`
- `semantic_enabled`
- `assistant`
- `results`

The assistant object contains:

- explanation of how the match worked
- refinement chips such as open now, closer, cheaper, higher rated

## 9. AI Food Chat Technical Flow

AI Food Chat is designed to feel like a short Google AI-style answer.

Endpoint:

- `POST /api/ai-search/`

Important files:

- `restaurants/static/restaurants/js/ai_search.js`
- `restaurants/services/ai_grounded_search.py`
- `ai_grounded_search_api()` in `views.py`

### Frontend Chat Flow

1. User types a message.
2. `runAiSearch()` validates at least 4 characters.
3. It enforces a local minimum gap between requests.
4. It appends a user bubble.
5. It clears the composer.
6. It disables send and voice buttons.
7. It appends a loading assistant bubble.
8. It posts JSON to `/api/ai-search/`.
9. On success, it renders assistant summary and cards.
10. On failure, it renders an assistant error bubble.

The frontend does not auto-submit voice input. Voice fills the composer.

### Backend AI Quota

`_ai_quota_ok()`:

- scopes by user ID if authenticated
- scopes by session key if anonymous
- allows 12 AI searches per day
- stores count in cache for 24 hours

DRF also applies `AISearchRateThrottle` with scope `ai_search`.

### Gemini Grounded Search

`run_grounded_food_search()` builds a cache key using:

- AI cache version
- query
- location hint
- SHA-256 fingerprint

Cache duration:

- 10 minutes

Gemini attempt strategy:

1. `google_search` tool with strict JSON
2. `google_search_retrieval`
3. model call without tools

### AI Prompt Contract

The prompt asks Gemini to return JSON only:

- `summary`
- `results`

Each result may include:

- `name`
- `group`
- `category`
- `why`
- `vibe`
- `highlights`
- `area`
- `address`
- `rating_hint`
- `review_hint`
- `hours_hint`
- `price_hint`
- `source_url`
- `confidence`

The prompt explicitly says:

- result names must be real business/place names
- not headings
- not descriptions
- not summaries
- never use the summary as a result card

### Parsing and Validation

Parser chain:

1. `_extract_json_candidate()`
   - direct JSON parse
   - embedded JSON object
   - embedded JSON array
2. `_extract_json_like_results()`
   - loose extraction for near-JSON model output
3. `_extract_plaintext_results()`
   - numbered/plaintext fallback

Validation:

- `_valid_business_row()` rejects:
  - missing names
  - generic names like restaurant, food, chicken, top picks
  - summary-like names
  - heading/category rows
  - rows with no useful details
  - rows where `why` and `highlights` are summary-like

Normalization:

- `_normalize_results()` bounds text lengths.
- clamps confidence between 0 and 1.
- returns clean card rows.

### Repair Prompt

If the parsed result is missing or all rows are invalid:

- backend calls Gemini again with `_build_repair_request_payload()`
- repair prompt is stricter
- output must be valid JSON only
- result names must be real food businesses

### Google Places Fallback

If Gemini is unavailable, malformed, or invalid after repair:

1. `_places_payload()` runs.
2. Query is parsed with `parse_natural_query()`.
3. `_resolve_fallback_location()` tries:
   - provided `location_hint`
   - known aliases such as BGC, Makati, Santa Rosa Laguna, Nuvali, QC
   - simple location phrase extraction such as "in BGC"
   - Metro Manila fallback
4. `search_google_places()` fetches Places results.
5. Places rows are converted into AI card schema.
6. Summary is generated based on query type.

This is why AI Chat can still answer a query like:

```text
quiet place in bgc under 1000
```

even if Gemini grounding fails.

### AI Card Grouping

The backend or fallback may assign groups such as:

- Quiet Work Cafes
- Lounges & Hotel Cafes
- Calm Casual Restaurants
- Fried & Boneless Chicken
- Wings & Casual Hangouts
- Budget-Friendly Picks
- Top Picks

Frontend groups cards by `group`.

### AI Frontend Fake-Card Protection

`ai_search.js` also filters rows.

It rejects:

- empty names
- generic names
- summary-like names
- names longer than normal business-name patterns
- rows without useful supporting details

This creates a second safety layer even if the backend response is imperfect.

## 10. Location and Nearby Logic

### Browser Geolocation

Home and Nearby request browser geolocation on page load.

If user accepts:

- browser returns latitude and longitude.
- frontend loads nearby data.

If user denies or browser fails:

- frontend falls back to default Metro Manila coordinates.
- UI shows friendly fallback status.

### Manual Location

Manual location fields collect:

- country
- region
- city

Frontend posts to:

- `POST /api/resolve-location/`

Backend uses:

- `resolve_location_text()`

Resolution strategy:

1. Google Places Text Search if `GOOGLE_MAPS_API_KEY` exists.
2. OpenStreetMap Nominatim fallback when no Google key is configured.

Response:

- latitude
- longitude
- label

### Home to Smart Search Handoff

When Home manual location resolves:

- frontend saves it in `sessionStorage.homeManualLocationForSearchV1`

Smart Search reads it through:

- `applyHomeManualLocation()`

The saved Home location includes:

- latitude
- longitude
- label
- typed country/region/city

This avoids making the user enter location again after moving from Home to Smart Search.

### Nearby API

`GET /api/nearby/` accepts:

- latitude
- longitude
- limit
- offset

It returns:

- results
- pagination data

Nearby combines:

- open local restaurants
- Google Places "restaurants near me"

Then sorts by:

1. distance
2. rating

## 11. Favorites and Recent Searches

### Actor Logic

`_actor_filter()` decides who owns data:

- authenticated user:
  - filter by `user`
- anonymous visitor:
  - create/use Django session
  - filter by `session_key`

This allows favorites and history to work without login.

### Favorites

There are two favorite types:

1. local
   - stored in `FavoriteRestaurant`
   - points to a `Restaurant`
2. external
   - stored in `FavoriteExternalPlace`
   - stores Google `place_id` and display info

Add favorite API:

- accepts `restaurant_id` for local
- accepts `place_id` for external

Delete favorite API:

- route includes favorite type and ID.

### Recent Searches

Smart Search stores search history automatically.

Recent page:

- fetches latest entries from `/api/history/`
- displays query and filters
- supports delete

## 12. Detail Pages

Detail pages are facts-first and avoid repetitive AI-like descriptions.

### Local Restaurant Detail

Route:

- `/restaurant/<id>/`

Flow:

1. Load `Restaurant`.
2. Serialize it.
3. Build smart detail payload.
4. Render detail template.

### External Place Detail

Route:

- `/place/<place_id>/`

Flow:

1. Call Google Places details endpoint.
2. Normalize Google response.
3. Build smart detail payload.
4. Render same detail template.

### Smart Detail Payload

`build_smart_detail_payload()` creates:

- overview
- facts
- practical info
- action links

It includes fields such as:

- rating
- open status
- category/cuisine
- price
- address
- phone
- website
- maps/directions

## 13. Frontend State, Storage, and UX Logic

### Shared Tips

Tips dismissal key:

- `kainTayoTipsDismissedV1`

Used by:

- Home
- Smart Search
- AI Search

Clicking X, Got it, or Maybe later hides tips permanently until localStorage is cleared.

### Smart Search State Restore

Keys:

- `smartSearchStateV1`
- `smartSearchLastOpenedUrl`

Stored state includes:

- query
- parsed filters
- results
- coordinates
- manual location fields
- last opened detail URL

Purpose:

- preserve results after user opens a detail page and comes back.

### Layout Toggles

Smart Search:

- `smartSearchResultsLayoutV1`

Nearby:

- `nearbyResultsLayoutV1`

Values:

- `vertical`
- `swipe`

Vertical uses normal list/grid behavior. Swipe uses a horizontally scrollable row with card snap behavior.

### PWA Install Dismissal

Key:

- `kainTayoPwaInstallDismissedV1`

If dismissed:

- custom install bar stays hidden.

### Voice Input

Voice input uses:

- `window.SpeechRecognition`
- `window.webkitSpeechRecognition`

If unsupported:

- voice button is disabled.

Voice input fills the text field but does not automatically submit.

## 14. PWA, Service Worker, and Cache Freshness

### Manifest

Route:

- `/manifest.webmanifest`

It returns:

- app name
- short name
- start URL
- theme colors
- SVG icon

### Service Worker

Route:

- `/service-worker.js`

It is generated by Django.

Headers:

- `Cache-Control: no-cache, no-store, must-revalidate`
- `Pragma: no-cache`
- `Expires: 0`
- `Service-Worker-Allowed: /`

### Cache Strategy

Static cache:

- `kain-tayo-static-v3`

Runtime cache:

- `kain-tayo-runtime-v3`

Rules:

- only cache GET requests
- only same-origin requests
- ignore non-http and non-https schemes
- skip `/api/`
- skip `/service-worker.js`
- only cache successful basic responses

HTML:

- network first
- fallback to cache if offline

Other cacheable assets:

- cache first
- fetch and cache when missing

This avoids stale HTML after deployment while keeping PWA/offline basics.

## 15. External Integrations

### Google Places

Implemented in:

- `external_places.py`

Functions:

- `search_google_places()`
- `get_place_details()`
- `fetch_place_photo()`
- `resolve_location_text()`

Google Places is used by:

- Smart Search
- Nearby
- external detail pages
- manual location resolution
- AI Food Chat fallback

### Gemini

Used by:

- `ai_intent.py`
  - structured intent parsing
- `vector_search.py`
  - embeddings
- `ai_grounded_search.py`
  - AI Food Chat

Gemini failures are handled gracefully with deterministic parsing or Google Places fallback depending on feature.

### OpenStreetMap Nominatim

Used only as a location-resolution fallback when Google Maps API key is missing.

## 16. Deployment and Environment Variables

### Render

`render.yaml` defines:

- web service
- Python runtime
- build command
- start command
- PostgreSQL database

Build command:

```bash
sed -i 's/\r$//' build.sh && bash build.sh
```

Start command:

```bash
python manage.py migrate && gunicorn ai_restaurant_finder.wsgi:application
```

### Build Script

`build.sh`:

```bash
pip install -r requirements.txt
python manage.py collectstatic --no-input
```

### Important Environment Variables

Core:

- `SECRET_KEY`
- `DEBUG`
- `DATABASE_URL`
- `ALLOWED_HOSTS`
- `CSRF_TRUSTED_ORIGINS`
- `DJANGO_SETTINGS_MODULE`

External services:

- `GOOGLE_MAPS_API_KEY`
- `GEMINI_API_KEY`
- `GEMINI_MODEL`
- `GEMINI_EMBEDDING_MODEL`
- `MAPBOX_ACCESS_TOKEN`

Feature/rate settings:

- `VECTOR_SEARCH_ENABLED`
- `API_ANON_RATE_LIMIT`
- `API_USER_RATE_LIMIT`
- `API_AI_SEARCH_RATE_LIMIT`
- `SECURE_SSL_REDIRECT`
- `SECURE_HSTS_SECONDS`

## 17. Security, Rate Limits, and Reliability

### Security Settings

Production enables:

- secure cookies
- HTTP-only session cookie
- CSRF cookie for frontend API use
- HSTS when not in debug
- X-Frame-Options deny
- content type sniffing protection
- same-origin referrer policy

### API Guardrails

- query required
- max query length
- coordinate bounds
- favorite type validation
- idempotent favorite creation
- 404 behavior for missing detail/favorite/history records

### AI Guardrails

- DRF scoped throttle
- daily AI quota
- response cache
- fake-card validation
- repair prompt
- Google Places fallback
- frontend row filtering

### Cache Guardrails

- service worker does not cache APIs
- service worker ignores cross-origin and extension schemes
- service worker script is never cached by itself
- AI cache version can be bumped to invalidate stale AI responses

## 18. Testing and Quality Checks

Tests live in:

- `restaurants/tests.py`

Current coverage includes:

- intent parser typos and nearby parsing
- favorites idempotency
- external favorite idempotency
- Smart Search API behavior
- AI Search API structured payload
- AI quota blocking
- AI JSON parsing
- AI plaintext parsing
- AI fake-card rejection
- AI repair prompt behavior
- AI Google Places fallback
- page route rendering for Favorites and Recent

Recommended checks:

```bash
python manage.py check
python manage.py test
node --check restaurants/static/restaurants/js/ai_search.js
```

Deployment check:

```bash
python manage.py check --deploy
```

## 19. Presentation Guide: How to Explain the System

### Short Business Explanation

Kain Tayo helps users find restaurants faster by combining location, natural language search, map-based nearby discovery, and AI-powered recommendations.

Instead of forcing users to use rigid filters, the system understands queries like:

- "quiet place in BGC under 1000"
- "best chicken in Santa Rosa Laguna"
- "pizza near me"
- "Korean open now under 500"

It then returns practical restaurant cards with location, rating, budget, and action links.

### Technical Flow to Present

1. User opens the app.
2. Browser location is requested.
3. Home/Nearby can immediately show nearby places.
4. In Smart Search, the query is parsed into filters.
5. The backend searches both local database restaurants and Google Places.
6. Results are ranked by relevance, distance, rating, filters, and semantic similarity.
7. In AI Chat, Gemini generates a short recommendation answer.
8. The system validates AI output so fake recommendations do not appear.
9. If AI fails, Google Places fallback still returns real restaurant cards.
10. Users can save favorites, review recent searches, and open detail pages.

### Technical Strengths to Highlight

- Hybrid search:
  - local database plus live Google Places.
- AI with guardrails:
  - validation, repair, fallback.
- Mobile-first UX:
  - automatic location, swipe cards, PWA install.
- Practical persistence:
  - favorites and history for logged-in or anonymous sessions.
- Deployment-ready:
  - Render config, WhiteNoise, PostgreSQL support.
- Reliability:
  - API throttling, daily AI quota, cache strategy, graceful fallbacks.

### Demo Script

1. Open Home.
2. Show auto-location and nearby cards.
3. Search `chicken`.
4. Show Smart Search results and map.
5. Switch vertical to swipe layout.
6. Open a detail page and show facts-first information.
7. Return to Smart Search and show restored results.
8. Open AI Food Chat.
9. Ask `quiet place in bgc under 1000`.
10. Explain Gemini plus Google Places fallback.
11. Save a favorite.
12. Open Favorites and Recent.
13. Mention PWA install and cache freshness.

## 20. Known Limitations and Future Enhancements

### Current Limitations

- Google Places and Gemini quality depend on external API availability and quota.
- AI Chat conversation memory is page-local only and clears on refresh.
- Anonymous favorites/history are tied to browser session.
- Local restaurant inventory quality depends on seeded/admin-entered data.
- Review count is not always available in current Places search field mask.
- PWA offline mode is basic and focuses on shell/cache behavior, not full offline search.

### Future Enhancements

- User accounts with persistent cross-device favorites.
- More advanced personalization using `UserPreference`.
- Admin dashboard for restaurant quality control.
- Stronger analytics for popular searches and conversion.
- Better AI result sourcing and cited snippets.
- Full offline favorites/recent support.
- More granular AI budgets and cuisine controls.
- Richer Google Places fields such as review count and opening hours when cost allows.
- Background jobs for embedding backfill and periodic local data refresh.
