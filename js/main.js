import { makeFallback } from './core/generator.js';
import { drawHumanoid } from './render/renderer.js';

const canvas = document.getElementById('arena-canvas');
const ctx = canvas.getContext('2d');

// MATCHING YOUR HTML:
// <button id="btn-generate">...
// <input id="champion-input">...
const btnEnter = document.getElementById('btn-generate'); 
const nameInput = document.getElementById('champion-input'); 

let currentChampion = null;

// Adjusting canvas size to match your HTML exactly (520x340)
canvas.width = 520;
canvas.height = 340;

// The check 'if (btnEnter)' prevents the "null" error
if (btnEnter) {
    btnEnter.addEventListener('click', () => {
        const name = nameInput.value || "Mystery Fighter";
        console.log("Generating champion for:", name);
        
        // Generate character data
        currentChampion = makeFallback(name);
        
        // UI Updates using your HTML IDs
        const overlay = document.getElementById('canvas-overlay');
        if (overlay) overlay.style.display = 'none';

        const status = document.getElementById('generator-status');
        if (status) status.innerText = `CHAMPION [${name.toUpperCase()}] INITIALIZED`;

        // Reveal the stats card
        const card = document.getElementById('champion-card');
        if (card) card.classList.remove('hidden');
        
        const cardName = document.getElementById('card-name');
        if (cardName) cardName.innerText = name;
    });
} else {
    console.error("Critical Error: 'btn-generate' not found in HTML.");
}

function gameLoop() {
    const t = Date.now() / 1000;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (currentChampion) {
        drawHumanoid(
            ctx, 
            currentChampion, 
            canvas.width / 2, 
            canvas.height * 0.8, // Anchored near the bottom
            5,                  // Scaled for a smaller canvas
            t, 
            1, 
            false, false, false
        );
    }

    requestAnimationFrame(gameLoop);
}

gameLoop();
