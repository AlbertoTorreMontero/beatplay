// Conexión con una sala online (Music Roulette, Pulsador): WebSocket, reconexión y vuelta a la sala.
import { toast } from "./ui.js";

const RECONNECT_ATTEMPTS = 8;
const STORAGE_KEY = "beatplayRoom";

/**
 * onMessage(message)  recibe todos los mensajes del servidor.
 * onLost()            la conexión no se pudo recuperar: el juego vuelve a su pantalla de entrada.
 */
export function createRoomClient({ onMessage, onLost }) {

    const room = { code: null, token: null, playerId: null, game: null };
    let socket = null;
    let reconnecting = false;
    let closed = false;


    // ---- Sala guardada: un móvil puede descartar la pestaña en segundo plano.

    function save() {
        try {
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ code: room.code, token: room.token, game: room.game }));
        } catch { /* sin almacenamiento: solo funcionará la reconexión sin recargar */ }
    }

    function forget() {
        Object.assign(room, { code: null, token: null, playerId: null, game: null });
        try {
            sessionStorage.removeItem(STORAGE_KEY);
        } catch { /* nada que borrar */ }
    }

    function saved() {
        try {
            return JSON.parse(sessionStorage.getItem(STORAGE_KEY));
        } catch {
            return null;
        }
    }


    // ---- Conexión

    function send(type, data = {}) {
        if (socket?.readyState !== WebSocket.OPEN) {
            toast("Sin conexión con la sala.", { error: true });
            return;
        }
        socket.send(JSON.stringify({ type, ...data }));
    }

    function connect() {
        if (socket?.readyState === WebSocket.OPEN) return Promise.resolve();

        return new Promise((resolve, reject) => {
            const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`);
            let opened = false;
            socket = ws;

            ws.addEventListener("open", () => {
                opened = true;
                resolve();
            });

            ws.addEventListener("message", event => {
                let message;
                try {
                    message = JSON.parse(event.data);
                } catch {
                    return;
                }

                if (message.type === "joined") {
                    Object.assign(room, { code: message.code, playerId: message.playerId, token: message.token, game: message.game });
                    save();
                } else if (message.type === "rejoin_failed") {
                    forget();
                }

                try {
                    onMessage(message);
                } catch (error) {
                    console.error("Sala:", error);
                }
            });

            ws.addEventListener("close", () => {
                // Si ya no es el socket activo, el cierre lo pidió close() o lo sustituyó otro.
                if (socket !== ws || !opened || closed) return;
                socket = null;

                if (room.code && room.token) reconnect();
                else onLost();
            });

            ws.addEventListener("error", () => reject(new Error("No se pudo conectar con el servidor de salas.")));
        });
    }

    // Reintenta con espera creciente y recupera el sitio con el token.
    async function reconnect(attempt = 1) {
        if (closed || !room.code || !room.token) return;

        if (attempt === 1) {
            if (reconnecting) return;
            reconnecting = true;
            toast("Conexión perdida. Reconectando…");
        }

        try {
            await connect();
            reconnecting = false;
            send("rejoin", { code: room.code, token: room.token });
        } catch {
            if (attempt >= RECONNECT_ATTEMPTS) {
                reconnecting = false;
                forget();
                onLost();
                return;
            }
            setTimeout(() => reconnect(attempt + 1), Math.min(1000 * attempt, 5000));
        }
    }

    // Al volver a primer plano (móvil) el socket suele estar muerto aunque el navegador no lo sepa.
    const check = () => {
        if (!document.hidden && room.code && socket?.readyState !== WebSocket.OPEN) reconnect();
    };

    document.addEventListener("visibilitychange", check);
    window.addEventListener("online", check);

    async function request(type, data) {
        try {
            await connect();
            send(type, data);
        } catch (error) {
            toast(error.message, { error: true });
        }
    }

    return {
        room,
        connect,
        send,
        request, // conecta si hace falta y envía

        create: (game, name) => request("create_room", { game, name }),

        join(code, name) {
            code = String(code || "").trim().toUpperCase();
            if (code.length !== 5) {
                toast("El código tiene 5 letras o números.");
                return false;
            }
            request("join_room", { code, name });
            return true;
        },

        // Si la pestaña se recargó en mitad de una sala de este juego, se vuelve a ella.
        resumeSaved(game) {
            const last = saved();
            if (!last?.code || !last?.token || last.game !== game) return false;
            Object.assign(room, last);
            request("rejoin", { code: last.code, token: last.token });
            return true;
        },

        close() {
            closed = true;
            document.removeEventListener("visibilitychange", check);
            window.removeEventListener("online", check);

            const ws = socket;
            socket = null;
            if (ws?.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: "leave_room" }));
                ws.close();
            }
            forget();
        },

        inviteLink: () => `${location.origin}/app#sala=${room.code}`
    };
}
