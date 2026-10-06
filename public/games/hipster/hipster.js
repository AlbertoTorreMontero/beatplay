/* =========================================================
   BEATPLAY — HIPSTER
   Escucha una canción y colócala en su año dentro de la
   línea temporal. Un fallo termina la partida.
========================================================= */

const HIPSTER_NEXT_DELAY = 850;
const HIPSTER_FAIL_DELAY = 900;

const HIPSTER_IDS = [
    "hipsterScore", "hipsterBest", "hipsterBoard", "hipsterGameOver", "hipsterTimeline",
    "hipsterResult", "hipsterPlayPause", "hipsterPlayerStatus", "hipsterProgress",
    "hipsterCurrentTime", "hipsterDuration", "hipsterFinalTitle", "hipsterFinalScore", "hipsterFinalRecord"
];

let hipsterTracks = [];
let hipsterTimeline = [];
let hipsterCurrentTrack = null;
let hipsterMode = "global";
let hipsterPlaylist = null;
let hipsterScore = 0;
let hipsterBest = readHipsterBest();
let hipsterLocked = false;
let hipsterGameId = 0;
let hipsterTimer = null;
let hipsterTicker = null;
let hipsterUnsubscribe = null;
let hipsterPlayback = null; // último estado del reproductor y cuándo llegó
let ui = {};


// El HTML del juego se vuelve a inyectar en cada partida: hay que volver a localizar los elementos.
function bindHipsterUi() {

    ui = Object.fromEntries(
        HIPSTER_IDS.map(id => [id.replace("hipster", "").replace(/^./, c => c.toLowerCase()), document.getElementById(id)])
    );
}


function readHipsterBest() {

    try {
        return Number(localStorage.getItem("hipsterBest")) || 0;
    } catch {
        return 0; // almacenamiento bloqueado (modo privado)
    }
}


// =====================================================
// INICIO
// =====================================================

async function startHipster({ mode = "global", playlist = null } = {}) {

    stopHipster();

    const gameId = ++hipsterGameId;

    hipsterMode = mode;
    hipsterPlaylist = playlist;
    hipsterScore = 0;
    hipsterLocked = false;

    bindHipsterUi();

    ui.score.textContent = "0";
    ui.best.textContent = hipsterBest;
    ui.gameOver.classList.add("hidden");
    ui.board.classList.remove("hidden");
    ui.timeline.replaceChildren();
    resetPlayer();

    hipsterUnsubscribe = onPlayerState(handlePlayerState);
    hipsterTicker = setInterval(tickProgress, 250);

    try {

        const tracks = (await loadHipsterTracks()).filter(track => track.year > 0);

        if (gameId !== hipsterGameId) return;

        if (tracks.length < 2) {
            throw new Error("Esta playlist necesita al menos 2 canciones con año para jugar a Hipster.");
        }

        hipsterTracks = shuffle(tracks);
        hipsterTimeline = [hipsterTracks.shift()];

        renderTimeline();

        await nextHipsterTrack(gameId);

    } catch (error) {

        if (gameId !== hipsterGameId) return;

        console.error("Hipster:", error);
        toast(error.message || "No se pudo iniciar Hipster.");

        stopHipster();
        showScreen("menuScreen");
    }
}


function loadHipsterTracks() {

    if (hipsterMode === "user" && !hipsterPlaylist) {
        throw new Error("No hay playlist seleccionada.");
    }

    return getHipsterTracks(hipsterMode === "user" ? hipsterPlaylist.id : null);
}


// =====================================================
// SIGUIENTE CANCIÓN
// =====================================================

async function nextHipsterTrack(gameId) {

    if (gameId !== hipsterGameId) return;

    if (!hipsterTracks.length) {
        endHipster(true);
        return;
    }

    hipsterCurrentTrack = hipsterTracks.shift();
    hipsterLocked = false;

    ui.result.classList.add("hidden");
    resetPlayer();
    setPlayerStatus("CARGANDO");

    try {

        await playSpotifyTrack(hipsterCurrentTrack.uri);

        if (gameId !== hipsterGameId) return;

        setPlayerStatus("REPRODUCIENDO");

    } catch (error) {

        console.warn("No se pudo iniciar automáticamente:", error);
        setPlayerStatus("PULSA PLAY");
    }
}


