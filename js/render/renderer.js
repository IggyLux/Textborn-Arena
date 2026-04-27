/**
 * @file renderer.js
 * @description Pure-function rendering engine for TEXTBORN ARENA.
 *
 * Architecture: a layered draw pipeline. Each exported draw* function is a
 * self-contained unit responsible for exactly one body region. The main
 * exported function `drawHumanoid` orchestrates them in Z-order.
 *
 * Depth model: every shape uses three tones derived from a single base color
 * via lc() (lighten/darken). No flat fills — highlight edge, base fill,
 * shadow edge. This is what gives the CRT-plastic solidity.
 *
 * Animation contract (t = elapsed seconds, continuous):
 *   Idle breath  : sin(t × 1.8)   → torso Y bob, ±1.5px
 *   Idle sway    : sin(t × 1.2)   → head X drift, ±1px
 *   Idle arm     : sin(t × 1.6)   → arm hang oscillation
 *   Aura pulse   : sin(t × 2.5)   → outer glow alpha
 *   Wing flap    : sin(t × 3.5)   → wing pitch angle
 *   Attack swing : sin(t × 8.0)   → weapon arm forward swing (half-cycle)
 *   Hit recoil   : exp(-t × 8)    → x-position displacement (managed by caller)
 *   Walk cycle   : sin(t × 6.0)   → leg/arm swing (when isMoving)
 *
 * Exports:
 *   drawArena(ctx, width, height)
 *   drawHumanoid(ctx, data, x, y, scale, t, facing, state)
 *   drawParticles(ctx, particles, dt)
 *   createHitParticles(x, y, color)    → Particle[]
 *
 * `state` is an object: { isAttacking, isDead, isMoving, hitRecoilT }
 * `facing` is +1 (right) or -1 (left, mirrored)
 */

import { RENDERER_CONFIG } from "../config.js";
import { hexRgb, rca, lc } from "./generator.js";

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL COLOUR HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Darken an rgb array — convenience alias for negative lc */
const dk = (rgb, f) => lc(rgb, -Math.abs(f));

/** Lighten an rgb array — convenience alias for positive lc */
const lt = (rgb, f) => lc(rgb, +Math.abs(f));

/**
 * Build a linear gradient for a shape to simulate a directional light source
 * coming from upper-left. Returns a CanvasGradient.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x  @param {number} y  @param {number} w  @param {number} h
 * @param {number[]} rgb   Base colour [r,g,b]
 * @param {number}   [lift=0.18]   Highlight lift amount
 * @param {number}   [drop=0.22]   Shadow drop amount
 * @returns {CanvasGradient}
 */
function shapeGrad(ctx, x, y, w, h, rgb, lift = 0.18, drop = 0.22) {
  const g = ctx.createLinearGradient(x - w * 0.5, y - h * 0.5, x + w * 0.5, y + h * 0.5);
  g.addColorStop(0.0, rca(...lt(rgb, lift)));
  g.addColorStop(0.5, rca(...rgb));
  g.addColorStop(1.0, rca(...dk(rgb, drop)));
  return g;
}

/**
 * Stroke a shape's rim with a highlight on top and shadow on bottom.
 * Call this right after any ctx.fill().
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number[]} rgb
 * @param {number} [alpha=0.55]
 */
function rimStroke(ctx, rgb, alpha = 0.55) {
  ctx.strokeStyle = rca(...lt(rgb, 0.25), alpha);
  ctx.lineWidth   = 0.9;
  ctx.stroke();
}

// ─────────────────────────────────────────────────────────────────────────────
// ARENA BACKGROUND
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Draws the arena floor and background bands.
 * Call once per frame before any characters.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} W  Canvas logical width
 * @param {number} H  Canvas logical height
 * @param {number} t  Elapsed time (used for ambient pulse)
 */
