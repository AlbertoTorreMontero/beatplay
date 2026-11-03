// Punto de entrada: npm start
const http = require("http");
const config = require("./config");
const { loadProvider } = require("./providers");
const { createApp } = require("./app");
const { attachRooms } = require("./rooms/socket");

const provider = loadProvider(config.provider);
const app = createApp({ ...config, provider });
const server = http.createServer(app);

// Las salas online; la app las consulta para los enlaces de invitación.
app.locals.rooms = attachRooms(server, provider);

server.listen(config.port, () => {
    console.log(`BeatPlay escuchando en el puerto ${config.port} con ${provider.name} (${new URL(provider.redirectUri).origin})`);
});
