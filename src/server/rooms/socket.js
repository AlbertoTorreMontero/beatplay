// WebSocket de los juegos online (Music Roulette y Pulsador), montado sobre el mismo servidor HTTP.
const { WebSocketServer } = require("ws");
const { createHub } = require("./hub");
const { createRoulette } = require("./roulette");
const { createBuzzer } = require("./buzzer");

const HEARTBEAT_MS = 25000;

function attachRooms(server, provider) {

    const hub = createHub({
        roulette: createRoulette({ coverHosts: provider.coverHosts }),
        buzzer: createBuzzer({ coverHosts: provider.coverHosts })
    });

    const wss = new WebSocketServer({
        server,
        maxPayload: 256 * 1024, // sobra para 200 canciones y evita mensajes gigantes
        // Solo se aceptan conexiones desde nuestra propia web.
        verifyClient: ({ origin, req }) => {
            try {
                return !origin || new URL(origin).host === req.headers.host;
            } catch {
                return false;
            }
        }
    });

    wss.on("connection", ws => {
        const connection = { ws, player: hub.createPlayer(ws) };
        const disconnect = () => hub.handleDisconnect(connection);

        ws.isAlive = true;
        ws.on("pong", () => { ws.isAlive = true; });

        ws.on("message", raw => {
            let message;
            try {
                message = JSON.parse(raw);
            } catch {
                return;
            }
            if (message && typeof message === "object") hub.handleMessage(connection, message);
        });

        ws.on("close", disconnect);
        ws.on("error", disconnect);
    });

    // Los proxies cierran las conexiones inactivas; un ping periódico las mantiene y detecta las muertas.
    const heartbeat = setInterval(() => {
        wss.clients.forEach(ws => {
            if (!ws.isAlive) return ws.terminate();
            ws.isAlive = false;
            ws.ping();
        });
    }, HEARTBEAT_MS);

    wss.on("close", () => clearInterval(heartbeat));

    return hub;
}

module.exports = { attachRooms };
