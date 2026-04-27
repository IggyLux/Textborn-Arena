/* ============================================================================
   TEXTBORN ARENA — main.js (REWRITTEN FOR RESOLUTION INDEPENDENCE)
   ============================================================================ */

/**
 * CORE CONFIGURATION
 * We use a "Reference Height" of 600. 
 * If the Arena is 1200px tall on a 4K screen, the scale is 2.0.
 */
const REFERENCE_HEIGHT = 600;

// State Management
const gameState = {
    player: null,
    enemy: null,
    isBattleActive: false,
    wave: 1,
    uiScale: 1, // This will be calculated dynamically
    arena: {
        width: 0,
        height: 0
    }
};

// DOM References
const canvas = document.getElementById('arena-canvas');
const ctx = canvas.getContext('2d');
const canvasWrap = document.getElementById('canvas-wrap');
const overlay = document.querySelector('.canvas-overlay');

/**
 * RESIZE ENGINE
 * This is the "Brain" that connects the CSS Arena box to the JS Drawing logic.
 */
function resize() {
    if (!canvasWrap) return;

    // 1. Measure the CSS container
    const rect = canvasWrap.getBoundingClientRect();
    
    // 2. Set Canvas resolution to match the physical pixels on screen
    canvas.width = rect.width;
    canvas.height = rect.height;
    
    gameState.arena.width = rect.width;
    gameState.arena.height = rect.height;

    // 3. Calculate Scale Factor based on height
    // This ensures characters grow/shrink with the arena size
    gameState.uiScale = rect.height / REFERENCE_HEIGHT;

    // 4. Force a re-render
    render();
}

/**
 * RENDER LOOP
 */
function render() {
    // Clear the arena
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!gameState.player && !gameState.enemy) return;

    // Center point of the arena
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;

    // DRAW PLAYER (Left Side)
    if (gameState.player) {
        drawFighter(
            gameState.player, 
            centerX - (150 * gameState.uiScale), // Positioned relative to center & scale
            centerY, 
            false
        );
    }

    // DRAW ENEMY (Right Side)
    if (gameState.enemy) {
        drawFighter(
            gameState.enemy, 
            centerX + (150 * gameState.uiScale), 
            centerY, 
            true
        );
    }
}

/**
 * FIGHTER DRAWING LOGIC
 * Uses gameState.uiScale to ensure size consistency across resolutions.
 */
function drawFighter(fighter, x, y, isEnemy) {
    const s = gameState.uiScale;
    
    // Example: Body is 100px tall at reference height
    const bodyW = 40 * s;
    const bodyH = 100 * s;

    ctx.fillStyle = isEnemy ? '#ef4444' : '#22c55e';
    
    // Simple placeholder drawing logic (Update this with your character rendering)
    ctx.fillRect(x - bodyW/2, y - bodyH/2, bodyW, bodyH);
    
    // Name Tag
    ctx.fillStyle = '#fff';
    ctx.font = `${Math.floor(14 * s)}px 'Share Tech Mono'`;
    ctx.textAlign = 'center';
    ctx.fillText(fighter.name, x, y - (bodyH/2) - (10 * s));
}

/**
 * INITIALIZATION & EVENTS
 */
window.addEventListener('resize', resize);

// Initial scale calculation
document.addEventListener('DOMContentLoaded', () => {
    resize();
    console.log("Textborn Arena Engine Initialized.");
});

/* --- BATTLE LOGIC WRAPPERS (Preserving your flow) --- */
async function generateChampion() {
    const name = document.getElementById('champ-name').value || "Robot Catgirl";
    // Show Loading in the overlay
    const overlayText = document.querySelector('.overlay-text');
    if (overlayText) overlayText.innerText = "INITIALIZING CHAMPION...";

    // Simulating API call
    setTimeout(() => {
        gameState.player = { name: name, hp: 100, maxHp: 100 };
        if (overlay) overlay.classList.add('hidden');
        resize();
    }, 1000);
}
