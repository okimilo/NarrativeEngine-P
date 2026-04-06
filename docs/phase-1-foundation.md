# Phase 1 — Foundation: Types + Server + Rollback Integrity

**Status:** Not started
**Depends on:** Nothing
**Goal:** Chapter data model exists, server persists chapters, rollback cascade is safe (fixes pre-existing bugs + chapter-aware cleanup).

---

## 1A. Types

**File:** `src/types/index.ts`

Add the `ArchiveChapter` type:

```ts
export type ArchiveChapter = {
    chapterId: string;            // "CH01"
    title: string;                // Auto-generated or user-edited
    sceneRange: [string, string]; // ["001", "023"] — inclusive
    summary: string;              // LLM-generated on seal (empty if unsealed)
    keywords: string[];           // Aggregated + deduped from child scenes
    npcs: string[];               // Aggregated from child scenes
    majorEvents: string[];        // Key beats from header index
    unresolvedThreads: string[];  // Carried from header index Section 2
    tone: string;                 // "combat-heavy", "exploration", "social", etc.
    themes: string[];             // Thematic tags
    sceneCount: number;           // Number of scenes in range
    sealedAt?: number;            // undefined = open chapter
    invalidated?: boolean;        // true = summary stale due to rollback, needs re-gen
};
```

No behavior change. Just type availability.

---

## 1B. Server: Chapter File Management

**File:** `server.js`

### New helper

```js
function chaptersPath(id) {
    return path.join(CAMPAIGNS_DIR, `${id}.archive.chapters.json`);
}
```

### New file
`data/campaigns/{id}.archive.chapters.json` — array of `ArchiveChapter` objects.

### Endpoints

#### `GET /api/campaigns/:id/archive/chapters`
Return all chapters from file. Return `[]` if file doesn't exist.

#### `POST /api/campaigns/:id/archive/chapters`
Create a new open chapter. Body: `{ title?: string }`.
- Auto-assign `chapterId` as `CH{NN}` (increment from existing).
- `sceneRange`: `[nextSceneId, nextSceneId]` (from `getNextSceneNumber`).
- All other fields: defaults (empty arrays, empty strings, `sceneCount: 0`, no `sealedAt`).

#### `PATCH /api/campaigns/:id/archive/chapters/:chapterId`
Update chapter metadata. Body: `{ title?: string }`.
- Only allow editing `title` for now.
- Reject if chapter not found.

#### Auto-create on scene append
In the existing `POST /api/campaigns/:id/archive` handler (the scene append endpoint):
- After writing the scene, check if `archive.chapters.json` exists and has an open chapter (one without `sealedAt`).
- If no open chapter exists, auto-create one starting at the current scene.
- Increment the open chapter's `sceneRange[1]` to the current sceneId.
- Increment `sceneCount`.

---

## 1C. Rollback Cascade

**File:** `server.js`

This phase fixes both pre-existing bugs and adds chapter-aware cleanup.

### Enhance `DELETE /api/campaigns/:id/archive/scenes-from/:sceneId`

After the existing archive.md + index.json + facts.json trimming, add:

#### Chapter cascade
```
Load chapters from archive.chapters.json
For each chapter:
  startNum = parseInt(sceneRange[0])
  endNum = parseInt(sceneRange[1])

  if startNum >= rollbackNum:
    → DELETE chapter entirely (it's fully after the rollback point)

  if endNum >= rollbackNum:
    → TRUNCATE sceneRange[1] to (rollbackNum - 1), padded to 3 digits
    → SET invalidated = true
    → CLEAR sealedAt (unseal it — summary no longer valid)
    → UPDATE sceneCount = rollbackNum - startNum

After loop:
  if no open chapter exists in repaired list:
    → CREATE new open chapter starting at rollbackNum
```

Write repaired chapters back to file.

#### Response enhancement
Return `{ ok: true, removedFrom, chaptersRepaired: true }` so the client knows to refresh chapter state.

### Enhance `DELETE /api/campaigns/:id/archive` (clear all)

After clearing `.archive.md` and `.archive.index.json`:
- Also delete `.archive.chapters.json` if it exists.
- Return signal in response: `{ ok: true, chaptersCleared: true }`.

### Pre-existing bug fixes (server-side signal only)
The server cannot directly reset client-side condenser state, but it can:
- Return `{ condenserResetRecommended: true }` in the rollback response when scenes are removed.
- The client handles the actual reset in Phase 4B.

---

## 1D. State Scaffolding

