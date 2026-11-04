// Pantalla de login: entrar, configurar la app propia de Spotify la primera vez, otro dispositivo e invitados.
import { $, $$, refs, toast, store } from "../lib/ui.js";

const CLIENT_ID_KEY = "beatplayClientId";
const CLIENT_ID_FORMAT = /^[0-9a-f]{32}$/i;

const NOTICES = {
    denied: "Has cancelado el acceso. Sin él no podemos leer tus playlists.",
    error: "No se pudo iniciar sesión. Revisa tu Client ID y vuelve a intentarlo.",
    notallowed: "Tu cuenta no está en la lista de amigos de BeatPlay. Conecta tu propia app de Spotify: se hace una vez.",
    setup: "Para entrar necesitas conectar tu propia app de Spotify. Se hace una vez."
};

let ui = {};

const loginWith = clientId => { location.href = clientId ? `/login?clientId=${clientId}` : "/login"; };

function show(view) {
    for (const section of $$("[data-login]")) section.classList.toggle("hidden", section.dataset.login !== view);
    // En la pantalla de inicio no se enfoca nada: en el móvil abriría el teclado sin pedirlo.
    if (view !== "start") $(`[data-login="${view}"] input, [data-login="${view}"] button`)?.focus({ preventScroll: true });
}

function notice(text) {
    ui.loginNotice.hidden = !text;
    ui.loginNotice.textContent = text || "";
}

async function copy(text) {
    try {
        await navigator.clipboard.writeText(text);
        toast("Copiado.");
    } catch {
        toast(text);
    }
}

/**
 * Prepara la pantalla. `onGuest(código)` entra a una sala sin cuenta.
 * `invite` es el código de sala de un enlace de invitación, si lo hay (queda ya escrito).
 */
export function initLogin({ config, onGuest, invite }) {
    const root = $("#loginScreen");
    ui = refs(root);
    ui.loginNotice = $("#loginNotice");

    ui.redirectUri.textContent = config.redirectUri;
    if (config.dashboardUrl) ui.dashboard.href = config.dashboardUrl;
    $("[data-action=shared]", root).hidden = !config.sharedApp;
    ui.clientId.value = store.get(CLIENT_ID_KEY, "");

    // Con un enlace de invitación, el código ya está puesto: un toque y a la sala.
    if (invite) {
        ui.guestCode.value = invite;
        ui.guestTitle.textContent = `Sala ${invite}`;
        ui.guestText.textContent = "Te han invitado a esta sala. Entra sin cuenta: no necesitas Spotify.";
    }

    // Quien ya conectó Spotify en este navegador entra directo; si no, se le avisa de la guía.
    if (store.get(CLIENT_ID_KEY)) ui.loginNote.textContent = "Ya conectaste tu Spotify en este navegador: entras directo.";

    // Avisos que deja el servidor al volver del login (?auth=…).
    const reason = new URLSearchParams(location.search).get("auth");
    if (reason) history.replaceState(null, "", location.pathname + location.hash);
    notice(NOTICES[reason]);
    show(["setup", "notallowed"].includes(reason) ? "setup" : "start");

    root.addEventListener("click", event => {
        const target = event.target.closest("[data-action], [data-show], [data-copy], [data-copy-ref]");
        if (!target) return;

        if (target.dataset.show) return show(target.dataset.show);
        if (target.dataset.copy) return copy(target.dataset.copy);
        if (target.dataset.copyRef) return copy(ui[target.dataset.copyRef].textContent);

        switch (target.dataset.action) {
            case "login": {
                // Quien ya lo configuró en este navegador entra directo.
                const saved = store.get(CLIENT_ID_KEY);
                return saved ? loginWith(saved) : show("setup");
            }
            case "shared": return loginWith(null);
        }
    });

    ui.setupForm.addEventListener("submit", event => {
        event.preventDefault();
        const clientId = ui.clientId.value.trim();

        if (!CLIENT_ID_FORMAT.test(clientId)) {
            notice("Ese Client ID no parece correcto: son 32 letras y números, sin espacios.");
            ui.clientId.focus();
            return;
        }

        store.set(CLIENT_ID_KEY, clientId.toLowerCase());
        loginWith(clientId.toLowerCase());
    });

    ui.guestCode.addEventListener("input", () => { ui.guestCode.value = ui.guestCode.value.toUpperCase(); });

    ui.guestForm.addEventListener("submit", event => {
        event.preventDefault();
        if (ui.guestCode.value.trim().length !== 5) {
            notice("El código de la sala tiene 5 letras o números.");
            return ui.guestCode.focus();
        }
        onGuest(ui.guestCode.value.trim().toUpperCase());
    });

    ui.deviceForm.addEventListener("submit", async event => {
        event.preventDefault();
        const account = ui.account.value.trim();
        if (!account) return ui.account.focus();

        try {
            const response = await fetch(`/auth/client-id?account=${encodeURIComponent(account)}`);
            const data = await response.json();
            if (!response.ok) throw new Error(data.error);

            store.set(CLIENT_ID_KEY, data.clientId);
            loginWith(data.clientId);
        } catch (error) {
            notice(error.message || "No se pudo buscar tu cuenta.");
        }
    });
}
