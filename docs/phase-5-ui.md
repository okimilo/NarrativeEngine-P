# Phase 5 — UI: Chapter Management

**Status:** Not started
**Depends on:** Phase 1 (types, state), Phase 2 (lifecycle, summary generation)
**Goal:** User can see, manage, and interact with chapters in the context drawer.

---

## 5A. ChapterTab Component

**New file:** `src/components/context-drawer/ChapterTab.tsx`

### Layout

```
┌─────────────────────────────────────────────────┐
│  CHAPTERS                              [+ New]  │
├─────────────────────────────────────────────────┤
│                                                  │
│  ┌─ CH01: Arrival at the Hidden Leaf ────────┐  │
│  │  Scenes 001–023  │  Sealed  │  23 scenes  │  │
│  │  Themes: belonging, rivalry               │  │
│  │  NPCs: Naruto, Sasuke, Iruka              │  │
│  │  ▼ Summary                                 │  │
│  │  Player arrives in Konoha and enrolls...   │  │
│  │  ▼ Threads                                 │  │
│  │  • Sasuke's mysterious goal (High)         │  │
│  │  • Academy exam upcoming (Medium)          │  │
│  │                      [Regenerate Summary]  │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
│  ┌─ CH02: The Forest of Death ───────────────┐  │
│  │  Scenes 024–041  │  Sealed  │  18 scenes  │  │
│  │  ⚠ INVALIDATED — summary may be stale     │  │
│  │  ...                                       │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
│  ┌─ CH03: Open Chapter ──────────────────────┐  │
│  │  Scenes 042–058  │  OPEN  │  17 scenes    │  │
│  │                    [Seal This Chapter]     │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
└─────────────────────────────────────────────────┘
```

### Component structure

```tsx
const ChapterTab: React.FC = () => {
    const { chapters, activeCampaignId } = useAppStore();
    const [expandedId, setExpandedId] = useState<string | null>(null);

    // Actions
    const handleSeal = async (chapterId: string) => { ... };
    const handleRegenerate = async (chapterId: string) => { ... };
    const handleRename = async (chapterId: string, newTitle: string) => { ... };
    const handleMerge = async (idA: string, idB: string) => { ... };
    const handleSplit = async (chapterId: string, atSceneId: string) => { ... };

    return (
        <div className="space-y-2">
            <header>...</header>
            {chapters.map(ch => (
                <ChapterCard
                    key={ch.chapterId}
                    chapter={ch}
                    expanded={expandedId === ch.chapterId}
                    onToggle={() => setExpandedId(...)}
                    onSeal={handleSeal}
                    onRegenerate={handleRegenerate}
                    onRename={handleRename}
                />
            ))}
        </div>
    );
};
```

### ChapterCard sub-component

Each card shows:
- **Title** — editable inline (click to edit, blur to save)
- **Status badge** — color-coded: `SEALED` (green), `OPEN` (amber), `INVALIDATED` (red)
- **Scene range** — `"Scenes 001–023 (23 scenes)"`
- **Expandable detail panel:**
  - Summary text
  - NPCs list (clickable? future enhancement)
  - Themes tags
  - Major events list
  - Unresolved threads with pressure indicators
  - Tone label
- **Actions** (context-dependent):
  - Sealed chapter: "Regenerate Summary" button
  - Invalidated chapter: "Regenerate Summary" button (prominent, warning color)
  - Open chapter: "Seal Chapter" button
  - Adjacent chapters: "Merge" option (appears when two chapters are selected)

### Styling

Follow existing context drawer patterns:
- Dark theme (`bg-void-lighter`, `border-border`, `text-text-primary`)
- Monospace font for data fields
- Color-coded badges matching existing system (`text-terminal`, `text-ember`, `text-ice`)
- Compact layout — chapters are metadata, not content

---

## 5B. Chapter Actions

### Seal Chapter

```ts
const handleSeal = async () => {
    const result = await api.archive.sealChapter(activeCampaignId, { title: optionalTitle });
    setChapters(await api.chapters.list(activeCampaignId));
    // Trigger async summary generation
    generateSummaryAsync(result.sealed);
};
```

