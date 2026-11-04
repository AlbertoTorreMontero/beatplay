// Dibujos de línea de cada juego para las tarjetas del menú: un solo color (currentColor), sin relleno.
const SVG = body => `<svg viewBox="0 0 120 120" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ART = {
    // Serpiente en zigzag a por una portada
    snake: SVG(`<path d="M14 92h28v-24h-24v-24h44v24h16v-36h22"/><circle cx="100" cy="32" r="2.5"/><rect x="86" y="80" width="20" height="20" rx="3"/><path d="M92 90h8M96 86v8"/>`),
    // Botón de play y la onda que se va abriendo
    intro: SVG(`<path d="M18 60h6M30 52v16M38 44v32M46 56v8M54 36v48M62 50v20"/><circle cx="90" cy="60" r="20"/><path d="M85 50l14 10-14 10z"/>`),
    // Línea del tiempo con canciones colocadas
    hipster: SVG(`<path d="M10 70h100"/><path d="M22 66v8M46 66v8M74 66v8M98 66v8"/><rect x="34" y="30" width="24" height="24" rx="3"/><rect x="62" y="38" width="24" height="24" rx="3" transform="rotate(8 74 50)"/><path d="M46 54v12"/><text x="14" y="94" fill="currentColor" stroke="none" font-size="10" font-family="monospace">1984</text><text x="88" y="94" fill="currentColor" stroke="none" font-size="10" font-family="monospace">2026</text>`),
    // Pulsador gigante
    buzzer: SVG(`<ellipse cx="60" cy="84" rx="38" ry="10"/><path d="M22 84v-8c0-6 17-10 38-10s38 4 38 10v8"/><path d="M34 70c0-16 12-30 26-30s26 14 26 30"/><path d="M60 16v10M38 22l6 8M82 22l-6 8"/>`),
    // Silla con notas cayendo
    chairs: SVG(`<path d="M40 36v62M80 36v62M40 36h40M40 60h40M40 74h40M44 74v24M76 74v24"/><path d="M96 22v18a5 5 0 1 1-4-5"/><path d="M96 22l10-3"/><path d="M18 30v14a4 4 0 1 1-3-4"/>`),
    // Tres caras: una canta otra cosa
    impostor: SVG(`<circle cx="28" cy="60" r="14"/><circle cx="60" cy="60" r="14"/><circle cx="92" cy="60" r="14" stroke-dasharray="4 4"/><path d="M22 64q6 5 12 0M54 64q6 5 12 0M86 66q6-4 12 0"/><path d="M28 34l4-8M60 34l4-8M92 30l-6-6"/><text x="86" y="100" fill="currentColor" stroke="none" font-size="18" font-family="serif">?</text>`),
    // Dos platos de DJ
    djbattle: SVG(`<rect x="10" y="36" width="100" height="50" rx="6"/><circle cx="36" cy="61" r="16"/><circle cx="36" cy="61" r="3"/><circle cx="84" cy="61" r="16"/><circle cx="84" cy="61" r="3"/><path d="M54 76h12M60 72v8"/><path d="M36 45l12-8M84 45l-12-8"/>`),
    // Disco con interrogación
    bluff: SVG(`<rect x="22" y="24" width="64" height="64" rx="4"/><circle cx="66" cy="56" r="30" stroke-dasharray="3 5"/><circle cx="54" cy="56" r="12"/><path d="M50 52a4 4 0 1 1 6 4v3"/><circle cx="56" cy="64" r="0.8"/>`),
    // Etiqueta de precio con nota
    bid: SVG(`<path d="M20 58l34-34h36v36l-34 34z"/><circle cx="78" cy="38" r="5"/><path d="M52 50v18a5 5 0 1 1-4-5"/><path d="M52 50l10-3"/>`),
    // Mazo de subasta
    auction: SVG(`<rect x="44" y="22" width="40" height="18" rx="4" transform="rotate(-30 64 31)"/><path d="M58 44l-30 40"/><path d="M20 98h44"/><path d="M28 90h28"/><path d="M84 66l8-6M88 78h10M80 84l6 8"/>`),
    // Micrófono
    karaoke: SVG(`<rect x="46" y="16" width="28" height="46" rx="14"/><path d="M36 50a24 24 0 0 0 48 0"/><path d="M60 74v20M44 96h32"/><path d="M90 28q8 8 0 16M98 22q14 14 0 28"/>`),
    // Lienzo y pincel
    draw: SVG(`<rect x="14" y="22" width="62" height="62" rx="3"/><path d="M24 70q10-24 20-8t22-14"/><circle cx="58" cy="38" r="6"/><path d="M104 18l-34 58"/><path d="M70 76l-6 12 10-8"/>`),
    // Ruleta de portadas
    roulette: SVG(`<circle cx="60" cy="60" r="40"/><circle cx="60" cy="60" r="8"/><path d="M60 20v32M60 68v32M20 60h32M68 60h32M32 32l22 22M66 66l22 22M88 32L66 54M54 66L32 88"/><path d="M60 8l-6 10h12z"/>`),
    // Cartón de bingo
    bingo: SVG(`<rect x="14" y="30" width="92" height="60" rx="4"/><path d="M14 50h92M14 70h92M37 30v60M60 30v60M83 30v60"/><circle cx="25.5" cy="40" r="6"/><circle cx="71.5" cy="60" r="6"/><circle cx="48.5" cy="80" r="6"/><path d="M90 76l8 8M98 76l-8 8"/>`)
};

// Pone el dibujo en cada tarjeta que tenga un hueco [data-art].
export function paintArt(root = document) {
    for (const card of root.querySelectorAll(".game-card[data-game]")) {
        const slot = card.querySelector("[data-art]");
        if (slot && ART[card.dataset.game]) slot.innerHTML = ART[card.dataset.game];
    }
}
