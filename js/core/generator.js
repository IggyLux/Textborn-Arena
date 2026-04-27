
/**
 * @file generator.js
 * @description The Forge Pipeline — transforms a text prompt into a character entity.
 *
 * Stage 1 — Prompt Engineering : strict JSON schema contract with the LLM
 * Stage 2 — Communication      : async POST to KoboldCPP or Anthropic endpoint
 * Stage 3 — Transformation     : validated JSON → combat + visual entity object
 * Stage 4 — Fallback           : deterministic djb2 hash when API is unavailable
 *
 * Exports:
 *   forgeCharacter(input, style)  → Promise<CharacterEntity>
 *   makeFallback(input)           → CharacterEntity   (sync, always succeeds)
 *   validateEntity(raw)           → CharacterEntity   (clamp + fill defaults)
 */

import {
  API_CONFIG,
  FALLBACK_CONFIG,
  ARCHETYPES,
  ARCHETYPE_KEYS,
  STAT_RANGES,
  clamp,
} from "../config.js";

// ─────────────────────────────────────────────────────────────────────────────
// SCHEMA CONSTANTS  (closed vocabulary the renderer already knows how to draw)
// ─────────────────────────────────────────────────────────────────────────────

export const ALLOWED = {
  attackType: ["melee","ranged","magic","poison","fire","ice","lightning","void","nature","sound"],
  special:    ["none","lifesteal","shield","burst","pierce","regen"],
  headShape:  ["round","helmet","horned","crown","hooded","masked","skull","crystal","flame","cloud"],
  bodyBuild:  ["normal","heavy","slim","giant","tiny","hunched"],
  weaponType: ["sword","axe","staff","bow","claws","whip","orb","spear","none"],
};

/**
 * The system prompt is the schema contract.
 * It defines EVERY field the renderer and battle engine will consume.
 * The LLM must return raw JSON — no prose, no markdown fences.
 */
const SYSTEM_PROMPT = `You are a game character generator for TEXTBORN ARENA, a dark fantasy auto-battler.
Output ONLY a raw JSON object. No markdown. No backticks. No explanation. No preamble.

Given any input concept, generate a humanoid fighter whose every attribute reflects that concept.

Required JSON schema (all fields mandatory):
{
  "name":        string,   // 2-3 word display name, max 24 chars
  "archetype":   string,   // one of: warrior rogue mage ranger paladin berserker golem specter
  "attackType":  string,   // one of: melee ranged magic poison fire ice lightning void nature sound
  "special":     string,   // one of: none lifesteal shield burst pierce regen
  "attackVerb":  string,   // single past-tense verb e.g. "cleaves" "hexes" "shatters"
  "flavor":      string,   // one atmospheric sentence, 8-12 words max

  "skinColor":   string,   // hex — MUST match concept (fire=#cc4400, ice=#aaccff, void=#331144, nature=#336622, ghost=#ddeeff, robot=#778899)
  "armorColor":  string,   // hex — armor/clothing color
  "accentColor": string,   // hex — glowing highlights, runes, magical edges
  "weaponColor": string,   // hex — weapon material
  "auraColor":   string,   // hex — outer glow/energy field

  "headShape":   string,   // one of: round helmet horned crown hooded masked skull crystal flame cloud
  "bodyBuild":   string,   // one of: normal heavy slim giant tiny hunched
  "weaponType":  string,   // one of: sword axe staff bow claws whip orb spear none

  "physicalTraits": {
    "hasWings":   boolean,  // true if concept implies flight, angelic/demonic, or winged creature
    "hasTail":    boolean,  // true if concept implies beast, dragon, demon, or reptilian origin
    "hasBreasts": boolean,  // true if concept is explicitly female or feminine
    "hasArmor":   boolean   // true if concept wears armor, false for robes/bare/organic forms
  },

  "stats": {
    "hp":   number,   // 40–200
    "atk":  number,   // 5–50
    "def":  number,   // 0–40
    "spd":  number,   // 1–20
    "crit": number    // 0.00–0.50 as decimal
  }
}

CRITICAL RULES:
- skinColor MUST reflect the concept's elemental nature. Never default to human skin unless the concept is explicitly human.
- All string values must be from their allowed lists exactly as written.
- Stats must reflect the archetype. Berserker = high atk, low def. Golem = high hp/def, low spd. Specter = low hp, high spd/crit.
- Output ONLY the JSON object. Nothing else.`;

