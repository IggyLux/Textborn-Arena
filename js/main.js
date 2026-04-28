/* ============================================================================
   TEXTBORN ARENA — CORE ENGINE (Resolution Independent)
   ============================================================================ */

// 1. ENGINE STATE
// All data lives here. Drawing logic reads from this.
const state = {
    player: null,
    enemy: null,
    isBattleActive: false,
    wave: 1,
    uiScale: 1,
    arena: { width: 0, height: 0 }
};

// 2. DOM REFERENCES
const canvas = document.getElementById('arena-canvas');
const ctx = canvas.getContext('2d');
const canvasWrap = document.getElementById('canvas-wrap');
const overlay = document.querySelector('.canvas-overlay');
const overlayText = document.querySelector('.overlay-text');

/**
 * RESIZE & SCALE ENGINE
 * Measures the #canvas-wrap (the CSS box) and scales the internal drawing resolution.
 */
function resize() {
    if (!canvasWrap || !canvas) return;

    // Get exact dimensions of the Arena container from CSS
    const rect = canvasWrap.getBoundingClientRect();
    
    // Set internal resolution to match physical screen size
    canvas.width = rect.width;
    canvas.height = rect.height;
    state.arena.width = rect.width;
    state.arena.height = rect.height;

    // Calculate scale factor relative to a 600px tall "Reference Arena"
    state.uiScale = rect.height / 600;

    render();
}

/**
 * CHAMPION GENERATION
 * Triggered by the Forge Button.
 */
async function generateChampion() {
    console.log("Initiating Champion Generation...");

    const nameInput = document.getElementById('champ-name');
    const styleInput = document.getElementById('champ-style');
    const name = nameInput ? nameInput.value.trim() : "Unknown Challenger";

    // 1. Update Overlay Feedback
    if (overlayText) overlayText.innerText = "FORGING CHAMPION...";
    
    try {
        // 2. Build Player Object (Add your AI/Fetch logic here if needed)
        state.player = {
            name: name || "Challenger",
            hp: 100,
            maxHp: 100,
            stats: { atk: 10, def: 10, spd: 10 },
            style: styleInput ? styleInput.value : "Standard"
        };

        console.log("Champion Generated:", state.player.name);

        // 3. HIDE OVERLAY & REVEAL ARENA
        // This is where the 'awaiting combatants' disappears
        if (overlay) {
            overlay.classList.add('hidden');
        }
        
        // 4. Update UI and Re-draw
        updateHUD();
        resize(); // Force a re-render now that state.player exists
        
        log(`[ SYSTEM ] : CHAMPION [ ${state.player.name.toUpperCase()} ] INITIALIZED`);

    } catch (err) {
        console.error("Generation Error:", err);
        if (overlayText) overlayText.innerText = "GENERATION FAILED";
    }
}

/**
 * RENDER LOOP
 * Handles drawing the characters onto the canvas.
 */
function render() {
    // Clear previous frame
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // If no player has been generated yet, stop here.
    if (!state.player) return;

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;

    // Draw Player (Left side)
    drawFighter(state.player, centerX - (180 * state.uiScale), centerY, false);

    // Draw Enemy (Right side)
    if (state.enemy) {
        drawFighter(state.enemy, centerX + (180 * state.uiScale), centerY, true);
    }
}

/**
 * DRAWING UTILITY
 * Draws a representative fighter based on uiScale.
 */
function drawFighter(fighter, x, y, isEnemy) {
    const s = state.uiScale;
    
    // Scale body parts to match the Arena height
    const bodyW = 40 * s;
    const bodyH = 100 * s;
    const headR = 25 * s;

    // Head
    ctx.fillStyle = isEnemy ? '#ef4444' : '#22c55e';
    ctx.beginPath();
    ctx.arc(x, y - (bodyH/2), headR, 0, Math.PI * 2);
    ctx.fill();

    // Body
    ctx.fillRect(x - bodyW/2, y - (bodyH/4), bodyW, bodyH);

    // Name Label
    ctx.fillStyle = '#fff';
    ctx.font = `${Math.floor(14 * s)}px 'Share Tech Mono'`;
    ctx.textAlign = 'center';
    ctx.fillText(fighter.name.toUpperCase(), x, y - (bodyH/2) - (headR + 10 * s));
}

/**
 * HUD & LOG UTILITIES
 */
function updateHUD() {
    if (!state.player) return;
    const pNameEl = document.getElementById('player-name');
    if (pNameEl) pNameEl.innerText = state.player.name;
    
    // Reset Health Bars to 100%
    const pBar = document.getElementById('player-hp-bar');
    if (pBar) pBar.style.width = '100%';
}

function log(msg) {
    const logContainer = document.getElementById('combat-log');
    if (!logContainer) return;
    
    const entry = document.createElement('div');
    entry.className = 'log-entry log-system';
    entry.innerText = msg;
    logContainer.prepend(entry);
}

/**
 * INITIALIZATION
 */
window.addEventListener('resize', resize);

document.addEventListener('DOMContentLoaded', () => {
    // Run initial sizing
    resize();

    // Find and Bind the Generate Button
    const genBtn = document.querySelector('button') || document.querySelector('.btn-generate');
    if (genBtn) {
        genBtn.addEventListener('click', (e) => {
            e.preventDefault();
            generateChampion();
        });
    }
    
    console.log("Textborn Arena Engine: Online");
});
