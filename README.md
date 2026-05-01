# Kain Tayo

Kain Tayo is a Django restaurant discovery app with two search modes:

- **Smart Search** (fast local + external restaurant matching)
- **AI Search** (Gemini-grounded food-place suggestions)

It is optimized for mobile, supports voice input, and includes PWA foundations.

## Product overview

Kain Tayo helps users find places to eat with:

- natural-language query parsing (`budget`, `cuisine`, `mood`, `open now`, `near me`, rating)
- hybrid ranking (intent + semantic similarity + rating + distance)
- nearby browsing with optional location resolution
- separate pages for **Favorites** and **Recent Searches**
- restaurant detail pages with structured summaries
- onboarding tips and accessibility-first UX touches
- session-based state restore when navigating back from details

## What is finalized

- Strict click-triggered API behavior on key pages (no wasteful auto-search calls)
- Dedicated pages:
  - `/search/` (Smart Search)
  - `/ai-search/` (AI Search)
  - `/favorites/`
  - `/recent/`
- AI reliability hardening:
  - multiple Gemini request strategies
  - structured parsing fallbacks (JSON, JSON-like, plaintext)
  - clean single-card AI result rendering
- PWA baseline:
  - manifest endpoint
  - service worker endpoint
  - static app icon
- Lighthouse/UX improvements:
  - reduced render blocking
  - skip link + live region updates
  - skeleton loading + smart empty-state chips
  - sticky mobile action bar

## Tech stack

- Python 3.11
- Django 5.2
- Django REST Framework
- PostgreSQL (`dj-database-url`)
- `pgvector` for semantic search
- Gunicorn
- WhiteNoise (static serving)
- Leaflet map UI with Mapbox token support (OpenStreetMap fallback)

## Project structure

- `ai_restaurant_finder/` Django project settings and root routes
- `restaurants/` core app (models, APIs, services, templates, static)
- `render.yaml` Render Blueprint config
- `build.sh` production build steps

## Key pages

- Home: `/`
- Smart Search: `/search/`
- AI Search: `/ai-search/`
- Nearby: `/nearby/`
- Favorites: `/favorites/`
- Recent: `/recent/`
- Local detail: `/restaurant/<id>/`
- External place detail: `/place/<place_id>/`

## API surface

- Smart Search: `POST /api/search/`
- Nearby: `GET /api/nearby/`
- Resolve Location: `POST /api/resolve-location/`
- AI Search: `POST /api/ai-search/`
- Chat Assistant (query refinement): `POST /api/chat-assistant/`
- Favorites:
  - `GET /api/favorites/`
  - `POST /api/favorites/add/`
  - `DELETE /api/favorites/<type>/<id>/`
- Search History:
  - `GET /api/history/`
  - `DELETE /api/history/<id>/`
- Place Photo Proxy: `GET /api/place-photo/`
- Manifest: `GET /manifest.webmanifest`
- Service Worker: `GET /service-worker.js`

## AI search behavior

AI Search is tuned for reliability and cleaner output:

- Gemini request attempts:
  1. `google_search` tool + strict JSON
  2. `google_search_retrieval`
  3. model call without tools
- Parser fallback chain:
  1. strict JSON
  2. JSON-like field extraction
  3. plaintext list extraction
  4. final fallback message
- Cached grounded responses for repeated queries (10 minutes)
- Quota and throttling guardrails to reduce abuse and cost

## Local development

### 1) Install dependencies

```bash
python -m pip install -r requirements.txt
```

### 2) Environment variables

Required for local app startup:

- `DEBUG=True`
- `SECURE_SSL_REDIRECT=False`
- `SECRET_KEY=<local-secret>`
- `ALLOWED_HOSTS=127.0.0.1,localhost`
- `CSRF_TRUSTED_ORIGINS=http://127.0.0.1:8000,http://localhost:8000`

Optional integrations:

- `DATABASE_URL` (falls back to SQLite)
- `MAPBOX_ACCESS_TOKEN`
- `GOOGLE_MAPS_API_KEY`
- `GEMINI_API_KEY`
- `GEMINI_MODEL`
- `GEMINI_EMBEDDING_MODEL` (default `text-embedding-004`)
- `VECTOR_SEARCH_ENABLED` (default `True`)
- `API_ANON_RATE_LIMIT`
- `API_USER_RATE_LIMIT`
- `API_AI_SEARCH_RATE_LIMIT`

### 3) Migrate and run

```bash
python manage.py migrate
python manage.py backfill_embeddings --only-missing
python manage.py runserver
```

## Quality checks

Run tests:

```bash
python manage.py test
```

Deployment check:

```bash
python manage.py check --deploy
```

## Deployment (Render)

Configured with:

- `render.yaml`
- `build.sh`

Render flow:

- build installs dependencies and collects static files
- start runs migrations, then Gunicorn

Set env vars in Render:

- `SECRET_KEY`
- `DEBUG=False`
- `ALLOWED_HOSTS`
- `CSRF_TRUSTED_ORIGINS`
- `DATABASE_URL`
- optional map/AI keys

## Security and reliability notes

- DRF throttling enabled (anon/user + scoped AI search throttling)
- secure headers/cookies enabled for production
- input/query validation and coordinate bounds checks in APIs
- idempotent favorite creation per actor/session
- graceful fallbacks for map script issues and AI format drift

## Performance notes

- cached Google Places search responses (10 min)
- cached Google Place details (24h)
- cached location resolve responses (6h)
- cached AI grounded query responses (10 min)
- DB indexes on common filter/sort fields:
  - `cuisine`
  - `is_open_now`
  - `rating` (desc)
  - `average_cost_for_two`

## PWA notes

- manifest endpoint serves `application/manifest+json`
- service worker uses:
  - network-first for HTML
  - cache-first for static assets
  - API routes excluded from cache

## MCP note

MCP usage (`user-lean-ctx`) is for development workflow only.  
Runtime deployment does not require MCP servers.
