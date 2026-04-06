# Phase 2 — Chapter Lifecycle: Auto-Seal + Summary Generation

**Status:** Not started
**Depends on:** Phase 1 (types, server CRUD, state hydration)
**Goal:** Chapters auto-seal when conditions are met, LLM-generated summaries fill chapter metadata on seal.

---

## 2A. Auto-Seal Detection

**New file:** `src/services/archiveChapterEngine.ts`

### Detection function

```ts
const AUTO_SEAL_SCENE_THRESHOLD = 25; // configurable, could move to settings

export function shouldAutoSeal(
    chapters: ArchiveChapter[],
    archiveIndex: ArchiveIndexEntry[],
    headerIndex: string
): { shouldSeal: boolean; reason: string } {
    const openChapter = chapters.find(c => !c.sealedAt);
    if (!openChapter) return { shouldSeal: false, reason: 'no_open_chapter' };

    // Count scenes in open chapter's range
    const startNum = parseInt(openChapter.sceneRange[0], 10);
    const endNum = parseInt(openChapter.sceneRange[1], 10);
    const sceneCount = endNum - startNum + 1;

    if (sceneCount >= AUTO_SEAL_SCENE_THRESHOLD) {
        return { shouldSeal: true, reason: 'scene_threshold' };
    }

    // Check for new SESSION_ID in header index that doesn't match open chapter
    // Extract SESSION_IDs from header index and compare
    const sessionIds = extractSessionIds(headerIndex);
    const lastSessionId = sessionIds[sessionIds.length - 1];
    if (lastSessionId && openChapter._lastSeenSessionId && lastSessionId !== openChapter._lastSeenSessionId) {
        return { shouldSeal: true, reason: 'session_boundary' };
    }

    return { shouldSeal: false, reason: '' };
}
```

**Note on `SESSION_ID` detection:** The header index uses `SESSION_ID:` entries. We need to parse these from the raw header index string. A simple regex can extract them:
```ts
function extractSessionIds(headerIndex: string): string[] {
    const matches = headerIndex.match(/SESSION_ID:\s*(\S+)/g) || [];
    return matches.map(m => m.replace('SESSION_ID:', '').trim());
}
```

The open chapter needs to track which `SESSION_ID` it was created under. This could be a private field or stored alongside the chapter. Simplest approach: store it in the chapter object.

**Consideration:** Add an optional field to `ArchiveChapter`:
```ts
_lastSeenSessionId?: string; // not serialized, used for auto-seal detection only
```
Or better: compute it from the header index at detection time by comparing the open chapter's starting scene range against SESSION boundaries in the header index.

### Seal execution

```ts
export async function sealChapter(
    campaignId: string,
    chapters: ArchiveChapter[],
    archiveIndex: ArchiveIndexEntry[]
): Promise<{ sealedChapter: ArchiveChapter; newOpenChapter: ArchiveChapter }> {
    const openChapter = chapters.find(c => !c.sealedAt);
    if (!openChapter) throw new Error('No open chapter to seal');

    // Seal it
    const sealed = {
        ...openChapter,
        sealedAt: Date.now(),
    };

    // Determine next scene number
    const lastScene = parseInt(sealed.sceneRange[1], 10);
    const nextScene = String(lastScene + 1).padStart(3, '0');

    // Create new open chapter
    const nextId = `CH${String(chapters.length + 1).padStart(2, '0')}`;
    const newOpen: ArchiveChapter = {
        chapterId: nextId,
        title: 'Open Chapter',
        sceneRange: [nextScene, nextScene],
        summary: '',
        keywords: [],
        npcs: [],
        majorEvents: [],
        unresolvedThreads: [],
        tone: '',
        themes: [],
        sceneCount: 0,
    };

    return { sealedChapter: sealed, newOpenChapter: newOpen };
}
```

### Hook into ChatArea post-turn

**File:** `src/components/ChatArea.tsx`

After the turn completes (post archive append + NPC detection + condensation):
1. Check `shouldAutoSeal(chapters, archiveIndex, context.headerIndex)`
2. If true, call `sealChapter()` → persist both via API
3. Kick off async summary generation (Phase 2B)

