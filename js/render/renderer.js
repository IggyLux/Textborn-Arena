// js/render/renderer.js

export function drawHumanoid(ctx, data, x, y, scale, t) {
    // We use a fixed internal scale so the 20k-token generator 
    // variables don't blow up the screen.
    const s = scale; 
    
    // 1. BASE COLOR (Using data color if it exists, otherwise green)
    ctx.fillStyle = data.color || "#4cc918";

    // 2. TORSO 
    // We hardcode the base size here to override any "giant" data values
    const tw = 20 * s; 
    const th = 30 * s;
    // Draw centered on X, and sitting ON the Y coordinate
    ctx.fillRect(x - tw/2, y - th, tw, th);

    // 3. HEAD
    const hr = 10 * s;
    const headY = y - th - hr; // Sits exactly on top of torso
    ctx.beginPath();
    ctx.arc(x, headY, hr, 0, Math.PI * 2);
    ctx.fill();

    // 4. LEGS (The missing pieces)
    const lw = 8 * s;
    const lh = 15 * s;
    // Left Leg
    ctx.fillRect(x - tw/2, y, lw, lh);
    // Right Leg
    ctx.fillRect(x + tw/2 - lw, y, lw, lh);

    // 5. ARMS (White slabs from your screenshot, but sized correctly)
    ctx.fillStyle = "#FFFFFF";
    const aw = 6 * s;
    const ah = 20 * s;
    const swing = Math.sin(t * 4) * 0.2;

    // Left Arm
    ctx.save();
    ctx.translate(x - tw/2, y - th + 5);
    ctx.rotate(swing);
    ctx.fillRect(-aw, 0, aw, ah);
    ctx.restore();

    // Right Arm
    ctx.save();
    ctx.translate(x + tw/2, y - th + 5);
    ctx.rotate(-swing);
    ctx.fillRect(0, 0, aw, ah);
    ctx.restore();
}
