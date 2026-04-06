# Phase 3 — Iterative Funnel Retrieval

**Status:** Not started
**Depends on:** Phase 1 (types, server, state), Phase 2 (chapters exist and get sealed)
**Goal:** Chapter-aware retrieval using the iterative engine→LLM→engine funnel approach. Not yet wired into the turn pipeline.

---

## Design Principle

The retrieval uses an **iterative funnel** — not a single LLM call against the entire archive. The engine does the heavy narrowing, the LLM validates one chapter at a time. This keeps LLM calls tiny and bounded.

```
Engine 3D-scores chapter index → ranks all chapters
  ↓
Take #1 ranked chapter → LLM: "Relevant? YES/NO" (~200 token prompt, ~20 token response)
  ↓ Yes                     ↓ No
Confirm chapter          Take #2 chapter → LLM check → ...
  ↓
Repeat for up to 3 confirmed or 5 iterations
  ↓
3D-score scenes WITHIN confirmed chapters + open chapter
  ↓
Fetch top scenes within token budget (3000 tokens)
```

The LLM **never sees raw archive content** — only chapter summaries (~100-200 tokens each).

---

## 3A. Chapter-Level 3D Scoring

**File:** `src/services/archiveChapterEngine.ts`

### Scoring function

Reuses the same 3D scoring formula from `archiveMemory.ts`:
```
score = (0.5 × recency) + (1.0 × importance) + (2.0 × activation)
```

Adapted for chapters:

```ts
function scoreChapter(
    chapter: ArchiveChapter,
    contextActivations: Record<string, number>,
    totalChapters: number,
    semanticFacts?: SemanticFact[]
): number {
    // D1: Recency — use sceneRange midpoint position relative to total scenes
    const midScene = (parseInt(chapter.sceneRange[0]) + parseInt(chapter.sceneRange[1])) / 2;
    const latestScene = ...; // derived from total scenes or open chapter start
    const chaptersSince = latestScene - midScene;
    const recencyBonus = 1 / (1 + Math.log(1 + Math.max(0, chaptersSince)));

    // D2: Intrinsic importance — derived from majorEvents count + has unresolved threads
    const importance = Math.min(10, 3 + chapter.majorEvents.length + (chapter.unresolvedThreads.length * 2));

    // D3: Activation strength — keyword + NPC match against current context
    let activation = 0;
    for (const keyword of chapter.keywords) {
        const kw = keyword.toLowerCase();
        if (contextActivations[kw]) {
            activation += contextActivations[kw] * 1.0;
        }
    }
    for (const npc of chapter.npcs) {
        const npcLower = npc.toLowerCase();
        if (contextActivations[npcLower]) {
            activation += contextActivations[npcLower] * 2.0; // NPCs weighted higher
        }
    }

    return (0.5 * recencyBonus) + (1.0 * importance) + (2.0 * activation);
}
```

### Rank function

```ts
export function rankChapters(
    chapters: ArchiveChapter[],
    userMessage: string,
    recentMessages: ChatMessage[],
    npcLedger?: NPCEntry[],
    semanticFacts?: SemanticFact[]
): ArchiveChapter[] {
    // Only score sealed chapters with summaries
    const sealed = chapters.filter(c => c.sealedAt && c.summary);

    if (sealed.length === 0) return [];

    const contextActivations = extractContextActivations(userMessage, recentMessages, npcLedger);
    const expandedActivations = expandActivationsWithFacts(contextActivations, semanticFacts);

    const totalChapters = sealed.length;
    const scored = sealed.map(ch => ({
        chapter: ch,
        score: scoreChapter(ch, expandedActivations, totalChapters, semanticFacts),
    }));

    return scored
        .filter(s => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .map(s => s.chapter);
}
```

**Note:** Reuse `extractContextActivations()` and `expandActivationsWithFacts()` from `archiveMemory.ts`. These are already exported or can be exported.

---

## 3B. Iterative LLM Validation

**File:** `src/services/archiveChapterEngine.ts`

### Validation function