This runs **after** the user sees the GM response. Non-blocking.

---

## 2B. Chapter Summary Generation (Async)

**File:** `src/services/saveFileEngine.ts`

### New function

```ts
export async function generateChapterSummary(
    provider: ProviderConfig | EndpointConfig,
    chapter: ArchiveChapter,
    archiveScenes: { sceneId: string; content: string }[],
    headerIndex: string
): Promise<{
    title: string;
    summary: string;
    keywords: string[];
    npcs: string[];
    majorEvents: string[];
    unresolvedThreads: string[];
    tone: string;
    themes: string[];
}> {
    // Build prompt
    const prompt = buildChapterSummaryPrompt(chapter, archiveScenes, headerIndex);
    
    // Call LLM (uses summarizerAI endpoint)
    const output = await llmCall(provider, prompt);
    
    // Parse structured output
    return parseChapterSummaryOutput(output);
}
```

### Prompt design

```
You are a TTRPG campaign archivist. Generate a structured chapter summary.

CHAPTER: {chapter.title or "Untitled"}
SCENES: {sceneRange[0]} to {sceneRange[1]} ({sceneCount} scenes)

OUTPUT FORMAT — respond with a JSON object:
{
    "title": "Short evocative chapter title",
    "summary": "3-5 sentence narrative summary of what happened",
    "keywords": ["keyword1", "keyword2", ...],
    "npcs": ["NPC Name 1", "NPC Name 2", ...],
    "majorEvents": ["Event description 1", "Event description 2"],
    "unresolvedThreads": ["Thread 1", "Thread 2"],
    "tone": "one of: combat-heavy, exploration, social, mystery, political, emotional, mixed",
    "themes": ["theme1", "theme2"]
}

RULES:
1. Keywords should be distinctive nouns/places/factions — not generic words
2. NPCs should include all significant named characters who appeared or were discussed
3. Major events are plot-critical beats only (not every combat round)
4. Unresolved threads are open plot hooks, promises, or mysteries
5. Title should be 2-5 words, evocative
6. Summary should read like a campaign journal entry, not a list

HEADER INDEX REFERENCE (for thread tracking):
{relevant header index entries}

SCENE CONTENT:
{concatenated scene content, truncated if needed to fit budget}
```

### Budget management
- Chapter summary prompt should respect a token budget (suggest 8000 tokens for input)
- If scenes in range exceed budget, truncate oldest scenes, keep the last ~60% and first ~20%
- Output is small (~300-500 tokens)

### Server endpoint

**File:** `server.js`

#### `POST /api/campaigns/:id/archive/chapters/:chapterId/generate-summary`

1. Load chapter from chapters file
2. Validate chapter is sealed
3. Fetch scenes in chapter's sceneRange from archive.md
4. Call back to **client** with a signal that summary generation is needed (or handle server-side if summarizer endpoint is available)

**Decision needed:** Summary generation requires an LLM call with API key. Two options:
- **Option A (recommended):** Client triggers generation, sends result back to server. The client has the API key and provider config.
- **Option B:** Server has access to the summarizer endpoint config. More complex, requires config sharing.

**Going with Option A:** The client calls `generateChapterSummary()` locally, then `PATCH /archive/chapters/:chapterId` with the filled-in fields.

### Async flow

```
After seal:
  1. Persist sealed chapter (summary still empty)
  2. Fire-and-forget: fetch scenes for chapter range from server
  3. Run generateChapterSummary() locally
  4. On success: PATCH chapter with summary fields
  5. On failure: chapter remains sealed with empty summary, flagged for retry in UI
```

---

## 2C. Manual Seal Trigger

**File:** `server.js`

#### `POST /api/campaigns/:id/archive/chapters/seal`

Body: `{ title?: string }`

1. Load chapters
2. Find open chapter
3. Set `sealedAt = Date.now()`
4. Optionally set `title` from request body
5. Create new open chapter starting at next scene
6. Persist both
7. Return `{ sealed: chapter, newOpen: newChapter }`

Client then kicks off summary generation async (same as 2B).

