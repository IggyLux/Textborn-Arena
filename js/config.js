/**
 * @file config.js
 * @description Central configuration for TEXTBORN ARENA.
 *   All magic numbers, API endpoints, stat formulas, and archetype
 *   definitions live here. Import this module anywhere you need a
 *   constant; never hard-code values in other modules.
 *
 * Exports (named):
 *   API_CONFIG        – LLM endpoint & model settings
 *   GAME_CONFIG       – Timing, canvas, loop constants
 *   STAT_RANGES       – Min/max for each base stat
 *   ARCHETYPES        – Archetype definitions with stat bias and colors
 *   WAVE_CONFIG       – Wave scaling parameters
 *   DAMAGE_CONFIG     – Combat math constants
 *   RENDERER_CONFIG   – Canvas drawing constants
 *   FALLBACK_CONFIG   – Hash-based generator parameters
 *   calcBaseStats     – Deterministic stat formula (pure function)
 *   scaleEnemyStats   – Wave-scaling formula (pure function)
 */

// ─────────────────────────────────────────────────────────────────────────────
// API CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

export const API_CONFIG = {
  /**
   * Which API backend to target.
   *   "kobold"    → KoboldCPP / any OpenAI-compatible local server
   *   "anthropic" → Anthropic Messages API (requires no key in-browser via shim)
   *
   * Change this ONE value to switch backends. No other code changes needed.
   */
  mode: "kobold",

  /** KoboldCPP endpoint (OpenAI-compatible). Used when mode === "kobold". */
  koboldEndpoint: "http://localhost:5001/v1/chat/completions",

  /** Anthropic endpoint. Used when mode === "anthropic". */
  anthropicEndpoint: "https://api.anthropic.com/v1/messages",

  /**
   * Resolved at runtime by generator.js based on `mode`.
   * Do not set this directly — generator.js reads koboldEndpoint or
   * anthropicEndpoint depending on the mode.
   */
  get endpoint() {
    return this.mode === "anthropic" ? this.anthropicEndpoint : this.koboldEndpoint;
  },

  /** Anthropic model string. Only used when mode === "anthropic". */
  model: "claude-sonnet-4-20250514",

  /**
   * Optional API key. For KoboldCPP this is usually empty "".
   * For hosted OpenAI-compatible endpoints, set your key here.
   * The Anthropic shim handles auth automatically when mode === "anthropic".
   */
  apiKey: "",

  /** Hard ceiling on response tokens — keeps latency low */
  maxTokens: 800,

  /** Request timeout in ms before falling back to hash generator */
  timeoutMs: 12000,

  /**
   * User prompt template — {name} and {style} are replaced at call time
   * by generator.js. Keep this terse; the system prompt carries the schema.
   */
  userPromptTemplate: `Concept: "{name}"
Combat style: "{style}"
Generate the character JSON now.`,
};


// ─────────────────────────────────────────────────────────────────────────────
// GAME LOOP & CANVAS CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

export const GAME_CONFIG = {
  /** Target frames-per-second for requestAnimationFrame loop */
  targetFPS: 60,

  /**
   * How many ms elapse between combat "ticks".
   * Each tick processes one action for each combatant whose cooldown is ready.
   */
  tickIntervalMs: 800,

  /** Canvas logical resolution (must match HTML attributes) */
  canvasWidth: 520,
  canvasHeight: 340,

  /** Pixel padding inside the canvas for rendering safe zones */
  canvasPadding: 20,

  /** Z-positions (x offset from center) for player and enemy */
  playerX: 130,
  enemyX: 390,

  /** Y baseline (feet level) for humanoid figures */
  fighterBaseY: 270,
};


// ─────────────────────────────────────────────────────────────────────────────
// STAT RANGES
// ─────────────────────────────────────────────────────────────────────────────

/** Hard min/max for every stat. Used by clamp helpers and the fallback generator. */
export const STAT_RANGES = {
  hp:   { min: 40,  max: 200 },
  atk:  { min: 5,   max: 50  },
  def:  { min: 0,   max: 40  },
  spd:  { min: 1,   max: 20  },
  crit: { min: 0.0, max: 0.50 },
};


// ─────────────────────────────────────────────────────────────────────────────
// ARCHETYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Each archetype defines:
 *   label      – Display string
 *   statBias   – Multipliers applied on top of base stats (1.0 = neutral)
 *   colors     – Default palette for the fallback hash generator
 *   weaponType – Hint to renderer for which weapon shape to draw
 */