```ts
const MAX_LLM_ITERATIONS = 5;
const MAX_CONFIRMED_CHAPTERS = 3;

async function validateChapterRelevance(
    chapter: ArchiveChapter,
    userMessage: string,
    recentContext: string,
    provider: EndpointConfig | ProviderConfig
): Promise<boolean> {
    const prompt = [
        'You are a TTRPG story continuity checker. Given the current situation and a chapter summary, is this chapter relevant?',
        '',
        'Respond with ONLY: YES or NO',
        '',
        'CURRENT SITUATION:',
        userMessage,
        '',
        'RECENT CONTEXT:',
        recentContext.slice(-500), // keep it small
        '',
        'CHAPTER SUMMARY:',
        `Title: ${chapter.title}`,
        `Scenes: ${chapter.sceneRange[0]}-${chapter.sceneRange[1]}`,
        chapter.summary.slice(0, 300), // truncate to keep prompt small
        `NPCs: ${chapter.npcs.join(', ')}`,
        `Key events: ${chapter.majorEvents.slice(0, 3).join('; ')}`,
    ].join('\n');

    try {
        const url = `${provider.endpoint.replace(/\/+$/, '')}/chat/completions`;
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (provider.apiKey) headers['Authorization'] = `Bearer ${provider.apiKey}`;

        const res = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                model: provider.modelName,
                messages: [{ role: 'user', content: prompt }],
                stream: false,
                max_tokens: 10, // we only need YES/NO
            }),
        });

        if (!res.ok) return true; // on failure, assume relevant (don't lose data)

        const data = await res.json();
        const answer = (data.choices?.[0]?.message?.content ?? '').trim().toUpperCase();
        return answer.startsWith('YES');
    } catch {
        return true; // on error, assume relevant
    }
}
```

### Iterative loop

```ts
export async function iterativeChapterFilter(
    rankedChapters: ArchiveChapter[],
    userMessage: string,
    recentMessages: ChatMessage[],
    utilityProvider?: EndpointConfig | ProviderConfig
): Promise<ArchiveChapter[]> {
    // If no utility AI configured, accept top 3 by 3D score (graceful degradation)
    if (!utilityProvider) {
        return rankedChapters.slice(0, MAX_CONFIRMED_CHAPTERS);
    }

    const recentContext = recentMessages.slice(-5).map(m => m.content || '').join('\n');
    const confirmed: ArchiveChapter[] = [];
    let iterations = 0;

    for (const chapter of rankedChapters) {
        if (confirmed.length >= MAX_CONFIRMED_CHAPTERS) break;
        if (iterations >= MAX_LLM_ITERATIONS) break;

        const isRelevant = await validateChapterRelevance(
            chapter, userMessage, recentContext, utilityProvider
        );
        iterations++;

        if (isRelevant) {
            confirmed.push(chapter);
        }
        // If NO → continue to next ranked chapter
    }

    return confirmed;
}
```

### Cost estimate
- Per iteration: ~200 tokens input, ~5 tokens output
- Worst case (5 iterations): ~1000 input + ~25 output = ~1025 tokens
- Uses `utilityAI` endpoint — designated for cheap/fast calls

---

## 3C. Scene Drill-Down Within Confirmed Chapters

**File:** `src/services/archiveMemory.ts`

### Add sceneRange filter to existing retrieval

```ts
export function retrieveArchiveMemory(
    index: ArchiveIndexEntry[],
    userMessage: string,
    recentMessages: ChatMessage[],
    npcLedger?: NPCEntry[],
    maxScenes?: number,
    semanticFacts?: { subject: string; predicate: string; object: string; importance: number }[],
    sceneRanges?: [string, string][]  // NEW optional parameter
): string[] {
    // ... existing code ...

    // NEW: If sceneRanges provided, filter index to only those ranges
    let scopedIndex = index;
    if (sceneRanges && sceneRanges.length > 0) {
        scopedIndex = index.filter(entry => {
            const sceneNum = parseInt(entry.sceneId, 10);
            return sceneRanges.some(([start, end]) => {
                const s = parseInt(start, 10);
                const e = parseInt(end, 10);
                return sceneNum >= s && sceneNum <= e;
            });
        });
    }

    const totalScenes = scopedIndex.length; // was: index.length
    const scored = scopedIndex.map(entry => ({  // was: index.map
        sceneId: entry.sceneId,
        score: scoreEntry(entry, contextText, contextActivations, totalScenes),
    }));

    // ... rest unchanged ...
}
```

