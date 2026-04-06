# Phase 4 — Integration: Wire Into Turn Pipeline

**Status:** Not started
**Depends on:** Phase 1 (types, server, state), Phase 2 (lifecycle), Phase 3 (retrieval funnel)
**Goal:** Replace flat retrieval with chapter funnel in the turn orchestrator. Wire rollback sync and auto-seal trigger.

---

## ⚠️ LATENCY DESIGN NOTE

The iterative LLM validation in Phase 3 adds up to 5 serial API calls. With typical utility AI latency (~300-500ms per call for models like minimax-2.7 or gemini-flash), this could add **1.5–2.5 seconds** to turn response time if run synchronously.

**Mandatory mitigation:** The chapter funnel MUST be structured as a **two-stage async pipeline** to avoid blocking the user:

1. **Stage 1 (non-blocking):** 3D chapter scoring runs synchronously — this is pure math, no LLM calls. Produces a ranked chapter list.
2. **Stage 2 (parallel):** LLM validation runs as a **parallel promise** alongside the existing `recommenderPromise`, `factsPromise`, and `timelinePromise`. It races against a **3-second hard timeout**.
3. **Fallback on timeout:** If the LLM validation doesn't complete in 3 seconds, accept the top 3 chapters by 3D score alone (same as the no-utility-AI fallback in Phase 3B).

This ensures the chapter funnel **never adds more than ~100ms** to the critical path (the synchronous scoring), with the LLM validation as a best-effort enhancement.

---

## 4A. Turn Orchestrator: Swap Retrieval

**File:** `src/services/turnOrchestrator.ts`

### Current flow (simplified)

```ts
// Current: flat retrieval over entire archive index
const archiveScenes = await recallArchiveScenes(
    campaignId, archiveIndex, userMessage, recentMessages,
    3000, npcLedger, semanticFacts
);
```

### New flow (two-stage with timeout)

```ts
// New: chapter funnel with two-stage pipeline and timeout fallback

const chapters = useAppStore.getState().chapters;
const hasSealedChapters = chapters.some(c => c.sealedAt && c.summary);

let archiveScenes: ArchiveScene[];

if (hasSealedChapters) {
    const utilityConfig = getUtilityProvider();

    // Stage 1: Synchronous 3D scoring (pure math, ~1ms)
    const rankedChapters = rankChapters(
        chapters, userMessage, recentMessages, npcLedger, semanticFacts
    );

    // Stage 2: LLM validation with hard timeout
    // This runs as a promise alongside other parallel work
    const FUNNEL_TIMEOUT_MS = 3000;

    const funnelPromise = recallWithChapterFunnel(
        chapters, archiveIndex, userMessage, recentMessages,
        npcLedger, semanticFacts, utilityConfig,
        campaignId, 3000, rankedChapters // pass pre-ranked to skip redundant scoring
    );

    const timeoutPromise = new Promise<ArchiveScene[]>((resolve) => {
        setTimeout(() => {
            console.warn('[ChapterFunnel] LLM validation timed out after 3s — falling back to top-3 by 3D score');
            // Fallback: use top 3 ranked chapters without LLM validation
            const fallbackRanges: [string, string][] = rankedChapters.slice(0, 3).map(ch => ch.sceneRange);
            const openChapter = chapters.find(c => !c.sealedAt);
            if (openChapter) fallbackRanges.push(openChapter.sceneRange);

            const matchedIds = retrieveArchiveMemory(
                archiveIndex, userMessage, recentMessages, npcLedger,
                undefined, semanticFacts, fallbackRanges
            );
            fetchArchiveScenes(campaignId!, matchedIds, 3000).then(resolve).catch(() => resolve([]));
        }, FUNNEL_TIMEOUT_MS);
    });

    archiveScenes = await Promise.race([funnelPromise, timeoutPromise]);

    // Double-fallback: if funnel returned nothing, try flat retrieval
    if (archiveScenes.length === 0) {
        console.warn('[ChapterFunnel] Funnel returned 0 scenes — falling back to flat archive retrieval. '
            + 'This may indicate chapter summaries are too sparse or scoring thresholds are too aggressive.');
        archiveScenes = await recallArchiveScenes(
            campaignId, archiveIndex, userMessage, recentMessages,
            3000, npcLedger, semanticFacts
        );
    }
} else {
    // No sealed chapters — use existing flat retrieval unchanged
    archiveScenes = await recallArchiveScenes(
        campaignId, archiveIndex, userMessage, recentMessages,
        3000, npcLedger, semanticFacts
    );
}
```

