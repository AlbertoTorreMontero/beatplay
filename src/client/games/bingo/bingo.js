/*
 * BINGO MUSICAL
 * Cartones: 3 filas × 9 columnas, 5 canciones por fila, sacadas de la playlist entera.
 * Cantar: suena la playlist en orden aleatorio y se apunta lo que ya ha salido.
 */
import { refs, h, toast, shuffle } from "../../lib/ui.js";
import { tracks as loadTracks } from "../../lib/api.js";
import { player } from "../../lib/player/index.js";
import { playlistPicker } from "../../lib/playlists.js";

const PER_CARD = 15;
const ROWS = 3;
const COLS = 9;

let ui = {};
let root = null;
let playlistName = "";
let catalog = [];
let queue = [];
let called = [];


async function mount(container) {
    root = container;
    ui = refs(root);

    root.addEventListener("click", onClick);
    ui.form.addEventListener("submit", event => {
        event.preventDefault();
        generate();
    });
    ui.hide.addEventListener("change", renderCaller);

    // La playlist se elige dentro del juego, como en los demás juegos de grupo.
    playlistPicker(ui.playlists, { onSelect: choose });
}

async function choose(playlist) {
    ui.pickStatus.textContent = "Leyendo la playlist entera…";
    try {
        // Con una muestra todos los cartones saldrían casi iguales: hace falta la playlist entera.
        const tracks = await loadTracks.all(playlist.id);
        if (tracks.length < PER_CARD) {
            ui.pickStatus.textContent = `El bingo necesita al menos ${PER_CARD} canciones. Esta tiene ${tracks.length}: elige otra.`;
            return;
        }
        if (!root) return;

        catalog = tracks;
        playlistName = playlist.name;

        // El orden de "Cantar" se decide ya y se carga en el reproductor: cada canción nueva sale sin llamadas.
        queue = shuffle([...catalog]);
        called = [];
        player.load(queue);

        ui.playlist.textContent = `${playlist.name} · ${catalog.length} canciones`;
        ui.name.value = playlist.name;
        ui.pickTab.classList.add("hidden");
        ui.tabs.classList.remove("hidden");
        showTab("cards");
    } catch (error) {
        ui.pickStatus.textContent = error.message;
    }
}

function unmount() {
    root = null;
}


// =====================================================
// CARTONES
// =====================================================

function generate() {
    const count = Math.min(60, Math.max(1, parseInt(ui.count.value, 10) || 1));
    const title = ui.name.value.trim() || playlistName || "Bingo musical";

    ui.count.value = count;
    ui.cards.replaceChildren(...Array.from({ length: count }, (_, i) => bingoCard(i + 1, title)));
    ui.print.disabled = false;
    ui.cards.firstElementChild.scrollIntoView({ behavior: "smooth", block: "start" });
}

// En cada fila se rellenan 5 de las 9 casillas, al azar.
function bingoCard(number, title) {
    const picks = shuffle([...catalog]).slice(0, PER_CARD);
    // Sin carga diferida: al imprimir, las portadas de los cartones de abajo no se habrían cargado.
    const cover = track => {
        if (!track.cover) return h("div", { class: "bingo-nocover", "aria-hidden": "true" }, "♪");
        const img = h("img", { src: track.thumb || track.cover, alt: "", decoding: "async" });
        img.addEventListener("error", () => {
            if (img.src !== track.cover) img.src = track.cover; // reintento con la grande
            else img.replaceWith(h("div", { class: "bingo-nocover", "aria-hidden": "true" }, "♪"));
        }, { once: false });
        return img;
    };
    const cells = [];

    for (let row = 0; row < ROWS; row++) {
        const filled = new Set(shuffle([...Array(COLS).keys()]).slice(0, PER_CARD / ROWS));

        for (let col = 0; col < COLS; col++) {
            const track = filled.has(col) ? picks.pop() : null;
            cells.push(track
                ? h("div", { class: "bingo-cell" },
                    cover(track),
                    h("span", {}, track.name))
                : h("div", { class: "bingo-cell empty", "aria-hidden": "true" }));
        }
    }

    const id = String(number).padStart(2, "0");

    return h("article", { class: "bingo-card", "aria-label": `Cartón ${id}` },
        h("header", { class: "bingo-card-head" },
            h("strong", {}, title),
            h("span", { class: "display" }, id)),
        h("div", { class: "bingo-grid" }, cells));
}


// =====================================================
// CANTAR
// =====================================================

async function callNext() {
    if (called.length >= queue.length) {
        toast("Ya han sonado todas las canciones de la playlist.");
        return;
    }

    const index = called.length;
    const track = queue[index];
    called.unshift(track);
    renderCaller();

    try {
        await player.playAt(index);
    } catch (error) {
        toast(error.message, { error: true });
    }
}

function renderCaller() {
    const [now, ...previous] = called;
    if (!now) return;

    const hide = ui.hide.checked;

    ui.callerCount.textContent = `Canción ${called.length} de ${catalog.length}`;
    ui.callerName.textContent = hide ? "¿Cuál es?" : now.name;
    ui.callerArtist.textContent = hide ? "Escucha y busca en tu cartón" : now.artist;
    ui.callerCover.hidden = hide || !now.cover;
    if (now.cover) ui.callerCover.src = now.cover;

    // La anterior ya se puede desvelar: el historial muestra todo menos la que suena.
    const shown = hide ? previous : called;
    ui.history.replaceChildren(...shown.map(track =>
        h("li", {}, h("img", { src: track.cover || "", alt: "" }), h("span", {}, h("strong", {}, track.name), h("small", {}, track.artist)))
    ));
}

function showTab(name) {
    for (const tab of root.querySelectorAll("[data-tab]")) {
        const active = tab.dataset.tab === name;
        tab.setAttribute("aria-pressed", String(active));
        tab.setAttribute("aria-selected", String(active));
    }
    ui.cardsTab.classList.toggle("hidden", name !== "cards");
    ui.callerTab.classList.toggle("hidden", name !== "caller");
    if (name === "cards") player.pause();
}

function onClick(event) {
    const target = event.target.closest("[data-tab], [data-action]");
    if (!target) return;

    if (target.dataset.tab) showTab(target.dataset.tab);
    else if (target.dataset.action === "print") printWhenReady();
    else if (target.dataset.action === "next") callNext();
}


// Imprime cuando todas las portadas han cargado (como mucho 6 s de espera).
async function printWhenReady() {
    ui.print.disabled = true;
    const images = [...document.querySelectorAll(".bingo-cell img")];
    await Promise.race([
        Promise.all(images.map(img => img.complete ? null : new Promise(done => {
            img.addEventListener("load", done, { once: true });
            img.addEventListener("error", done, { once: true });
        }))),
        new Promise(done => setTimeout(done, 6000))
    ]);
    ui.print.disabled = false;
    window.print();
}

export default {
    template: "/games/bingo/bingo.html",
    cta: "Preparar bingo",
    needsPlaylist: false,
    setupTitle: () => "Bingo en grupo",
    note: () => "Imprime cartones con las canciones de una playlist y canta el bingo con la música sonando. La playlist se elige dentro.",
    mount,
    unmount
};