export function drawArena(ctx, W, H, t) {
  const { bgBands, floorY } = RENDERER_CONFIG;

  // Background bands
  for (const band of bgBands) {
    ctx.fillStyle = band.color;
    ctx.fillRect(0, band.y, W, band.h);
  }

  // Ambient atmospheric vignette
  const vign = ctx.createRadialGradient(W * 0.5, H * 0.45, 20, W * 0.5, H * 0.45, W * 0.65);
  vign.addColorStop(0,   "rgba(0,0,0,0)");
  vign.addColorStop(1,   "rgba(0,0,0,0.55)");
  ctx.fillStyle = vign;
  ctx.fillRect(0, 0, W, H);

  // Arena floor — glowing horizon line
  const pulse = 0.12 + Math.sin(t * 0.9) * 0.04;
  const floorGrad = ctx.createLinearGradient(0, floorY - 2, 0, floorY + 14);
  floorGrad.addColorStop(0,   `rgba(0,229,255,${pulse})`);
  floorGrad.addColorStop(0.4, `rgba(0,229,255,0.04)`);
  floorGrad.addColorStop(1,   "rgba(0,0,0,0)");
  ctx.fillStyle = floorGrad;
  ctx.fillRect(0, floorY - 2, W, 18);

  // Floor grid — two perspective lines converging to center
  ctx.strokeStyle = `rgba(0,229,255,0.07)`;
  ctx.lineWidth   = 0.5;
  for (let i = 0; i <= 6; i++) {
    const fx = (i / 6) * W;
    ctx.beginPath();
    ctx.moveTo(W * 0.5, floorY);
    ctx.lineTo(fx, H);
    ctx.stroke();
  }

  // Horizontal grid lines on floor
  for (let j = 1; j <= 3; j++) {
    const gy = floorY + j * 16;
    if (gy > H) break;
    ctx.beginPath();
    ctx.moveTo(0, gy); ctx.lineTo(W, gy);
    ctx.strokeStyle = `rgba(0,229,255,${0.05 - j * 0.012})`;
    ctx.stroke();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 0 — GROUND SHADOW
// ─────────────────────────────────────────────────────────────────────────────

function drawShadow(ctx, bw, S, isDead) {
  if (isDead) return;
  ctx.beginPath();
  ctx.ellipse(0, 4, bw * 0.48, S * 0.07, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,0.38)";
  ctx.fill();
}

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 1 — AURA / ENERGY FIELD
// ─────────────────────────────────────────────────────────────────────────────

function drawAura(ctx, aurc, S, t, isDead) {
  if (isDead) return;
  const pulse = 0.14 + Math.sin(t * 2.5) * 0.05;
  const agrad = ctx.createRadialGradient(0, -S * 0.38, 0, 0, -S * 0.28, S * 1.05);
  agrad.addColorStop(0,   rca(...aurc, pulse * 1.4));
  agrad.addColorStop(0.5, rca(...aurc, pulse * 0.5));
  agrad.addColorStop(1,   rca(...aurc, 0));
  ctx.beginPath();
  ctx.ellipse(0, -S * 0.28, S * 0.88, S * 1.15, 0, 0, Math.PI * 2);
  ctx.fillStyle = agrad;
  ctx.fill();
}

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 2 — TAIL
// ─────────────────────────────────────────────────────────────────────────────

function drawTail(ctx, sc, acc, bw, bh, S, t) {
  const wag = Math.sin(t * 2.2) * 22;
  ctx.save();
  ctx.translate(-bw * 0.38, -bh * 0.1);
  ctx.rotate((90 + wag) * Math.PI / 180);

  // Main tail curve
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(
    S * 0.05, S * 0.18,
    S * 0.14, S * 0.3,
    Math.sin(t * 2.2) * S * 0.06, S * 0.44
  );
  ctx.strokeStyle = rca(...sc, 0.88);
  ctx.lineWidth   = bw * 0.13;
  ctx.lineCap     = "round";
  ctx.stroke();

  // Tail highlight (thinner, lighter, offset)
  ctx.beginPath();
  ctx.moveTo(-bw * 0.03, 0);
  ctx.bezierCurveTo(
    S * 0.02, S * 0.18,
    S * 0.10, S * 0.28,
    Math.sin(t * 2.2) * S * 0.06 - bw * 0.02, S * 0.44
  );
  ctx.strokeStyle = rca(...lt(sc, 0.22), 0.45);
  ctx.lineWidth   = bw * 0.05;
  ctx.stroke();

  // Tail tip — accent gem
  ctx.beginPath();
  const tipX = Math.sin(t * 2.2) * S * 0.06;
  ctx.arc(tipX, S * 0.44, bw * 0.11, 0, Math.PI * 2);
  const tipG = ctx.createRadialGradient(tipX - bw * 0.03, S * 0.42, 0, tipX, S * 0.44, bw * 0.11);
  tipG.addColorStop(0, rca(...lt(acc, 0.3)));
  tipG.addColorStop(1, rca(...dk(acc, 0.15)));
  ctx.fillStyle = tipG;
  ctx.fill();
  rimStroke(ctx, acc, 0.7);
  ctx.restore();
}

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 3 — WINGS (back pass — drawn behind torso)
// ─────────────────────────────────────────────────────────────────────────────

function drawWingsBack(ctx, acc, sc, torsoW, torsoH, S, t) {
  const flap = Math.sin(t * 3.5) * 14;
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.scale(side, 1);
    ctx.rotate((-22 + flap) * Math.PI / 180);

    // Membrane fill
    ctx.beginPath();
    ctx.moveTo(torsoW * 0.28, -torsoH * 0.28);
    ctx.bezierCurveTo(torsoW * 1.05, -torsoH * 0.78, torsoW * 1.28, 0.02, torsoW * 0.58, torsoH * 0.22);
    ctx.bezierCurveTo(torsoW * 0.48, torsoH * 0.06, torsoW * 0.38, -torsoH * 0.08, torsoW * 0.28, -torsoH * 0.28);
    ctx.fillStyle = rca(...acc, 0.22);
    ctx.fill();

    // Wing edge vein
    ctx.beginPath();
    ctx.moveTo(torsoW * 0.28, -torsoH * 0.28);
    ctx.bezierCurveTo(torsoW * 1.05, -torsoH * 0.78, torsoW * 1.28, 0.02, torsoW * 0.58, torsoH * 0.22);
    ctx.strokeStyle = rca(...acc, 0.58);
    ctx.lineWidth = 0.8;
    ctx.stroke();

    // Inner vein lines
    ctx.strokeStyle = rca(...acc, 0.2);
    ctx.lineWidth   = 0.5;
    for (let v = 0; v < 3; v++) {
      const vt = (v + 1) / 4;
      ctx.beginPath();
      ctx.moveTo(torsoW * 0.28, -torsoH * 0.28);
      ctx.lineTo(
        torsoW * (0.28 + 0.9 * vt),
        -torsoH * (0.28 - 0.9 * vt) + torsoH * 0.5 * vt
      );
      ctx.stroke();
    }
    ctx.restore();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 4 — LEGS
// ─────────────────────────────────────────────────────────────────────────────

function drawLegs(ctx, sc, ac, hasArmor, bw, bh, S, t, isMoving, build) {
  const walkAmt  = isMoving ? 1 : 0;
  const legSwing = Math.sin(t * 6.0) * 18 * walkAmt;
  const legW     = bw * 0.22;
  const legH     = bh * 0.38;
  const legCol   = hasArmor ? ac : sc;

  const hunch = build === "hunched" ? 8 : 0;
  const legY  = hunch;

  for (const side of [-1, 1]) {
    const swing = side === -1 ? -legSwing * 0.8 : legSwing * 0.8;
    ctx.save();
    ctx.translate(side * bw * 0.15, legY - legH * 0.1);
    ctx.rotate(swing * Math.PI / 180);
    _drawLimb(ctx, legCol, legW, legH * 0.48, legW * 0.85, legH, "leg");
    ctx.restore();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 5 — TORSO  (integrates hasArmor + hasBreasts as sub-layers)
// ─────────────────────────────────────────────────────────────────────────────

function drawTorso(ctx, data, sc, ac, acc, bw, bh, t, isAttacking, isMoving) {
  const { hasArmor, hasBreasts } = data.physicalTraits;
  const torsoW = bw * 0.52;
  const torsoH = bh * 0.42;
  const attackLean = isAttacking ? 0.012 : 0;

  ctx.save();
  if (attackLean) ctx.rotate(attackLean * Math.sin(t * 8.0));

  if (hasArmor) {
    _drawArmoredTorso(ctx, ac, acc, torsoW, torsoH);
  } else {
    _drawBareTorso(ctx, sc, torsoW, torsoH);
  }

  // Breasts are drawn as integral volume of the torso — not a separate layer
  // pasted on top. They share the torso's lighting model and are clipped to
  // the upper chest region so they emerge from the body geometry naturally.
  if (hasBreasts) {
    _drawBreasts(ctx, sc, ac, acc, hasArmor, torsoW, torsoH, t, isMoving);
  }

  ctx.restore();
}

function _drawArmoredTorso(ctx, ac, acc, torsoW, torsoH) {
  // Main plate — diamond-tapered silhouette
  ctx.beginPath();
  ctx.moveTo(-torsoW * 0.5,  -torsoH * 0.05);
  ctx.quadraticCurveTo(-torsoW * 0.52, -torsoH * 0.5,  -torsoW * 0.35, -torsoH * 0.5);
  ctx.lineTo( torsoW * 0.35, -torsoH * 0.5);
  ctx.quadraticCurveTo( torsoW * 0.52, -torsoH * 0.5,   torsoW * 0.5,  -torsoH * 0.05);
  ctx.lineTo( torsoW * 0.45,  torsoH * 0.45);
  ctx.lineTo(-torsoW * 0.45,  torsoH * 0.45);
  ctx.closePath();

  const pg = ctx.createLinearGradient(-torsoW * 0.5, -torsoH * 0.5, torsoW * 0.5, torsoH * 0.45);
  pg.addColorStop(0.0, rca(...lt(ac, 0.22)));
  pg.addColorStop(0.4, rca(...ac));
  pg.addColorStop(1.0, rca(...dk(ac, 0.28)));
  ctx.fillStyle = pg;
  ctx.fill();
  rimStroke(ctx, ac, 0.45);

  // Center ridge / sternum line
  ctx.beginPath();
  ctx.moveTo(-torsoW * 0.26, -torsoH * 0.25);
  ctx.lineTo(0,               -torsoH * 0.06);
  ctx.lineTo( torsoW * 0.26,  -torsoH * 0.25);
  ctx.strokeStyle = rca(...lt(acc, 0.1), 0.45);
  ctx.lineWidth   = 0.8;
  ctx.stroke();

  // Center gem / clasp
  ctx.beginPath();
  ctx.ellipse(0, -torsoH * 0.06, torsoW * 0.07, torsoH * 0.065, 0, 0, Math.PI * 2);
  const gemG = ctx.createRadialGradient(-torsoW * 0.02, -torsoH * 0.08, 0, 0, -torsoH * 0.06, torsoW * 0.07);
  gemG.addColorStop(0, rca(...lt(acc, 0.4)));
  gemG.addColorStop(1, rca(...dk(acc, 0.1)));
  ctx.fillStyle   = gemG;
  ctx.fill();
  rimStroke(ctx, acc, 0.9);

  // Horizontal armor plate seam
  ctx.beginPath();
  ctx.moveTo(-torsoW * 0.44, torsoH * 0.12);
  ctx.lineTo( torsoW * 0.44, torsoH * 0.12);
  ctx.strokeStyle = rca(...dk(ac, 0.35), 0.6);
  ctx.lineWidth   = 0.7;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-torsoW * 0.44, torsoH * 0.14);
  ctx.lineTo( torsoW * 0.44, torsoH * 0.14);
  ctx.strokeStyle = rca(...lt(ac, 0.12), 0.3);
  ctx.lineWidth   = 0.5;
  ctx.stroke();
}

function _drawBareTorso(ctx, sc, torsoW, torsoH) {
  ctx.beginPath();
  ctx.moveTo(-torsoW * 0.5,  -torsoH * 0.05);
  ctx.quadraticCurveTo(-torsoW * 0.5, -torsoH * 0.5, -torsoW * 0.3, -torsoH * 0.5);
  ctx.lineTo( torsoW * 0.3,  -torsoH * 0.5);
  ctx.quadraticCurveTo( torsoW * 0.5, -torsoH * 0.5,  torsoW * 0.5, -torsoH * 0.05);
  ctx.lineTo( torsoW * 0.4,   torsoH * 0.45);
  ctx.lineTo(-torsoW * 0.4,   torsoH * 0.45);
  ctx.closePath();

  const sg = ctx.createLinearGradient(-torsoW * 0.5, -torsoH * 0.5, torsoW * 0.3, torsoH * 0.45);
  sg.addColorStop(0.0, rca(...lt(sc, 0.2)));
  sg.addColorStop(0.5, rca(...sc));
  sg.addColorStop(1.0, rca(...dk(sc, 0.25)));
  ctx.fillStyle = sg;
  ctx.fill();

  // Bare skin subsurface rim
  ctx.strokeStyle = rca(...dk(sc, 0.18), 0.5);
  ctx.lineWidth   = 0.8;
  ctx.stroke();

  // Collarbone hint
  ctx.beginPath();
  ctx.moveTo(-torsoW * 0.28, -torsoH * 0.38);
  ctx.quadraticCurveTo(0, -torsoH * 0.3, torsoW * 0.28, -torsoH * 0.38);
  ctx.strokeStyle = rca(...lt(sc, 0.15), 0.35);
  ctx.lineWidth   = 0.6;
  ctx.stroke();
}

/**
 * Breasts drawn as integral upper-chest volume.
 * They share the torso's base color so they read as the same material.
 * Armored variant uses the armor color with a slight accent tint.
 * The bounce offset comes from the same walk/idle sin already driving the body.
 */
function _drawBreasts(ctx, sc, ac, acc, hasArmor, torsoW, torsoH, t, isMoving) {
  // Sync the bounce exactly to the same frequency as the idle/walk bob
  // so the motion reads as one unified body, not a separate animation.
  const breathPhase = isMoving ? Math.abs(Math.sin(t * 6.0)) * 3.2 : Math.sin(t * 1.8) * 1.4;
  const bounceY     = breathPhase;

  // Geometry — ellipses emerge from the upper chest, not float above it
  // hOffset + breastW <= torsoW*0.5 ensures they don't clip outside the silhouette
  const breastW = torsoW * 0.215;
  const breastH = torsoH * 0.28;
  const hOffset = torsoW * 0.225;
  const centerY = -torsoH * 0.2 + bounceY;

  // Base material — same as torso so it's the same flesh/armor surface
  const baseCol = hasArmor ? ac : sc;

  for (const side of [-1, 1]) {
    const cx = side * hOffset;

    // Under-shadow: slightly darker ellipse drawn slightly lower for depth
    ctx.beginPath();
    ctx.ellipse(cx, centerY + breastH * 0.18, breastW * 0.9, breastH * 0.75, 0, 0, Math.PI * 2);
    ctx.fillStyle = rca(...dk(baseCol, 0.28), 0.55);
    ctx.fill();

    // Main volume — gradient lit from upper-left
    ctx.beginPath();
    ctx.ellipse(cx, centerY, breastW, breastH, 0, 0, Math.PI * 2);
    const bg = ctx.createRadialGradient(
      cx - breastW * 0.3, centerY - breastH * 0.3, 0,
      cx, centerY, breastW
    );
    bg.addColorStop(0,   rca(...lt(baseCol, hasArmor ? 0.14 : 0.22)));
    bg.addColorStop(0.6, rca(...baseCol));
    bg.addColorStop(1,   rca(...dk(baseCol, 0.2)));
    ctx.fillStyle = bg;
    ctx.fill();

    // Rim — same treatment as torso edge
    ctx.strokeStyle = rca(...dk(baseCol, 0.22), 0.5);
    ctx.lineWidth   = 0.7;
    ctx.stroke();

    // Armor: small accent rivet at upper curve
    if (hasArmor) {
      ctx.beginPath();
      ctx.arc(cx + side * breastW * 0.25, centerY - breastH * 0.35, torsoW * 0.028, 0, Math.PI * 2);
      ctx.fillStyle = rca(...lt(acc, 0.2), 0.75);
      ctx.fill();
    }
  }

  // Cleavage shadow — a single soft center line that ties both volumes together
  ctx.beginPath();
  ctx.moveTo(-torsoW * 0.04, centerY + breastH * 0.28);
  ctx.quadraticCurveTo(0, centerY + breastH * 0.5, torsoW * 0.04, centerY + breastH * 0.28);
  ctx.strokeStyle = rca(...dk(baseCol, 0.32), 0.45);
  ctx.lineWidth   = 1.1;
  ctx.stroke();
}

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 6 — ARMS + WEAPON
// ─────────────────────────────────────────────────────────────────────────────

function drawArms(ctx, data, sc, ac, wc, acc, bw, bh, S, t, isAttacking, isMoving) {
  const { hasArmor } = data.physicalTraits;
  const walkAmt  = isMoving ? 1 : 0;
  const armSwing = Math.sin(t * 6.0) * 20 * walkAmt;

  // Attack swing — one clean half-sine so the arm swings forward and holds
  const atkProgress  = isAttacking ? Math.max(0, Math.sin(t * 8.0)) : 0;
  const attackRotDeg = atkProgress * -52;

  // Off-arm (left when facing right)
  ctx.save();
  ctx.translate(-bw * 0.5, -bh * 0.35);
  ctx.rotate((-armSwing - 10) * Math.PI / 180);
  _drawLimb(ctx, hasArmor ? ac : sc, bw * 0.18, bh * 0.3, bw * 0.15, bh * 0.28, "arm");
  ctx.restore();

  // Weapon arm (right when facing right)
  ctx.save();
  ctx.translate(bw * 0.5, -bh * 0.35);
  ctx.rotate((armSwing + attackRotDeg) * Math.PI / 180);
  _drawLimb(ctx, hasArmor ? ac : sc, bw * 0.18, bh * 0.3, bw * 0.15, bh * 0.28, "arm");

  if (data.weaponType && data.weaponType !== "none") {
    ctx.translate(0, bh * 0.58);
    drawWeapon(ctx, data.weaponType, wc, acc, S, t, isAttacking);
  }
  ctx.restore();
}

// ─────────────────────────────────────────────────────────────────────────────
// SHARED LIMB DRAWER (legs + arms call this)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Draws a two-segment limb (upper + lower) with joint sphere.
 * Upper segment is wider, lower is slightly narrower — anatomical taper.
 * Both segments use the three-tone depth model.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number[]} col    Base [r,g,b]
 * @param {number}   uw     Upper width
 * @param {number}   uh     Upper height
 * @param {number}   lw     Lower width
 * @param {number}   lh     Lower height
 * @param {"arm"|"leg"} type
 */
function _drawLimb(ctx, col, uw, uh, lw, lh, type) {
  // Upper segment
  ctx.beginPath();
  ctx.moveTo(-uw / 2, 0);
  ctx.quadraticCurveTo(-uw / 2 * 1.1, uh / 2, -lw / 2, uh);
  ctx.lineTo( lw / 2, uh);
  ctx.quadraticCurveTo( uw / 2 * 1.1, uh / 2,  uw / 2, 0);
  ctx.closePath();

  const ug = ctx.createLinearGradient(-uw / 2, 0, uw / 2, uh);
  ug.addColorStop(0, rca(...lt(col, 0.2)));
  ug.addColorStop(1, rca(...dk(col, 0.22)));
  ctx.fillStyle = ug;
  ctx.fill();
  rimStroke(ctx, col, 0.4);

  // Joint sphere — catches light separately
  ctx.beginPath();
  ctx.arc(0, uh, lw * 0.42, 0, Math.PI * 2);
  const jg = ctx.createRadialGradient(-lw * 0.1, uh - lw * 0.15, 0, 0, uh, lw * 0.42);
  jg.addColorStop(0, rca(...lt(col, 0.28)));
  jg.addColorStop(1, rca(...dk(col, 0.18)));
  ctx.fillStyle = jg;
  ctx.fill();

  // Lower segment
  ctx.beginPath();
  ctx.moveTo(-lw / 2, uh);
  ctx.quadraticCurveTo(-lw / 2 * 1.05, uh + lh / 2, -lw * 0.38, uh + lh);
  ctx.lineTo( lw * 0.38, uh + lh);
  ctx.quadraticCurveTo( lw / 2 * 1.05, uh + lh / 2,  lw / 2, uh);
  ctx.closePath();

  const lg2 = ctx.createLinearGradient(-lw / 2, uh, lw / 2, uh + lh);
  lg2.addColorStop(0, rca(...lt(col, 0.12)));
  lg2.addColorStop(1, rca(...dk(col, 0.28)));
  ctx.fillStyle = lg2;
  ctx.fill();
  rimStroke(ctx, col, 0.35);

  // Foot / hand cap
  if (type === "leg") {
    ctx.beginPath();
    ctx.ellipse(0, uh + lh, lw * 0.72, lw * 0.3, 0, 0, Math.PI * 2);
    ctx.fillStyle = rca(...dk(col, 0.22));
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.arc(0, uh + lh, lw * 0.38, 0, Math.PI * 2);
    const hg = ctx.createRadialGradient(-lw * 0.1, uh + lh - lw * 0.1, 0, 0, uh + lh, lw * 0.38);
    hg.addColorStop(0, rca(...lt(col, 0.18)));
    hg.addColorStop(1, rca(...dk(col, 0.2)));
    ctx.fillStyle = hg;
    ctx.fill();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 7 — HEAD
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Draws the head and dispatches to the correct shape sub-function.
 * Head bobs with a sin tied to t — idle sway on x, gentle y breath.
 */
function drawHead(ctx, data, sc, ac, acc, hs, t) {
  const sway = Math.sin(t * 1.2) * 1.0;
  const bob  = Math.sin(t * 1.8) * 1.5;
  ctx.save();
  ctx.translate(sway, bob);

  const r = hs * 0.28;

  switch (data.headShape) {
    case "helmet": case "masked": _drawHelmetHead(ctx, ac, acc, r, t); break;
    case "skull":                 _drawSkullHead(ctx, sc, acc, r, t);  break;
    case "horned":                _drawHornedHead(ctx, sc, acc, r, t); break;
    case "crown":                 _drawCrownHead(ctx, sc, ac, acc, r); break;
    case "hooded":                _drawHoodedHead(ctx, sc, ac, acc, r, t); break;
    case "crystal":               _drawCrystalHead(ctx, sc, acc, r, t); break;
    case "flame":                 _drawFlameHead(ctx, sc, acc, r, t);  break;
    case "cloud":                 _drawCloudHead(ctx, sc, acc, r, t);  break;
    default:                      _drawRoundHead(ctx, sc, acc, r);     break;
  }

  // Eyes (except shapes that draw their own)
  const noDefaultEyes = ["helmet","masked","skull","crystal"];
  if (!noDefaultEyes.includes(data.headShape)) {
    _drawEyes(ctx, data.attackType, sc, acc, r);
  }

  // Elemental forehead mark
  _drawForehead(ctx, data.attackType, acc, r, t);

  ctx.restore();
}

// ── Head shape sub-functions ──────────────────────────────────────────────

function _drawRoundHead(ctx, sc, acc, r) {
  ctx.beginPath();
  ctx.arc(0, -r * 0.35, r, 0, Math.PI * 2);
  const hg = ctx.createRadialGradient(-r * 0.22, -r * 0.68, 0, 0, -r * 0.35, r);
  hg.addColorStop(0, rca(...lt(sc, 0.28)));
  hg.addColorStop(0.6, rca(...sc));
  hg.addColorStop(1,   rca(...dk(sc, 0.22)));
  ctx.fillStyle = hg;
  ctx.fill();
  rimStroke(ctx, sc, 0.45);
}

function _drawHelmetHead(ctx, ac, acc, r, t) {
  // Visor glow pulse
  const vp = 0.55 + Math.sin(t * 2.8) * 0.18;

  // Main helm — angular plated shape
  ctx.beginPath();
  ctx.moveTo(-r * 0.9,  r * 0.32);
  ctx.lineTo(-r * 0.92, -r * 0.18);
  ctx.quadraticCurveTo(-r * 0.95, -r * 1.18, 0, -r * 1.22);
  ctx.quadraticCurveTo( r * 0.95, -r * 1.18, r * 0.92, -r * 0.18);
  ctx.lineTo( r * 0.9,  r * 0.32);
  ctx.lineTo( r * 0.72, r * 0.52);
  ctx.lineTo(-r * 0.72, r * 0.52);
  ctx.closePath();

  const hg = ctx.createLinearGradient(-r, -r * 1.2, r, r * 0.5);
  hg.addColorStop(0,   rca(...lt(ac, 0.28)));
  hg.addColorStop(0.5, rca(...ac));
  hg.addColorStop(1,   rca(...dk(ac, 0.32)));
  ctx.fillStyle = hg;
  ctx.fill();
  rimStroke(ctx, ac, 0.5);

  // Visor slot — two horizontal rectangles
  ctx.beginPath();
  ctx.rect(-r * 0.66, -r * 0.14, r * 1.32, r * 0.44);
  ctx.fillStyle = rca(...dk(ac, 0.5), 0.9);
  ctx.fill();

  // Visor glow
  ctx.beginPath();
  ctx.rect(-r * 0.64, -r * 0.12, r * 1.28, r * 0.4);
  ctx.fillStyle = rca(...acc, vp * 0.6);
  ctx.fill();
  ctx.strokeStyle = rca(...acc, vp);
  ctx.lineWidth   = 0.8;
  ctx.stroke();

  // Cheek vents — small horizontal slits
  for (const side of [-1, 1]) {
    for (let sv = 0; sv < 3; sv++) {
      ctx.beginPath();
      ctx.rect(side * r * 0.52, r * 0.12 + sv * r * 0.1, r * 0.32, r * 0.055);
      ctx.fillStyle = rca(...dk(ac, 0.4), 0.7);
      ctx.fill();
    }
  }

  // Crown ridge
  ctx.beginPath();
  ctx.moveTo(-r * 0.15, -r * 1.22);
  ctx.lineTo( r * 0.15, -r * 1.22);
  ctx.lineTo( r * 0.08, -r * 0.62);
  ctx.lineTo(-r * 0.08, -r * 0.62);
  ctx.closePath();
  ctx.fillStyle = rca(...lt(acc, 0.1), 0.85);
  ctx.fill();
}

function _drawSkullHead(ctx, sc, acc, r, t) {
  const pulse = Math.sin(t * 3.2) * 0.18;

  // Cranium — slightly elongated, geometric
  ctx.beginPath();
  ctx.moveTo(-r * 0.88, -r * 0.06);
  ctx.quadraticCurveTo(-r * 0.95, -r * 1.05, 0, -r * 1.18);
  ctx.quadraticCurveTo( r * 0.95, -r * 1.05, r * 0.88, -r * 0.06);
  ctx.lineTo( r * 0.72, r * 0.45);
  ctx.lineTo(-r * 0.72, r * 0.45);
  ctx.closePath();

  const cg = ctx.createLinearGradient(-r, -r * 1.1, r * 0.5, r * 0.4);
  cg.addColorStop(0,   rca(...lt(sc, 0.38)));
  cg.addColorStop(0.55, rca(...lt(sc, 0.12)));
  cg.addColorStop(1,   rca(...dk(sc, 0.2)));
  ctx.fillStyle = cg;
  ctx.fill();
  ctx.strokeStyle = rca(...dk(sc, 0.18), 0.5);
  ctx.lineWidth   = 0.8;
  ctx.stroke();

  // Cheekbones — flat shaded triangles
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(side * r * 0.4,  r * 0.18);
    ctx.lineTo(side * r * 0.78, r * 0.0);
    ctx.lineTo(side * r * 0.68, r * 0.42);
    ctx.closePath();
    ctx.fillStyle = rca(...dk(sc, 0.14), 0.6);
    ctx.fill();
  }

  // Eye sockets — deep dark voids
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(side * r * 0.32, -r * 0.52, r * 0.22, r * 0.27, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.9)";
    ctx.fill();

    // Glowing orb inside socket
    ctx.beginPath();
    ctx.ellipse(side * r * 0.32, -r * 0.5, r * 0.1, r * 0.12, 0, 0, Math.PI * 2);
    const eg = ctx.createRadialGradient(side * r * 0.28, -r * 0.54, 0, side * r * 0.32, -r * 0.5, r * 0.1);
    eg.addColorStop(0, rca(...lt(acc, 0.4), 0.9 + pulse));
    eg.addColorStop(1, rca(...acc, 0.4));
    ctx.fillStyle = eg;
    ctx.fill();
  }

  // Nasal cavity — inverted triangle void
  ctx.beginPath();
  ctx.moveTo(-r * 0.09, -r * 0.18);
  ctx.lineTo( r * 0.09, -r * 0.18);
  ctx.lineTo(0,          r * 0.02);
  ctx.closePath();
  ctx.fillStyle = "rgba(0,0,0,0.7)";
  ctx.fill();

  // Teeth — regular rectangular notches along jaw line
  const jawY  = r * 0.44;
  const teethW = r * 0.13;
  const teethH = r * 0.16;
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.rect(i * r * 0.2 - teethW / 2, jawY - teethH, teethW * 0.85, teethH);
    const tg = ctx.createLinearGradient(0, jawY - teethH, 0, jawY);
    tg.addColorStop(0, "rgba(240,235,220,0.95)");
    tg.addColorStop(1, "rgba(200,195,180,0.85)");
    ctx.fillStyle = tg;
    ctx.fill();
    ctx.strokeStyle = "rgba(160,155,140,0.6)";
    ctx.lineWidth   = 0.5;
    ctx.stroke();
  }
}

function _drawHornedHead(ctx, sc, acc, r, t) {
  // Base skull
  _drawRoundHead(ctx, sc, acc, r);

  // Horns — curved, not straight, with inner highlight groove
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.scale(side, 1);

    // Horn silhouette
    ctx.beginPath();
    ctx.moveTo(r * 0.38,  -r * 1.08);
    ctx.bezierCurveTo(r * 0.55, -r * 1.45, r * 0.72, -r * 1.6, r * 0.28, -r * 1.78);
    ctx.bezierCurveTo(r * 0.12, -r * 1.55, r * 0.12, -r * 1.25, r * 0.2,  -r * 1.08);
    ctx.closePath();

    const hornG = ctx.createLinearGradient(r * 0.2, -r * 1.78, r * 0.55, -r * 1.08);
    hornG.addColorStop(0,   rca(...lt(acc, 0.15)));
    hornG.addColorStop(0.5, rca(...acc));
    hornG.addColorStop(1,   rca(...dk(acc, 0.25)));
    ctx.fillStyle = hornG;
    ctx.fill();
    ctx.strokeStyle = rca(...dk(acc, 0.2), 0.55);
    ctx.lineWidth   = 0.7;
    ctx.stroke();

    // Highlight groove running up the inside edge
    ctx.beginPath();
    ctx.moveTo(r * 0.22, -r * 1.1);
    ctx.bezierCurveTo(r * 0.24, -r * 1.35, r * 0.28, -r * 1.55, r * 0.26, -r * 1.72);
    ctx.strokeStyle = rca(...lt(acc, 0.35), 0.5);
    ctx.lineWidth   = 0.5;
    ctx.stroke();

    ctx.restore();
  }
}

function _drawCrownHead(ctx, sc, ac, acc, r) {
  _drawRoundHead(ctx, sc, acc, r);

  // Crown band
  ctx.beginPath();
  ctx.moveTo(-r * 0.82, -r * 0.88);
  ctx.lineTo(-r * 0.82, -r * 0.62);
  ctx.lineTo( r * 0.82, -r * 0.62);
  ctx.lineTo( r * 0.82, -r * 0.88);
  ctx.closePath();
  const bandG = ctx.createLinearGradient(-r * 0.8, -r * 0.88, r * 0.8, -r * 0.62);
  bandG.addColorStop(0,   rca(...lt(ac, 0.25)));
  bandG.addColorStop(0.5, rca(...ac));
  bandG.addColorStop(1,   rca(...dk(ac, 0.2)));
  ctx.fillStyle = bandG;
  ctx.fill();
  rimStroke(ctx, ac, 0.5);

  // Crown tines — 3 central + 2 side, different heights
  const tines = [
    { x: 0,          h: r * 0.72, w: r * 0.12 },
    { x: -r * 0.38,  h: r * 0.48, w: r * 0.1  },
    { x:  r * 0.38,  h: r * 0.48, w: r * 0.1  },
    { x: -r * 0.7,   h: r * 0.3,  w: r * 0.09 },
    { x:  r * 0.7,   h: r * 0.3,  w: r * 0.09 },
  ];
  for (const tn of tines) {
    ctx.beginPath();
    ctx.moveTo(tn.x - tn.w,      -r * 0.88);
    ctx.lineTo(tn.x - tn.w * 0.5, -r * 0.88 - tn.h);
    ctx.lineTo(tn.x + tn.w * 0.5, -r * 0.88 - tn.h);
    ctx.lineTo(tn.x + tn.w,       -r * 0.88);
    ctx.closePath();
    ctx.fillStyle = rca(...lt(ac, 0.18));
    ctx.fill();
    // Gem atop each tine
    ctx.beginPath();
    ctx.arc(tn.x, -r * 0.88 - tn.h - r * 0.06, r * 0.065, 0, Math.PI * 2);
    ctx.fillStyle = rca(...lt(acc, 0.3));
    ctx.fill();
  }
}

function _drawHoodedHead(ctx, sc, ac, acc, r, t) {
  _drawRoundHead(ctx, sc, acc, r);
  const sway = Math.sin(t * 1.2) * 1.5;

  // Hood shadow under brim
  ctx.beginPath();
  ctx.moveTo(-r * 1.05, r * 0.38);
  ctx.bezierCurveTo(-r * 1.1, -r * 0.25, -r * 0.98, -r * 1.38, 0 + sway, -r * 1.52);
  ctx.bezierCurveTo( r * 0.98, -r * 1.38,  r * 1.1,  -r * 0.25, r * 1.05,  r * 0.38);
  ctx.lineTo( r * 0.8, r * 0.54);
  ctx.lineTo(-r * 0.8, r * 0.54);
  ctx.closePath();
  ctx.fillStyle = rca(...dk(ac, 0.1), 0.9);
  ctx.fill();

  // Hood outer surface
  ctx.beginPath();
  ctx.moveTo(-r * 1.02, r * 0.38);
  ctx.bezierCurveTo(-r * 1.08, -r * 0.22, -r * 0.96, -r * 1.35, 0 + sway, -r * 1.48);
  ctx.bezierCurveTo( r * 0.96, -r * 1.35,  r * 1.08,  -r * 0.22, r * 1.02, r * 0.38);
  const hoodG = ctx.createLinearGradient(-r, -r * 1.4, r, r * 0.4);
  hoodG.addColorStop(0,   rca(...lt(ac, 0.15)));
  hoodG.addColorStop(0.6, rca(...ac));
  hoodG.addColorStop(1,   rca(...dk(ac, 0.28)));
  ctx.fillStyle = hoodG;
  ctx.fill();
  rimStroke(ctx, ac, 0.35);

  // Shadow inside hood opening — face in shadow
  ctx.beginPath();
  ctx.ellipse(sway * 0.4, -r * 0.22, r * 0.58, r * 0.65, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,0.42)";
  ctx.fill();
}

function _drawCrystalHead(ctx, sc, acc, r, t) {
  const refPulse = Math.sin(t * 2.2) * 0.12;

  // Main crystal — sharp faceted hexagon
  ctx.beginPath();
  ctx.moveTo(0,        -r * 1.42);
  ctx.lineTo( r * 0.88, -r * 0.62);
  ctx.lineTo( r * 0.72,  r * 0.52);
  ctx.lineTo(0,          r * 0.72);
  ctx.lineTo(-r * 0.72,  r * 0.52);
  ctx.lineTo(-r * 0.88, -r * 0.62);
  ctx.closePath();

  const crG = ctx.createLinearGradient(-r * 0.8, -r * 1.4, r * 0.8, r * 0.7);
  crG.addColorStop(0.0, rca(...lt(sc, 0.42 + refPulse)));
  crG.addColorStop(0.3, rca(...lt(sc, 0.18)));
  crG.addColorStop(0.7, rca(...sc, 0.88));
  crG.addColorStop(1.0, rca(...dk(sc, 0.3)));
  ctx.fillStyle = crG;
  ctx.fill();
  ctx.strokeStyle = rca(...acc, 0.75);
  ctx.lineWidth   = 1;
  ctx.stroke();

  // Internal fracture lines — give it depth through the transparent surface
  const fractures = [
    [0, -r * 1.42, r * 0.88, -r * 0.62],
    [0, -r * 1.42, -r * 0.88, -r * 0.62],
    [0, -r * 1.42, 0, r * 0.72],
    [-r * 0.88, -r * 0.62, r * 0.72, r * 0.52],
  ];
  for (const [x1, y1, x2, y2] of fractures) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = rca(...lt(acc, 0.2), 0.28 + refPulse * 0.5);
    ctx.lineWidth   = 0.5;
    ctx.stroke();
  }

  // Facet highlight — upper-left face catches the light
  ctx.beginPath();
  ctx.moveTo(0,        -r * 1.42);
  ctx.lineTo(-r * 0.88, -r * 0.62);
  ctx.lineTo(0,          r * 0.72);
  ctx.closePath();
  ctx.fillStyle = rca(...lt(sc, 0.25), 0.22 + refPulse);
  ctx.fill();

  // Crystal eyes — sharp diamond shapes
  for (const side of [-1, 1]) {
    const ex = side * r * 0.3;
    const ey = -r * 0.18;
    ctx.beginPath();
    ctx.moveTo(ex,          ey - r * 0.16);
    ctx.lineTo(ex + r * 0.1, ey);
    ctx.lineTo(ex,          ey + r * 0.14);
    ctx.lineTo(ex - r * 0.1, ey);
    ctx.closePath();
    ctx.fillStyle = rca(...lt(acc, 0.25), 0.92 + refPulse);
    ctx.fill();
    ctx.strokeStyle = rca(...acc, 0.8);
    ctx.lineWidth   = 0.6;
    ctx.stroke();
  }
}