### Utility provider extraction

```ts
function getUtilityProvider(): EndpointConfig | undefined {
    const settings = useAppStore.getState().settings;
    const activePreset = settings.presets.find(p => p.id === settings.activePresetId);
    return activePreset?.utilityAI;
}
```

### Summarizer provider extraction

```ts
function getSummarizerProvider(): EndpointConfig | undefined {
    const settings = useAppStore.getState().settings;
    const activePreset = settings.presets.find(p => p.id === settings.activePresetId);
    return activePreset?.summarizerAI;
}
```

### Pass-through changes
- `turnOrchestrator` needs access to chapters from store (already accessible via `useAppStore.getState()`)
- No signature changes needed to `buildPayload()` — it already receives `ArchiveScene[]`
- Import `rankChapters` from `archiveChapterEngine.ts` (so scoring can run before the full funnel)
- Import `retrieveArchiveMemory`, `fetchArchiveScenes` from `archiveMemory.ts` (for timeout fallback)

### Integration into parallel promise block

The chapter funnel replaces the existing `archivePromise` in the `Promise.all` block:

```ts
// BEFORE (current):
const archivePromise = (archiveIndex.length > 0 && activeCampaignId)
    ? recallArchiveScenes(...)
    : Promise.resolve();

// AFTER (new):
const archivePromise = (archiveIndex.length > 0 && activeCampaignId)
    ? (hasSealedChapters
        ? Promise.race([funnelPromise, timeoutPromise])
        : recallArchiveScenes(...))
        .then(res => archiveRecall = res)
        .catch(() => { /* ignored */ })
    : Promise.resolve();
```

This keeps the funnel inside the existing parallel execution model. No structural changes to the Promise.all block.

---

## 4B. ChatArea: Rollback Sync

**File:** `src/components/ChatArea.tsx`

### Current flow

```ts
const rollbackArchiveFrom = async (fromTimestamp: number) => {
    // ...
    await api.archive.deleteFrom(campaignId, target.sceneId);
    const freshIndex = await api.archive.getIndex(campaignId);
    setArchiveIndex(freshIndex);
    const freshFacts = await api.facts.get(campaignId);
    setSemanticFacts(freshFacts);
};
```

### Enhanced flow

```ts
const rollbackArchiveFrom = async (fromTimestamp: number) => {
    // ...
    const result = await api.archive.deleteFrom(campaignId, target.sceneId);

    // Refresh index + facts (existing)
    const freshIndex = await api.archive.getIndex(campaignId);
    setArchiveIndex(freshIndex);
    const freshFacts = await api.facts.get(campaignId);
    setSemanticFacts(freshFacts);

    // NEW: Refresh chapters if server indicates they were affected
    if (result.chaptersRepaired) {
        const freshChapters = await api.chapters.list(campaignId);
        setChapters(freshChapters);
    }

    // NEW: Reset condenser state (fixes pre-existing bug)
    // The condensed summary may reference deleted scenes.
    // Safest approach: reset and let re-condensation happen naturally.
    if (result.condenserResetRecommended) {
        useAppStore.getState().setCondenser({
            condensedSummary: '',
            condensedUpToIndex: -1,
            isCondensing: false,
        });
    }
};
```

### Condenser state setter

**File:** `src/store/slices/chatSlice.ts`

Need to add (or verify existence of) a `setCondenser` action:

```ts
setCondenser: (state: CondenserState) => set({ condenser: state }),
```

### handleEditSubmit + handleRegenerate

Both already call `rollbackArchiveFrom()`. The enhanced version handles chapter sync automatically. No additional changes needed in these handlers.

### handleClearArchive

```ts
const handleClearArchive = async () => {
    // ... existing confirmation + clear call ...
    clearArchive();

    // NEW: Also clear chapters
    const result = await api.archive.clear(activeCampaignId);
    if (result.chaptersCleared) {
        setChapters([]);
    }

    // NEW: Also reset condenser
    useAppStore.getState().setCondenser({
        condensedSummary: '',
        condensedUpToIndex: -1,
        isCondensing: false,
    });
};
```

---

## 4C. ChatArea: Auto-Seal Trigger

**File:** `src/components/ChatArea.tsx`

### Post-turn hook

After the turn completes successfully (after archive append, NPC detection, and condensation):

