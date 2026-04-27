import { makeFallback } from './core/generator.js';
import { drawHumanoid, drawArena } from './render/renderer.js';

const canvas = document.getElementById('arena-canvas');
const ctx = canvas.getContext('2d');

const characters = [
    makeFallback('Fire Knight'),
    makeFallback('Void Assassin'),
    makeFallback('Slime'),
    makeFallback('Holy Valkyrie'),
    makeFallback('Mechanical Tank')
];

const characterPositions = [60, 140, 220, 300, 380];
const baseY = canvas.height * 0.65;
let startTime = Date.now();

function gameLoop() {
    const elapsedMs = Date.now() - startTime;
    const t = elapsedMs / 1000;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawArena(ctx, canvas.width, canvas.height, t);

    characters.forEach((character, index) => {
        const x = characterPositions[index];
        drawHumanoid(ctx, character, x, baseY, 1.0, t, 1, { isAttacking: false, isDead: false, isMoving: false });
    });
    requestAnimationFrame(gameLoop);
}

gameLoop();