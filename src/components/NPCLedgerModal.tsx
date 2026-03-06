import { useState, useEffect, useRef } from 'react';
import { X, Plus, Trash2, Save, Users, User, LayoutGrid, List, Loader2, Image as ImageIcon, Sparkles, CheckSquare, Square, Upload, Download, BookOpen } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { generateNPCPortrait, updateExistingNPCs } from '../services/chatEngine';
import { parseNPCsFromLore } from '../services/loreNPCParser';
import { downloadImageToLocal } from '../services/assetService';
import type { NPCEntry, NPCVisualProfile } from '../types';

// Helper to format axis labels based on 1-10 value
const AXIS_LABELS: Record<string, string[]> = {
    'Nature': ['Pacifist', 'Gentle', 'Cautious', 'Measured', 'Pragmatic', 'Assertive', 'Aggressive', 'Brutal', 'Savage', 'Feral'],
    'Training': ['Untrained', 'Dabbler', 'Novice', 'Apprentice', 'Competent', 'Seasoned', 'Veteran', 'Expert', 'Master', 'Legendary'],
    'Emotion': ['Hollow', 'Stoic', 'Guarded', 'Composed', 'Steady', 'Sensitive', 'Volatile', 'Intense', 'Explosive', 'Hysterical'],
    'Social': ['Mute', 'Recluse', 'Shy', 'Reserved', 'Neutral', 'Sociable', 'Charismatic', 'Influential', 'Magnetic', 'Manipulative'],
    'Belief': ['Nihilist', 'Apathetic', 'Skeptic', 'Doubter', 'Moderate', 'Faithful', 'Devout', 'Zealous', 'Fanatical', 'Messianic'],
    'Ego': ['Selfless', 'Servile', 'Meek', 'Humble', 'Balanced', 'Confident', 'Proud', 'Arrogant', 'Narcissistic', 'God-Complex']
};

function getAxisLabel(axis: string, value: number) {
    const list = AXIS_LABELS[axis];
    if (!list) return '';
    const index = Math.max(0, Math.min(9, value - 1));
    return list[index];
}

const DEFAULT_VISUAL_PROFILE: NPCVisualProfile = {
    race: '', gender: '', ageRange: '', build: '', symmetry: '',
    hairStyle: '', eyeColor: '', skinTone: '', gait: '', distinctMarks: '', clothing: '', artStyle: 'Realistic'
};

