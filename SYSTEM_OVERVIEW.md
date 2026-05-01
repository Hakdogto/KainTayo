# System Overview

## System identity

- **Name:** Kain Tayo
- **Type:** AI-assisted restaurant discovery web app
- **Core experience:** Smart Search + AI Search with mobile-first UX

## Finalized architecture (high level)

Kain Tayo has two discovery paths:

1. **Smart Search** (`/search/`)
   - natural-language intent parsing
   - local DB + optional external place merge
   - semantic ranking (pgvector for local restaurants)
   - map and list rendering
2. **AI Search** (`/ai-search/`)
   - Gemini-based grounded suggestions
   - reliability fallback chain for model output variability
   - single-card recommendation UI for cleaner output

Supporting pages:

- Home (`/`)
- Nearby (`/nearby/`)
- Favorites (`/favorites/`)
- Recent (`/recent/`)
- Detail pages (`/restaurant/<id>/`, `/place/<place_id>/`)

## Data model and storage

- **Primary DB:** PostgreSQL (or SQLite locally when `DATABASE_URL` is missing)
- **ORM:** Django ORM
- **Vector extension:** `pgvector` in PostgreSQL

Key stored entities:

- Restaurants (with vector embeddings)
- Local favorites
- External place favorites
- Search history

Vector details:

- extension: `vector`
- embedding field: `Restaurant.embedding` (768 dims)
- similarity metric: cosine distance

## API and service layout

Core APIs:

- `POST /api/search/`
- `GET /api/nearby/`
- `POST /api/resolve-location/`
- `POST /api/ai-search/`
- `POST /api/chat-assistant/`
- favorites/history CRUD APIs
- `GET /manifest.webmanifest`
- `GET /service-worker.js`

Important service modules:

- `intent_parser.py` / `ai_intent.py` for query extraction
- `vector_search.py` for semantic similarity ranking
- `external_places.py` for external place fetches/photo proxy
- `ai_grounded_search.py` for resilient AI search parsing

## Smart Search flow

1. User submits query (text/voice/chip).
2. Query is parsed into filters (budget/cuisine/mood/open/rating/near me).
3. Local candidates are filtered and semantically scored.
4. External place candidates are fetched and merged.
5. Results are deduped and ranked by relevance + distance + rating.
6. Results and state are persisted in session storage for back-navigation restore.

## AI Search flow

1. User submits query manually (click-triggered).
2. Backend calls Gemini with staged request strategy.
3. Response parsing fallback chain:
   - strict JSON
   - JSON-like extraction
   - plaintext extraction
   - optional plaintext retry call
4. Normalized suggestions are returned and rendered in one clean card/list area.
5. Query responses are cached to reduce repeat latency and API cost.

## Performance and UX characteristics

- No unnecessary auto-triggered search calls on initial load.
- Cached external/AI lookups reduce repeated request time.
- Search state restoration includes query, filters, results, location, and form fields.
- Skeleton loading and smart empty-state suggestions improve perceived speed.
- Sticky mobile actions improve one-handed usability.
- Onboarding tips available on Home, Smart Search, and AI Search.

## Accessibility and PWA

- Skip-to-content and aria-live updates for search status.
- Keyboard and focus-friendly controls.
- PWA manifest + service worker baseline.
- Service worker strategy:
  - network-first for HTML
  - cache-first for static assets
  - API routes bypass cache

## Security and reliability

- DRF throttle controls (anon/user + scoped AI search throttle).
- Daily AI quota gate to protect usage.
- Input validation and coordinate bounds checks on APIs.
- Graceful degradation for map/provider failures.

## Development workflow note

- MCP (`user-lean-ctx`) is used during development only.
- Production runtime does not depend on MCP services.