export const ARCHETYPES = {
  warrior: {
    label: "Warrior",
    statBias: { hp: 1.3, atk: 1.1, def: 1.2, spd: 0.9,  crit: 0.9  },
    colors: { skin: "#c8956c", armor: "#4a5568", accent: "#e2b96f", eyes: "#a0aec0" },
    weaponType: "sword",
  },
  rogue: {
    label: "Rogue",
    statBias: { hp: 0.8, atk: 1.2, def: 0.7, spd: 1.4,  crit: 1.5  },
    colors: { skin: "#8b7355", armor: "#2d3748", accent: "#68d391", eyes: "#48bb78" },
    weaponType: "dagger",
  },
  mage: {
    label: "Mage",
    statBias: { hp: 0.7, atk: 1.5, def: 0.6, spd: 1.0,  crit: 1.2  },
    colors: { skin: "#b8a9c9", armor: "#553c9a", accent: "#b794f4", eyes: "#d6bcfa" },
    weaponType: "staff",
  },
  ranger: {
    label: "Ranger",
    statBias: { hp: 0.9, atk: 1.2, def: 0.8, spd: 1.3,  crit: 1.3  },
    colors: { skin: "#9c7a5b", armor: "#2f6b3e", accent: "#f6ad55", eyes: "#68d391" },
    weaponType: "bow",
  },
  paladin: {
    label: "Paladin",
    statBias: { hp: 1.4, atk: 1.0, def: 1.4, spd: 0.8,  crit: 0.8  },
    colors: { skin: "#d4b896", armor: "#744210", accent: "#faf089", eyes: "#f6e05e" },
    weaponType: "mace",
  },
  berserker: {
    label: "Berserker",
    statBias: { hp: 1.1, atk: 1.6, def: 0.5, spd: 1.2,  crit: 1.1  },
    colors: { skin: "#c53030", armor: "#742a2a", accent: "#fc8181", eyes: "#feb2b2" },
    weaponType: "axe",
  },
  golem: {
    label: "Golem",
    statBias: { hp: 1.8, atk: 0.9, def: 1.6, spd: 0.5,  crit: 0.6  },
    colors: { skin: "#718096", armor: "#2d3748", accent: "#63b3ed", eyes: "#bee3f8" },
    weaponType: "fist",
  },
  specter: {
    label: "Specter",
    statBias: { hp: 0.65, atk: 1.4, def: 0.4, spd: 1.5, crit: 1.4  },
    colors: { skin: "#e2e8f0", armor: "#1a202c", accent: "#76e4f7", eyes: "#81e6d9" },
    weaponType: "scythe",
  },
};

/** Ordered array of archetype keys — used for index-based selection in fallback */
export const ARCHETYPE_KEYS = Object.keys(ARCHETYPES);


// ─────────────────────────────────────────────────────────────────────────────
// WAVE SCALING CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

export const WAVE_CONFIG = {
  /** HP multiplier applied per completed wave */
  hpScalePerWave: 0.18,

  /** ATK multiplier applied per completed wave */
  atkScalePerWave: 0.15,

  /** DEF multiplier applied per completed wave */
  defScalePerWave: 0.10,

  /** SPD multiplier applied per completed wave */
  spdScalePerWave: 0.07,

  /** Maximum wave number (game win condition) */
  maxWaves: 10,

  /**
   * Every N waves, the enemy gains a special trait modifier.
   * Trait modifiers are defined in DAMAGE_CONFIG below.
   */
  eliteEveryNWaves: 3,
};


// ─────────────────────────────────────────────────────────────────────────────
// DAMAGE & COMBAT CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

export const DAMAGE_CONFIG = {
  /**
   * Base damage formula:
   *   rawDamage = atk * ATK_SCALAR - def * DEF_SCALAR
   *   damage    = max(rawDamage, MIN_DAMAGE)
   */
  atkScalar: 1.0,
  defScalar: 0.6,
  minDamage: 1,

  /** Critical hit damage multiplier */
  critMultiplier: 2.0,

  /** Miss chance baseline (0–1). Speed difference modifies this. */
  baseMissChance: 0.05,

  /**
   * For every point of speed advantage the attacker has over the defender,
   * miss chance is reduced by this amount (capped at zero).
   */
  missReductionPerSpd: 0.01,

  /** Trait modifiers for elite enemies */
  eliteTraits: {
    ironSkin:   { label: "Iron Skin",   defBonus: 8  },
    bloodlust:  { label: "Bloodlust",   atkBonus: 10 },
    swiftness:  { label: "Swiftness",   spdBonus: 4  },
    resilience: { label: "Resilience",  hpBonus:  40 },
  },
};


// ─────────────────────────────────────────────────────────────────────────────
// RENDERER CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

