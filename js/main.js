import { makeFallback } from './core/generator.js';
import { drawHumanoid } from './render/renderer.js';

const canvas = document.getElementById('arena-canvas');
const ctx = canvas.getContext('2d');
const btnEnter = document.getElementById('btn-generate'); 
const nameInput = document.getElementById('champion-input'); 

let currentChampion = null;

/**
 * CRISP RENDERER SETUP
 * High-DPI handling to prevent blurriness on desktops/mobiles
 */
function setupCanvas() {
    const dpr = window.devicePixelRatio || 1;
    // Your CSS layout size
    const width = 520;
    const height = 340;
    
    // Set display size
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    
    // Set actual internal resolution (Higher for Retina/4K screens)
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    
    // Normalize coordinate system
    ctx.scale(dpr, dpr);
}

setupCanvas();

// The check 'if (btnEnter)' prevents the "null" error
if (btnEnter) {
    btnEnter.addEventListener('click', () => {
        const name = nameInput.value || "Mystery Fighter";
        
        // Generate character data
        currentChampion = makeFallback(name);
        
        // UI Updates
        const overlay = document.getElementById('canvas-overlay');
        if (overlay) overlay.style.display = 'none';

        const status = document.getElementById('generator-status');
        if (status) status.innerText = `CHAMPION [${name.toUpperCase()}] INITIALIZED`;

        const card = document.getElementById('champion-card');
        if (card) card.classList.remove('hidden');
        
        const cardName = document.getElementById('card-name');
        if (cardName) cardName.innerText = name;
    });
}

/**
 * GAME LOOP
 * Using "Relative Positioning" so characters fit on any screen
 */
function gameLoop() {
    const t = Date.now() / 1000;
    
    // Clean clear
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (currentChampion) {
        // WORLD COORDINATES:
        // x: 130 (25% of the way across - The Player Slot)
        // y: 240 (Near the bottom)
        // scale: 3 (Balanced size for 2 combatants)
        drawHumanoid(
            ctx, 
            currentChampion, 
            130,                 
            240,                 
            3,                   
            t, 
            1,                   // Facing Right
            false, false, false
        );
        
        // Placeholder for Enemy (will go at x: 390)
    }

    requestAnimationFrame(gameLoop);
}

gameLoop();