---

## 2D. Testing Strategy

Tests for Phase 2 cover auto-seal detection, seal execution, and summary generation. Summary generation tests use mocked LLM responses (no live API calls).

### Unit tests (pure functions)

#### shouldAutoSeal
```
test: Returns false when no open chapter exists
test: Returns true with reason 'scene_threshold' when sceneCount >= AUTO_SEAL_SCENE_THRESHOLD
test: Returns false when sceneCount < AUTO_SEAL_SCENE_THRESHOLD
test: Returns true with reason 'session_boundary' when SESSION_ID changes
test: Returns false when SESSION_ID has not changed
```

#### extractSessionIds
```
test: Extracts SESSION_IDs from header index string with SESSION_ID: prefix
test: Returns empty array when no SESSION_IDs found
test: Handles multiple SESSION_IDs in order
```

#### sealChapter
```
test: Seals open chapter by setting sealedAt to current timestamp
test: Creates new open chapter with correct next chapterId (incrementing)
test: New open chapter starts at sceneRange = [lastScene + 1, lastScene + 1]
test: Throws when no open chapter exists
```

### Integration tests (mocked fetch for LLM calls)

#### generateChapterSummary
```
test: Sends correct prompt structure to LLM endpoint
test: Parses valid JSON response into chapter summary fields
test: Handles malformed JSON gracefully (uses extractJson fallback)
test: Handles LLM returning markdown-fenced JSON (```json ... ```)
test: Respects 8000-token input budget (truncates oldest scenes)
test: Returns all required fields: title, summary, keywords, npcs, majorEvents, unresolvedThreads, tone, themes
```

#### Async generation flow
```
test: Sealed chapter with empty summary triggers generation
test: On LLM success, chapter is PATCHed with summary fields
test: On LLM failure, chapter remains sealed with empty summary (no crash)
test: Fire-and-forget does not block the main turn flow
```

### Implementation notes

- Mock `fetch` to return controlled LLM JSON responses
- Test `parseChapterSummaryOutput` with known-bad JSON (trailing commas, missing fields, `<think>` blocks)
- For budget tests, create synthetic scene content of known token counts
- Use `extractJson()` from `payloadBuilder.ts` for robustness — it already handles edge cases

---

## Checklist

- [ ] 2A: Create `archiveChapterEngine.ts` with `shouldAutoSeal()`
- [ ] 2A: `extractSessionIds()` helper for header index parsing
- [ ] 2A: `sealChapter()` execution function
- [ ] 2A: Hook auto-seal check into ChatArea post-turn flow
- [ ] 2B: `generateChapterSummary()` in `saveFileEngine.ts`
- [ ] 2B: `buildChapterSummaryPrompt()` with structured JSON output
- [ ] 2B: `parseChapterSummaryOutput()` with fallback on parse failure
- [ ] 2B: Budget management for large chapter scene content
- [ ] 2B: Client-side async generation flow (fetch scenes → LLM → PATCH)
- [ ] 2C: `POST /archive/chapters/seal` server endpoint
- [ ] 2C: Manual seal trigger from client (API call + state update)
- [ ] 2D: Unit tests for shouldAutoSeal
- [ ] 2D: Unit tests for extractSessionIds
- [ ] 2D: Unit tests for sealChapter
- [ ] 2D: Integration tests for generateChapterSummary (mocked LLM)

## Decisions Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Auto-seal scene threshold | 25 scenes | ~25 exchanges is a meaningful arc; configurable later |
| SESSION_ID detection | Parse from header index string | Reuses existing data, no new tracking needed |
| Summary generation location | Client-side (Option A) | Client has API keys and provider configs; avoids config duplication |
| Summary timing | Async, fire-and-forget after seal | Doesn't block current turn; chapter is usable with empty summary |
| LLM endpoint for summaries | `summarizerAI` | Already designated for compression tasks |

## Open Questions

- Should `AUTO_SEAL_SCENE_THRESHOLD` be user-configurable via settings? (Deferring to Phase 5 UI)
- Should we re-run `shouldAutoSeal` if the summary generation fails and the chapter has no summary?
