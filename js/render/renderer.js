// js/render/renderer.js

export function drawHumanoid(ctx, data, x, y, scale, t) {
    const s = scale;
    
    // 1. Torso (The Core)
    const tw = 30 * s; 
    const th = 40 * s;
    ctx.fillStyle = data.color || "#44cc44";
    ctx.fillRect(x - tw/2, y - th, tw, th);

    // 2. Head (Snapped to Torso)
    const hr = 15 * s;
    const headY = y - th - hr; // Perfectly sits on neck
    ctx.beginPath();
    ctx.arc(x, headY, hr, 0, Math.PI * 2);
    ctx.fill();

    // 3. Eyes (Relative to Head)
    ctx.fillStyle = "white";
    const eyeSize = 3 * s;
    const eyeSpacing = 6 * s;
    ctx.fillRect(x - eyeSpacing, headY - eyeSize, eyeSize, eyeSize);
    ctx.fillRect(x + eyeSpacing - eyeSize, headY - eyeSize, eyeSize, eyeSize);

    // 4. Arms (Attached to Shoulders)
    const armW = 8 * s;
    const armH = 30 * s;
    const swing = Math.sin(t * 5) * 0.2; // Slight idle animation
    
    // Left Arm
    ctx.save();
    ctx.translate(x - tw/2, y - th + 5);
    ctx.rotate(swing);
    ctx.fillRect(-armW, 0, armW, armH);
    ctx.restore();

    // Right Arm
    ctx.save();
    ctx.translate(x + tw/2, y - th + 5);
    ctx.rotate(-swing);
    ctx.fillRect(0, 0, armW, armH);
    ctx.restore();
}