Uses `POST /archive/chapters/seal` endpoint from Phase 2C.

### Regenerate Summary

```ts
const handleRegenerate = async (chapterId: string) => {
    const chapter = chapters.find(c => c.chapterId === chapterId);
    if (!chapter || !chapter.sealedAt) return;

    // Show loading state on the chapter card
    setRegeneratingId(chapterId);

    try {
        await generateSummaryAsync(chapter); // reuse from Phase 4C
    } finally {
        setRegeneratingId(null);
    }
};
```

### Merge Chapters

**New server endpoint:** `POST /api/campaigns/:id/archive/chapters/merge`

Body: `{ chapterA: "CH01", chapterB: "CH02" }`

Server logic:
1. Validate both chapters exist and are adjacent. **Use array position adjacency** (`chapters.indexOf(B) === chapters.indexOf(A) + 1`), NOT scene range arithmetic (`B.sceneRange[0] === A.sceneRange[1] + 1`). Scene range math breaks when rollbacks create gaps in scene numbering.
2. Merge: new `sceneRange = [A.sceneRange[0], B.sceneRange[1]]`
3. Merge keywords, NPCs (union, dedupe)
4. Mark merged chapter as `invalidated = true` (summary needs regeneration)
5. Delete chapter B
6. Return merged chapter

Client: refresh chapters, trigger summary generation for the merged chapter.

### Split Chapter

**New server endpoint:** `POST /api/campaigns/:id/archive/chapters/:chapterId/split`

Body: `{ atSceneId: "015" }`

Server logic:
1. Validate chapter exists and `atSceneId` is within its sceneRange
2. Split into two chapters:
   - Chapter A: `sceneRange[0]` to `atSceneId - 1`
   - Chapter B: `atSceneId` to `sceneRange[1]`
3. Both marked `invalidated` (summaries stale)
4. Return both chapters

Client: refresh chapters, trigger summary generation for both.

### Rename Chapter

Inline editing in the ChapterCard:
```ts
const handleRename = async (chapterId: string, newTitle: string) => {
    await api.chapters.update(activeCampaignId, chapterId, { title: newTitle });
    setChapters(await api.chapters.list(activeCampaignId));
};
```

Uses `PATCH /archive/chapters/:chapterId` from Phase 1B.

---

## 5C. Context Drawer Integration

**File:** `src/components/context-drawer/ContextDrawer.tsx`

Add a new tab to the existing drawer tabs:

```tsx
// Add "Chapters" tab alongside existing tabs (Save File, Lore, NPCs, etc.)
const tabs = [
    { id: 'savefile', label: 'Save File', icon: Save },
    { id: 'chapters', label: 'Chapters', icon: BookOpen },  // NEW
    { id: 'lore', label: 'Lore', icon: Scroll },
    { id: 'npcs', label: 'NPCs', icon: Users },
    // ... existing tabs
];
```

Import `ChapterTab` component and render when tab is active:

```tsx
{activeTab === 'chapters' && <ChapterTab />}
```

### Icon choice
Use `BookOpen` from lucide-react (already a dependency). Alternatively `Library`, `BookmarkOpen`, or `BookMarked`.

---

## 5D. Optional Enhancements (Future)

These are not in scope for Phase 5 but worth noting for later:

### Chapter progress indicator
A small visual in the chat area showing current chapter name + scene count. Like a "Chapter 3 — Scene 45/25+" mini-banner.

### Chapter jump
Click a chapter to load its scenes in a read-only modal. Let the user browse past chapters without affecting current context.

### Chapter search
Search within chapter summaries. Useful for long campaigns with 20+ chapters.

### Drag-and-drop reorder
Allow merging by dragging one chapter onto another.

---

## 5E. Testing Strategy

Tests for this phase cover server endpoints and UI behavior. No live LLM calls needed — mock all API responses.

### Server endpoint tests (mocked filesystem)

