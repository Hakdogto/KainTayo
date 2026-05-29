# Rubric-Ready Session Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build no-login session-based Saved Places CRUD, stronger voice commands, clearer AI Smart Chat explanations, and database/index proof so Kain Tayo can confidently satisfy the rubric.

**Architecture:** Extend the existing favorites models and APIs instead of adding authentication or admin-only CRUD. Keep the frontend in the current page-specific JavaScript files, adding a small shared voice command parser to avoid duplicating command logic. Preserve existing search and AI flows while adding explanatory fields and UI states.

**Tech Stack:** Django 5.2, Django REST Framework, PostgreSQL via `DATABASE_URL`, pgvector, browser Web Speech API, vanilla JavaScript, existing Django templates and CSS.

---

## File Structure

- Modify `restaurants/models.py`: add session-owned metadata fields to `FavoriteRestaurant` and `FavoriteExternalPlace`, plus useful session/date indexes.
- Create `restaurants/migrations/0006_saved_place_metadata_and_indexes.py`: migrate metadata fields and indexes.
- Modify `restaurants/serializers.py`: expose `note`, `tags`, and `status`.
- Modify `restaurants/views.py`: allow saved-place metadata on create/update, include richer API payloads, and add AI response helper fields.
- Modify `restaurants/tests.py`: add TDD coverage for Saved Places CRUD and AI response shape.
- Modify `restaurants/templates/restaurants/favorites.html`: rename UI to Saved Places and add status filters.
- Modify `restaurants/static/restaurants/js/favorites.js`: render Saved Places CRUD editing UI.
- Create `restaurants/static/restaurants/js/voice_commands.js`: shared voice normalization and command routing.
- Modify `restaurants/templates/restaurants/base.html`: include the shared voice command helper before page scripts.
- Modify `restaurants/static/restaurants/js/search.js`, `home.js`, and `ai_search.js`: use shared voice commands for navigation/search behavior.
- Modify `restaurants/static/restaurants/css/styles.css`: add compact controls, saved-place badges, and metadata editing styles.
- Modify `README.md`: document no-auth Saved Places CRUD, AI/pgvector value, and no menu-price claims.

---

### Task 1: Saved Places Model And API Tests

**Files:**
- Modify: `restaurants/tests.py`

- [ ] **Step 1: Write failing tests for local saved-place metadata CRUD**

Add these tests to `FavoritesApiTests` after `test_add_favorite_idempotent_for_same_session`:

```python
    def test_local_saved_place_metadata_can_be_created_read_updated_and_deleted(self):
        created = self.client.post(
            "/api/favorites/add/",
            {
                "restaurant_id": self.restaurant.id,
                "note": "Try after class",
                "tags": ["barkada", "craving"],
                "status": "want_to_try",
            },
            format="json",
        )
        self.assertEqual(created.status_code, 201)
        self.assertEqual(created.json()["note"], "Try after class")
        self.assertEqual(created.json()["tags"], ["barkada", "craving"])
        self.assertEqual(created.json()["status"], "want_to_try")

        listed = self.client.get("/api/favorites/")
        self.assertEqual(listed.status_code, 200)
        row = listed.json()[0]
        self.assertEqual(row["type"], "local")
        self.assertEqual(row["note"], "Try after class")
        self.assertEqual(row["tags"], ["barkada", "craving"])
        self.assertEqual(row["status"], "want_to_try")

        patched = self.client.patch(
            f"/api/favorites/local/{row['id']}/",
            {"note": "Visited with friends", "tags": ["tried"], "status": "tried"},
            format="json",
        )
        self.assertEqual(patched.status_code, 200)
        self.assertEqual(patched.json()["note"], "Visited with friends")
        self.assertEqual(patched.json()["tags"], ["tried"])
        self.assertEqual(patched.json()["status"], "tried")

        deleted = self.client.delete(f"/api/favorites/local/{row['id']}/")
        self.assertEqual(deleted.status_code, 200)
        self.assertEqual(FavoriteRestaurant.objects.count(), 0)
```

