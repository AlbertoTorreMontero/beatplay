// Los juegos de fiesta: solo el anfitrión necesita cuenta y Spotify; el resto entra con el código.
const { createChairs } = require("./chairs");
const { createImpostor } = require("./impostor");
const { createDjBattle } = require("./djbattle");
const { createBluff } = require("./bluff");
const { createBid } = require("./bid");
const { createAuction } = require("./auction");
const { createKaraoke } = require("./karaoke");
const { createDraw } = require("./draw");

// Devuelve { id: juego } listo para pasárselo a createHub junto a los que ya hay.
function createPartyGames(options) {
    return {
        chairs: createChairs(options),
        impostor: createImpostor(options),
        djbattle: createDjBattle(options),
        bluff: createBluff(options),
        bid: createBid(options),
        auction: createAuction(options),
        karaoke: createKaraoke(options),
        draw: createDraw(options)
    };
}

module.exports = { createPartyGames };