**Backward compatible:** If `sceneRanges` is undefined, existing behavior is unchanged.

### Export helpers from archiveMemory.ts

Export `extractContextActivations` and `expandActivationsWithFacts` so `archiveChapterEngine.ts` can reuse them.

---

## 3D. Main Funnel Orchestrator

**File:** `src/services/archiveChapterEngine.ts`

```ts
export async function recallWithChapterFunnel(
    chapters: ArchiveChapter[],
    index: ArchiveIndexEntry[],
    userMessage: string,
    recentMessages: ChatMessage[],
    npcLedger?: NPCEntry[],
    semanticFacts?: SemanticFact[],
    utilityProvider?: EndpointConfig | ProviderConfig,
    campaignId?: string,
    tokenBudget = 3000
): Promise<ArchiveScene[]> {
    // ─── Phase 1: Chapter-level 3D scoring ───
    const ranked = rankChapters(chapters, userMessage, recentMessages, npcLedger, semanticFacts);

    if (ranked.length === 0) {
        // No sealed chapters with summaries — fall back to open chapter scenes only
        // or full flat retrieval handled by caller
        return [];
    }

    // ─── Phase 2: Iterative LLM validation ───
    const confirmed = await iterativeChapterFilter(
        ranked, userMessage, recentMessages, utilityProvider
    );

    // ─── Phase 3: Build scene ranges ───
    const sceneRanges: [string, string][] = confirmed.map(ch => ch.sceneRange);

    // Always include the open chapter's scenes
    const openChapter = chapters.find(c => !c.sealedAt);
    if (openChapter) {
        sceneRanges.push(openChapter.sceneRange);
    }

    // ─── Phase 4: Scene-level 3D scoring within ranges ───
    const matchedIds = retrieveArchiveMemory(
        index, userMessage, recentMessages, npcLedger,
        undefined, semanticFacts, sceneRanges
    );

    if (matchedIds.length === 0) return [];

    // ─── Phase 5: Fetch within budget ───
    if (!campaignId) return [];
    return fetchArchiveScenes(campaignId, matchedIds, tokenBudget);
}
```

---

## 3E. Fallback Behavior

The funnel is **opt-in**. The calling code (turnOrchestrator in Phase 4) handles the fallback:

```ts
// In turnOrchestrator.ts (Phase 4):
const hasSealedChapters = chapters.some(c => c.sealedAt && c.summary);

if (hasSealedChapters) {
    archiveScenes = await recallWithChapterFunnel(chapters, ...);
} else {
    archiveScenes = await recallArchiveScenes(campaignId, index, ...); // existing
}
```

No behavioral regression for early campaigns.

---

## 3F. Testing Strategy

Phase 3 is the most algorithm-heavy phase. Tests must cover the 3D scoring math, the iterative LLM loop, and the full funnel end-to-end. LLM validation tests use mocked responses.

### Unit tests (pure functions — no mocks needed)

#### scoreChapter
```
test: Recency bonus decreases as chaptersSince increases (logarithmic decay)
test: Importance scales with majorEvents.length + unresolvedThreads.length
test: Activation score increases when chapter keywords match context activations
test: NPC matches contribute 2x weight compared to keyword matches
test: Chapter with zero keyword/NPC overlap scores only recency + importance
test: Returns 0 or positive (never negative)
```

#### rankChapters
```
test: Filters out unsealed chapters (no sealedAt)
test: Filters out chapters with empty summary
test: Returns chapters sorted by score descending
test: Returns empty array when no sealed chapters exist
test: Handles edge case of single sealed chapter
```

#### sceneRanges filtering (3C)
```
test: retrieveArchiveMemory with sceneRanges filters index to matching scenes only
test: retrieveArchiveMemory without sceneRanges uses full index (backward compatible)
test: Multiple sceneRanges are unioned (scenes matching ANY range are included)
test: Scene at exact boundary of range is included (inclusive)
```

