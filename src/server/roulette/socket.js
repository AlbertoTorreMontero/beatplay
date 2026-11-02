// WebSocket de Music Roulette, montado sobre el mismo servidor HTTP.
const { WebSocketServer } = require("ws");
const { createRoulette } = require("./game");

const HEARTBEAT_MS = 25000;

function attachRoulette(server, provider) {

    const roulette = createRoulette({ coverHosts: provider.coverHosts });

    const wss = new WebSocketServer({
        server,
        maxPayload: 256 * 1024, // sobra para 100 canciones y evita mensajes gigantes
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
        const connection = { ws, player: roulette.createPlayer(ws) };
        const disconnect = () => roulette.handleDisconnect(connection);

        ws.isAlive = true;
        ws.on("pong", () => { ws.isAlive = true; });

        ws.on("message", raw => {
            let message;
            try {
                message = JSON.parse(raw);
            } catch {
                return;
            }
            if (message && typeof message === "object") roulette.handleMessage(connection, message);
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

    return wss;
}

module.exports = { attachRoulette };