// =====================================================
// REPRODUCTOR
// =====================================================

function handlePlayerState(state) {

    hipsterPlayback = { state, receivedAt: performance.now() };

    ui.playPause.textContent = state.paused ? "▶" : "Ⅱ";
    ui.duration.textContent = formatTime(state.duration);

    setPlayerStatus(state.paused ? "PAUSADO" : "REPRODUCIENDO");
    updateProgress();
}


// El SDK solo avisa cuando cambia algo (play, pausa, seek): entre avisos la posición se calcula.
function currentPosition() {

    const { state, receivedAt } = hipsterPlayback;
    const elapsed = state.paused ? 0 : performance.now() - receivedAt;

    return Math.min(state.duration, state.position + elapsed);
}


function updateProgress() {

    // Mientras el usuario arrastra la barra no se la movemos.
    if (!hipsterPlayback?.state.duration || document.activeElement === ui.progress) return;

    const position = currentPosition();

    ui.progress.value = Math.round(position / hipsterPlayback.state.duration * 1000);
    ui.currentTime.textContent = formatTime(position);
}


function tickProgress() {

    if (hipsterPlayback && !hipsterPlayback.state.paused) updateProgress();
}


async function toggleHipsterPlay() {

    try {
        await spotifyTogglePlay();
    } catch (error) {
        console.error("Player Hipster:", error);
    }
}


async function seekHipster(event) {

    if (!hipsterPlayback?.state.duration) return;

    try {
        await spotifySeek(hipsterPlayback.state.duration * Number(event.target.value) / 1000);
    } catch (error) {
        console.error("Seek Hipster:", error);
    }
}


function resetPlayer() {

    hipsterPlayback = null;

    ui.progress.value = 0;
    ui.currentTime.textContent = "0:00";
    ui.duration.textContent = "0:00";
    ui.playPause.textContent = "▶";
}


function setPlayerStatus(text) {
    ui.playerStatus.textContent = text;
}


// =====================================================
// LÍNEA TEMPORAL
// Hijos del contenedor: hueco, carta, hueco, carta… hueco.
// Al colocar una carta solo se insertan dos nodos nuevos;
// reconstruirlo todo recargaba todas las portadas cada vez.
// =====================================================

function createSlot() {

    const slot = document.createElement("div");
    const button = document.createElement("button");

    slot.className = "hipsterSlot";
    button.type = "button";
    button.className = "hipsterPlus";
    button.textContent = "+";

    slot.append(button);

    return slot;
}


function createCard(track) {

    const card = document.createElement("article");
    const image = document.createElement("img");
    const artist = document.createElement("div");
    const year = document.createElement("div");
    const song = document.createElement("div");

    card.className = "hipsterCard";
    image.className = "hipsterCardCover";
    image.src = track.cover || "";
    image.alt = "";
    image.decoding = "async";
    artist.className = "hipsterCardArtist";
    artist.textContent = track.artist || "";
    year.className = "hipsterCardYear";
    year.textContent = track.year;
    song.className = "hipsterCardSong";
    song.textContent = track.name;

    card.append(image, artist, year, song);

    return card;
}


function renderTimeline() {

    ui.timeline.replaceChildren(createSlot(), createCard(hipsterTimeline[0]), createSlot());

    labelSlots();
}


// Etiquetas para lector de pantalla: "Colocar entre 1990 y 2001".
function labelSlots() {

    const buttons = ui.timeline.querySelectorAll(".hipsterPlus");

    buttons.forEach((button, position) => {

        const before = hipsterTimeline[position - 1];
        const after = hipsterTimeline[position];

        const label =
            !before ? `Colocar antes de ${after.year}` :
            !after ? `Colocar después de ${before.year}` :
            `Colocar entre ${before.year} y ${after.year}`;

        button.setAttribute("aria-label", label);
        button.title = label;
    });
}