function uid(): string {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function NPCLedgerModal() {
    const { npcLedger, npcLedgerOpen, toggleNPCLedger, addNPC, updateNPC, removeNPC, setNPCLedger, addNPCs } = useAppStore();
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [isEditing, setIsEditing] = useState(false);
    const [viewMode, setViewMode] = useState<'list' | 'gallery'>('list');
    const [isGeneratingImage, setIsGeneratingImage] = useState(false);
    const [isAIUpdating, setIsAIUpdating] = useState(false);

    // Multi-select state
    const [selectMode, setSelectMode] = useState(false);
    const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());

    // Import ref
    const importRef = useRef<HTMLInputElement>(null);

    // Form state
    const [form, setForm] = useState<Partial<NPCEntry>>({
        status: 'Alive', nature: 5, training: 1, emotion: 5, social: 5, belief: 5, ego: 5,
        visualProfile: { ...DEFAULT_VISUAL_PROFILE }
    });

    // Close on escape
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && npcLedgerOpen) toggleNPCLedger();
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [npcLedgerOpen, toggleNPCLedger]);

    if (!npcLedgerOpen) return null;

    // â”€â”€ Single-select â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const handleSelect = (npc: NPCEntry) => {
        if (selectMode) return; // in multi-select, clicks on rows toggle checkboxes
        setSelectedId(npc.id);
        setForm({ ...npc, visualProfile: npc.visualProfile || { ...DEFAULT_VISUAL_PROFILE } });
        setIsEditing(false);
    };

    const handleCreateNew = () => {
        setSelectedId(null);
        setForm({
            name: '', aliases: '', appearance: '', faction: '', storyRelevance: '', disposition: '',
            status: 'Alive', goals: '', nature: 5, training: 1, emotion: 5, social: 5, belief: 5, ego: 5,
            visualProfile: { ...DEFAULT_VISUAL_PROFILE }
        });
        setIsEditing(true);
        setSelectMode(false);
        setCheckedIds(new Set());
    };

    const handleSave = () => {
        if (!form.name?.trim()) return;
        if (selectedId) {
            updateNPC(selectedId, form);
        } else {
            addNPC({ ...form, id: uid() } as NPCEntry);
        }
        setIsEditing(false);
    };

    const handleDelete = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (confirm('Delete this NPC from the ledger?')) {
            removeNPC(id);
            if (selectedId === id) {
                setSelectedId(null);
                setIsEditing(false);
            }
        }
    };

    // â”€â”€ Multi-select â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const toggleCheck = (id: string) => {
        setCheckedIds(prev => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    };


    const allChecked = npcLedger.length > 0 && checkedIds.size === npcLedger.length;

    const handleSelectAll = () => {
        if (allChecked) {
            setCheckedIds(new Set());
        } else {
            setCheckedIds(new Set(npcLedger.map(n => n.id)));
        }
    };

    const handleDeleteSelected = () => {
        if (checkedIds.size === 0) return;
        if (!confirm(`Delete ${checkedIds.size} selected NPC(s) from the ledger ? `)) return;
        const newLedger = npcLedger.filter(n => !checkedIds.has(n.id));
        setNPCLedger(newLedger);
        if (selectedId && checkedIds.has(selectedId)) {
            setSelectedId(null);
            setIsEditing(false);
        }
        setCheckedIds(new Set());
        setSelectMode(false);
    };

    const handleExitSelectMode = () => {
        setSelectMode(false);
        setCheckedIds(new Set());
    };

    // â”€â”€ Import / Export â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const handleExport = () => {
        // Strip portrait (base64 images bloat the file)
        const exportData = npcLedger.map(({ portrait: _p, ...rest }) => rest);
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const dateStr = new Date().toISOString().slice(0, 10);
        const a = document.createElement('a');
        a.href = url;
        a.download = `npc_ledger_export_${dateStr}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const handleImportClick = () => importRef.current?.click();

    const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const parsed = JSON.parse(ev.target?.result as string);
                if (!Array.isArray(parsed)) {
                    alert('Invalid format: expected a JSON array of NPCs.');
                    return;
                }
                // Assign fresh IDs to avoid collisions, merge into existing ledger
                const imported: NPCEntry[] = parsed.map((entry: Partial<NPCEntry>) => ({
                    ...entry,
                    id: uid(),
                    name: entry.name || 'Unknown',
                    aliases: entry.aliases || '',
                    appearance: entry.appearance || '',
                    faction: entry.faction || '',
                    storyRelevance: entry.storyRelevance || '',
                    disposition: entry.disposition || '',
                    status: entry.status || 'Alive',
                    goals: entry.goals || '',
                    nature: entry.nature ?? 5,
                    training: entry.training ?? 5,
                    emotion: entry.emotion ?? 5,
                    social: entry.social ?? 5,
                    belief: entry.belief ?? 5,
                    ego: entry.ego ?? 5,
                    affinity: entry.affinity ?? 50,
                }));
                addNPCs(imported); // Use addNPCs for multiple
                alert(`Imported ${imported.length} NPC(s) successfully.`);
            } catch {
                alert('Failed to parse JSON file. Please check the file format.');
            }
        };
        reader.readAsText(file);
        // Reset so same file can be re-imported if needed
        e.target.value = '';
    };

    const handleSeedFromLore = () => {
        const chunks = useAppStore.getState().loreChunks || [];
        const parsed = parseNPCsFromLore(chunks);

        if (parsed.length === 0) {
            alert('No ## CHARACTERS block found in the lore file. Ensure your world lore includes this section.');
            return;
        }

        const existingByName = new Map(npcLedger.map(n => [n.name.toLowerCase(), n]));
        const newNpcs: NPCEntry[] = [];
        let updatedCount = 0;

        const hasVisualData = (vp?: NPCVisualProfile) => !!(
            vp && (vp.race || vp.gender || vp.ageRange || vp.build || vp.symmetry || vp.hairStyle || vp.eyeColor || vp.skinTone || vp.gait || vp.distinctMarks || vp.clothing)
        );

        for (const incoming of parsed) {
            const existing = existingByName.get(incoming.name.toLowerCase());
            if (!existing) {
                newNpcs.push(incoming);
                continue;
            }

            const incomingVP = incoming.visualProfile;
            if (!hasVisualData(incomingVP)) continue;

            const currentVP = existing.visualProfile || { ...DEFAULT_VISUAL_PROFILE };
            const mergedVP: NPCVisualProfile = {
                race: currentVP.race || incomingVP?.race || '',
                gender: currentVP.gender || incomingVP?.gender || '',
                ageRange: currentVP.ageRange || incomingVP?.ageRange || '',
                build: currentVP.build || incomingVP?.build || '',
                symmetry: currentVP.symmetry || incomingVP?.symmetry || '',
                hairStyle: currentVP.hairStyle || incomingVP?.hairStyle || '',
                eyeColor: currentVP.eyeColor || incomingVP?.eyeColor || '',
                skinTone: currentVP.skinTone || incomingVP?.skinTone || '',
                gait: currentVP.gait || incomingVP?.gait || '',
                distinctMarks: currentVP.distinctMarks || incomingVP?.distinctMarks || '',
                clothing: currentVP.clothing || incomingVP?.clothing || '',
                artStyle: currentVP.artStyle || incomingVP?.artStyle || 'Realistic',
            };

            const vpChanged = (
                mergedVP.race !== (currentVP.race || '') ||
                mergedVP.gender !== (currentVP.gender || '') ||
                mergedVP.ageRange !== (currentVP.ageRange || '') ||
                mergedVP.build !== (currentVP.build || '') ||
                mergedVP.symmetry !== (currentVP.symmetry || '') ||
                mergedVP.hairStyle !== (currentVP.hairStyle || '') ||
                mergedVP.eyeColor !== (currentVP.eyeColor || '') ||
                mergedVP.skinTone !== (currentVP.skinTone || '') ||
                mergedVP.gait !== (currentVP.gait || '') ||
                mergedVP.distinctMarks !== (currentVP.distinctMarks || '') ||
                mergedVP.clothing !== (currentVP.clothing || '') ||
                mergedVP.artStyle !== (currentVP.artStyle || 'Realistic')
            );

            const appearanceChanged = !existing.appearance && !!incoming.appearance;
            if (vpChanged || appearanceChanged) {
                updateNPC(existing.id, {
                    appearance: existing.appearance || incoming.appearance,
                    visualProfile: mergedVP,
                });
                updatedCount += 1;
            }
        }

        if (newNpcs.length > 0) {
            addNPCs(newNpcs);
        }

        if (newNpcs.length === 0 && updatedCount === 0) {
            alert('No new lore characters found, and no existing records needed visual-profile updates.');
            return;
        }

        alert(`Lore sync complete: added ${newNpcs.length} new NPC(s), updated ${updatedCount} existing NPC(s).`);
    };
    // —— Visual profile â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const handleVisualProfileChange = (field: keyof NPCVisualProfile, value: string) => {
        setForm(prev => ({
            ...prev,
            visualProfile: { ...(prev.visualProfile || DEFAULT_VISUAL_PROFILE), [field]: value }
        }));
    };

    // â”€â”€ Portrait generation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const handleGeneratePortrait = async () => {
        const state = useAppStore.getState();
        const activePreset = state.settings.presets.find((p: any) => p.id === state.settings.activePresetId) || state.settings.presets[0];
        const imageConfig = activePreset?.imageAI;

        if (!imageConfig || !imageConfig.endpoint) {
            alert('Image AI endpoint is not configured in Settings.');
            return;
        }

        setIsGeneratingImage(true);
        try {
            const visualTraits = form.visualProfile || DEFAULT_VISUAL_PROFILE;
            const appearanceInfo = form.appearance ? `Legacy Notes: ${form.appearance} ` : '';

            const styleMap: Record<string, string> = {
                'Realistic': 'High quality, highly detailed realistic digital painting, fantasy art style, masterpiece',
                'Anime Realistic': 'Highly detailed anime realistic art style, ala Makoto Shinkai, masterpiece, beautiful lighting',
                'Anime': 'High quality anime art style, ala Kyoto Animation, crisp lines, masterpiece',
                'Western RPG': 'Western RPG art style, character portrait, ala Baldur\'s Gate 3, highly detailed digital painting',
                'Chibi': 'High quality chibi art style, cute, fantasy character portrait, masterpiece'
            };
            const stylePrompt = styleMap[visualTraits.artStyle] || styleMap['Realistic'];

            const prompt = `A profile picture portrait of ONE SINGLE PERSON ONLY with a neutral gray background.The character's face, hair, and middle chest are clearly visible. Solo character, no other people, no split screens, no twins. ${stylePrompt}. Name: ${form.name}. Race: ${visualTraits.race}. Gender: ${visualTraits.gender}. Age: ${visualTraits.ageRange}. Build: ${visualTraits.build}. Hair: ${visualTraits.hairStyle}. Eyes: ${visualTraits.eyeColor}. Skin: ${visualTraits.skinTone}. Clothing: ${visualTraits.clothing}. Distinctive marks: ${visualTraits.distinctMarks}. ${appearanceInfo}`;

            const url = await generateNPCPortrait(imageConfig, prompt);

            // NEW: Download the image to local assets
            const localPath = await downloadImageToLocal(url, form.name || 'Unknown');

            setForm(prev => ({ ...prev, portrait: localPath }));

            if (!isEditing && form.id) {
                updateNPC(form.id, { portrait: localPath });
            }
        } catch (error: any) {
            console.error(error);
            alert(`Failed to generate portrait: ${error.message}`);
        } finally {
            setIsGeneratingImage(false);
        }
    };

    // â”€â”€ AI Update â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const handleAIUpdate = async () => {
        if (!selectedId || !form.name) return;
        const state = useAppStore.getState();
        const provider = state.getActiveStoryEndpoint();
        if (!provider) { alert('Story AI endpoint is not configured.'); return; }
        const npc = npcLedger.find(n => n.id === selectedId);
        if (!npc) return;

        setIsAIUpdating(true);
        try {
            await updateExistingNPCs(provider, state.messages, [npc], (id, patch) => {
                updateNPC(id, patch);
                setForm(prev => ({ ...prev, ...patch }));
            });
        } catch (err: any) {
            console.error('[NPC Manual AI Update] Error:', err);
        } finally {
            setIsAIUpdating(false);
        }
    };

    // â”€â”€ Slider â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const renderSlider = (label: keyof NPCEntry, displayLabel: string) => {
        const value = form[label] as number ?? 5;
        return (
            <div className="mb-4">
                <div className="flex justify-between items-end mb-1">
                    <label className="text-text-dim text-xs uppercase tracking-wider">{displayLabel}</label>
                    <span className="text-xs text-terminal">{value} / 10 <span className="text-text-dim ml-1 text-[10px] hidden sm:inline">({getAxisLabel(displayLabel, value)})</span></span>
                </div>
                <input
                    type="range" min="1" max="10" value={value}
                    onChange={(e) => setForm({ ...form, [label]: parseInt(e.target.value, 10) })}
                    disabled={!isEditing}
                    className="w-full accent-terminal"
                />
            </div>
        );
    };

    // â”€â”€ Sidebar: List â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const renderList = () => (
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {npcLedger.length === 0 && (
                <p className="text-text-dim text-xs text-center p-4 italic opacity-50">No records found.</p>
            )}
            {npcLedger.map(npc => {
                const isActive = selectedId === npc.id && !selectMode;
                const isChecked = checkedIds.has(npc.id);
                return (
                    <div
                        key={npc.id}
                        onClick={() => selectMode ? toggleCheck(npc.id) : handleSelect(npc)}
                        className={`flex items-center justify-between p-3 cursor-pointer border-l-2 transition-all group ${isActive ? 'border-terminal bg-terminal/5' : isChecked ? 'border-terminal/40 bg-terminal/5' : 'border-transparent hover:bg-surface'}`}
                    >
                        <div className="flex items-center gap-2 truncate flex-1 min-w-0">
                            {selectMode ? (
                                <div className="shrink-0 text-terminal">
                                    {isChecked
                                        ? <CheckSquare size={14} />
                                        : <Square size={14} className="text-text-dim" />}
                                </div>
                            ) : (
                                <User size={14} className={`shrink-0 ${isActive ? 'text-terminal' : 'text-text-dim'}`} />
                            )}
                            <div className="truncate min-w-0">
                                <p className={`text-sm font-bold truncate ${isActive ? 'text-terminal glow-green-sm' : 'text-text-primary'}`}>
                                    {npc.name}
                                </p>
                                <div className="flex items-center gap-1 text-[10px] mt-0.5 text-text-dim truncate">
                                    {npc.faction && <span className="bg-terminal/10 text-terminal px-1 rounded uppercase">{npc.faction}</span>}
                                    {npc.aliases && <span className="truncate">{npc.aliases}</span>}
                                </div>
                            </div>
                        </div>
                        {!selectMode && (
                            <button
                                onClick={(e) => handleDelete(npc.id, e)}
                                className="p-1.5 text-text-dim hover:text-danger hover:bg-danger/10 rounded transition-colors opacity-100 sm:opacity-0 sm:group-hover:opacity-100 shrink-0"
                            >
                                <Trash2 size={12} />
                            </button>
                        )}
                    </div>
                );
            })}
        </div>
    );

    // â”€â”€ Sidebar: Gallery â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const renderGallery = () => (
        <div className="flex-1 overflow-y-auto p-4 grid grid-cols-2 md:grid-cols-3 gap-3">
            {npcLedger.length === 0 && (
                <p className="text-text-dim text-xs text-center p-4 italic opacity-50 col-span-full">No records found.</p>
            )}
            {npcLedger.map(npc => {
                const isActive = selectedId === npc.id;
                const isChecked = checkedIds.has(npc.id);
                return (
                    <div
                        key={npc.id}
                        onClick={() => selectMode ? toggleCheck(npc.id) : handleSelect(npc)}
                        className={`relative aspect-[3/4] rounded overflow-hidden cursor-pointer border group transition-all ${isActive ? 'border-terminal ring-1 ring-terminal shadow-[0_0_15px_rgba(0,255,0,0.15)]' : isChecked ? 'border-terminal/50 ring-1 ring-terminal/30' : 'border-border hover:border-terminal/50'}`}
                    >
                        {npc.portrait ? (
                            <img src={npc.portrait} alt={npc.name} className="w-full h-full object-cover transition-transform group-hover:scale-105" />
                        ) : (
                            <div className="w-full h-full bg-void-lighter flex flex-col items-center justify-center gap-2">
                                <User size={32} className="text-text-dim/30" />
                                <span className="text-[10px] text-text-dim/50 uppercase tracking-widest">No Portrait</span>
                            </div>
                        )}
                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-void via-void/80 to-transparent p-3 pt-8">
                            <p className={`text-xs font-bold truncate ${isActive ? 'text-terminal glow-green-sm' : 'text-text-primary'}`}>{npc.name}</p>
                            {npc.faction && <p className="text-[9px] text-text-dim truncate uppercase mt-0.5">{npc.faction}</p>}
                        </div>
                        {selectMode ? (
                            <div className="absolute top-2 left-2 p-1 bg-void/80 rounded" onClick={(e) => { e.stopPropagation(); toggleCheck(npc.id); }}>
                                {isChecked ? <CheckSquare size={14} className="text-terminal" /> : <Square size={14} className="text-text-dim" />}
                            </div>
                        ) : (
                            <button
                                onClick={(e) => handleDelete(npc.id, e)}
                                className="absolute top-2 right-2 p-1.5 bg-void/80 rounded text-text-dim hover:text-danger hover:bg-danger/20 transition-all opacity-0 group-hover:opacity-100 flex items-center justify-center"
                            >
                                <Trash2 size={12} />
                            </button>
                        )}
                    </div>
                );
            })}
        </div>
    );

    // â”€â”€ Main render â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-void/80 backdrop-blur-sm p-4 sm:p-8" onClick={toggleNPCLedger}>
            {/* Hidden import input */}
            <input ref={importRef} type="file" accept=".json" className="hidden" onChange={handleImportFile} />

            <div className="bg-surface border border-border flex flex-col sm:flex-row w-full max-w-6xl h-full max-h-[850px] overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>

                {/* Left Sidebar */}
                <div className="w-full sm:w-1/3 md:w-80 border-b sm:border-b-0 sm:border-r border-border flex flex-col bg-void-lighter max-h-[40vh] sm:max-h-none shrink-0">

                    {/* Sidebar Header */}
                    <div className="p-4 border-b border-border flex justify-between items-center bg-void">
                        <div className="flex items-center gap-2 text-terminal font-bold uppercase tracking-widest text-sm">
                            <Users size={16} />
                            NPC Ledger
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="flex bg-surface border border-border rounded overflow-hidden">
                                <button
                                    onClick={() => setViewMode('list')}
                                    className={`p-1.5 transition-colors ${viewMode === 'list' ? 'bg-terminal text-void' : 'text-text-dim hover:text-text-primary'}`}
                                    title="List View"
                                >
                                    <List size={14} />
                                </button>
                                <button
                                    onClick={() => setViewMode('gallery')}
                                    className={`p-1.5 transition-colors ${viewMode === 'gallery' ? 'bg-terminal text-void' : 'text-text-dim hover:text-text-primary'}`}
                                    title="Gallery View"
                                >
                                    <LayoutGrid size={14} />
                                </button>
                            </div>
                            <button onClick={toggleNPCLedger} className="text-text-dim hover:text-text-primary p-1 sm:hidden">
                                <X size={18} />
                            </button>
                        </div>
                    </div>

                    {/* Action Bar */}
                    <div className="p-3 border-b border-border bg-void-lighter shrink-0 space-y-2">
                        {/* New Record button */}
                        <button
                            onClick={handleCreateNew}
                            className={`w-full flex items-center justify-center gap-2 py-2 px-4 border border-dashed rounded text-xs uppercase tracking-wider transition-colors ${!selectedId && isEditing ? 'border-terminal text-terminal bg-terminal/10' : 'border-border text-text-dim hover:text-terminal hover:border-terminal'}`}
                        >
                            <Plus size={14} /> New Record
                        </button>

                        {/* Import / Export / Select row */}
                        <div className="flex items-center gap-1.5">
                            <button
                                onClick={handleImportClick}
                                title="Import NPCs from JSON"
                                className="flex-1 flex items-center justify-center gap-1 py-1.5 px-2 border border-border rounded text-[10px] uppercase tracking-wider text-text-dim hover:text-terminal hover:border-terminal transition-colors group relative"
                            >
                                <Upload size={11} /> Import
                                {/* Tooltip */}
                                <div className="absolute top-full mt-1 right-0 bg-void border border-border text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50">
                                    Import JSON
                                </div>
                            </button>
                            <button
                                onClick={handleSeedFromLore}
                                title="Seed from Lore"
                                className="flex-1 flex items-center justify-center gap-1 py-1.5 px-2 border border-border rounded text-[10px] uppercase tracking-wider text-text-dim hover:text-terminal hover:border-terminal transition-colors group relative"
                            >
                                <BookOpen size={11} /> Seed
                                {/* Tooltip */}
                                <div className="absolute top-full mt-1 left-1/2 -translate-x-1/2 bg-void border border-border text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50">
                                    Seed from Lore
                                </div>
                            </button>
                            <button
                                onClick={handleExport}
                                disabled={npcLedger.length === 0}
                                title="Export NPCs to JSON"
                                className="flex-1 flex items-center justify-center gap-1 py-1.5 px-2 border border-border rounded text-[10px] uppercase tracking-wider text-text-dim hover:text-terminal hover:border-terminal transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                                <Download size={11} /> Export
                            </button>
                            <button
                                onClick={selectMode ? handleExitSelectMode : () => setSelectMode(true)}
                                title={selectMode ? 'Exit select mode' : 'Select NPCs for bulk action'}
                                className={`flex-1 flex items-center justify-center gap-1 py-1.5 px-2 border rounded text-[10px] uppercase tracking-wider transition-colors ${selectMode ? 'border-terminal text-terminal bg-terminal/10' : 'border-border text-text-dim hover:text-terminal hover:border-terminal'}`}
                            >
                                <CheckSquare size={11} /> Select
                            </button>
                        </div>

                        {/* Bulk action bar (visible in select mode) */}
                        {selectMode && (
                            <div className="flex items-center justify-between gap-2 pt-1">
                                <button
                                    onClick={handleSelectAll}
                                    className="text-[10px] uppercase tracking-wider text-text-dim hover:text-terminal transition-colors"
                                >
                                    {allChecked ? 'Deselect All' : 'Select All'}
                                </button>
                                <button
                                    onClick={handleDeleteSelected}
                                    disabled={checkedIds.size === 0}
                                    className="flex items-center gap-1 px-3 py-1 bg-danger/10 border border-danger/30 text-danger text-[10px] uppercase tracking-wider rounded hover:bg-danger/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                >
                                    <Trash2 size={10} /> Delete ({checkedIds.size})
                                </button>
                            </div>
                        )}
                    </div>

                    {/* List or Gallery */}
                    {viewMode === 'list' ? renderList() : renderGallery()}
                </div>

                {/* Right Detail Pane */}
                <div className="flex-1 flex flex-col bg-surface overflow-hidden relative">
                    <button onClick={toggleNPCLedger} className="absolute top-4 right-4 text-text-dim hover:text-text-primary hidden sm:block p-1 bg-void rounded border border-border hover:border-terminal transition-colors z-10">
                        <X size={18} />
                    </button>

                    {selectedId || isEditing ? (
                        <div className="flex-1 overflow-y-auto flex flex-col p-6 sm:p-8">
                            {/* Title row */}
                            <div className="flex justify-between items-start mb-5">
                                <div>
                                    <h2 className="text-xl font-bold text-text-primary tracking-wide uppercase">
                                        {isEditing && !selectedId ? 'New Subject Record' : selectedId && !isEditing ? form.name : `Editing: ${form.name}`}
                                    </h2>
                                    <p className="text-xs text-text-dim mt-1">Classified GM Information file.</p>
                                </div>
                                {!isEditing && (
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={handleAIUpdate}
                                            disabled={isAIUpdating || !selectedId}
                                            title="Ask AI to update this NPC based on recent chat history"
                                            className="flex items-center gap-1.5 bg-void border border-terminal/30 px-3 py-1.5 text-xs text-terminal hover:border-terminal uppercase tracking-widest transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                        >
                                            {isAIUpdating ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                                            AI Update
                                        </button>
                                        <button
                                            onClick={() => setIsEditing(true)}
                                            className="bg-void border border-border px-4 py-1.5 text-xs text-text-dim hover:text-terminal hover:border-terminal uppercase tracking-widest transition-colors"
                                        >
                                            Edit Record
                                        </button>
                                    </div>
                                )}
                            </div>


                            {/* Form grid */}
                            <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 flex-1">
                                {/* Left Form Column */}
                                <div className="space-y-4">
                                    <div className="flex gap-4">
                                        <div className="flex-1">
                                            <label className="block text-text-dim text-[10px] uppercase tracking-wider mb-1">Primary Designation</label>
                                            <input
                                                type="text"
                                                value={form.name || ''}
                                                onChange={e => setForm({ ...form, name: e.target.value })}
                                                disabled={!isEditing}
                                                placeholder="Subject Name"
                                                className="w-full bg-void border border-border rounded px-3 py-2 text-sm text-text-primary placeholder:text-text-dim/50 disabled:opacity-70 disabled:bg-surface disabled:border-transparent focus:outline-none focus:border-terminal"
                                            />
                                        </div>
                                        <div className="w-1/3">
                                            <label className="block text-text-dim text-[10px] uppercase tracking-wider mb-1">Status</label>
                                            <select
                                                value={form.status || 'Alive'}
                                                onChange={e => setForm({ ...form, status: e.target.value })}
                                                disabled={!isEditing}
                                                className="w-full bg-void border border-border rounded px-3 py-2 text-sm text-text-primary disabled:opacity-70 disabled:bg-surface disabled:border-transparent outline-none focus:border-terminal transition-colors"
                                            >
                                                <option value="Alive">Alive</option>
                                                <option value="Deceased">Deceased</option>
                                                <option value="Missing">Missing</option>
                                                <option value="Unknown">Unknown</option>
                                                <option value="In Custody">In Custody</option>
                                            </select>
                                        </div>
                                    </div>

                                    <div className="flex gap-4">
                                        <div className="flex-1">
                                            <label className="block text-text-dim text-[10px] uppercase tracking-wider mb-1">Faction / Organization</label>
                                            <input
                                                type="text"
                                                value={form.faction || ''}
                                                onChange={e => setForm({ ...form, faction: e.target.value })}
                                                disabled={!isEditing}
                                                placeholder="e.g. Ironspire Knights"
                                                className="w-full bg-void border border-border rounded px-3 py-2 text-sm text-text-primary placeholder:text-text-dim/50 disabled:opacity-70 disabled:bg-surface disabled:border-transparent focus:outline-none focus:border-terminal"
                                            />
                                        </div>
                                        <div className="flex-1">
                                            <label className="block text-text-dim text-[10px] uppercase tracking-wider mb-1">Known Aliases</label>
                                            <input
                                                type="text"
                                                value={form.aliases || ''}
                                                onChange={e => setForm({ ...form, aliases: e.target.value })}
                                                disabled={!isEditing}
                                                placeholder="Comma separated"
                                                className="w-full bg-void border border-border rounded px-3 py-2 text-sm text-text-primary placeholder:text-text-dim/50 disabled:opacity-70 disabled:bg-surface disabled:border-transparent focus:outline-none focus:border-terminal"
                                            />
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-terminal text-[10px] uppercase tracking-wider font-bold mb-1">Story Relevance</label>
                                        <textarea
                                            value={form.storyRelevance || ''}
                                            onChange={e => setForm({ ...form, storyRelevance: e.target.value })}
                                            disabled={!isEditing}
                                            placeholder="Why does this NPC matter to the narrative?"
                                            rows={2}
                                            className="w-full bg-terminal/5 border border-terminal/30 rounded px-3 py-2 text-sm text-text-primary placeholder:text-text-dim/50 disabled:opacity-70 disabled:bg-surface disabled:border-transparent resize-none focus:outline-none focus:border-terminal"
                                        />
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-text-dim text-[10px] uppercase tracking-wider mb-1">Default Disposition</label>
                                            <input
                                                type="text"
                                                value={form.disposition || ''}
                                                onChange={e => setForm({ ...form, disposition: e.target.value })}
                                                disabled={!isEditing}
                                                placeholder="Helpful, Suspicious..."
                                                className="w-full bg-void border border-border rounded px-3 py-2 text-sm text-text-primary placeholder:text-text-dim/50 disabled:opacity-70 disabled:bg-surface disabled:border-transparent focus:outline-none focus:border-terminal"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-text-dim text-[10px] uppercase tracking-wider mb-1">Affinity (0-100)</label>
                                            <input
                                                type="number"
                                                min={0}
                                                max={100}
                                                value={form.affinity ?? 50}
                                                onChange={e => setForm({ ...form, affinity: parseInt(e.target.value, 10) || 50 })}
                                                disabled={!isEditing}
                                                className="w-full bg-void border border-border rounded px-3 py-2 text-sm text-text-primary disabled:opacity-70 disabled:bg-surface disabled:border-transparent focus:outline-none focus:border-terminal"
                                            />
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-text-dim text-[10px] uppercase tracking-wider mb-1">Core Motive / Goals</label>
                                        <textarea
                                            value={form.goals || ''}
                                            onChange={e => setForm({ ...form, goals: e.target.value })}
                                            disabled={!isEditing}
                                            placeholder="What does this character ultimately want?"
                                            rows={2}
                                            className="w-full bg-void border border-border rounded px-3 py-2 text-sm text-text-primary placeholder:text-text-dim/50 disabled:opacity-70 disabled:bg-surface disabled:border-transparent resize-none focus:outline-none focus:border-terminal"
                                        />
                                    </div>

                                    <div className="bg-void p-4 rounded border border-border">
                                        <div className="flex items-center gap-2 text-text-primary font-bold uppercase tracking-widest text-xs mb-4">
                                            Psychological Axes
                                        </div>
                                        {renderSlider('nature', 'Nature')}
                                        {renderSlider('training', 'Training')}
                                        {renderSlider('emotion', 'Emotion')}
                                        {renderSlider('social', 'Social')}
                                        {renderSlider('belief', 'Belief')}
                                        {renderSlider('ego', 'Ego')}
                                    </div>
                                </div>

                                {/* Right Form Column (Visual Profile) */}
                                <div className="space-y-4">
                                    <div className="bg-void-lighter p-4 rounded border border-border shadow-inner">

                                        {/* â”€â”€ Portrait block (inside Visual Profile panel) â”€â”€ */}
                                        {form.portrait ? (
                                            <div className="relative group mb-4 rounded overflow-hidden border border-border">
                                                <img
                                                    src={form.portrait}
                                                    alt={form.name || 'NPC Portrait'}
                                                    className="w-full aspect-[3/4] object-cover object-top"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={handleGeneratePortrait}
                                                    disabled={isGeneratingImage || !form.name}
                                                    className="absolute bottom-2 right-2 flex items-center gap-1.5 px-2.5 py-1 bg-void/80 border border-border hover:border-terminal text-terminal text-[10px] uppercase tracking-wider rounded transition-colors disabled:opacity-50 opacity-0 group-hover:opacity-100"
                                                >
                                                    {isGeneratingImage ? <Loader2 size={11} className="animate-spin" /> : <ImageIcon size={11} />}
                                                    Regenerate
                                                </button>
                                            </div>
                                        ) : null}

                                        <div className="flex items-center justify-between mb-4 border-b border-border/50 pb-2">
                                            <div className="text-terminal font-bold uppercase tracking-widest text-xs">
                                                Visual Profile (AI Ready)
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <div className="text-[9px] uppercase tracking-wider text-text-dim hidden sm:block">Portrait Generation Data</div>
                                                <button
                                                    type="button"
                                                    onClick={handleGeneratePortrait}
                                                    disabled={isGeneratingImage || !form.name}
                                                    title="Generate portrait from visual profile"
                                                    className="flex items-center gap-1 px-2 py-1 border border-border hover:border-terminal text-terminal text-[9px] uppercase tracking-wider rounded transition-colors disabled:opacity-50"
                                                >
                                                    {isGeneratingImage ? <Loader2 size={10} className="animate-spin" /> : <ImageIcon size={10} />}
                                                    {isGeneratingImage ? 'Generatingâ€¦' : form.portrait ? 'Regen' : 'Generate'}
                                                </button>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-2 gap-3">
                                            {[
                                                { k: 'race', l: 'Race / Species' },
                                                { k: 'gender', l: 'Gender' },
                                                { k: 'ageRange', l: 'Age Range' },
                                                { k: 'build', l: 'Build / Body Type' },
                                                { k: 'symmetry', l: 'Attract / Symmetry' },
                                                { k: 'skinTone', l: 'Skin Tone' },
                                                { k: 'hairStyle', l: 'Hair Style & Color' },
                                                { k: 'eyeColor', l: 'Eye Color' },
                                                { k: 'gait', l: 'Gait / Posture' },
                                                { k: 'clothing', l: 'Clothing Style' },
                                                { k: 'distinctMarks', l: 'Distinct Marks' },
                                            ].map(({ k, l }) => (
                                                <div key={k} className={k === 'clothing' || k === 'distinctMarks' ? 'col-span-2' : ''}>
                                                    <label className="block text-text-dim text-[9px] uppercase tracking-wider mb-1">{l}</label>
                                                    <input
                                                        type="text"
                                                        value={form.visualProfile?.[k as keyof NPCVisualProfile] || ''}
                                                        onChange={e => handleVisualProfileChange(k as keyof NPCVisualProfile, e.target.value)}
                                                        disabled={!isEditing}
                                                        className="w-full bg-surface border border-border rounded px-2 py-1.5 text-xs text-text-primary disabled:opacity-70 disabled:bg-surface disabled:border-transparent focus:outline-none focus:border-terminal"
                                                    />
                                                </div>
                                            ))}
                                        </div>

                                        <div className="mt-3">
                                            <label className="block text-text-dim text-[9px] uppercase tracking-wider mb-1">Art Style</label>
                                            <select
                                                value={form.visualProfile?.artStyle || 'Realistic'}
                                                onChange={e => handleVisualProfileChange('artStyle', e.target.value)}
                                                disabled={!isEditing}
                                                className="w-full bg-surface border border-border rounded px-2 py-1.5 text-xs text-text-primary disabled:opacity-70 disabled:bg-surface disabled:border-transparent focus:outline-none focus:border-terminal outline-none"
                                            >
                                                <option value="Realistic">Realistic</option>
                                                <option value="Anime Realistic">Anime Realistic (Makoto Shinkai)</option>
                                                <option value="Anime">Anime (Kyoto Animation)</option>
                                                <option value="Western RPG">Western RPG (Baldur's Gate 3)</option>
                                                <option value="Chibi">Chibi</option>
                                            </select>
                                        </div>

                                        <div className="mt-4 pt-4 border-t border-border/50">
                                            <label className="block text-text-dim text-[9px] uppercase tracking-wider mb-1">Legacy Appearance Notes (Fallback)</label>
                                            <textarea
                                                value={form.appearance || ''}
                                                onChange={e => setForm({ ...form, appearance: e.target.value })}
                                                disabled={!isEditing}
                                                rows={2}
                                                className="w-full bg-surface border border-border rounded px-2 py-1.5 text-xs text-text-primary disabled:opacity-70 disabled:bg-surface disabled:border-transparent resize-none focus:outline-none focus:border-terminal"
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Actions Bar */}
                            {isEditing && (
                                <div className="mt-8 pt-4 border-t border-border flex justify-between gap-3 shrink-0">
                                    {selectedId ? (
                                        <button
                                            onClick={(e) => handleDelete(selectedId, e)}
                                            className="px-4 py-2 text-xs uppercase tracking-widest text-danger hover:bg-danger/10 border border-danger/30 rounded transition-colors"
                                        >
                                            <div className="flex items-center gap-2">
                                                <Trash2 size={14} /> Delete Record
                                            </div>
                                        </button>
                                    ) : (
                                        <div />
                                    )}

                                    <div className="flex gap-3">
                                        {selectedId && (
                                            <button
                                                onClick={() => {
                                                    const npc = npcLedger.find(n => n.id === selectedId);
                                                    if (npc) setForm({ ...npc, visualProfile: npc.visualProfile || { ...DEFAULT_VISUAL_PROFILE } });
                                                    setIsEditing(false);
                                                }}
                                                className="px-4 py-2 text-xs uppercase tracking-widest text-text-dim hover:text-text-primary border border-border bg-void transition-colors"
                                            >
                                                Discard Change
                                            </button>
                                        )}
                                        <button
                                            onClick={handleSave}
                                            disabled={!form.name?.trim()}
                                            className="flex items-center gap-2 px-6 py-2 text-xs uppercase tracking-widest text-void bg-terminal font-bold hover:brightness-110 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                                        >
                                            <Save size={14} /> Commit Record
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="flex-1 flex flex-col items-center justify-center text-center p-8 opacity-50 bg-void">
                            <Users size={64} className="mb-6 text-text-dim/30 drop-shadow-lg" />
                            <p className="text-text-dim uppercase tracking-widest text-sm font-bold">No Record Selected</p>
                            <p className="text-text-dim/60 text-xs mt-2 max-w-xs">Select a subject from the ledger to view their classified file, or create a new entry.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

