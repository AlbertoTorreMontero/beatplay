// Configuración leída de las variables de entorno (.env en local).
require("dotenv").config({ quiet: true });

const path = require("path");

module.exports = {
    port: Number(process.env.PORT) || 3000,
    // Qué servicio de música usa la app. Cada uno vive en src/server/providers/<nombre>.js.
    provider: process.env.MUSIC_PROVIDER || "spotify",
    hipsterPlaylistId: process.env.HIPSTER_PLAYLIST_ID || null,
    clientDir: path.join(__dirname, "..", "client")
};
