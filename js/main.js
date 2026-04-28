/**
 * TEXTBORN ARENA — CORE ENGINE
 * Scaled for Resolution Independence
 */

// Configuration
const REFERENCE_HEIGHT = 600; // Base height for coordinate math

// Engine State
const state = {
    player: null,
    enemy: null,
    isBattleActive: false,
    wave: 1,
    uiScale: 1,
    arena: { width: 0, height: 0 }
};

// DOM References
const canvas = document.getElementById('arena-canvas');
const ctx = canvas.getContext('2d');
const canvasWrap = document.getElementById('canvas-wrap');
const overlay = document.querySelector('.canvas-overlay');
const overlayText = document.querySelector('.overlay-text');

/**
 * RESIZE & SCALE LOGIC
 * Measures the CSS-defined arena box and updates the drawing scale.
 */
function resize() {
    if (!canvasWrap || !canvas) return;

    // 1. Measure the box provided by your new CSS
    const rect = canvasWrap.getBoundingClientRect();
    
    // 2. Set internal resolution to match physical screen pixels
    canvas.width = rect.width;
    canvas.height = rect.height;
    state.arena.width = rect.width;
    state.arena.height = rect.height;

    // 3. Calculate Scale Factor
    // Ensures characters look the same size relative to the box on any monitor
    state.uiScale = rect.height / REFERENCE_HEIGHT;

    render();
}

/**
 * CHAMPION GENERATION
 * Connects the "Forge" button to the Arena state.
 */
async function generateChampion() {
    const nameInput = document.getElementById('champ-name');
    const styleInput = document.getElementById('champ-style');
    const name = nameInput.value.trim() || "Unknown Challenger";

    // Update UI State
    if (overlayText) overlayText.innerText = "FORGING CHAMPION...";
    
    try {
        // Logic for champion creation
        state.player = {
            name: name,
            hp: 100,
            maxHp: 100,
            stats: { atk: 10, def: 10, spd: 10 },
            style: styleInput.value || "Standard"
        };

        // Hide overlay and reveal Arena
        if (overlay) overlay.classList.add('hidden');
        
        updateHUD();
        resize(); // Re-center and scale for new fighter
        log(`[ SYSTEM ] : CHAMPION [ ${name.toUpperCase()} ] INITIALIZED`);

    } catch (err) {
        if (overlayText) overlayText.innerText = "GENERATION FAILED";
        console.error(err);
    }
}

/**
 * RENDER LOOP
 * Draws the game world based on the current uiScale.
 */
function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!state.player) return;

    // Calculate dynamic center points
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;

    // Draw Player
    drawFighter(state.player, centerX - (180 * state.uiScale), centerY, false);

    // Draw Enemy (if exists)
    if (state.enemy) {
        drawFighter(state.enemy, centerX + (180 * state.uiScale), centerY, true);
    }
}

/**
 * FIGHTER DRAWING
 * Relative to scale and position.
 */
function drawFighter(fighter, x, y, isEnemy) {
    const s = state.uiScale;
    const bodyW = 40 * s;
    const bodyH = 100 * s;

    // Head
    ctx.fillStyle = isEnemy ? '#ef4444' : '#22c55e'; //
    ctx.beginPath();
    ctx.arc(x, y - (40 * s), 25 * s, 0, Math.PI * 2);
    ctx.fill();

    // Body
    ctx.fillRect(x - bodyW/2, y - bodyH/4, bodyW, bodyH);

    // Label
    ctx.fillStyle = '#fff';
    ctx.font = `${Math.floor(14 * s)}px 'Share Tech Mono'`;
    ctx.textAlign = 'center';
    ctx.fillText(fighter.name, x, y - (bodyH/2) - (25 * s));
}

/**
 * UI UPDATES
 */
function updateHUD() {
    if (!state.player) return;
    document.getElementById('player-name').innerText = state.player.name;
    // Update HP bars and other stats here
}

function log(msg) {
    const logContainer = document.getElementById('combat-log');
    if (!logContainer) return;
    const div = document.createElement('div');
    div.className = 'log-entry log-system';
    div.innerText = msg;
    logContainer.prepend(div);
}

// Global Event Listeners
window.addEventListener('resize', resize);
document.addEventListener('DOMContentLoaded', () => {
    resize();
    // Re-bind the generate button if needed
    const genBtn = document.querySelector('button[onclick="generateChampion()"]');
    if (genBtn) {
        genBtn.onclick = null; // Remove inline
        genBtn.addEventListener('click', generateChampion);
    }
});
