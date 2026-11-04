/*
 * Base de los juegos de fiesta (cliente).
 *
 * Todo lo común vive aquí: entrar o crear sala, elegir playlist (solo el anfitrión), la música
 * (solo suena en el dispositivo del anfitrión), el temporizador, la clasificación y la reconexión.
 * Cada juego solo define sus pantallas: una función por fase que pinta lo que manda el servidor.
 *
 * Llamadas a la API: el anfitrión lee UNA página de su playlist y la carga en el reproductor.
 * Después solo hay órdenes de reproducción (una por canción). Los invitados no hacen ninguna.
 *
 *   export default definePartyGame({
 *       id, title, tagline, rules: ["…"], dated,
 *       screens: { fase: (view, kit) => nodo },   // nodo.update?.(view) para cambios dentro de la fase
 *       final: (view, kit) => nodo,                 // opcional, encima de la clasificación final
 *       options: (roomState, kit) => nodo,          // opcional, opciones en la sala de espera
 *       onMessage: (mensaje, kit) => {}             // opcional, mensajes propios del juego
 *   })
 */
import { refs, h, toast, pulse, $$ } from "./ui.js";
import { getMe, tracks as loadTracks } from "./api.js";
import { playlistPicker } from "./playlists.js";
import { createRoomClient } from "./room.js";
import { songSearch } from "./song-search.js";
import { player } from "./player/index.js";

const POOL_KEY = "beatplayPartyPool";
const MAX_POOL = 200;

