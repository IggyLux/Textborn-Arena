/* ============================================================================
   TEXTBORN ARENA — CORE ENGINE
   ============================================================================ */

// 1. STATE MANAGEMENT
const state = {
    player: null,
    enemy: null,
    isBattleActive: false,
    wave: 1,
    uiScale: 1,
    roster: JSON.parse(localStorage.getItem('textborn_roster')) || []
};

// 2. DOM REFERENCES
const views = {
    forge: document.getElementById('view-forge'),
    arena: document.getElementById('view-arena')
};

const canvas = {
    arena: document.getElementById('arena-canvas'),
    preview: document.getElementById('preview-canvas')
};

/**
 * VIEW NAVIGATION
 * Swaps between the Forge and the Arena
 */
function setView(viewName) {
    views.forge.classList.remove('view-active');
    views.arena.classList.remove('view-active');

    if (viewName === 'arena') {
        views.arena.classList.add('view-active');
        // We must resize immediately because the canvas was hidden
        setTimeout(resizeArena, 50); 
    } else {
        views.forge.classList.add('view-active');
    }
}

/**
 * FORGE LOGIC
 * Turns text into a Champion object
 */
function forgeChampion() {
    const nameInput = document.getElementById('champ-name');
    const styleInput = document.getElementById('champ-style');
    const name = nameInput.value.trim() || "Unknown Unit";

    // Simulate "Generation" logic
    state.player = {
        name: name,
        style: styleInput.value || "Standard",
        hp: 100,
        maxHp: 100,
        stats: {
            atk: Math.floor(Math.random() * 10) + 10,
            spd: Math.floor(Math.random() * 10) + 5
        },
        color: '#22c55e'
    };

    // Show the Preview Area
    document.getElementById('forge-preview-display').classList.remove('hidden');
    updateForgeUI();
    renderPreview();
}

function updateForgeUI() {
    document.getElementById('preview-display-name').innerText = state.player.name;
    document.getElementById('stat-hp').style.width = '100%';
    document.getElementById('stat-atk').style.width = (state.player.stats.atk * 4) + '%';
    document.getElementById('stat-spd').style.width = (state.player.stats.spd * 4) + '%';
    
    // Log system message
    console.log(`System: ${state.player.name} forged successfully.`);
}

/**
 * ROSTER SYSTEM (LocalStorage)
 */
function saveToRoster() {
    if (!state.player) return;
    
    // Avoid exact duplicates
    const exists = state.roster.some(c => c.name === state.player.name);
    if (!exists) {
        state.roster.push({...state.player});
        localStorage.setItem('textborn_roster', JSON.stringify(state.roster));
        renderRoster();
    }
}

function renderRoster() {
    const grid = document.getElementById('roster-grid');
    if (!grid) return;
    grid.innerHTML = '';

    if (state.roster.length === 0) {
        grid.innerHTML = '<div class="roster-empty-msg">No champions in roster yet...</div>';
        return;
    }

    state.roster.forEach((char, index) => {
        const card = document.createElement('div');
        card.className = 'roster-card'; // Ensure this class is in your CSS
        card.style.border = '1px solid var(--clr-muted)';
        card.style.padding = '10px';
        card.style.cursor = 'pointer';
        card.innerHTML = `
            <div style="color: var(--clr-primary); font-size: 0.8rem;">${char.name}</div>
            <div style="font-size: 0.6rem; opacity: 0.5;">${char.style}</div>
        `;
        card.onclick = () => {
            state.player = char;
            document.getElementById('forge-preview-display').classList.remove('hidden');
            updateForgeUI();
            renderPreview();
        };
        grid.appendChild(card);
    });
}

/**
 * RENDER ENGINES
 */
function renderPreview() {
    const ctx = canvas.preview.getContext('2d');
    const w = canvas.preview.width;
    const h = canvas.preview.height;
    ctx.clearRect(0, 0, w, h);
    
    // Draw centered "i" placeholder for preview
    const s = h / 200; // local scale for preview box
    drawFighter(ctx, state.player, w/2, h/2 + (20*s), s);
}

function resizeArena() {
    const wrap = document.getElementById('canvas-wrap');
    if (!wrap || !canvas.arena) return;
    const rect = wrap.getBoundingClientRect();
    
    canvas.arena.width = rect.width;
    canvas.arena.height = rect.height;
    state.uiScale = rect.height / 600;
    
    renderArena();
}

function renderArena() {
    const ctx = canvas.arena.getContext('2d');
    ctx.clearRect(0, 0, canvas.arena.width, canvas.arena.height);

    if (!state.player) return;
    
    const centerX = canvas.arena.width / 2;
    const centerY = canvas.arena.height / 2;
    const s = state.uiScale;

    // Draw Player in Arena
    drawFighter(ctx, state.player, centerX - (180 * s), centerY, s);
}

function drawFighter(ctx, fighter, x, y, s) {
    const bodyW = 40 * s;
    const bodyH = 100 * s;
    const headR = 25 * s;

    // Head
    ctx.fillStyle = fighter.color || '#22c55e';
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
 * INITIALIZATION
 */
document.addEventListener('DOMContentLoaded', () => {
    // 1. Bind Forge Buttons
    document.getElementById('btn-forge-main').addEventListener('click', forgeChampion);
    document.getElementById('btn-save-roster').addEventListener('click', saveToRoster);
    document.getElementById('btn-enter-arena').addEventListener('click', () => {
        setView('arena');
    });
    
    // 2. Bind Arena Buttons
    document.getElementById('btn-back-to-forge').addEventListener('click', () => {
        setView('forge');
    });

    // 3. Setup
    renderRoster();
    window.addEventListener('resize', () => {
        if (views.arena.classList.contains('view-active')) resizeArena();
    });
});
