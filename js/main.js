import { makeFallback } from './core/generator.js';
import { drawHumanoid } from './render/renderer.js';

const canvas = document.getElementById('arena-canvas');
const ctx = canvas.getContext('2d');
const btnEnter = document.getElementById('enter-arena-btn'); // Make sure this ID matches your HTML
const nameInput = document.getElementById('champion-name'); // Make sure this ID matches your HTML

let currentChampion = null;

// Set canvas size
canvas.width = 800;
canvas.height = 600;

// THE "GLUE": What happens when you click the button
btnEnter.addEventListener('click', () => {
    const name = nameInput.value || "Mystery Fighter";
    console.log("Generating champion for:", name);
    
    // Create the character data using the fallback hash system
    currentChampion = makeFallback(name);
    
    // Switch UI views (This assumes your CSS/HTML uses these classes)
    document.getElementById('setup-screen').style.display = 'none';
    document.getElementById('arena-screen').style.display = 'block';
});

function gameLoop() {
    const t = Date.now() / 1000;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Only draw if we have a champion
    if (currentChampion) {
        drawHumanoid(
            ctx, 
            currentChampion, 
            canvas.width / 2, 
            canvas.height * 0.7, 
            100, 
            t, 
            1, 
            false, false, false
        );
    }

    requestAnimationFrame(gameLoop);
}

gameLoop();
