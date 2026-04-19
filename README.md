# Narrative Engine

Your AI Dungeon Master. A self-hosted TTRPG engine that runs extended, multi-session campaigns with persistent memory, living NPCs, and automated world management — powered by any OpenAI-compatible LLM or local Ollama model.

No cloud. No subscription. Your campaigns stay on your machine.

---

## Getting Started

1. **Clone the repo**
   ```
   git clone https://github.com/Sagesheep/NarrativeEngine.git
   cd NarrativeEngine
   ```

2. **Install & Run**

   **Windows** — just double-click `Start_Narrative_Engine.bat`

   **Or manually:**
   ```
   npm install
   npm run dev
   ```

3. **Open your browser** to `http://localhost:5173`

4. **Configure your LLM** — Open Settings and add your API key + endpoint. Supports OpenAI, Ollama, and any OpenAI-compatible API.

That's it. Create a campaign, write your world lore, and start playing.

---

## Features

### Your Campaign, Your World

- Run multiple campaigns side by side, each with its own world, lore, and state
- Write a rich world bible (lore) using plain Markdown — locations, factions, power systems, cultures, rules
- Lore entries are auto-classified and triggered by keywords in the conversation
- Pin critical lore (rules, economy, magic systems) so it's always in the GM's context

### Smart Memory That Actually Works

The GM remembers your past sessions without you doing anything:

- **Session summaries** — old chat history is automatically condensed into running summaries while keeping memorable quotes intact
- **Scene archive** — every scene is saved verbatim in a lossless log, never thrown away
- **Chapters** — the story is auto-organized into chapters as you play, with LLM-generated summaries
- **Semantic search** — when the GM needs to recall something, it searches your entire history by meaning, not just keywords

### Living NPCs

- NPCs are **automatically detected** as they appear in the story — no manual data entry
- The AI generates full profiles: personality, voice, goals, factions, visual descriptions
- **Portrait generation** with 5 art styles: Realistic, Anime Realistic, Anime, Western RPG, Chibi
- NPCs **remember what they witnessed** — the GM knows who was in the room and won't have a tavern keeper reference a secret they never saw
- Personality drift is tracked — if an NPC's attitude shifts, you'll see a drift alert for 3 turns

### World State Tracking

The engine maintains a living timeline of world truths:

- Who's where, who holds what, who killed who, who's allied with who
- Contradictions are **auto-resolved** — if a character dies, their "located in" and "allied with" entries are superseded
- Add or remove timeline events manually anytime
- Entity normalization catches aliases and minor name variations

### Dice & Randomness

Three engines that create emergent storytelling:

- **Surprise Engine** — ambient flavor events (a mysterious sound, a fleeting shadow)
- **Encounter Engine** — mid-stakes hooks and challenges
- **World Event Engine** — seismic shifts (a coup, a natural disaster, a god intervenes)

Each engine's threshold decreases over time, so the longer nothing happens, the more likely something will. All configurable.

Plus a **fair dice pool** system for skill checks with advantage/disadvantage, criticals, and catastrophes across 7 skill categories.

### AI Co-DMs

Three independent AI personas can act each turn with their own LLM endpoints:

- **Enemy AI** — antagonists who act against you
- **Neutral AI** — bystanders and wildcards
- **Ally AI** — companions and friendly forces

Each has its own personality, prompt, and intervention chance. They can't override the GM or resolve player actions — they act in their own voice as separate characters.

### Image Generation

- Generate NPC portraits on the fly in 5 art styles
- Generate scene illustrations during play
- Works with any OpenAI-compatible image API
- Images are downloaded and stored locally

### Your Data, Your Control

- **Encrypted API key vault** — AES-256-GCM encryption, password-optional
- **Machine-key mode** — no password needed, keys auto-unlock on your device
- **Password mode** — PBKDF2 with 100K iterations for full lock-down
- **Client-side encryption** — API keys are encrypted in your browser before they ever touch the server
- All campaign data is stored locally as files — no database, no cloud, no vendor lock-in
- Export and import your vault for backups

### Backups & Rollback

- **Automatic backups** created before any risky operation
- **Manual labeled backups** anytime
- **Scene-level rollback** — undo any scene and the entire world state (timeline, chapters, NPCs) cascades back to that point
- Invalidated chapters auto-unseal, timeline entries are pruned, condenser resets if needed
- Pre-rollback safety backup so you can't lose data even when rolling back

### LLM Tool Calls

The GM can use tools mid-conversation:

- **Query Campaign Lore** — the GM looks up your world bible on the fly when it needs a detail
- **Update Scene Notebook** — a volatile working memory for tracking active spells, timers, NPC positions, environmental conditions

Works with OpenAI function calling and DeepSeek models (with DSML fallback parsing).

---

## Supported LLM Providers

Any OpenAI-compatible API works. Configure up to 6 endpoints per preset:

| Role | Purpose |
|---|---|
| **Story AI** | Main GM narration |
| **Summarizer AI** | Condensing old history (can use a cheaper model) |
| **Utility AI** | NPC validation, importance rating, context recommendations (cheap model recommended) |
| **Image AI** | Portrait and scene generation |
| **Enemy / Neutral / Ally AI** | Co-DM personas (falls back to Story AI if not set) |

Works great with Ollama for fully local play — no internet required after setup.

---

## Quick Reference

| Action | Command |
|---|---|
| Install & run (Windows) | Double-click `Start_Narrative_Engine.bat` |
| Install manually | `npm install` |
| Start the app | `npm run dev` |
| Run tests | `npm run test` |
| Lint | `npm run lint` |

---

## License

This project is currently unlicensed. All rights reserved.