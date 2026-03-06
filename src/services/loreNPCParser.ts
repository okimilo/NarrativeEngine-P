import type { NPCEntry, LoreChunk } from '../types';

function uid(): string {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/**
 * Parses a world lore markdown file for a `## CHARACTERS` section and
 * extracts structured NPC entries for the ledger.
 *
 * Each character block must use `### Name` headers with `**Field:** Value` bullets.
 * Fields: Aliases, Appearance, Disposition, Goals, Faction, StoryRelevance,
 *         Status, Affinity, Nature, Training, Emotion, Social, Belief, Ego
 */
export function parseNPCsFromLore(chunks: LoreChunk[]): NPCEntry[] {
    const npcs: NPCEntry[] = [];
    let inCharactersSection = false;

    for (const chunk of chunks) {
        if (chunk.header.toUpperCase().includes('CHARACTERS')) {
            inCharactersSection = true;
            continue;
        }

        if (inCharactersSection && (chunk.content.includes('**Disposition:**') || chunk.content.includes('**Aliases:**'))) {
            const name = chunk.header.trim();
            if (!name) continue;

            const body = chunk.content;

            const get = (field: string): string => {
                const re = new RegExp(`\\*\\*${field}:\\*\\*\\s*(.+)`, 'i');
                const m = body.match(re);
                return m ? m[1].trim() : '';
            };
            const getAny = (fields: string[]): string => {
                for (const field of fields) {
                    const value = get(field);
                    if (value) return value;
                }
                return '';
            };

            const getNum = (field: string, fallback: number): number => {
                const raw = get(field);
                const n = parseInt(raw, 10);
                return isNaN(n) ? fallback : n;
            };

            const visualProfile = {
                race: getAny(['VisualRace', 'Visual Race', 'Race', 'Race / Species']),
                gender: getAny(['VisualGender', 'Gender']),
                ageRange: getAny(['VisualAgeRange', 'Age Range', 'VisualAge', 'Age']),
                build: getAny(['VisualBuild', 'Build', 'Build / Body Type']),
                symmetry: getAny(['VisualSymmetry', 'Attract / Symmetry', 'Symmetry', 'Attractiveness']),
                hairStyle: getAny(['VisualHairStyle', 'Hair Style & Color', 'Hair', 'Hair Style']),
                eyeColor: getAny(['VisualEyeColor', 'Eye Color', 'Eyes']),
                skinTone: getAny(['VisualSkinTone', 'Skin Tone']),
                gait: getAny(['VisualGait', 'Gait / Posture', 'Gait']),
                distinctMarks: getAny(['VisualDistinctMarks', 'Distinct Marks']),
                clothing: getAny(['VisualClothing', 'Clothing Style', 'Clothing']),
                artStyle: getAny(['VisualArtStyle', 'Art Style']) || 'Realistic',
            };
            const hasVisualProfile = !!(
                visualProfile.race || visualProfile.gender || visualProfile.ageRange || visualProfile.build ||
                visualProfile.symmetry || visualProfile.hairStyle || visualProfile.eyeColor || visualProfile.skinTone ||
                visualProfile.gait || visualProfile.distinctMarks || visualProfile.clothing
            );

            npcs.push({
                id: uid(),
                name,
                aliases: get('Aliases'),
                appearance: getAny(['Appearance', 'VisualForAI']),
                visualProfile: hasVisualProfile ? visualProfile : undefined,
                disposition: get('Disposition'),
                goals: get('Goals'),
                faction: get('Faction'),
                storyRelevance: get('StoryRelevance'),
                status: (get('Status') as NPCEntry['status']) || 'Alive',
                affinity: getNum('Affinity', 50),
                nature: getNum('Nature', 5),
                training: getNum('Training', 5),
                emotion: getNum('Emotion', 5),
                social: getNum('Social', 5),
                belief: getNum('Belief', 5),
                ego: getNum('Ego', 5),
                portrait: '',
            });
        }
    }

    return npcs;
}
