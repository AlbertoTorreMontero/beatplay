// Punto de entrada: npm start
const http = require("http");
const config = require("./config");
const { loadProvider } = require("./providers");
const { createApp } = require("./app");
const { attachRoulette } = require("./roulette/socket");

const provider = loadProvider(config.provider);
const server = http.createServer(createApp({ ...config, provider }));

attachRoulette(server, provider);

server.listen(config.port, () => {
    console.log(`BeatPlay escuchando en el puerto ${config.port} con ${provider.name} (${new URL(provider.redirectUri).origin})`);
});