```ts
// After turn completion in handleSend or turnOrchestrator callback:
const checkAutoSeal = async () => {
    const { chapters, archiveIndex, context } = useAppStore.getState();
    const { shouldSeal, reason } = shouldAutoSeal(chapters, archiveIndex, context.headerIndex);

    if (!shouldSeal) return;

    console.log(`[Chapter] Auto-sealing chapter: ${reason}`);

    try {
        const { sealedChapter, newOpenChapter } = await sealChapter(
            activeCampaignId, chapters, archiveIndex
        );

        // Persist both
        await api.chapters.update(activeCampaignId, sealedChapter.chapterId, sealedChapter);
        await api.chapters.create(activeCampaignId, { title: newOpenChapter.title });

        // Update local state
        const freshChapters = await api.chapters.list(activeCampaignId);
        setChapters(freshChapters);

        // Trigger async summary generation (fire-and-forget)
        // IMPORTANT: Capture all needed state NOW before the async gap.
        // Do NOT read from useAppStore.getState() inside the async callback —
        // the store may have changed by the time summary generation completes.
        const capturedArchiveIndex = freshChapters; // we just refreshed
        const capturedHeaderIndex = useAppStore.getState().context.headerIndex;
        const capturedProvider = getSummarizerProvider();

        generateSummaryAsync(sealedChapter, capturedArchiveIndex, capturedHeaderIndex, capturedProvider);
    } catch (err) {
        console.warn('[Chapter] Auto-seal failed:', err);
    }
};
```

### Async summary generation helper

**⚠️ Stale closure prevention:** This function receives all needed state as arguments. It does NOT read from `useAppStore.getState()` during execution — only at the end to persist results.

```ts
const generateSummaryAsync = async (
    chapter: ArchiveChapter,
    currentArchiveIndex: ArchiveIndexEntry[],
    currentHeaderIndex: string,
    provider: EndpointConfig | undefined
) => {
    if (!provider) {
        console.warn(`[Chapter] No summarizer provider configured — skipping summary for ${chapter.chapterId}`);
        return;
    }

    try {
        // Filter archive index to scenes within this chapter's range
        const chapterSceneIds = currentArchiveIndex
            .filter(e => {
                const num = parseInt(e.sceneId, 10);
                return num >= parseInt(chapter.sceneRange[0], 10)
                    && num <= parseInt(chapter.sceneRange[1], 10);
            })
            .map(e => e.sceneId);

        const scenes = await fetchArchiveScenes(
            activeCampaignId,
            chapterSceneIds,
            8000 // input budget for summary generation
        );

        const summary = await generateChapterSummary(
            provider, chapter,
            scenes.map(s => ({ sceneId: s.sceneId, content: s.content })),
            currentHeaderIndex // use the captured value, not a fresh read
        );

        // Persist filled summary — this is the ONLY point we touch the store
        await api.chapters.update(activeCampaignId, chapter.chapterId, {
            ...chapter,
            ...summary,
        });

        // Refresh state with latest from server
        const freshChapters = await api.chapters.list(activeCampaignId);
        setChapters(freshChapters);

        console.log(`[Chapter] Summary generated for ${chapter.chapterId}`);
    } catch (err) {
        console.warn(`[Chapter] Summary generation failed for ${chapter.chapterId}:`, err);
        // Chapter remains sealed with empty summary — can retry from UI
    }
};
```

---

## 4D. turnOrchestrator: Chapter-Aware Condensation Input

**File:** `src/services/turnOrchestrator.ts`

When triggering the save file pipeline, pass awareness of the current chapter boundary:

```ts
// Before running saveFilePipeline, check if we just crossed a chapter boundary
// This is informational — the condenser doesn't need to change behavior,
// but the header index generator benefits from knowing the chapter context
```

**No changes needed** for this in Phase 4. The condenser and saveFileEngine already work on the full message array. Chapter awareness is purely at the retrieval layer.

---

## 4E. Testing Strategy

This phase has the highest integration complexity. The following tests MUST be written alongside the implementation. Tests should use mocked LLM responses (no live API calls).

### Unit tests (pure functions, no mocks needed)

```
test: getUtilityProvider() returns undefined when no utilityAI configured
test: getUtilityProvider() returns correct endpoint from active preset
test: getSummarizerProvider() returns correct endpoint from active preset
```

### Integration tests (mocked fetch / mocked API)