export const RENDERER_CONFIG = {
  /** Pixels per unit of torso height */
  torsoHeight: 54,
  torsoWidth: 28,

  /** Head radius relative to torsoWidth */
  headRadiusRatio: 0.55,

  /** Limb segment lengths (upper / lower) in px */
  upperArmLength: 30,
  lowerArmLength: 26,
  upperLegLength: 34,
  lowerLegLength: 30,

  /** Limb widths */
  armWidth: 7,
  legWidth: 9,

  /** Sine-wave animation amplitudes (px) */
  idleSwayAmp: 2.5,
  idleBreathAmp: 1.5,
  attackSwingAmp: 28,
  hitRecoilAmp: 14,

  /** Animation speed (multiplied by elapsed time in seconds) */
  idleFreq: 1.8,
  attackFreq: 8.0,

  /** Arena background bands */
  floorY: 290,
  bgBands: [
    { y: 0,   h: 180, color: "#0a0e17" },
    { y: 180, h: 110, color: "#0d1320" },
    { y: 290, h: 50,  color: "#111827" },
  ],

  /** Particle effect constants */
  hitParticleCount: 8,
  hitParticleLifeMs: 400,
  hitParticleSpeed: 2.5,
};


// ─────────────────────────────────────────────────────────────────────────────
// FALLBACK HASH GENERATOR CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

export const FALLBACK_CONFIG = {
  /**
   * djb2-variant hash prime used to seed stat derivation.
   * Must be a prime to give good bit distribution.
   */
  hashPrime: 5381,

  /** Bit-shift used in djb2: hash = (hash << shift) + hash + charCode */
  hashShift: 5,

  /**
   * Stat channels: each channel extracts a different set of bits
   * from the hash output so stats are decorrelated from each other.
   */
  statChannels: {
    hp:   { shift: 0,  mask: 0xff },
    atk:  { shift: 8,  mask: 0x3f },
    def:  { shift: 14, mask: 0x3f },
    spd:  { shift: 20, mask: 0x1f },
    crit: { shift: 24, mask: 0x1f },
  },

  /**
   * Color channels: pull hue bytes from different hash rotations
   * to produce a coherent but varied palette.
   */
  colorRotations: [0, 7, 13, 19],
};


// ─────────────────────────────────────────────────────────────────────────────
// PURE STAT FORMULA FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Clamps a value between min and max (inclusive).
 * @param {number} val
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(val, min, max) {
  return Math.min(Math.max(val, min), max);
}

/**
 * Linearly maps a normalised value [0, 1] to a stat range.
 * @param {number} t       – Normalised value in [0, 1]
 * @param {string} statKey – Key in STAT_RANGES
 * @returns {number} Integer stat value (or float for crit)
 */
export function normToStat(t, statKey) {
  const { min, max } = STAT_RANGES[statKey];
  const raw = min + t * (max - min);
  return statKey === "crit"
    ? parseFloat(clamp(raw, min, max).toFixed(2))
    : Math.round(clamp(raw, min, max));
}

/**
 * Applies archetype stat biases to a raw stats object.
 * Each raw stat is in [0, 1] normalised range before this call.
 *
 * @param {{ hp:number, atk:number, def:number, spd:number, crit:number }} rawNorm
 * @param {string} archetypeKey
 * @returns {{ hp:number, atk:number, def:number, spd:number, crit:number }}
 */
export function calcBaseStats(rawNorm, archetypeKey) {
  const bias = ARCHETYPES[archetypeKey]?.statBias ?? {
    hp: 1, atk: 1, def: 1, spd: 1, crit: 1,
  };

  return {
    hp:   normToStat(clamp(rawNorm.hp   * bias.hp,   0, 1), "hp"),
    atk:  normToStat(clamp(rawNorm.atk  * bias.atk,  0, 1), "atk"),
    def:  normToStat(clamp(rawNorm.def  * bias.def,  0, 1), "def"),
    spd:  normToStat(clamp(rawNorm.spd  * bias.spd,  0, 1), "spd"),
    crit: normToStat(clamp(rawNorm.crit * bias.crit, 0, 1), "crit"),
  };
}

/**
 * Scales an enemy's base stats for a given wave number.
 * Uses compound growth: stat * (1 + scalePerWave) ^ (wave - 1)
 *
 * @param {{ hp:number, atk:number, def:number, spd:number, crit:number }} baseStats
 * @param {number} wave – Current wave number (1-indexed)
 * @returns {{ hp:number, atk:number, def:number, spd:number, crit:number }}
 */
export function scaleEnemyStats(baseStats, wave) {
  if (wave <= 1) return { ...baseStats };

  const w = wave - 1; // waves of growth applied
  const { hpScalePerWave, atkScalePerWave, defScalePerWave, spdScalePerWave } = WAVE_CONFIG;

  return {
    hp:   Math.round(baseStats.hp   * Math.pow(1 + hpScalePerWave,  w)),
    atk:  Math.round(baseStats.atk  * Math.pow(1 + atkScalePerWave, w)),
    def:  Math.round(baseStats.def  * Math.pow(1 + defScalePerWave, w)),
    spd:  Math.round(baseStats.spd  * Math.pow(1 + spdScalePerWave, w)),
    crit: parseFloat(Math.min(baseStats.crit + 0.02 * w, STAT_RANGES.crit.max).toFixed(2)),
  };
}
