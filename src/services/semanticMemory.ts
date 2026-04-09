/**
 * semanticMemory.ts
 *
 * Semantic Memory Layer — queries the server-side fact store and returns
 * matching facts for injection into the LLM payload.
 *
 * Facts are extracted server-side during archive append (Phase 2).
 * This service queries them by entity matching against current context.
 */

import type { SemanticFact, NPCEntry } from '../types';

function trigramSet(s: string): Set<string> {
    const t = new Set<string>();
    const normalized = `  ${s.toLowerCase().trim()} `;
    for (let i = 0; i <= normalized.length - 3; i++) {
        t.add(normalized.substring(i, i + 3));
    }
    return t;
}

function trigramSimilarity(a: string, b: string): number {
    const sa = trigramSet(a);
    const sb = trigramSet(b);
    if (sa.size === 0 && sb.size === 0) return 1;
    if (sa.size === 0 || sb.size === 0) return 0;
    let intersection = 0;
    for (const t of sa) {
        if (sb.has(t)) intersection++;
    }
    const union = sa.size + sb.size - intersection;
    return union === 0 ? 0 : intersection / union;
}

function deduplicateFacts(facts: SemanticFact[]): SemanticFact[] {
    if (facts.length <= 1) return facts;

    const groups = new Map<string, SemanticFact[]>();
    for (const f of facts) {
        const key = `${f.subject.toLowerCase()}|${f.predicate.toLowerCase()}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(f);
    }

    const keep = new Set<SemanticFact>();
    let dedupedCount = 0;

    for (const [, group] of groups) {
        if (group.length === 1) {
            keep.add(group[0]);
            continue;
        }

        group.sort((a, b) => {
            if (b.importance !== a.importance) return b.importance - a.importance;
            return (b.timestamp || 0) - (a.timestamp || 0);
        });

        const survivors: SemanticFact[] = [group[0]];

        for (let i = 1; i < group.length; i++) {
            const candidate = group[i];
            const isDupe = survivors.some(survivor =>
                trigramSimilarity(candidate.object, survivor.object) > 0.80
            );
            if (isDupe) {
                dedupedCount++;
            } else {
                survivors.push(candidate);
            }
        }

        for (const s of survivors) keep.add(s);
    }

    const kept = facts.filter(f => keep.has(f));
    if (dedupedCount > 0) {
        console.log(`[SemanticMemory] Dedup: removed ${dedupedCount} near-duplicate/contradictory facts`);
    }
    return kept;
}

export async function fetchFacts(campaignId: string): Promise<SemanticFact[]> {
    try {
        const res = await fetch(`/api/campaigns/${campaignId}/facts`);
        if (res.ok) return await res.json();
    } catch (err) {
        console.warn('[SemanticMemory] Failed to fetch facts:', err);
    }
    return [];
}

function extractContextEntities(
    userMessage: string,
    recentMessages: { content: string; role: string }[],
    npcLedger?: NPCEntry[]
): Set<string> {
    const entities = new Set<string>();

    if (npcLedger) {
        for (const npc of npcLedger) {
            entities.add(npc.name.toLowerCase());
            if (npc.aliases) {
                for (const alias of npc.aliases.split(',').map(a => a.trim().toLowerCase()).filter(Boolean)) {
                    entities.add(alias);
                }
            }
        }
    }

    const allText = [userMessage, ...recentMessages.slice(-5).map(m => m.content || '')].join(' ');
    const properNouns = allText.match(/[A-Z][A-Za-z]{2,}(?:\s[A-Z][A-Za-z]{2,})*/g) || [];
    for (const noun of properNouns) entities.add(noun.toLowerCase());

    return entities;
}

export function queryFacts(
    facts: SemanticFact[],
    userMessage: string,
    recentMessages: { content: string; role: string }[],
    npcLedger?: NPCEntry[],
    tokenBudget = 500
): SemanticFact[] {
    if (!facts || facts.length === 0) return [];

    const entities = extractContextEntities(userMessage, recentMessages, npcLedger);

    const scored = facts.map(fact => {
        let score = 0;
        const sLower = fact.subject.toLowerCase();
        const oLower = fact.object.toLowerCase();
        if (entities.has(sLower)) score += fact.importance;
        if (entities.has(oLower)) score += fact.importance * 0.8;
        for (const entity of entities) {
            if (sLower.includes(entity) || entity.includes(sLower)) score += 2;
            if (oLower.includes(entity) || entity.includes(oLower)) score += 1.5;
        }
        return { fact, score };
    });

    const matched = scored.filter(s => s.score > 0).sort((a, b) => b.score - a.score);
    const deduped = deduplicateFacts(matched.map(s => s.fact));
    const selected: SemanticFact[] = [];
    let usedTokens = 0;

    for (const fact of deduped) {
        if (usedTokens + 12 > tokenBudget) break;
        selected.push(fact);
        usedTokens += 12;
    }

    if (selected.length > 0) {
        console.log(`[SemanticMemory] Matched ${selected.length}/${facts.length} facts (~${usedTokens} tokens)`);
    }
    return selected;
}

export function formatFactsForContext(facts: SemanticFact[]): string {
    if (facts.length === 0) return '';
    const lines = facts
        .sort((a, b) => b.importance - a.importance)
        .map(f => `▸ ${f.subject} —${f.predicate}→ ${f.object} [${f.importance}]`);
    return `[SEMANTIC MEMORY]\n${lines.join('\n')}\n[END SEMANTIC MEMORY]`;
}

export function queryByEntity(
    facts: SemanticFact[],
    entityName: string
): SemanticFact[] {
    const lower = entityName.toLowerCase();
    return facts.filter(f =>
        f.subject.toLowerCase() === lower ||
        f.object.toLowerCase() === lower
    );
}

export function traverseGraph(
    facts: SemanticFact[],
    startEntity: string,
    maxDepth: number = 2
): SemanticFact[] {
    const visited = new Set<string>();
    const result: SemanticFact[] = [];
    const queue: { entity: string; depth: number }[] = [
        { entity: startEntity, depth: 0 }
    ];

    while (queue.length > 0) {
        const item = queue.shift()!;
        if (item.depth > maxDepth) continue;
        const key = item.entity.toLowerCase();
        if (visited.has(key)) continue;
        visited.add(key);

        const related = queryByEntity(facts, item.entity);
        for (const fact of related) {
            if (!result.some(r => r.id === fact.id)) {
                result.push(fact);
            }
            const nextEntity =
                fact.subject.toLowerCase() === key ? fact.object : fact.subject;
            if (!visited.has(nextEntity.toLowerCase())) {
                queue.push({ entity: nextEntity, depth: item.depth + 1 });
            }
        }
    }

    return result;
}