#### 4A — Funnel integration
```
test: When hasSealedChapters is false, uses flat recallArchiveScenes (no funnel)
test: When hasSealedChapters is true, calls recallWithChapterFunnel
test: When funnel returns empty array, falls back to flat recallArchiveScenes
    → verify console.warn is emitted with diagnostic message
test: When funnel exceeds 3-second timeout, falls back to top-3-by-score
    → mock recallWithChapterFunnel to delay 5 seconds
    → verify result comes from timeout fallback path
    → verify console.warn is emitted
test: Funnel result is passed to buildPayload as archiveRecall (same shape)
```

#### 4B — Rollback sync
```
test: rollbackArchiveFrom refreshes chapters when result.chaptersRepaired is true
test: rollbackArchiveFrom does NOT refresh chapters when chaptersRepaired is false
test: rollbackArchiveFrom resets condenser when condenserResetRecommended is true
test: handleClearArchive clears chapters and resets condenser
```

#### 4C — Auto-seal
```
test: checkAutoSeal does nothing when shouldAutoSeal returns false
test: checkAutoSeal seals chapter, creates new open, and triggers summary gen
test: generateSummaryAsync does not read from store during execution
    → verify no useAppStore.getState() calls between start and final persist
test: generateSummaryAsync handles provider=undefined gracefully (logs warning, returns)
test: generateSummaryAsync handles fetch failure gracefully (logs warning, chapter keeps empty summary)
```

### Implementation notes for test runner

- Use the project's existing test framework (if any) or add `vitest` as a dev dependency
- Mock `fetch` globally for LLM call tests
- Mock `useAppStore.getState()` to return controlled state snapshots
- For timeout tests, use `vi.useFakeTimers()` to avoid real 3-second waits

---

## Checklist

- [ ] 4A: Import `rankChapters` from `archiveChapterEngine.ts`
- [ ] 4A: Import `retrieveArchiveMemory`, `fetchArchiveScenes` from `archiveMemory.ts`
- [ ] 4A: Add `getUtilityProvider()` helper
- [ ] 4A: Add `getSummarizerProvider()` helper
- [ ] 4A: Two-stage funnel: synchronous 3D scoring + parallel LLM validation with 3s timeout
- [ ] 4A: Timeout fallback to top-3-by-score
- [ ] 4A: Double-fallback to flat retrieval if funnel returns empty (with `console.warn`)
- [ ] 4A: Integrate funnel into existing `Promise.all` parallel block
- [ ] 4B: Enhanced `rollbackArchiveFrom` with chapter refresh
- [ ] 4B: `setCondenser` action in chatSlice (if not existing)
- [ ] 4B: Condenser reset on rollback
- [ ] 4B: Enhanced `handleClearArchive` with chapter + condenser cleanup
- [ ] 4C: `checkAutoSeal()` post-turn hook
- [ ] 4C: `generateSummaryAsync()` with captured state (no stale closures)
- [ ] 4C: Hook into turn completion flow
- [ ] 4E: Unit tests for provider extraction helpers
- [ ] 4E: Integration tests for funnel fallback paths
- [ ] 4E: Integration tests for rollback sync
- [ ] 4E: Integration tests for auto-seal + summary generation

## Decisions Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Funnel execution model | Two-stage: sync scoring + parallel LLM with 3s timeout | Prevents blocking user turn; LLM validation is best-effort enhancement |
| Timeout fallback | Accept top 3 by 3D score | Same as no-utility-AI graceful degradation; proven safe |
| Timeout value | 3 seconds | Balances validation quality vs. UX; typical utility AI (minimax-2.7, gemini-flash, kimi-2.5) responds in 300-800ms per call |
| Funnel fallback | If funnel returns empty, try flat retrieval with diagnostic warning | Safety net — never lose all archive recall; warning aids debugging |
| Stale closure fix | Capture all state as arguments to generateSummaryAsync | Prevents reading stale store during 5-10s async gap |
| Condenser reset on rollback | Full reset (summary = '', index = -1) | Simplest and safest; re-condensation is cheap |
| Auto-seal timing | Post-turn, non-blocking | User sees GM response immediately; seal happens in background |
| Summary generation | Fire-and-forget async with captured state | Doesn't block next turn; failure is non-critical |
| Utility provider extraction | From active preset's `utilityAI` field | Already used by contextRecommender; consistent |
| Summary provider extraction | From active preset's `summarizerAI` field | Already designated for compression/summary tasks |

## Open Questions

- Should the auto-seal check run before or after condensation? (Recommend: after — condensation may change the message landscape)
- Should we log auto-seal events in the archive for debugging?
