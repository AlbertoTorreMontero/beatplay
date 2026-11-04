// Pantalla de entrada: invitados con código, o "Pongo la música" con Spotify.
// La primera vez, un asistente de 4 pasos conecta la app propia de Spotify; después el Client ID
// queda guardado en este navegador y se entra con un toque.
import { $, $$, refs, toast, store } from "../lib/ui.js";
import { isMobile } from "../lib/player/index.js";

export const CLIENT_ID_KEY = "beatplayClientId";
const CLIENT_ID_FORMAT = /^[0-9a-f]{32}$/i;
const STEPS = 4;

// Avisos al volver de Spotify (?auth=…): qué ha pasado y a qué pantalla se vuelve.
const RETURNS = {
    denied: { text: "Has cancelado el permiso en Spotify. Sin él no podemos leer tus playlists. Vuelve a intentarlo cuando quieras.", view: "start" },
    error: { text: "Spotify no aceptó la conexión. Casi siempre es la Redirect URI: comprueba que está copiada entera en tu app y que le diste a Save.", view: "setup", step: 3 },
    notallowed: { text: "Tu cuenta no está autorizada en la app de esta web. Conecta la tuya: son 3 minutos.", view: "setup", step: 1 },
    setup: { text: "", view: "setup", step: 1 }
};

let ui = {};
let config = {};

const loginWith = clientId => { location.href = clientId ? `/login?clientId=${clientId}` : "/login"; };
const cleanId = value => value.replace(/\s+/g, "").toLowerCase();

function notice(text) {
    ui.loginNotice.hidden = !text;
    ui.loginNotice.textContent = text || "";
}

function show(view, step = 1) {
    for (const section of $$("[data-login]")) section.classList.toggle("hidden", section.dataset.login !== view);
    ui.loginTitle.hidden = view !== "start";
    if (view === "setup") goTo(step);
}

function goTo(step) {
    for (const section of $$("[data-step]")) section.classList.toggle("current", Number(section.dataset.step) === step);
    [...ui.progress.children].forEach((bar, i) => bar.classList.toggle("done", i < step));
    window.scrollTo({ top: 0 });
    if (step === 4 && !isMobile()) ui.clientId.focus({ preventScroll: true });
}

async function copy(text, button) {
    try {
        await navigator.clipboard.writeText(text);
        button.classList.add("copied");
        const label = button.textContent;
        button.textContent = "Copiado ✓";
        setTimeout(() => {
            button.classList.remove("copied");
            button.textContent = label;
        }, 1600);
    } catch {
        toast(`Cópialo a mano: ${text}`);
    }
}

function checkClientId() {
    const value = cleanId(ui.clientId.value);
    const ok = CLIENT_ID_FORMAT.test(value);
    ui.connectButton.disabled = !ok;
    ui.clientIdHint.textContent = !value
        ? "Si no lo encuentras: en developer.spotify.com/dashboard, entra en tu app BeatPlay."
        : ok ? "Perfecto, ese es." : `Eso no parece un Client ID: tiene que tener 32 letras y números (llevas ${value.length}).`;
    return ok ? value : null;
}

/**
 * Prepara la pantalla. `onGuest(código)` entra a una sala sin cuenta.
 * `invite` es el código de un enlace de invitación, si lo hay (queda ya escrito).
 */
export function initLogin({ config: providerConfig, onGuest, invite }) {
    config = providerConfig;
    const root = $("#loginScreen");
    ui = refs(root);
    ui.loginNotice = $("#loginNotice");
    ui.progress = $(".wizard-progress", root);

    ui.redirectUri.textContent = config.redirectUri;
    if (config.dashboardUrl) ui.dashboard.href = config.dashboardUrl;
    $("[data-action=shared]", root).hidden = !config.sharedApp;
    ui.mobileNote.hidden = !isMobile();

    const saved = store.get(CLIENT_ID_KEY);
    if (saved) {
        ui.loginNote.textContent = "Ya conectaste tu Spotify en este navegador: entras con un toque.";
        ui.resetLink.hidden = false;
        ui.clientId.value = saved;
    }
    checkClientId();

    if (invite) {
        ui.guestCode.value = invite;
        ui.guestTitle.textContent = `Sala ${invite}`;
        ui.guestText.textContent = "Te han invitado a esta sala. Pulsa Entrar: no necesitas Spotify ni registrarte.";
    }

    const reason = new URLSearchParams(location.search).get("auth");
    if (reason) history.replaceState(null, "", location.pathname + location.hash);
    const back = RETURNS[reason];
    notice(back?.text);
    show(back?.view || "start", back?.step);

    root.addEventListener("click", event => {
        const target = event.target.closest("[data-action], [data-show], [data-step-go], [data-copy], [data-copy-ref]");
        if (!target) return;

        if (target.dataset.show) {
            notice("");
            return show(target.dataset.show);
        }
        if (target.dataset.stepGo) return goTo(Number(target.dataset.stepGo));
        if (target.dataset.copy) return copy(target.dataset.copy, target);
        if (target.dataset.copyRef) return copy(ui[target.dataset.copyRef].textContent, target);

        switch (target.dataset.action) {
            case "login": {
                const known = store.get(CLIENT_ID_KEY);
                return known ? loginWith(known) : show("setup", 1);
            }
            case "reset":
                store.set(CLIENT_ID_KEY, null);
                ui.clientId.value = "";
                checkClientId();
                return show("setup", 1);
            case "shared": return loginWith(null);
            case "paste":
                return navigator.clipboard?.readText?.()
                    .then(text => {
                        ui.clientId.value = text.trim();
                        checkClientId();
                    })
                    .catch(() => ui.clientId.focus());
            case "connect": {
                const clientId = checkClientId();
                if (!clientId) return;
                store.set(CLIENT_ID_KEY, clientId);
                return loginWith(clientId);
            }
        }
    });

    ui.clientId.addEventListener("input", checkClientId);
    ui.setupForm.addEventListener("submit", event => {
        event.preventDefault();
        ui.connectButton.click();
    });

    ui.guestCode.addEventListener("input", () => { ui.guestCode.value = ui.guestCode.value.toUpperCase(); });
    ui.guestForm.addEventListener("submit", event => {
        event.preventDefault();
        const code = ui.guestCode.value.trim().toUpperCase();
        if (code.length !== 5) {
            notice("El código de la sala tiene 5 letras o números.");
            return ui.guestCode.focus();
        }
        onGuest(code);
    });
}
