import { makeFallback } from './core/generator.js';
import { drawHumanoid } from './render/renderer.js';

const canvas = document.getElementById('arena-canvas');
const ctx = canvas.getContext('2d');

// FIXED: Matching your index.html IDs
const btnEnter = document.getElementById('btn-generate'); 
const nameInput = document.getElementById('champion-input'); 

let currentChampion = null;

// Set canvas size (Adjusted to match your HTML canvas width/height if desired)
canvas.width = 520; 
canvas.height = 340;

// THE "GLUE": What happens when you click the button
if (btnEnter) {
    btnEnter.addEventListener('click', () => {
        const name = nameInput.value || "Mystery Fighter";
        console.log("Generating champion for:", name);
        
        // Create the character data using the fallback hash system
        currentChampion = makeFallback(name);
        
        // FIXED: Using the panel IDs from your HTML
        // This hides the generator and shows the arena status
        document.getElementById('canvas-overlay').classList.add('hidden');
        document.getElementById('generator-status').innerText = `CHAMPION ${name.toUpperCase()} LOADED.`;
        
        // Optional: If you want to show the stat card, remove the hidden class
        document.getElementById('champion-card').classList.remove('hidden');
        document.getElementById('card-name').innerText = name;
    });
}

function gameLoop() {
    const t = Date.now() / 1000;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Only draw if we have a champion
    if (currentChampion) {
        drawHumanoid(
            ctx, 
            currentChampion, 
            canvas.width / 2, 
            canvas.height * 0.8, // Positioned near bottom of canvas
            80,                  // Slightly smaller scale for your 520x340 canvas
            t, 
            1, 
            false, false, false
        );
    }

    requestAnimationFrame(gameLoop);
}

gameLoop();