- [ ] **Step 2: Write failing tests for external saved-place metadata and validation**

Add these tests to `FavoritesApiTests` after `test_patch_external_favorite_updates_fields`:

```python
    def test_external_saved_place_metadata_can_be_updated(self):
        created = self.client.post(
            "/api/favorites/add/",
            {
                "place_id": "places/demo-789",
                "name": "Demo Cafe",
                "cuisine": "cafe",
                "address": "Santa Rosa, Laguna",
                "detail_url": "/place/places/demo-789/",
                "rating": 4.5,
                "note": "Good for study",
                "tags": ["study"],
                "status": "favorite",
            },
            format="json",
        )
        self.assertEqual(created.status_code, 201)
        favorite_id = created.json()["id"]

        patched = self.client.patch(
            f"/api/favorites/external/{favorite_id}/",
            {"note": "Try the pastries", "tags": ["study", "quick_bite"], "status": "tried"},
            format="json",
        )

        self.assertEqual(patched.status_code, 200)
        self.assertEqual(patched.json()["note"], "Try the pastries")
        self.assertEqual(patched.json()["tags"], ["study", "quick_bite"])
        self.assertEqual(patched.json()["status"], "tried")

    def test_saved_place_rejects_invalid_status_and_tags(self):
        created = self.client.post(
            "/api/favorites/add/",
            {"restaurant_id": self.restaurant.id},
            format="json",
        )
        self.assertEqual(created.status_code, 201)
        favorite_id = created.json()["id"]

        bad_status = self.client.patch(
            f"/api/favorites/local/{favorite_id}/",
            {"status": "expensive"},
            format="json",
        )
        self.assertEqual(bad_status.status_code, 400)
        self.assertIn("status", bad_status.json()["error"])

        bad_tags = self.client.patch(
            f"/api/favorites/local/{favorite_id}/",
            {"tags": "date"},
            format="json",
        )
        self.assertEqual(bad_tags.status_code, 400)
        self.assertIn("tags", bad_tags.json()["error"])
```

- [ ] **Step 3: Run tests and verify they fail**

Run: `python manage.py test restaurants.tests.FavoritesApiTests`

Expected: FAIL with errors showing `note`, `tags`, and `status` fields are missing or local PATCH is not supported.

---

### Task 2: Saved Places Model, Migration, Serializer, And API

**Files:**
- Modify: `restaurants/models.py`
- Create: `restaurants/migrations/0006_saved_place_metadata_and_indexes.py`
- Modify: `restaurants/serializers.py`
- Modify: `restaurants/views.py`

- [ ] **Step 1: Add metadata fields and indexes**

In both `FavoriteRestaurant` and `FavoriteExternalPlace`, add:

```python
    note = models.TextField(blank=True, default="")
    tags = models.JSONField(default=list, blank=True)
    status = models.CharField(max_length=24, default="want_to_try")
```

Add indexes to `FavoriteRestaurant.Meta.indexes`:

```python
        indexes = [
            models.Index(fields=["session_key", "-created_at"], name="fav_local_session_created_idx"),
            models.Index(fields=["user", "-created_at"], name="fav_local_user_created_idx"),
        ]
```

Add indexes to `FavoriteExternalPlace.Meta.indexes`:

```python
        indexes = [
            models.Index(fields=["session_key", "-created_at"], name="fav_ext_session_created_idx"),
            models.Index(fields=["user", "-created_at"], name="fav_ext_user_created_idx"),
        ]
```

- [ ] **Step 2: Create migration**

Create `restaurants/migrations/0006_saved_place_metadata_and_indexes.py` with:

```python
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("restaurants", "0005_favoriteexternalplace"),
    ]

    operations = [
        migrations.AddField(
            model_name="favoriterestaurant",
            name="note",
            field=models.TextField(blank=True, default=""),
        ),
        migrations.AddField(
            model_name="favoriterestaurant",
            name="tags",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name="favoriterestaurant",
            name="status",
            field=models.CharField(default="want_to_try", max_length=24),
        ),
        migrations.AddField(
            model_name="favoriteexternalplace",
            name="note",
            field=models.TextField(blank=True, default=""),
        ),
        migrations.AddField(
            model_name="favoriteexternalplace",
            name="tags",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name="favoriteexternalplace",
            name="status",
            field=models.CharField(default="want_to_try", max_length=24),
        ),
        migrations.AddIndex(
            model_name="favoriterestaurant",
            index=models.Index(fields=["session_key", "-created_at"], name="fav_local_session_created_idx"),
        ),
        migrations.AddIndex(
            model_name="favoriterestaurant",
            index=models.Index(fields=["user", "-created_at"], name="fav_local_user_created_idx"),
        ),
        migrations.AddIndex(
            model_name="favoriteexternalplace",
            index=models.Index(fields=["session_key", "-created_at"], name="fav_ext_session_created_idx"),
        ),
        migrations.AddIndex(
            model_name="favoriteexternalplace",
            index=models.Index(fields=["user", "-created_at"], name="fav_ext_user_created_idx"),
        ),
    ]
```

- [ ] **Step 3: Expose fields in serializers**

Change `FavoriteRestaurantSerializer.Meta.fields` to:

```python
        fields = ["id", "restaurant", "note", "tags", "status", "created_at"]
```

Change `FavoriteExternalPlaceSerializer.Meta.fields` to include:

```python
            "note",
            "tags",
            "status",
```

- [ ] **Step 4: Add validation helpers in views**

Add near constants in `restaurants/views.py`:

```python
SAVED_PLACE_STATUSES = {"want_to_try", "tried", "favorite"}
SAVED_PLACE_TAGS = {"date", "family", "study", "barkada", "quick_bite", "nearby", "craving"}


def _clean_saved_place_status(value, default="want_to_try") -> str:
    status_value = str(value or default).strip().lower().replace(" ", "_")
    if status_value not in SAVED_PLACE_STATUSES:
        raise ValidationError("status must be one of: want_to_try, tried, favorite.")
    return status_value


def _clean_saved_place_tags(value) -> list[str]:
    if value in (None, ""):
        return []
    if not isinstance(value, list):
        raise ValidationError("tags must be a list.")
    cleaned = []
    for item in value[:8]:
        tag = str(item or "").strip().lower().replace(" ", "_")
        if not tag:
            continue
        if tag not in SAVED_PLACE_TAGS:
            raise ValidationError(
                "tags may only include: barkada, craving, date, family, nearby, quick_bite, study."
            )
        if tag not in cleaned:
            cleaned.append(tag)
    return cleaned


def _clean_saved_place_note(value) -> str:
    return str(value or "").strip()[:500]
```

- [ ] **Step 5: Update API create and patch behavior**

In `add_favorite_api`, parse metadata before local/external branches:

```python
    try:
        saved_note = _clean_saved_place_note(request.data.get("note", ""))
        saved_tags = _clean_saved_place_tags(request.data.get("tags", []))
        saved_status = _clean_saved_place_status(request.data.get("status", "want_to_try"))
    except ValidationError as exc:
        return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
```

Pass metadata in both `get_or_create(... defaults={...})` calls and update existing favorites when metadata is provided:

```python
            favorite.note = saved_note
            favorite.tags = saved_tags
            favorite.status = saved_status
            favorite.save(update_fields=["note", "tags", "status"])
```

In `delete_favorite_api`, allow PATCH for both local and external favorites. Use the same metadata helpers and existing external display-field update logic.

- [ ] **Step 6: Run tests**

Run: `python manage.py test restaurants.tests.FavoritesApiTests`

Expected: PASS.

---

### Task 3: Saved Places UI