function _drawFlameHead(ctx, sc, acc, r, t) {
  // Base skull under the flame
  _drawRoundHead(ctx, sc, acc, r * 0.82);

  // 4 flame tongues — staggered phase offsets, each drifting on a different sin
  const tongues = [
    { phase: 0.0,  w: 0.52, h: 1.45, ox:  0.0  },
    { phase: 1.2,  w: 0.38, h: 1.22, ox: -0.3  },
    { phase: 2.4,  w: 0.38, h: 1.18, ox:  0.28 },
    { phase: 0.7,  w: 0.26, h: 0.95, ox: -0.12 },
  ];
  for (const tn of tongues) {
    const fi    = ((t * 1.4 + tn.phase) % (Math.PI * 2));
    const drift = Math.sin(fi) * r * 0.12;
    const alpha = 0.7 - Math.abs(Math.sin(fi)) * 0.25;

    ctx.beginPath();
    ctx.moveTo(drift + tn.ox * r - tn.w * r * 0.28,  -r * 0.55);
    ctx.bezierCurveTo(
      drift + tn.ox * r - tn.w * r * 0.38,  -r * (0.55 + tn.h * 0.5),
      drift + tn.ox * r + tn.w * r * 0.35,  -r * (0.55 + tn.h * 0.7),
      drift + tn.ox * r,                     -r * (0.55 + tn.h)
    );
    ctx.bezierCurveTo(
      drift + tn.ox * r - tn.w * r * 0.3,   -r * (0.55 + tn.h * 0.65),
      drift + tn.ox * r + tn.w * r * 0.38,  -r * (0.55 + tn.h * 0.42),
      drift + tn.ox * r + tn.w * r * 0.28,  -r * 0.55
    );
    ctx.closePath();

    const fg = ctx.createLinearGradient(0, -r * 0.55, drift, -r * (0.55 + tn.h));
    fg.addColorStop(0,   rca(...acc, alpha));
    fg.addColorStop(0.5, rca(...lt(acc, 0.3), alpha * 0.7));
    fg.addColorStop(1,   rca(...lt(acc, 0.55), 0));
    ctx.fillStyle = fg;
    ctx.fill();
  }
}