// ─────────────────────────────────────────────────────────────────────────────
// COLOUR MATH UTILITIES  (preserved from original, used by fallback palette)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse a CSS hex string to [r, g, b] integers.
 * @param {string} hex
 * @returns {[number, number, number]}
 */
export function hexRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || "#888888");
  return m
    ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)]
    : [128, 128, 128];
}

/**
 * Build an rgba() string from r,g,b and optional alpha.
 * @param {number} r @param {number} g @param {number} b @param {number} [a=1]
 * @returns {string}
 */
export function rca(r, g, b, a = 1) {
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a})`;
}

/**
 * Lighten (+) or darken (–) an [r,g,b] array by a factor of 255.
 * @param {[number,number,number]} rgb
 * @param {number} f  – range roughly –1 to +1
 * @returns {[number,number,number]}
 */
export function lc(rgb, f) {
  return rgb.map(c => clamp(Math.round(c + f * 255), 0, 255));
}

// ─────────────────────────────────────────────────────────────────────────────
// DETERMINISTIC HASH  (djb2 variant — same input → same character, always)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * djb2-inspired string hash. Returns a stable unsigned 32-bit integer.
 * @param {string} str
 * @returns {number}
 */
function hashString(str) {
  const { hashPrime, hashShift } = FALLBACK_CONFIG;
  let h = hashPrime;
  for (let i = 0; i < str.length; i++) {
    h = (((h << hashShift) + h) + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * Rotate the hash right by n bits (32-bit). Used to decorrelate stat channels.
 * @param {number} h @param {number} n @returns {number}
 */
function rotr(h, n) {
  return ((h >>> n) | (h << (32 - n))) >>> 0;
}

/**
 * Linearly maps a byte value (0–255) to a stat range.
 * @param {number} byte  0–255
 * @param {string} key   stat key in STAT_RANGES
 * @returns {number}
 */
function byteToStat(byte, key) {
  const { min, max } = STAT_RANGES[key];
  const raw = min + (byte / 255) * (max - min);
  return key === "crit"
    ? parseFloat(clamp(raw, min, max).toFixed(2))
    : Math.round(clamp(raw, min, max));
}

/**
 * Fallback colour palettes — 8 distinct elemental themes.
 * Index is derived from the hash so the same concept always maps to the same palette.
 */
const FALLBACK_PALETTES = [
  { skin: "#cc4400", armor: "#882200", accent: "#ff8844", weapon: "#ffaa44", aura: "#ff4400" }, // fire
  { skin: "#aaccff", armor: "#6688cc", accent: "#ffffff", weapon: "#88ddff", aura: "#88aaff" }, // ice
  { skin: "#336622", armor: "#224411", accent: "#88ff44", weapon: "#55cc22", aura: "#44aa22" }, // nature
  { skin: "#778899", armor: "#445566", accent: "#00ddff", weapon: "#aabbcc", aura: "#0088cc" }, // steel
  { skin: "#663388", armor: "#441166", accent: "#cc88ff", weapon: "#9944cc", aura: "#9933cc" }, // void
  { skin: "#cc8833", armor: "#885522", accent: "#ffdd44", weapon: "#ffbb22", aura: "#ffaa00" }, // gold
  { skin: "#336688", armor: "#224455", accent: "#44ddff", weapon: "#2299cc", aura: "#0099cc" }, // water
  { skin: "#886644", armor: "#664433", accent: "#ddaa66", weapon: "#aa8855", aura: "#aa7744" }, // earth
];

/**
 * Builds a complete CharacterEntity from a text string using pure math.
 * No randomness — the same input always produces the identical character.
 *
 * @param {string} input  – Raw user text
 * @returns {CharacterEntity}
 */
export function makeFallback(input) {
  const inp = (input || "unknown").trim();
  const h   = hashString(inp);

  // Decorrelated channels via bit rotation
  const h0 = h;
  const h1 = rotr(h, 7);
  const h2 = rotr(h, 13);
  const h3 = rotr(h, 19);
  const h4 = rotr(h, 23);
  const h5 = rotr(h, 29);

  const archetypeKey = ARCHETYPE_KEYS[h0 % ARCHETYPE_KEYS.length];
  const archetype    = ARCHETYPES[archetypeKey];
  const palette      = FALLBACK_PALETTES[h1 % FALLBACK_PALETTES.length];

  // Stats — each drawn from a different hash rotation, then biased by archetype
  const bias = archetype.statBias;
  const rawHp   = (h0 & 0xff) / 255;
  const rawAtk  = (h1 & 0x3f) / 63;
  const rawDef  = (h2 & 0x3f) / 63;
  const rawSpd  = (h3 & 0x1f) / 31;
  const rawCrit = (h4 & 0x1f) / 31;

  const stats = {
    hp:   byteToStat(clamp(rawHp   * bias.hp   * 255, 0, 255), "hp"),
    atk:  byteToStat(clamp(rawAtk  * bias.atk  * 255, 0, 255), "atk"),
    def:  byteToStat(clamp(rawDef  * bias.def  * 255, 0, 255), "def"),
    spd:  byteToStat(clamp(rawSpd  * bias.spd  * 255, 0, 255), "spd"),
    crit: byteToStat(clamp(rawCrit * bias.crit * 255, 0, 255), "crit"),
  };

  // Physical traits — deterministic boolean derivations from hash bits
  const physicalTraits = {
    hasWings:   (h2 % 7) === 0,
    hasTail:    (h3 % 5) === 0,
    hasBreasts: (h4 % 9) === 0,
    hasArmor:   (h5 % 3) !== 0,   // armor is the majority case
  };

  // Name: first 1–3 words of input, capitalised
  const nameParts = inp.split(/\s+/).slice(0, 3);
  const name = nameParts
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ")
    .slice(0, 24);

  return {
    // Identity
    name,
    archetype:   archetypeKey,
    attackType:  ALLOWED.attackType[h0 % ALLOWED.attackType.length],
    special:     ALLOWED.special[h1 % ALLOWED.special.length],
    attackVerb:  ["strikes","cleaves","hexes","pierces","blasts","shreds","erupts","haunts"][h2 % 8],
    flavor:      "A warrior forged from the void between words.",

    // Visual
    skinColor:   palette.skin,
    armorColor:  palette.armor,
    accentColor: palette.accent,
    weaponColor: palette.weapon,
    auraColor:   palette.aura,

    headShape:   ALLOWED.headShape[h3 % ALLOWED.headShape.length],
    bodyBuild:   ALLOWED.bodyBuild[h4 % ALLOWED.bodyBuild.length],
    weaponType:  ALLOWED.weaponType[h5 % ALLOWED.weaponType.length],

    physicalTraits,
    stats,

    // Meta
    source: "fallback",
    input:  inp,
    id:     Date.now().toString(36) + (h & 0xffff).toString(16),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ENTITY VALIDATION  (clamp, coerce, fill defaults on LLM output)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates and sanitises a raw parsed JSON object into a safe CharacterEntity.
 * Unknown enum values are replaced with safe defaults.
 * Stats are clamped to STAT_RANGES.
 *
 * @param {object} raw    – Parsed JSON from LLM
 * @param {string} input  – Original user input (for id/meta)
 * @returns {CharacterEntity}
 */
export function validateEntity(raw, input = "") {
  const pick = (val, allowed, def) =>
    allowed.includes(val) ? val : def;

  const num = (v, min, max, def) =>
    typeof v === "number" ? clamp(v, min, max) : def;

  const bool = (v, def) =>
    typeof v === "boolean" ? v : def;

  const stats   = raw.stats   || {};
  const traits  = raw.physicalTraits || {};
  const colors  = raw.colors  || {};   // tolerate old schema shape too

  return {
    name:        (typeof raw.name === "string" ? raw.name : "Unknown").slice(0, 24),
    archetype:   pick(raw.archetype, ARCHETYPE_KEYS, "warrior"),
    attackType:  pick(raw.attackType, ALLOWED.attackType, "melee"),
    special:     pick(raw.special,    ALLOWED.special,    "none"),
    attackVerb:  typeof raw.attackVerb === "string" ? raw.attackVerb.slice(0, 20) : "strikes",
    flavor:      typeof raw.flavor     === "string" ? raw.flavor.slice(0, 160)    : "An enigmatic combatant.",

    skinColor:   raw.skinColor   || colors.skin   || "#aa7744",
    armorColor:  raw.armorColor  || colors.armor  || "#554433",
    accentColor: raw.accentColor || colors.accent || "#ffffff",
    weaponColor: raw.weaponColor || colors.accent || "#ccaa44",
    auraColor:   raw.auraColor   || colors.accent || "#4488ff",

    headShape:   pick(raw.headShape,  ALLOWED.headShape,  "round"),
    bodyBuild:   pick(raw.bodyBuild,  ALLOWED.bodyBuild,  "normal"),
    weaponType:  pick(raw.weaponType, ALLOWED.weaponType, "sword"),

    physicalTraits: {
      hasWings:   bool(traits.hasWings,   false),
      hasTail:    bool(traits.hasTail,    false),
      hasBreasts: bool(traits.hasBreasts, false),
      hasArmor:   bool(traits.hasArmor,   true),
    },

    stats: {
      hp:   num(stats.hp,   STAT_RANGES.hp.min,   STAT_RANGES.hp.max,   100),
      atk:  num(stats.atk,  STAT_RANGES.atk.min,  STAT_RANGES.atk.max,  18),
      def:  num(stats.def,  STAT_RANGES.def.min,  STAT_RANGES.def.max,  8),
      spd:  num(stats.spd,  STAT_RANGES.spd.min,  STAT_RANGES.spd.max,  5),
      crit: num(stats.crit, STAT_RANGES.crit.min, STAT_RANGES.crit.max, 0.10),
    },

    source: "llm",
    input:  input,
    id:     Date.now().toString(36),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// JSON EXTRACTION  (strips markdown fences, finds the first {} block)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Attempts to extract and parse a JSON object from a raw LLM response string.
 * Handles:
 *   - Bare JSON
 *   - ```json ... ``` fenced blocks
 *   - JSON preceded/followed by prose
 *
 * @param {string} text
 * @returns {object|null}
 */
function extractJSON(text) {
  if (!text) return null;

  // Strip common markdown fences
  const stripped = text
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();

  // Find the outermost { ... } block
  const match = stripped.match(/\{[\s\S]*\}/);
  if (!match) return null;

  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// API COMMUNICATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calls the configured LLM endpoint with a timeout guard.
 * Supports both KoboldCPP (OpenAI-compatible) and Anthropic message formats.
 *
 * @param {string} userMessage  – The formatted user prompt
 * @returns {Promise<string>}   – Raw response text from the model
 * @throws {Error}              – On network failure, timeout, or bad response shape
 */
async function callLLM(userMessage) {
  const { endpoint, model, maxTokens, timeoutMs, mode } = API_CONFIG;

  // Build the request body based on API mode
  let body;
  let headers = { "Content-Type": "application/json" };

  if (mode === "anthropic") {
    // Anthropic Messages API — system prompt is a top-level field
    body = JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });
  } else {
    // KoboldCPP / OpenAI-compatible — system prompt in messages array
    body = JSON.stringify({
      model: "local-model",
      max_tokens: maxTokens,
      temperature: 0.7,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user",   content: userMessage   },
      ],
    });

    if (API_CONFIG.apiKey) {
      headers["Authorization"] = `Bearer ${API_CONFIG.apiKey}`;
    }
  }

  // Abort controller for timeout
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(endpoint, {
      method:  "POST",
      headers,
      body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new Error(`LLM request failed: HTTP ${response.status}`);
  }

  const data = await response.json();

  // Extract content from either response shape
  if (mode === "anthropic") {
    const block = data?.content?.find(b => b.type === "text");
    if (!block?.text) throw new Error("Anthropic: no text block in response");
    return block.text;
  } else {
    const msg = data?.choices?.[0]?.message?.content;
    if (!msg) throw new Error("KoboldCPP: invalid response shape");
    return msg;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// THE FORGE  (public entry point)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} ForgeResult
 * @property {CharacterEntity} character  – The generated character
 * @property {"llm"|"fallback"} source    – Which pipeline produced it
 * @property {string|null} error          – Error message if fallback was used
 */

/**
 * Main Forge pipeline. Attempts LLM generation, falls back to hash on any failure.
 *
 * @param {string} input   – Champion name / concept from the user
 * @param {string} [style] – Optional combat style hint
 * @returns {Promise<ForgeResult>}
 */
export async function forgeCharacter(input, style = "") {
  const inp = (input || "").trim();
  if (!inp) {
    return {
      character: makeFallback("unknown warrior"),
      source:    "fallback",
      error:     "Empty input — used deterministic fallback.",
    };
  }

  // Build the user prompt from the template
  const userMessage = API_CONFIG.userPromptTemplate
    .replace("{name}",  inp)
    .replace("{style}", style || "any");

  try {
    const rawText = await callLLM(userMessage);
    const parsed  = extractJSON(rawText);

    if (!parsed) {
      throw new Error("LLM returned no parseable JSON block.");
    }

    const character = validateEntity(parsed, inp);

    return { character, source: "llm", error: null };

  } catch (err) {
    console.warn("[Forge] LLM failed, using deterministic fallback.", err.message);

    return {
      character: makeFallback(inp + (style ? ` ${style}` : "")),
      source:    "fallback",
      error:     err.message,
    };
  }
}