### Integration tests (mocked fetch for LLM calls)

#### validateChapterRelevance
```
test: Returns true when LLM responds "YES"
test: Returns false when LLM responds "NO"
test: Returns true on LLM API failure (fail-open, never lose data)
test: Returns true on network error (fail-open)
test: Prompt is under 300 tokens (verify prompt construction is compact)
test: max_tokens is set to 10 (verify minimal output budget)
```

#### iterativeChapterFilter
```
test: Stops after MAX_CONFIRMED_CHAPTERS (3) confirmed
test: Stops after MAX_LLM_ITERATIONS (5) even if not enough confirmed
test: With no utility provider, returns top 3 by score (graceful degradation)
test: Processes chapters in ranked order (best score first)
test: Skips rejected chapters and continues to next
```

#### recallWithChapterFunnel (full pipeline)
```
test: End-to-end: 5 sealed chapters → ranks → validates top → drills into confirmed → returns scenes
    → Mock LLM to confirm chapters 1 and 3, reject 2
    → Verify returned scenes are from chapters 1, 3, and the open chapter only
test: Returns empty array when no sealed chapters have summaries
test: Always includes open chapter scenes in the final result
test: Respects tokenBudget parameter (does not exceed 3000 tokens)
test: With all chapters rejected by LLM, returns empty array (caller handles fallback)
```

### Implementation notes

- For `scoreChapter` tests, create synthetic `ArchiveChapter` objects with controlled field values
- For LLM mock tests, mock `fetch` to return `{ choices: [{ message: { content: "YES" } }] }`
- Test the full pipeline with 5-10 synthetic chapters to verify ranking + filtering + scene fetch works end-to-end
- Verify `extractContextActivations` and `expandActivationsWithFacts` exports compile without error after being made public

---

## Checklist

- [ ] 3A: `scoreChapter()` in `archiveChapterEngine.ts`
- [ ] 3A: `rankChapters()` in `archiveChapterEngine.ts`
- [ ] 3A: Export `extractContextActivations` and `expandActivationsWithFacts` from `archiveMemory.ts`
- [ ] 3B: `validateChapterRelevance()` in `archiveChapterEngine.ts`
- [ ] 3B: `iterativeChapterFilter()` in `archiveChapterEngine.ts`
- [ ] 3B: Constants `MAX_LLM_ITERATIONS`, `MAX_CONFIRMED_CHAPTERS`
- [ ] 3C: Add `sceneRanges` optional param to `retrieveArchiveMemory()`
- [ ] 3C: Scoped index filtering when `sceneRanges` provided
- [ ] 3D: `recallWithChapterFunnel()` main orchestrator
- [ ] 3E: Fallback logic documented (implemented in Phase 4)
- [ ] 3F: Unit tests for scoreChapter
- [ ] 3F: Unit tests for rankChapters
- [ ] 3F: Unit tests for sceneRanges filtering
- [ ] 3F: Integration tests for validateChapterRelevance (mocked LLM)
- [ ] 3F: Integration tests for iterativeChapterFilter
- [ ] 3F: End-to-end test for recallWithChapterFunnel

## Decisions Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| LLM validation endpoint | `utilityAI` | Designated for cheap/fast classification; already used by contextRecommender |
| Max LLM iterations | 5 | Bounds cost; worst case ~1000 tokens total |
| Max confirmed chapters | 3 | 3 chapters × ~1000 tokens each = 3000 token budget fits well |
| Prompt size per validation | ~200 tokens | Chapter summary truncated to 300 chars + minimal context |
| LLM failure mode | Assume relevant | Never lose data due to API errors |
| No utility AI fallback | Accept top 3 by score | Graceful degradation — 3D scoring alone is still useful |
| Scene scoring scope | Confirmed chapters + open chapter | Open chapter always included (it's current context) |

## Open Questions

- Should the `sceneRanges` parameter also accept individual scene IDs (for direct recall by ID)?
- Should we cache LLM validation results within a session? (e.g., if Chapter 3 is validated YES, don't re-check for the next few turns)