function _drawCloudHead(ctx, sc, acc, r, t) {
  const drift = Math.sin(t * 0.9) * 0.8;

  // Cloud puffs — overlapping circles, slightly different sizes
  const puffs = [
    { x: -r * 0.36, y: -r * 0.7,  r: r * 0.52 },
    { x:  r * 0.36, y: -r * 0.7,  r: r * 0.52 },
    { x:  0,        y: -r * 0.92, r: r * 0.56 },
    { x: -r * 0.64, y: -r * 0.34, r: r * 0.44 },
    { x:  r * 0.64, y: -r * 0.34, r: r * 0.44 },
  ];

  for (const p of puffs) {
    ctx.beginPath();
    ctx.arc(p.x + drift * 0.3, p.y, p.r, 0, Math.PI * 2);
    const pg = ctx.createRadialGradient(
      p.x + drift * 0.3 - p.r * 0.25, p.y - p.r * 0.25, 0,
      p.x + drift * 0.3, p.y, p.r
    );
    pg.addColorStop(0,   rca(...lt(sc, 0.32)));
    pg.addColorStop(0.7, rca(...lt(sc, 0.12)));
    pg.addColorStop(1,   rca(...sc, 0.82));
    ctx.fillStyle = pg;
    ctx.fill();
  }

  // Unify the bottom of the cloud with a filled oval base
  ctx.beginPath();
  ctx.ellipse(drift * 0.2, -r * 0.26, r * 0.78, r * 0.45, 0, 0, Math.PI * 2);
  ctx.fillStyle = rca(...sc, 0.9);
  ctx.fill();

  // Outlines — very subtle, only on outer edge
  ctx.strokeStyle = rca(...dk(sc, 0.14), 0.35);
  ctx.lineWidth   = 0.6;
  for (const p of puffs) {
    ctx.beginPath();
    ctx.arc(p.x + drift * 0.3, p.y, p.r, 0, Math.PI * 2);
    ctx.stroke();
  }
}