function insertCard(position, track) {

    const slot = ui.timeline.querySelectorAll(".hipsterSlot")[position];
    const card = createCard(track);

    slot.after(card, createSlot());
    labelSlots();

    const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

    card.scrollIntoView({ inline: "center", block: "nearest", behavior: reduceMotion ? "auto" : "smooth" });

    return card;
}


// =====================================================
// COLOCAR CANCIÓN
// =====================================================

function choosePosition(position) {

    if (hipsterLocked || !hipsterCurrentTrack) return;

    hipsterLocked = true;

    const before = hipsterTimeline[position - 1];
    const after = hipsterTimeline[position];
    const year = hipsterCurrentTrack.year;
    const correct = (!before || year >= before.year) && (!after || year <= after.year);

    hipsterTimeline.splice(position, 0, hipsterCurrentTrack);

    insertCard(position, hipsterCurrentTrack).classList.add(correct ? "correct" : "wrong");

    showResult(correct);
    setPlayerStatus(correct ? "CORRECTO" : "FALLO");

    clearTimeout(hipsterTimer);

    if (!correct) {
        hipsterTimer = setTimeout(() => endHipster(false), HIPSTER_FAIL_DELAY);
        return;
    }

    hipsterScore++;
    ui.score.textContent = hipsterScore;

    const gameId = hipsterGameId;

    hipsterTimer = setTimeout(() => nextHipsterTrack(gameId), HIPSTER_NEXT_DELAY);
}


function showResult(correct) {

    const verdict = document.createElement("strong");

    verdict.textContent = correct ? "Correcto" : "Incorrecto";

    ui.result.classList.remove("hidden");
    ui.result.replaceChildren(verdict, ` ${hipsterCurrentTrack.name} · ${hipsterCurrentTrack.year}`);
}


// =====================================================
// FIN
// =====================================================

function releaseHipster() {

    clearTimeout(hipsterTimer);
    clearInterval(hipsterTicker);
    hipsterUnsubscribe?.();
    hipsterUnsubscribe = null;
    hipsterPlayback = null;

    ++hipsterGameId; // invalida cualquier carga o temporizador pendiente
    hipsterLocked = true;

    pauseSpotify();
}


function endHipster(completed = false) {

    releaseHipster();

    ui.board.classList.add("hidden");
    ui.gameOver.classList.remove("hidden");
    ui.finalScore.textContent = hipsterScore;
    ui.finalTitle.textContent = completed ? "Has completado Hipster" : "Te has equivocado";

    if (hipsterScore > hipsterBest) {

        hipsterBest = hipsterScore;
        ui.finalRecord.textContent = "Nuevo récord";

        try {
            localStorage.setItem("hipsterBest", String(hipsterBest));
        } catch {
            /* almacenamiento bloqueado: el récord solo dura esta sesión */
        }

    } else {
        ui.finalRecord.textContent = `Récord: ${hipsterBest}`;
    }

    document.getElementById("hipsterRestartButton")?.focus();
}


function stopHipster() {

    releaseHipster();

    hipsterTracks = [];
    hipsterTimeline = [];
    hipsterCurrentTrack = null;
}


// =====================================================
// UTILIDADES Y EVENTOS
// =====================================================

function formatTime(ms) {

    const seconds = Math.floor((ms || 0) / 1000);

    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}


document.addEventListener("click", event => {

    if (event.target.closest("#hipsterPlayPause")) {
        toggleHipsterPlay();

    } else if (event.target.closest("#hipsterRestartButton")) {
        startHipster({ mode: hipsterMode, playlist: hipsterPlaylist });

    } else if (event.target.closest(".hipsterPlus")) {
        const buttons = [...ui.timeline.querySelectorAll(".hipsterPlus")];
        choosePosition(buttons.indexOf(event.target.closest(".hipsterPlus")));
    }
});


document.addEventListener("input", event => {

    if (event.target.id === "hipsterProgress") seekHipster(event);
});