**Files:**
- Modify: `restaurants/templates/restaurants/favorites.html`
- Modify: `restaurants/static/restaurants/js/favorites.js`
- Modify: `restaurants/static/restaurants/css/styles.css`

- [ ] **Step 1: Update page shell**

Replace the current content in `favorites.html` with:

```html
<section class="search-shell saved-places-shell">
    <div class="search-panel">
        <div class="section-heading-row">
            <div>
                <h1>Saved Places</h1>
                <p>Keep track of places you want to try, already tried, or love.</p>
            </div>
        </div>
        <div class="segmented-control saved-status-tabs" id="savedStatusTabs" aria-label="Saved place status filter">
            <button type="button" class="active" data-status="all">All</button>
            <button type="button" data-status="want_to_try">Want to Try</button>
            <button type="button" data-status="tried">Tried</button>
            <button type="button" data-status="favorite">Favorite</button>
        </div>
        <div id="favoritesList" class="results-list"></div>
    </div>
</section>
```

- [ ] **Step 2: Replace `favorites.js` with editing UI**

Implement `fetchFavorites`, `renderFavorites`, `patchFavoriteItem`, and `deleteFavoriteItem` so each card includes:

```html
<select class="saved-status-select">
  <option value="want_to_try">Want to Try</option>
  <option value="tried">Tried</option>
  <option value="favorite">Favorite</option>
</select>
<textarea class="saved-note-input" maxlength="500"></textarea>
<label><input type="checkbox" value="date"> Date</label>
<label><input type="checkbox" value="family"> Family</label>
<label><input type="checkbox" value="study"> Study</label>
<label><input type="checkbox" value="barkada"> Barkada</label>
<label><input type="checkbox" value="quick_bite"> Quick bite</label>
<label><input type="checkbox" value="nearby"> Nearby</label>
<label><input type="checkbox" value="craving"> Craving</label>
<button class="save-metadata-btn">Save</button>
<button class="delete-favorite-btn">Delete</button>
```

Use `PATCH /api/favorites/<type>/<id>/` with JSON:

```json
{
  "status": "tried",
  "note": "Visited with friends",
  "tags": ["barkada", "craving"]
}
```

- [ ] **Step 3: Add focused CSS**

Add classes for:

```css
.saved-places-shell {}
.saved-status-tabs {}
.saved-place-meta {}
.saved-note-input {}
.saved-tag-list {}
.saved-source-badge {}
```

Use existing colors and card patterns; keep cards compact and avoid nested cards.

- [ ] **Step 4: Run JS syntax check**

Run: `node --check restaurants/static/restaurants/js/favorites.js`

Expected: exit code 0.

---

### Task 4: Shared Voice Commands

**Files:**
- Create: `restaurants/static/restaurants/js/voice_commands.js`
- Modify: `restaurants/templates/restaurants/base.html`
- Modify: `restaurants/static/restaurants/js/search.js`
- Modify: `restaurants/static/restaurants/js/home.js`
- Modify: `restaurants/static/restaurants/js/ai_search.js`

- [ ] **Step 1: Create shared voice helper**

Create `voice_commands.js`:

```javascript
window.KainTayoVoice = (() => {
  function chooseSpeechLocale() {
    const lang = String(navigator.language || "").toLowerCase();
    if (lang.startsWith("fil") || lang.startsWith("tl")) return "fil-PH";
    return "en-US";
  }

  function normalize(value = "") {
    const lowered = String(value || "").trim().toLowerCase();
    const replacements = [
      [/\bhanap\b/gi, "search"],
      [/\bmalapit\s+sa\s+akin\b/gi, "near me"],
      [/\bmalapit\b/gi, "near"],
      [/\bbukas\s+ngayon\b/gi, "open now"],
      [/\bpunta\s+sa\b/gi, "go to"],
      [/\bpaborito\b/gi, "saved places"],
      [/\bmas\s+mura\b/gi, "casual"],
      [/\bsamgyup\b/gi, "samgyupsal"],
    ];
    return replacements.reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), lowered).replace(/\s{2,}/g, " ").trim();
  }

  function commandFor(transcript = "") {
    const text = normalize(transcript);
    if (!text) return { action: "empty", text };
    if (/\b(show|open|go to)\s+(saved places|favorites)\b/.test(text)) return { action: "navigate", url: "/favorites/", text };
    if (/\b(show|open|go to)\s+nearby\b/.test(text)) return { action: "navigate", url: "/nearby/", text };
    if (/\b(go to|open)\s+(ai chat|ai search)\b/.test(text)) return { action: "navigate", url: "/ai-search/", text };
    if (/\b(go home|open home)\b/.test(text)) return { action: "navigate", url: "/", text };
    if (/\bclear search\b/.test(text)) return { action: "clear", text };
    const searchText = text.replace(/^\b(search|find)\b\s*/, "").trim();
    return { action: "search", text: searchText || text };
  }

  return { chooseSpeechLocale, normalize, commandFor };
})();
```

- [ ] **Step 2: Include shared helper**

In `base.html`, add before `main.js`:

```html
    <script src="{% static 'restaurants/js/voice_commands.js' %}" defer></script>
```

- [ ] **Step 3: Wire page behavior**

In `search.js`, replace local `chooseSpeechLocale` and `normalizeVoiceQuery` internals with `window.KainTayoVoice`. On result:

```javascript
const command = window.KainTayoVoice.commandFor(event.results?.[0]?.[0]?.transcript || "");
if (command.action === "navigate") window.location.href = command.url;
if (command.action === "clear") queryInput.value = "";
if (command.action === "search") {
  queryInput.value = command.text;
  smartSearch();
}
```

In `home.js`, route navigation commands and send search commands to `/search/?q=...`.

In `ai_search.js`, route navigation commands and place search command text into the composer.

- [ ] **Step 4: Run JS syntax checks**

Run:

```bash
node --check restaurants/static/restaurants/js/voice_commands.js
node --check restaurants/static/restaurants/js/search.js
node --check restaurants/static/restaurants/js/home.js
node --check restaurants/static/restaurants/js/ai_search.js
```

Expected: all exit code 0.

---

### Task 5: AI Smart Chat Response Improvements

**Files:**
- Modify: `restaurants/views.py`
- Modify: `restaurants/static/restaurants/js/ai_search.js`
- Modify: `restaurants/tests.py`

- [ ] **Step 1: Write failing API shape test**

In `AiGroundedSearchApiTests`, update `test_ai_search_returns_structured_payload` to assert:

```python
        self.assertIn("intent_summary", data)
        self.assertIn("refinement_chips", data)
        self.assertIn("source_label", data)
        self.assertEqual(data["results"][0]["reason"], "Strong reviews")
```

- [ ] **Step 2: Add helper in views**

Add:

```python
def _build_ai_intent_summary(query: str, location_hint: str) -> str:
    parts = [f'Looking for "{query}".']
    if location_hint:
        parts.append(f"Location hint: {location_hint}.")
    parts.append("Results are ranked using grounded AI, source quality, and fallback availability.")
    return " ".join(parts)


def _build_ai_refinement_chips(query: str) -> list[dict]:
    return [
        {"label": "Closer", "query": f"{query} near me"},
        {"label": "Open now", "query": f"{query} open now"},
        {"label": "More local", "query": f"local {query}"},
        {"label": "Good for groups", "query": f"{query} good for groups"},
        {"label": "Date place", "query": f"{query} date place"},
        {"label": "Try another area", "query": query},
    ]
```

In `ai_grounded_search_api`, after `payload = run_grounded_food_search(...)`, add:

```python
    payload["intent_summary"] = _build_ai_intent_summary(query, location_hint)
    payload["refinement_chips"] = _build_ai_refinement_chips(query)
    payload["source_label"] = "AI grounded" if payload.get("grounded_ok") else "Google Places fallback"
    for row in payload.get("results", []):
        row["reason"] = row.get("why") or row.get("highlights") or "Matched your food request."
```

- [ ] **Step 3: Render AI improvements**

In `ai_search.js`, update `renderAssistantResponse` to render:

```javascript
if (payload.intent_summary) {
  const intent = document.createElement("p");
  intent.className = "ai-intent-summary";
  intent.textContent = payload.intent_summary;
  bubble.appendChild(intent);
}
```

Render refinement chips after cards:

```javascript
(payload.refinement_chips || []).forEach((chip) => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "chip clickable-chip";
  button.textContent = chip.label;
  button.addEventListener("click", () => runAiSearch(chip.query));
  chipWrap.appendChild(button);
});
```

In `buildResultCard`, show `row.reason` and `payload.source_label` or per-row source when present.

- [ ] **Step 4: Run tests and syntax check**

Run:

```bash
python manage.py test restaurants.tests.AiGroundedSearchApiTests
node --check restaurants/static/restaurants/js/ai_search.js
```

Expected: both pass.

---

### Task 6: Documentation And Final Verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README rubric/demo notes**

Add a section stating:

```markdown
## Rubric Alignment Notes

- CRUD is session-based through Saved Places. Users can create, read, update, and delete saved local restaurants and external Google Places without accounts.
- Voice supports search and navigation commands, including selected Filipino/Taglish phrases.
- AI features include Gemini grounded recommendations, Google Places fallback, intent summaries, refinement chips, and pgvector semantic ranking when embeddings are available.
- PostgreSQL is configured through DATABASE_URL on Render. The schema includes relationships, uniqueness constraints, session lookup indexes, and pgvector embedding storage.
- The app does not claim menu prices from Google Places. "Cheap" and "mura" are treated as soft intent signals, not verified menu-price facts.
```

- [ ] **Step 2: Run full verification**

Run:

```bash
python manage.py check
python manage.py test
node --check restaurants/static/restaurants/js/voice_commands.js
node --check restaurants/static/restaurants/js/favorites.js
node --check restaurants/static/restaurants/js/search.js
node --check restaurants/static/restaurants/js/home.js
node --check restaurants/static/restaurants/js/ai_search.js
```

Expected: Django tests pass and every Node syntax check exits 0. `python manage.py check` may still warn if the optional project-level `static/` directory is missing; if so, either create the directory or remove the nonexistent path from `STATICFILES_DIRS`.

- [ ] **Step 3: Commit implementation**

Stage only intentional source/docs changes:

```bash
git add restaurants/models.py restaurants/migrations/0006_saved_place_metadata_and_indexes.py restaurants/serializers.py restaurants/views.py restaurants/tests.py restaurants/templates/restaurants/favorites.html restaurants/templates/restaurants/base.html restaurants/static/restaurants/js/voice_commands.js restaurants/static/restaurants/js/favorites.js restaurants/static/restaurants/js/search.js restaurants/static/restaurants/js/home.js restaurants/static/restaurants/js/ai_search.js restaurants/static/restaurants/css/styles.css README.md
git commit -m "Add rubric-ready saved places and voice improvements"
```

Do not stage generated `__pycache__` files.

---

## Self-Review

- Spec coverage: Saved Places CRUD is covered by Tasks 1-3. Voice control is covered by Task 4. AI Smart Chat improvements are covered by Task 5. PostgreSQL/index proof and docs are covered by Tasks 2 and 6. No-auth/no-admin and no menu-price claims are preserved.
- Placeholder scan: No `TBD`, `TODO`, or vague "add error handling" instructions remain.
- Type consistency: Metadata fields use `note`, `tags`, and `status` consistently across model, serializer, API, tests, and UI. Status values are `want_to_try`, `tried`, and `favorite`. Tag values use underscore form for `quick_bite`.