// ── Shared eye / forehead mark drawers ───────────────────────────────────

function _drawEyes(ctx, attackType, sc, acc, r) {
  const eyeY = -r * 0.35;
  const eyeX =  r * 0.32;
  const er   =  r * 0.14;

  // Eye colour keyed to attack type
  const atkEyeMap = {
    fire:      "#ff9900", ice:   "#00eeff", void:    "#dd88ff",
    poison:    "#44ff88", lightning: "#ffee00", nature: "#88ff44",
    magic:     "#8888ff", sound: "#ffcc44",
  };
  const eyeCol = atkEyeMap[attackType] || rca(...acc);

  for (const side of [-1, 1]) {
    const ex = side * eyeX;

    // Iris
    ctx.beginPath();
    ctx.ellipse(ex, eyeY, er, er * 1.2, 0, 0, Math.PI * 2);
    ctx.fillStyle = eyeCol;
    ctx.fill();

    // Pupil
    ctx.beginPath();
    ctx.ellipse(ex + er * 0.15, eyeY, er * 0.5, er * 0.65, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.88)";
    ctx.fill();

    // Specular highlight
    ctx.beginPath();
    ctx.ellipse(ex - er * 0.15, eyeY - er * 0.3, er * 0.18, er * 0.18, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.82)";
    ctx.fill();
  }
}