export function definePartyGame(def) {

    let root = null;
    let ui = {};
    let client = null;
    let guest = false;
    let state = null;        // último room_state
    let catalog = [];        // canciones de la partida por posición: { name, artist, cover }
    let pool = [];           // (anfitrión) canciones completas, en el orden cargado en el reproductor
    let picker = null;
    let current = null;      // { key, node } pantalla pintada ahora
    let lastView = null;
    let tick = null;
    let clipTimer = null;
    let wakeLock = null;

    const me = () => client?.room.playerId;
    const isHost = () => state?.hostId === me();
    const show = view => {
        $$("[data-view]", root).forEach(section => section.classList.toggle("hidden", section.dataset.view !== view));
        // En partida, todo debe caber en la pantalla: nada de scroll en el móvil.
        root.firstElementChild.classList.toggle("fit", view === "stage");
    };


    // =====================================================
    // KIT PARA LAS PANTALLAS DE CADA JUEGO
    // =====================================================

    const kit = {
        h,
        pulse,
        toast,
        send: (action, data = {}) => client.send("act", { action, ...data }),
        get me() { return me(); },
        isHost,
        players: () => state?.players || [],
        name: id => state?.players.find(other => other.id === id)?.name || "Alguien",
        song: index => catalog[index] || { name: "—", artist: "", cover: null },

        // Vibración corta en el móvil (si lo permite).
        buzz: (pattern = 40) => navigator.vibrate?.(pattern),

        // Tarjeta de canción: portada, título y artista.
        songCard(index, { size = "md", label = null } = {}) {
            const song = kit.song(index);
            return h("figure", { class: `pt-song pt-song-${size}` },
                song.cover ? h("img", { src: song.cover, alt: "", loading: "lazy" }) : h("div", { class: "pt-song-blank", "aria-hidden": "true" }, "♪"),
                h("figcaption", {},
                    label && h("span", { class: "pt-song-label" }, label),
                    h("strong", {}, song.name),
                    h("span", {}, song.artist)));
        },

        // Rejilla de botones grandes, cómodos con el pulgar. onPick(value, button).
        choices(items, onPick, { columns = 1, className = "" } = {}) {
            const grid = h("div", { class: `pt-choices cols-${columns} ${className}` });
            items.forEach((item, i) => grid.append(h("button", {
                type: "button",
                class: `pt-choice ${item.className || ""}`,
                disabled: Boolean(item.disabled),
                style: `animation-delay: ${i * 40}ms`,
                onclick: event => {
                    if (grid.dataset.locked) return;
                    onPick(item.value, event.currentTarget);
                }
            },
            item.cover !== undefined && (item.cover ? h("img", { src: item.cover, alt: "" }) : h("span", { class: "pt-choice-blank" }, "♪")),
            h("span", { class: "pt-choice-text" }, h("strong", {}, item.label), item.sub && h("small", {}, item.sub)))));
            grid.lock = chosen => {
                grid.dataset.locked = "1";
                [...grid.children].forEach(button => {
                    button.disabled = true;
                    if (button === chosen) button.classList.add("chosen");
                });
            };
            return grid;
        },

        // Opciones de canción (título o artista) a partir de posiciones del catálogo.
        songChoices(options, kind, onPick, settings) {
            return kit.choices(options.map(index => ({
                value: index,
                label: kind === "artist" ? kit.song(index).artist : kit.song(index).name,
                sub: kind === "artist" ? null : kit.song(index).artist
            })), onPick, settings);
        },

        // Buscador de canciones sobre el catálogo de la partida.
        search(onPick, placeholder) {
            const box = h("div", { class: "song-search" });
            const search = songSearch(box, { onPick, placeholder });
            search.setChoices(catalog.map((song, index) => song && { ...song, id: index }).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name)));
            box.search = search;
            return box;
        },

        // Mensaje de espera ("Esperando a los demás") con progreso opcional.
        wait(text, ready = null, total = null) {
            return h("div", { class: "pt-wait" },
                h("span", { class: "pt-wait-dots", "aria-hidden": "true" }, h("i"), h("i"), h("i")),
                h("p", {}, text),
                ready != null && h("small", { class: "muted" }, `${ready} de ${total} listos`));
        },

        // Frase grande en el centro de la pantalla.
        headline(text, sub = null, className = "") {
            return h("div", { class: `pt-headline ${className}` }, h("h2", { class: "display" }, text), sub && h("p", {}, sub));
        },

        scores(rows, { limit = 8, mark = row => (row.gained > 0 ? `+${row.gained}` : row.gained < 0 ? `−${-row.gained}` : "") } = {}) {
            return h("ol", { class: "rl-scores pt-scores" }, rows.slice(0, limit).map((row, i) =>
                h("li", { class: `rl-score ${i === 0 ? "leader" : ""} ${row.id === me() ? "is-me" : ""}`, style: `animation-delay: ${i * 50}ms` },
                    h("span", { class: "rl-score-name" }, row.name, row.id === me() && h("small", {}, " (tú)")),
                    h("span", { class: "rl-score-mark" }, mark(row)),
                    h("span", { class: "rl-score-points display" }, row.score))));
        },

        // Pantalla de pie: varios bloques apilados que se reparten el alto disponible.
        stack: (...children) => h("div", { class: "pt-stack" }, ...children)
    };


    // =====================================================
    // CICLO DE VIDA
    // =====================================================

    async function mount(container, { code = "", guest: isGuest = false } = {}) {
        root = container;
        ui = refs(root);
        guest = isGuest;

        root.firstElementChild.classList.add(`party-${def.id}`);
        ui.title.textContent = def.title;
        ui.eyebrow.textContent = def.eyebrow || "Fiesta · multijugador";
        ui.tagline.textContent = def.tagline;
        ui.rules.replaceChildren(...def.rules.map(rule => h("li", {}, rule)));

        client = createRoomClient({
            onMessage,
            onLost: () => {
                stopTimer();
                show("lobby");
                toast("Se perdió la conexión con la sala.", { error: true });
            }
        });

        root.addEventListener("click", onClick);
        ui.joinForm.addEventListener("submit", event => {
            event.preventDefault();
            if (!client.join(ui.code.value, playerName())) ui.code.focus();
        });
        ui.code.addEventListener("input", () => { ui.code.value = ui.code.value.toUpperCase(); });
        document.addEventListener("visibilitychange", keepAwake);

        // Sin cuenta no hay música: los invitados solo pueden unirse.
        ui.createOption.hidden = guest;
        ui.code.value = code;

        const named = guest ? Promise.resolve() : getMe().then(profile => { if (!ui.name.value) ui.name.value = profile.name.slice(0, 20); }).catch(() => {});

        await client.connect();
        show("lobby");

        if (client.resumeSaved(def.id)) {
            restorePool();
            return;
        }

        if (code) {
            await named;
            if (!ui.name.value) return ui.name.focus();
            client.join(code, playerName());
        }
    }

    function unmount() {
        stopTimer();
        clearTimeout(clipTimer);
        if (isHost()) player.pause();
        client?.close();
        wakeLock?.release?.().catch(() => {});
        document.removeEventListener("visibilitychange", keepAwake);
        state = null;
        client = null;
        root = null;
        catalog = [];
        pool = [];
        picker = null;
        current = null;
        lastView = null;
        wakeLock = null;
    }

    const playerName = () => ui.name.value.trim() || "Jugador";

    // Que la pantalla no se apague a mitad de partida.
    async function keepAwake() {
        if (document.hidden || !root || !lastView || (wakeLock && !wakeLock.released)) return;
        try {
            wakeLock = await navigator.wakeLock?.request("screen");
        } catch { /* no disponible: no pasa nada */ }
    }


    // =====================================================
    // MENSAJES DEL SERVIDOR
    // =====================================================

    function onMessage(message) {
        switch (message.type) {
            case "joined":
                ui.roomCode.textContent = message.code;
                if (!message.resumed) show("room");
                break;
            case "rejoin_failed":
                show("lobby");
                toast("Esa sala ya no existe.");
                break;
            case "room_state": return renderRoom(message);
            case "catalog":
                catalog = message.songs || [];
                return;
            case "view": return renderView(message);
            case "music": return playMusic(message);
            case "error_message": return toast(message.message, { error: true });
            default: return def.onMessage?.(message, kit); // mensajes propios de cada juego
        }
    }


    // =====================================================
    // SALA DE ESPERA
    // =====================================================

    function renderRoom(next) {
        state = next;
        ui.count.textContent = state.players.length;
        ui.players.replaceChildren(...state.players.map(other =>
            h("li", { class: `rl-player ${other.connected ? "" : "offline"}` },
                h("span", { class: "rl-player-name" },
                    other.name,
                    other.id === me() && h("small", {}, " (tú)"),
                    other.id === state.hostId && h("small", {}, " · pone la música")),
                h("span", { class: "rl-player-state" }, other.connected ? `${other.score} pts` : "Sin conexión"))));

        if (state.status === "lobby") {
            if (lastView) {
                lastView = null;
                current = null;
            }
            show("room");
        }

        const host = isHost();
        ui.hostPanel.classList.toggle("hidden", !host || guest);
        ui.guestPanel.classList.toggle("hidden", host && !guest);

        if (host && guest) {
            ui.guestStatus.textContent = "Ahora te toca poner la música, pero hace falta una cuenta de Spotify. Que cree la sala alguien con cuenta.";
        } else if (!host) {
            ui.guestStatus.textContent = state.songs >= state.minSongs ? `Playlist elegida: ${state.playlistName}. Esperando a que empiece.` : "El anfitrión está eligiendo la playlist.";
        }

        if (host && !guest && !picker) picker = playlistPicker(ui.playlists, { onSelect: choosePlaylist });

        // Opciones del juego antes de empezar (p. ej. a qué se puja). Las cambia el anfitrión.
        ui.options.replaceChildren(def.options ? def.options(state, kit) || "" : "");

        const enoughSongs = state.songs >= state.minSongs;
        const enoughPlayers = state.players.length >= state.minPlayers;
        ui.start.hidden = !host;
        ui.start.disabled = !host || guest || !enoughSongs || !enoughPlayers;
        ui.hint.textContent = !host ? "Empieza quien pone la música."
            : !enoughSongs ? "Elige una playlist para empezar."
            : !enoughPlayers ? `Hacen falta al menos ${state.minPlayers} jugadores. Pasa el código.`
            : `${state.players.length} jugando · ${state.songs} canciones`;
    }

    // El anfitrión lee su playlist (una llamada) y la carga en su reproductor de una vez.
    async function choosePlaylist(playlist) {
        ui.playlistStatus.textContent = "Leyendo canciones…";
        try {
            const tracks = await (def.dated ? loadTracks.dated(playlist.id) : loadTracks.sample(playlist.id));
            setPool(tracks.slice(0, MAX_POOL), playlist.name);
            ui.playlistStatus.textContent = `${playlist.name}: ${tracks.length} canciones listas.`;
        } catch (error) {
            ui.playlistStatus.textContent = error.message;
        }
    }

    function setPool(tracks, playlistName) {
        pool = tracks;
        player.load(pool);
        try {
            sessionStorage.setItem(POOL_KEY, JSON.stringify({ game: def.id, playlistName, pool }));
        } catch { /* sin almacenamiento: si se recarga la página, habrá que volver a elegir */ }
        client.send("set_pool", {
            playlistName,
            tracks: pool.map(({ id, name, artist, album, year, cover, duration }) => ({ id, name, artist, album, year, cover, duration }))
        });
    }

    // El anfitrión que recarga la página a mitad de partida recupera su lista sin pedirla otra vez.
    function restorePool() {
        try {
            const saved = JSON.parse(sessionStorage.getItem(POOL_KEY));
            if (saved?.game === def.id && Array.isArray(saved.pool)) {
                pool = saved.pool;
                player.load(pool);
            }
        } catch { /* nada guardado */ }
    }


    // =====================================================
    // PARTIDA
    // =====================================================

    function renderView(view) {
        lastView = view;

        if (view.phase === "final") return renderFinal(view);

        show("stage");
        keepAwake();

        ui.round.textContent = !view.round ? "" : view.rounds ? `Ronda ${view.round} de ${view.rounds}` : `Ronda ${view.round}`;
        ui.skip.classList.toggle("hidden", !isHost() || !view.total);
        startTimer(view.remaining, view.total);

        ui.screen.dataset.phase = view.phase; // para estilos por fase
        const screen = def.screens[view.phase];
        if (!screen) return;

        // Misma fase y ronda: se actualiza lo que haya cambiado sin repintar (no se pierde lo escrito).
        const key = `${view.phase}:${view.round}:${def.keyOf?.(view) ?? ""}`;
        if (current?.key === key && current.node.update) return current.node.update(view);

        const node = screen(view, kit);
        current = { key, node };
        ui.screen.replaceChildren(node);
    }

    function renderFinal(view) {
        stopTimer();
        show("final");
        current = null;

        // Sin ganadores marcados por el juego, ganan todos los empatados en cabeza.
        const top = view.scoreboard[0]?.score;
        const winners = view.winners ? view.scoreboard.filter(row => view.winners.includes(row.id)) : view.scoreboard.filter(row => row.score === top);
        ui.winner.textContent = !winners.length ? "nadie"
            : winners.length > 3 ? (view.winners ? "el equipo" : "empate")
            : winners.map(row => row.name).join(" y ");
        ui.finalExtra.replaceChildren(def.final ? def.final(view, kit) : "");
        ui.finalScores.replaceWith(ui.finalScores = kit.scores(view.scoreboard, { limit: 20, mark: () => "" }));
        ui.again.disabled = !isHost();
        ui.again.textContent = isHost() ? "Otra partida" : "Esperando al anfitrión";
    }

    // La barra se vacía con una transición CSS: sin repintar cada fotograma.
    function startTimer(remaining, total) {
        stopTimer();
        ui.timer.classList.toggle("hidden", !total);
        ui.seconds.textContent = "";
        if (!total) return;

        const end = Date.now() + remaining;
        const bar = ui.timerBar;
        bar.style.transition = "none";
        bar.style.transform = `scaleX(${remaining / total})`;
        void bar.offsetWidth;
        bar.style.transition = `transform ${remaining}ms linear`;
        bar.style.transform = "scaleX(0)";

        const update = () => {
            const left = Math.max(0, end - Date.now());
            ui.seconds.textContent = Math.ceil(left / 1000);
            const urgent = left <= 5000 && total >= 10000;
            ui.seconds.classList.toggle("urgent", urgent);
            bar.classList.toggle("urgent", urgent);
            if (!left) stopTimer();
        };
        update();
        tick = setInterval(update, 250);
    }

    function stopTimer() {
        clearInterval(tick);
        tick = null;
    }


    // =====================================================
    // MÚSICA (solo en el dispositivo del anfitrión)
    // =====================================================

    function playMusic({ action, index, ms }) {
        if (!isHost() || guest) return;
        clearTimeout(clipTimer);
        const fail = error => toast(error.message, { error: true });

        if (action === "play") player.playAt(index).catch(fail);
        if (action === "clip") player.playAt(index).then(() => { clipTimer = setTimeout(() => player.pause(), ms); }).catch(fail);
        if (action === "pause") player.pause();
        if (action === "resume") player.resume().catch(fail);
    }


    // =====================================================
    // BOTONES COMUNES
    // =====================================================

    async function copy(text, done) {
        try {
            await navigator.clipboard.writeText(text);
            toast(done);
        } catch {
            toast(text);
        }
    }

    function onClick(event) {
        switch (event.target.closest("[data-action]")?.dataset.action) {
            case "create": return client.create(def.id, playerName());
            case "start": return client.send("start_game");
            case "skip": return client.send("skip");
            // Otra partida con la misma playlist: sin volver a pedirla.
            case "again": return client.send("play_again");
            case "copy-code": return copy(client.room.code, "Código copiado.");
            case "copy-link": return copy(client.inviteLink(), "Enlace copiado. Mándaselo a tus amigos.");
        }
    }

    return {
        template: "/games/party/party.html",
        cta: `Abrir ${def.title}`,
        needsPlaylist: false,
        setupTitle: () => "Juega con tus amigos",
        note: () => def.note || "Creas una sala, la música suena en tu dispositivo y los demás se unen desde su móvil con el código, sin cuenta.",
        mount,
        unmount
    };
}
