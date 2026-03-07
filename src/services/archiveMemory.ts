import type { ArchiveIndexEntry, ArchiveScene, ChatMessage } from '../types';
import { countTokens } from './tokenizer';

/**
 * archiveMemory.ts
 *
 * T4 Memory — Index-based retrieval over lossless .archive.md content.
 *
 * Flow:
 *   1. retrieveArchiveMemory() — keyword-scores ArchiveIndexEntry[] → returns ranked scene IDs
 *   2. fetchArchiveScenes()    — fetches full verbatim scene content from server
 *   3. buildPayload()          — injects full scenes into [ARCHIVE RECALL] context block
 */

// ─── Keyword Scoring ───

/**
 * Score an index entry against the current context.
 * Returns a relevance score (higher = more relevant).
 */
function scoreEntry(entry: ArchiveIndexEntry, contextText: string): number {
    let score = 0;

    for (const kw of entry.keywords) {
        if (contextText.includes(kw)) {
            const exactMatch = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
            score += exactMatch.test(contextText) ? 2 : 0.5;
        }
    }

    // NPC name bonus — stronger signal
    for (const npc of entry.npcsMentioned) {
        const lower = npc.toLowerCase();
        if (contextText.includes(lower)) {
            score += 3;
        }
    }

    return score;
}

/**
 * Search the archive index by keyword relevance, return matching scene IDs
 * ranked by score (best first).
 */
export function retrieveArchiveMemory(
    index: ArchiveIndexEntry[],
    userMessage: string,
    recentMessages: ChatMessage[],
    maxScenes = 3
): string[] {
    if (!index || index.length === 0) {
        console.log('[Archive Retrieval] Index is empty — no recall.');
        return [];
    }

    const contextText = [
        userMessage,
        ...recentMessages.slice(-3).map(m => m.content || '')
    ].join('\n').toLowerCase();

    const scored = index.map(entry => ({
        sceneId: entry.sceneId,
        score: scoreEntry(entry, contextText),
    }));

    const candidates = scored
        .filter(s => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, maxScenes);

    console.log(
        `[Archive Retrieval] Scored ${index.length} index entries. ` +
        `${candidates.length} matched. ` +
        `Selected scenes: [${candidates.map(c => c.sceneId).join(', ')}]`
    );

    return candidates.map(c => c.sceneId);
}

/**
 * Fetch full verbatim scene content from the server for a set of scene IDs.
 * Returns scenes within the token budget, sorted chronologically.
 */
export async function fetchArchiveScenes(
    campaignId: string,
    sceneIds: string[],
    tokenBudget = 3000
): Promise<ArchiveScene[]> {
    if (sceneIds.length === 0) return [];

    try {
        const idsParam = sceneIds.join(',');
        const res = await fetch(`/api/campaigns/${campaignId}/archive/scenes?ids=${idsParam}`);
        if (!res.ok) {
            console.warn('[Archive Retrieval] Failed to fetch scenes:', res.status);
            return [];
        }

        const raw: { sceneId: string; content: string }[] = await res.json();

        // Apply token budget, sorted chronologically (lowest scene ID first)
        const sorted = raw.sort((a, b) => parseInt(a.sceneId) - parseInt(b.sceneId));
        const selected: ArchiveScene[] = [];
        let usedTokens = 0;

        for (const scene of sorted) {
            const tokens = countTokens(scene.content);
            if (usedTokens + tokens > tokenBudget) break;
            selected.push({ sceneId: scene.sceneId, content: scene.content, tokens });
            usedTokens += tokens;
        }

        console.log(
            `[Archive Retrieval] Fetched ${selected.length}/${raw.length} scenes ` +
            `(${usedTokens} tokens used of ${tokenBudget} budget).`
        );

        return selected;
    } catch (err) {
        console.warn('[Archive Retrieval] Error fetching scenes:', err);
        return [];
    }
}

/**
 * Convenience: search + fetch in one call.
 * Used in ChatArea before buildPayload().
 */
export async function recallArchiveScenes(
    campaignId: string,
    index: ArchiveIndexEntry[],
    userMessage: string,
    recentMessages: ChatMessage[],
    tokenBudget = 3000
): Promise<ArchiveScene[]> {
    const matchedIds = retrieveArchiveMemory(index, userMessage, recentMessages);
    if (matchedIds.length === 0) return [];
    return fetchArchiveScenes(campaignId, matchedIds, tokenBudget);
}