function _drawForehead(ctx, attackType, acc, r, t) {
  const markMap = {
    fire: "#ff6600", ice: "#00ccff", lightning: "#ffee00", void: "#cc44ff",
    poison: "#44ff44", nature: "#44ff00", magic: "#8888ff", sound: "#ffcc44",
  };
  const col = markMap[attackType];
  if (!col) return;

  const pulse = 0.55 + Math.sin(t * 3.2) * 0.28;
  const my = -r * 0.95;

  // Outer glow
  ctx.beginPath();
  ctx.arc(0, my, r * 0.11, 0, Math.PI * 2);
  ctx.fillStyle = col.replace(")", `,${0.3 * pulse})`).replace("rgb", "rgba");
  ctx.fill();

  // Core dot
  ctx.beginPath();
  ctx.arc(0, my, r * 0.065, 0, Math.PI * 2);
  ctx.fillStyle = col;
  ctx.globalAlpha = pulse;
  ctx.fill();
  ctx.globalAlpha = 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 7b — WINGS (front edge pass — drawn over torso)
// ─────────────────────────────────────────────────────────────────────────────

function drawWingsFront(ctx, acc, sc, torsoW, torsoH, S, t) {
  const flap = Math.sin(t * 3.5) * 14;
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.scale(side, 1);
    ctx.rotate((-22 + flap) * Math.PI / 180);

    // Leading edge highlight — thicker, brighter line
    ctx.beginPath();
    ctx.moveTo(torsoW * 0.28, -torsoH * 0.28);
    ctx.bezierCurveTo(torsoW * 0.72, -torsoH * 0.65, torsoW * 1.1, -torsoH * 0.3, torsoW * 0.58, torsoH * 0.22);
    ctx.strokeStyle = rca(...lt(acc.constructor === Array ? acc : hexRgb(acc), 0.22), 0.55);
    ctx.lineWidth   = 1.2;
    ctx.stroke();
    ctx.restore();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// WEAPONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * All weapon draw functions share the same ctx coordinate frame:
 *   origin = grip point (end of weapon hand)
 *   +y = toward hand, –y = toward tip
 * Each weapon uses the three-tone depth model on its base material.
 */
export function drawWeapon(ctx, type, wc, acc, S, t, isAttacking) {
  const sw   = S * 0.6;
  const glow = 0.65 + Math.sin(t * 3.2) * 0.2;

  switch (type) {
    case "sword":    _wSword(ctx, wc, acc, sw, glow); break;
    case "axe":      _wAxe(ctx, wc, acc, sw, glow);   break;
    case "staff":    _wStaff(ctx, wc, acc, sw, glow, t); break;
    case "bow":      _wBow(ctx, wc, acc, sw, glow);   break;
    case "claws":    _wClaws(ctx, wc, acc, sw, glow, t); break;
    case "whip":     _wWhip(ctx, wc, acc, sw, t);     break;
    case "orb":      _wOrb(ctx, wc, acc, sw, glow, t); break;
    case "spear":    _wSpear(ctx, wc, acc, sw, glow); break;
    case "scythe":   _wScythe(ctx, wc, acc, sw, glow); break;
    case "mace":     _wMace(ctx, wc, acc, sw, glow);  break;
    default: break;
  }
}

function _wSword(ctx, wc, acc, sw, glow) {
  ctx.save();
  ctx.rotate(-Math.PI / 4);

  // Blade — narrow trapezoid with beveled edges
  ctx.beginPath();
  ctx.moveTo(-sw * 0.07, 0);
  ctx.lineTo(-sw * 0.05, -sw * 0.68);
  ctx.lineTo(0,          -sw * 0.82);
  ctx.lineTo( sw * 0.05, -sw * 0.68);
  ctx.lineTo( sw * 0.07, 0);
  ctx.closePath();
  const bg = ctx.createLinearGradient(-sw * 0.07, 0, sw * 0.07, -sw * 0.82);
  bg.addColorStop(0,   rca(...lt(wc, 0.28)));
  bg.addColorStop(0.4, rca(...wc));
  bg.addColorStop(1,   rca(...dk(wc, 0.22)));
  ctx.fillStyle = bg;
  ctx.fill();

  // Blade center fuller (groove)
  ctx.beginPath();
  ctx.moveTo(0, -sw * 0.08);
  ctx.lineTo(0, -sw * 0.74);
  ctx.strokeStyle = rca(...dk(wc, 0.3), 0.55);
  ctx.lineWidth   = sw * 0.018;
  ctx.stroke();

  // Edge highlight
  ctx.beginPath();
  ctx.moveTo(-sw * 0.035, -sw * 0.04);
  ctx.lineTo(-sw * 0.028, -sw * 0.72);
  ctx.strokeStyle = rca(...lt(wc, 0.38), 0.5);
  ctx.lineWidth   = sw * 0.012;
  ctx.stroke();

  // Crossguard
  ctx.beginPath();
  ctx.rect(-sw * 0.2, -sw * 0.06, sw * 0.4, sw * 0.1);
  const gg = shapeGrad(ctx, 0, -sw * 0.01, sw * 0.4, sw * 0.1, hexRgb ? acc : acc, 0.22, 0.2);
  ctx.fillStyle = gg;
  ctx.fill();
  rimStroke(ctx, acc, 0.7);

  // Glow edge on blade
  ctx.beginPath();
  ctx.moveTo(0, -sw * 0.05);
  ctx.lineTo(0, -sw * 0.8);
  ctx.strokeStyle = rca(...acc, glow * 0.4);
  ctx.lineWidth   = 0.8;
  ctx.stroke();

  ctx.restore();
}

function _wAxe(ctx, wc, acc, sw, glow) {
  ctx.save();
  ctx.rotate(-Math.PI / 6);

  // Haft
  ctx.beginPath();
  ctx.rect(-sw * 0.055, -sw * 0.6, sw * 0.11, sw * 0.58);
  ctx.fillStyle = rca(...dk(wc, 0.15));
  ctx.fill();
  ctx.strokeStyle = rca(...lt(wc, 0.1), 0.4);
  ctx.lineWidth   = 0.7;
  ctx.stroke();

  // Blade — swept crescent
  ctx.beginPath();
  ctx.moveTo( sw * 0.055, -sw * 0.55);
  ctx.bezierCurveTo(sw * 0.5, -sw * 0.72, sw * 0.52, -sw * 0.14, sw * 0.055, -sw * 0.08);
  ctx.closePath();
  const ag = ctx.createLinearGradient(sw * 0.05, -sw * 0.72, sw * 0.52, -sw * 0.08);
  ag.addColorStop(0,   rca(...lt(wc, 0.32)));
  ag.addColorStop(0.5, rca(...wc));
  ag.addColorStop(1,   rca(...dk(wc, 0.28)));
  ctx.fillStyle = ag;
  ctx.fill();
  ctx.strokeStyle = rca(...acc, glow * 0.55);
  ctx.lineWidth   = 0.8;
  ctx.stroke();

  // Cutting edge highlight
  ctx.beginPath();
  ctx.moveTo(sw * 0.48, -sw * 0.68);
  ctx.bezierCurveTo(sw * 0.54, -sw * 0.4, sw * 0.52, -sw * 0.18, sw * 0.42, -sw * 0.1);
  ctx.strokeStyle = rca(...lt(wc, 0.42), 0.6);
  ctx.lineWidth   = sw * 0.025;
  ctx.stroke();

  ctx.restore();
}

function _wStaff(ctx, wc, acc, sw, glow, t) {
  // Shaft
  ctx.beginPath();
  ctx.rect(-sw * 0.045, -sw * 0.95, sw * 0.09, sw * 0.95);
  const sg = ctx.createLinearGradient(-sw * 0.045, 0, sw * 0.045, 0);
  sg.addColorStop(0,   rca(...lt(wc, 0.22)));
  sg.addColorStop(0.5, rca(...wc));
  sg.addColorStop(1,   rca(...dk(wc, 0.2)));
  ctx.fillStyle = sg;
  ctx.fill();

  // Orb — pulsing sphere at tip
  const op = 0.7 + Math.sin(t * 2.8) * 0.18;
  ctx.beginPath();
  ctx.arc(0, -sw * 0.95, sw * 0.2, 0, Math.PI * 2);
  const orbG = ctx.createRadialGradient(-sw * 0.06, -sw * 1.02, 0, 0, -sw * 0.95, sw * 0.2);
  orbG.addColorStop(0,   rca(...lt(acc, 0.4), op));
  orbG.addColorStop(0.6, rca(...acc, op * 0.8));
  orbG.addColorStop(1,   rca(...dk(acc, 0.15), op * 0.6));
  ctx.fillStyle = orbG;
  ctx.fill();
  ctx.strokeStyle = rca(...acc, glow);
  ctx.lineWidth   = 0.9;
  ctx.stroke();

  // Outer glow halo
  ctx.beginPath();
  ctx.arc(0, -sw * 0.95, sw * 0.3, 0, Math.PI * 2);
  ctx.fillStyle = rca(...acc, 0.18 * op);
  ctx.fill();
}

function _wBow(ctx, wc, acc, sw, glow) {
  ctx.save();
  ctx.rotate(-Math.PI / 8);

  // Limbs — two arcs from center
  for (const tipY of [-sw * 0.72, sw * 0.02]) {
    ctx.beginPath();
    ctx.arc(-sw * 0.06, tipY === -sw * 0.72 ? -sw * 0.34 : -sw * 0.02, sw * 0.42,
      tipY === -sw * 0.72 ? Math.PI * 0.62 : Math.PI * 1.3,
      tipY === -sw * 0.72 ? Math.PI * 1.38 : Math.PI * 1.96);
    ctx.strokeStyle = rca(...wc);
    ctx.lineWidth   = sw * 0.072;
    ctx.lineCap     = "round";
    ctx.stroke();
    ctx.strokeStyle = rca(...lt(wc, 0.25), 0.4);
    ctx.lineWidth   = sw * 0.025;
    ctx.stroke();
  }

  // String
  ctx.beginPath();
  ctx.moveTo(-sw * 0.3, -sw * 0.7);
  ctx.lineTo(-sw * 0.3,  sw * 0.0);
  ctx.strokeStyle = rca(...acc, glow * 0.75);
  ctx.lineWidth   = 0.8;
  ctx.stroke();

  ctx.restore();
}

function _wClaws(ctx, wc, acc, sw, glow, t) {
  const flex = Math.sin(t * 4.5) * 4;
  for (const i of [-1, 0, 1]) {
    ctx.save();
    ctx.rotate((i * 22 + flex) * Math.PI / 180);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(sw * 0.06, -sw * 0.18, sw * 0.14, -sw * 0.38, sw * 0.02, -sw * 0.55);
    ctx.strokeStyle = rca(...acc, glow);
    ctx.lineWidth   = sw * 0.095;
    ctx.lineCap     = "round";
    ctx.stroke();
    // Inner claw highlight
    ctx.beginPath();
    ctx.moveTo(sw * 0.01, -sw * 0.04);
    ctx.bezierCurveTo(sw * 0.04, -sw * 0.2, sw * 0.1, -sw * 0.36, sw * 0.0, -sw * 0.52);
    ctx.strokeStyle = rca(...lt(acc, 0.35), 0.45);
    ctx.lineWidth   = sw * 0.03;
    ctx.stroke();
    ctx.restore();
  }
}

function _wWhip(ctx, wc, acc, sw, t) {
  const phase = (t * 1.6) % (Math.PI * 2);
  const curl  = Math.sin(phase) * sw * 0.22;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(sw * 0.28, -sw * 0.28 + curl, sw * 0.14, -sw * 0.58, sw * 0.42, -sw * 0.78);
  ctx.strokeStyle = rca(...wc, 0.9);
  ctx.lineWidth   = sw * 0.06;
  ctx.lineCap     = "round";
  ctx.stroke();
  ctx.strokeStyle = rca(...lt(wc, 0.3), 0.4);
  ctx.lineWidth   = sw * 0.02;
  ctx.stroke();

  // Tip cracker
  ctx.beginPath();
  ctx.arc(sw * 0.42, -sw * 0.78, sw * 0.045, 0, Math.PI * 2);
  ctx.fillStyle = rca(...acc, 0.85);
  ctx.fill();
}

function _wOrb(ctx, wc, acc, sw, glow, t) {
  const op = 0.8 + Math.sin(t * 2.5) * 0.12;

  // Outer corona
  ctx.beginPath();
  ctx.arc(0, -sw * 0.45, sw * 0.36, 0, Math.PI * 2);
  ctx.fillStyle = rca(...acc, 0.16 * op);
  ctx.fill();

  // Core sphere
  ctx.beginPath();
  ctx.arc(0, -sw * 0.45, sw * 0.22, 0, Math.PI * 2);
  const cg = ctx.createRadialGradient(-sw * 0.07, -sw * 0.52, 0, 0, -sw * 0.45, sw * 0.22);
  cg.addColorStop(0,   rca(...lt(acc, 0.45), op));
  cg.addColorStop(0.6, rca(...acc, op * 0.85));
  cg.addColorStop(1,   rca(...dk(acc, 0.2), op * 0.7));
  ctx.fillStyle = cg;
  ctx.fill();
  ctx.strokeStyle = rca(...wc, 0.7);
  ctx.lineWidth   = 0.9;
  ctx.stroke();

  // 3 orbiting particles
  for (let i = 0; i < 3; i++) {
    const ang = t * 2.2 + i * 2.094;
    const ox  = Math.cos(ang) * sw * 0.33;
    const oy  = -sw * 0.45 + Math.sin(ang) * sw * 0.14;
    ctx.beginPath();
    ctx.arc(ox, oy, sw * 0.052, 0, Math.PI * 2);
    ctx.fillStyle = rca(...wc, glow * 0.8);
    ctx.fill();
  }
}

function _wSpear(ctx, wc, acc, sw, glow) {
  // Shaft
  ctx.beginPath();
  ctx.rect(-sw * 0.038, -sw * 0.88, sw * 0.076, sw * 0.85);
  const sg = ctx.createLinearGradient(-sw * 0.038, 0, sw * 0.038, 0);
  sg.addColorStop(0,   rca(...lt(wc, 0.2)));
  sg.addColorStop(0.5, rca(...wc));
  sg.addColorStop(1,   rca(...dk(wc, 0.22)));
  ctx.fillStyle = sg;
  ctx.fill();

  // Head — elongated diamond
  ctx.beginPath();
  ctx.moveTo(-sw * 0.1, -sw * 0.88);
  ctx.lineTo(0,          -sw * 1.08);
  ctx.lineTo( sw * 0.1, -sw * 0.88);
  ctx.lineTo(0,          -sw * 0.72);
  ctx.closePath();
  const hg = ctx.createLinearGradient(-sw * 0.1, -sw * 1.08, sw * 0.1, -sw * 0.72);
  hg.addColorStop(0,   rca(...lt(acc, 0.28)));
  hg.addColorStop(0.5, rca(...acc));
  hg.addColorStop(1,   rca(...dk(acc, 0.2)));
  ctx.fillStyle = hg;
  ctx.fill();
  ctx.strokeStyle = rca(...acc, glow);
  ctx.lineWidth   = 0.8;
  ctx.stroke();
}

function _wScythe(ctx, wc, acc, sw, glow) {
  ctx.save();
  // Long haft — slightly angled
  ctx.rotate(Math.PI * 0.08);
  ctx.beginPath();
  ctx.rect(-sw * 0.04, -sw * 1.1, sw * 0.08, sw * 1.1);
  ctx.fillStyle = rca(...dk(wc, 0.1));
  ctx.fill();
  ctx.strokeStyle = rca(...lt(wc, 0.15), 0.35);
  ctx.lineWidth   = 0.7;
  ctx.stroke();

  // Blade — large curved crescent starting at top of haft
  ctx.beginPath();
  ctx.moveTo(0, -sw * 1.1);
  ctx.bezierCurveTo(sw * 0.8, -sw * 1.35, sw * 1.0, -sw * 0.6, sw * 0.35, -sw * 0.5);
  ctx.bezierCurveTo(sw * 0.7, -sw * 0.58, sw * 0.72, -sw * 1.18, 0, -sw * 1.1);
  ctx.closePath();
  const bg = ctx.createLinearGradient(0, -sw * 1.35, sw * 1.0, -sw * 0.5);
  bg.addColorStop(0,   rca(...lt(acc, 0.3)));
  bg.addColorStop(0.5, rca(...acc));
  bg.addColorStop(1,   rca(...dk(acc, 0.18)));
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.strokeStyle = rca(...acc, glow);
  ctx.lineWidth   = 0.9;
  ctx.stroke();

  // Inner edge highlight
  ctx.beginPath();
  ctx.moveTo(0, -sw * 1.1);
  ctx.bezierCurveTo(sw * 0.6, -sw * 1.28, sw * 0.88, -sw * 0.68, sw * 0.32, -sw * 0.52);
  ctx.strokeStyle = rca(...lt(acc, 0.42), 0.5);
  ctx.lineWidth   = sw * 0.022;
  ctx.stroke();

  ctx.restore();
}

function _wMace(ctx, wc, acc, sw, glow) {
  // Handle
  ctx.beginPath();
  ctx.rect(-sw * 0.05, -sw * 0.68, sw * 0.1, sw * 0.65);
  ctx.fillStyle = rca(...dk(wc, 0.12));
  ctx.fill();

  // Head — flanged sphere
  ctx.beginPath();
  ctx.arc(0, -sw * 0.7, sw * 0.22, 0, Math.PI * 2);
  const mg = ctx.createRadialGradient(-sw * 0.07, -sw * 0.76, 0, 0, -sw * 0.7, sw * 0.22);
  mg.addColorStop(0,   rca(...lt(wc, 0.32)));
  mg.addColorStop(0.6, rca(...wc));
  mg.addColorStop(1,   rca(...dk(wc, 0.28)));
  ctx.fillStyle = mg;
  ctx.fill();
  rimStroke(ctx, wc, 0.5);

  // Flanges — 6 radiating blades
  for (let i = 0; i < 6; i++) {
    const ang = i * (Math.PI / 3);
    ctx.save();
    ctx.translate(0, -sw * 0.7);
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(-sw * 0.05, 0);
    ctx.lineTo(0,          -sw * 0.3);
    ctx.lineTo( sw * 0.05, 0);
    ctx.closePath();
    ctx.fillStyle = rca(...lt(acc, 0.15), glow * 0.85);
    ctx.fill();
    ctx.restore();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PARTICLE SYSTEM
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a burst of hit particles at a world position.
 * Each particle is a plain object managed entirely in caller's state.
 *
 * @param {number}   x       World x of impact
 * @param {number}   y       World y of impact
 * @param {string}   hexCol  Impact color (e.g. accent or attack type color)
 * @returns {object[]}       Array of particle objects
 */
export function createHitParticles(x, y, hexCol) {
  const { hitParticleCount, hitParticleSpeed, hitParticleLifeMs } = RENDERER_CONFIG;
  const col = hexRgb(hexCol);
  const particles = [];

  for (let i = 0; i < hitParticleCount; i++) {
    const angle = (i / hitParticleCount) * Math.PI * 2 + Math.random() * 0.4;
    const speed = hitParticleSpeed * (0.6 + Math.random() * 0.8);
    particles.push({
      x, y,
      vx:     Math.cos(angle) * speed,
      vy:     Math.sin(angle) * speed - hitParticleSpeed * 0.5,
      life:   hitParticleLifeMs,
      maxLife:hitParticleLifeMs,
      col,
      r:      2 + Math.random() * 2.5,
    });
  }
  return particles;
}

/**
 * Updates and draws all live particles. Mutates the array in place.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object[]} particles  Particle array (modified in place)
 * @param {number}   dtMs       Delta time in milliseconds
 */
export function drawParticles(ctx, particles, dtMs) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dtMs;
    if (p.life <= 0) { particles.splice(i, 1); continue; }

    const alpha = (p.life / p.maxLife) * 0.85;
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.12; // gravity

    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * (p.life / p.maxLife), 0, Math.PI * 2);

    const pg = ctx.createRadialGradient(p.x - p.r * 0.2, p.y - p.r * 0.2, 0, p.x, p.y, p.r);
    pg.addColorStop(0, rca(...lt(p.col, 0.4), alpha));
    pg.addColorStop(1, rca(...p.col, alpha * 0.4));
    ctx.fillStyle = pg;
    ctx.fill();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DEAD STATE OVERLAY
// ─────────────────────────────────────────────────────────────────────────────

function applyDeadTransform(ctx) {
  ctx.rotate(Math.PI / 2);
  ctx.globalAlpha = 0.32;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ORCHESTRATOR  — public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Draws a complete humanoid character at world position (x, y).
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object}  data     – CharacterEntity from generator.js
 * @param {number}  x        – World x (canvas pixels)
 * @param {number}  y        – World y (feet baseline, canvas pixels)
 * @param {number}  scale    – Base scale factor (e.g. 1.0)
 * @param {number}  t        – Elapsed time in seconds (continuous, for animation)
 * @param {number}  facing   – +1 = faces right, -1 = faces left (mirrored)
 * @param {object}  state    – { isAttacking, isDead, isMoving }
 */
export function drawHumanoid(ctx, data, x, y, scale, t, facing, state = {}) {
  const {
    isAttacking = false,
    isDead      = false,
    isMoving    = false,
  } = state;

  // Resolve colours once
  const sc   = hexRgb(data.skinColor   || "#aa7744");
  const ac   = hexRgb(data.armorColor  || "#554433");
  const acc  = hexRgb(data.accentColor || "#ffffff");
  const wc   = hexRgb(data.weaponColor || "#ccaa44");
  const aurc = hexRgb(data.auraColor   || "#4488ff");

  // Build dimensions from build type
  const build = data.bodyBuild || "normal";
  const bwMul = { heavy: 1.5, slim: 0.85, giant: 1.6, tiny: 0.65, hunched: 1.1, normal: 1.0 }[build] ?? 1.0;
  const bhMul = { heavy: 1.1, giant: 1.4, tiny: 0.7, normal: 1.0, hunched: 1.0, slim: 1.0, }[build] ?? 1.0;
  const hsMul = { giant: 1.3, tiny: 0.75, normal: 1.0, heavy: 1.0, slim: 1.0, hunched: 0.95, }[build] ?? 1.0;

  const S   = scale;
  const bw  = S * bwMul  * 28;
  const bh  = S * bhMul  * 54;
  const hs  = S * hsMul  * 54;

  // Idle breath — applied as a Y offset shared by all body layers
  const hunch  = build === "hunched" ? 8 * S : 0;
  const bobY   = isMoving
    ? Math.abs(Math.sin(t * 6.0)) * 3
    : Math.sin(t * 1.8) * 1.5;

  // Torso anchor — the coordinate everything hangs from
  const torsoW  = bw * 0.52;
  const torsoH  = bh * 0.42;
  const torsoOY = -bh * 0.28 + hunch * 0.5 + bobY;   // relative to y (feet)
  const headOY  = torsoOY - bh * 0.5;                  // relative to y (feet)

  ctx.save();
  ctx.translate(x, y);
  if (facing < 0) ctx.scale(-1, 1);
  if (isDead) applyDeadTransform(ctx);

  // ── Layer 0: Ground shadow ─────────────────────────────────────────────
  drawShadow(ctx, bw, S, isDead);

  // ── Layer 1: Aura ──────────────────────────────────────────────────────
  ctx.save();
  ctx.translate(0, torsoOY);
  drawAura(ctx, aurc, S, t, isDead);
  ctx.restore();

  // ── Layer 2: Tail (behind torso) ───────────────────────────────────────
  if (data.physicalTraits?.hasTail) {
    ctx.save();
    ctx.translate(0, torsoOY);
    drawTail(ctx, sc, acc, bw, bh, S, t);
    ctx.restore();
  }

  // ── Layer 3: Wings — back membrane ────────────────────────────────────
  if (data.physicalTraits?.hasWings) {
    ctx.save();
    ctx.translate(0, torsoOY);
    drawWingsBack(ctx, acc, sc, torsoW, torsoH, S, t);
    ctx.restore();
  }

  // ── Layer 4: Legs ──────────────────────────────────────────────────────
  ctx.save();
  ctx.translate(0, bobY + hunch);
  drawLegs(ctx, sc, ac, data.physicalTraits?.hasArmor, bw, bh, S, t, isMoving, build);
  ctx.restore();

  // ── Layer 5: Torso (+ integrated breast sub-layer) ────────────────────
  ctx.save();
  ctx.translate(0, torsoOY);
  drawTorso(ctx, data, sc, ac, acc, bw, bh, t, isAttacking, isMoving);
  ctx.restore();

  // ── Layer 6: Arms + Weapon ─────────────────────────────────────────────
  ctx.save();
  ctx.translate(0, torsoOY);
  drawArms(ctx, data, sc, ac, wc, acc, bw, bh, S, t, isAttacking, isMoving);
  ctx.restore();

  // ── Layer 7: Head ──────────────────────────────────────────────────────
  ctx.save();
  ctx.translate(0, headOY);
  drawHead(ctx, data, sc, ac, acc, hs, t);
  ctx.restore();

  // ── Layer 8: Wings — front edge highlight ─────────────────────────────
  if (data.physicalTraits?.hasWings) {
    ctx.save();
    ctx.translate(0, torsoOY);
    // Re-resolve acc as array (already is) for drawWingsFront
    drawWingsFront(ctx, acc, sc, torsoW, torsoH, S, t);
    ctx.restore();
  }

  ctx.restore();
}