### Campaign store
**File:** `src/store/campaignStore.ts`

Add async functions:
- `loadChapters(campaignId)` → `GET /archive/chapters`
- `createChapter(campaignId, title?)` → `POST /archive/chapters`
- `updateChapter(campaignId, chapterId, patch)` → `PATCH /archive/chapters/:id`

### API client
**File:** `src/services/apiClient.ts`

Add `chapters` namespace:
```ts
chapters: {
    list: (campaignId) => fetch(...),
    create: (campaignId, body?) => fetch(...),
    update: (campaignId, chapterId, body) => fetch(...),
}
```

### Store slice
**File:** `src/store/slices/campaignSlice.ts`

Add to state:
```ts
chapters: ArchiveChapter[];
setChapters: (chapters: ArchiveChapter[]) => void;
```

### Hydration
**File:** `src/App.tsx` (or wherever campaigns are loaded)

Add chapters to the parallel hydration chain:
```ts
const chapters = await api.chapters.list(activeCampaignId);
setChapters(chapters);
```

Runs alongside existing lore, NPC, archive index, and facts loads. No blocking.

---

## 1E. Testing Strategy

Tests for Phase 1 cover server endpoints and rollback cascade logic. No LLM calls involved — all tests are pure I/O against the filesystem.

### Server endpoint tests (mocked filesystem)

#### CRUD endpoints
```
test: GET /archive/chapters returns [] when file does not exist
test: GET /archive/chapters returns array when file exists
test: POST /archive/chapters auto-assigns CH{NN} ID incrementing from existing
test: POST /archive/chapters creates open chapter (no sealedAt)
test: PATCH /archive/chapters/:id updates title
test: PATCH /archive/chapters/:id rejects unknown chapterId with 404
```

#### Auto-create on scene append
```
test: Scene append creates open chapter if no chapters file exists
test: Scene append creates open chapter if no open chapter exists
test: Scene append increments open chapter's sceneRange[1] and sceneCount
test: Scene append does NOT create duplicate open chapters
```

#### Rollback cascade (1C)
```
test: Chapters fully after rollback point are deleted entirely
test: Chapters spanning rollback point are truncated (sceneRange[1] set to rollbackNum - 1)
test: Truncated chapters get invalidated = true and sealedAt cleared
test: If no open chapter exists after cascade, a new one is created at rollbackNum
test: DELETE /archive (clear all) also deletes chapters file
test: Response includes chaptersRepaired = true when chapters were affected
test: Response includes condenserResetRecommended = true when scenes removed
```

### Implementation notes

- Use a temp directory for test campaign files to avoid polluting real data
- Test rollback cascade with multiple chapters spanning the rollback point to verify edge cases
- Verify file contents after each operation (read back and parse JSON)

---

## Checklist

- [ ] 1A: `ArchiveChapter` type added to `types/index.ts`
- [ ] 1B: `chaptersPath()` helper in `server.js`
- [ ] 1B: `GET /archive/chapters` endpoint
- [ ] 1B: `POST /archive/chapters` endpoint
- [ ] 1B: `PATCH /archive/chapters/:chapterId` endpoint
- [ ] 1B: Auto-create open chapter on scene append
- [ ] 1B: Update open chapter sceneRange/sceneCount on scene append
- [ ] 1C: Chapter cascade in `DELETE /scenes-from/:sceneId`
- [ ] 1C: Ensure open chapter exists after cascade
- [ ] 1C: Delete chapters file in `DELETE /archive` (clear all)
- [ ] 1C: Return `chaptersRepaired` / `condenserResetRecommended` signals
- [ ] 1D: API client chapters namespace
- [ ] 1D: Campaign store async functions
- [ ] 1D: Campaign slice state + setter
- [ ] 1D: Parallel hydration in App.tsx
- [ ] 1E: Server CRUD endpoint tests
- [ ] 1E: Auto-create on scene append tests
- [ ] 1E: Rollback cascade tests

## Decisions Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Chapter ID format | `CH{NN}` (zero-padded 2-digit) | Matches scene ID pattern (`001`), sortable |
| Open chapter tracking | `sealedAt === undefined` | Simple, no separate status enum needed |
| Invalidated flag | `invalidated?: boolean` | Opt-in: chapter still usable for retrieval but flagged as stale |
| File location | Same directory as other campaign files | Consistency with existing `.archive.md`, `.archive.index.json` pattern |

## Open Questions

- None for Phase 1. Decisions carry forward from conversation.