#### Merge endpoint
```
test: POST /archive/chapters/merge succeeds when chapters are array-adjacent
test: POST /archive/chapters/merge rejects when chapters are NOT array-adjacent
test: POST /archive/chapters/merge rejects when either chapter does not exist
test: Merged chapter has sceneRange = [A.start, B.end]
test: Merged chapter has union of keywords and NPCs (deduped)
test: Merged chapter has invalidated = true and sealedAt cleared
test: Chapter B is deleted from the array after merge
```

#### Split endpoint
```
test: POST /archive/chapters/:id/split succeeds when atSceneId is within chapter range
test: POST /archive/chapters/:id/split rejects when atSceneId is outside chapter range
test: Both resulting chapters have invalidated = true
test: Chapter A range is [original.start, atSceneId - 1], Chapter B range is [atSceneId, original.end]
```

### Component tests (React Testing Library or equivalent)

#### ChapterTab
```
test: Renders correct number of ChapterCard components from store
test: Shows SEALED badge (green) for sealed chapters with summary
test: Shows OPEN badge (amber) for chapters without sealedAt
test: Shows INVALIDATED badge (red) for chapters with invalidated = true
test: Expand/collapse toggles detail panel visibility
test: Inline title edit calls api.chapters.update on blur
```

#### ChapterCard actions
```
test: "Seal Chapter" button only appears on open chapters
test: "Regenerate Summary" button appears on sealed chapters
test: "Regenerate Summary" has warning styling on invalidated chapters
test: Clicking "Seal Chapter" calls POST /archive/chapters/seal and refreshes state
```

### Implementation notes

- Use the project's existing test framework or add `vitest` + `@testing-library/react`
- Mock `api.chapters.*` calls to return controlled responses
- Mock `useAppStore` to inject test chapter arrays
- For component tests, verify DOM output rather than internal state

---

## Checklist

- [ ] 5A: Create `ChapterTab.tsx` component
- [ ] 5A: `ChapterCard` sub-component with expand/collapse
- [ ] 5A: Inline title editing
- [ ] 5A: Status badges (SEALED / OPEN / INVALIDATED)
- [ ] 5A: Scene range display
- [ ] 5A: Expandable detail (summary, NPCs, themes, events, threads)
- [ ] 5B: Seal Chapter button + handler
- [ ] 5B: Regenerate Summary button + handler
- [ ] 5B: `POST /archive/chapters/merge` server endpoint
- [ ] 5B: Merge chapters UI action
- [ ] 5B: `POST /archive/chapters/:chapterId/split` server endpoint
- [ ] 5B: Split chapters UI action
- [ ] 5B: Rename handler (inline edit)
- [ ] 5C: Add Chapters tab to ContextDrawer
- [ ] 5C: Import and render ChapterTab
- [ ] 5E: Server endpoint tests for merge
- [ ] 5E: Server endpoint tests for split
- [ ] 5E: Component tests for ChapterTab rendering
- [ ] 5E: Component tests for ChapterCard actions

## Decisions Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Tab placement | Between Save File and Lore | Chapters are structural metadata, fits between state and world-building |
| Merge behavior | Mark invalidated, trigger re-summary | Merged chapter summary is stale; auto-regen is better than keeping two partial summaries |
| Merge adjacency check | Array position (`indexOf`), NOT scene range arithmetic | Scene range math breaks when rollbacks create gaps in numbering |
| Split behavior | Both halves invalidated | Same rationale as merge |
| Inline editing | Click-to-edit on title field | Matches existing UI patterns in the app |
| Invalidated visual | Red badge + warning text | Clear signal to user that summary needs attention |
| Mobile parity | Deferred — not in scope for this phase | Engine logic in `archiveChapterEngine.ts` is portable; server endpoints + UI will be replicated separately |

## Open Questions

- Should merge/split require confirmation? (Recommend: yes, with a preview)
- Should the ChapterTab show a loading spinner during summary generation?
- Should we add a chapter count badge to the tab label? (e.g., "Chapters (3)")
