/*
 * Proveedores de música.
 *
 * El resto del servidor solo habla con esta interfaz, nunca con la API de un servicio.
 * Para cambiar de servicio: crea providers/<nombre>.js con estos miembros, regístralo
 * abajo y pon MUSIC_PROVIDER=<nombre> en el .env.
 *
 *   id, name                       identificador y nombre visible ("Spotify")
 *   redirectUri                    URL de vuelta del login (define el host canónico)
 *   pageSize                       canciones por página en getTrackPage
 *   coverHosts                     hosts de los que se aceptan portadas en Music Roulette
 *   playback                       reproductor del cliente: "spotify-sdk" | "preview" | null
 *
 *   authorizeUrl(state)            URL a la que mandar al usuario para iniciar sesión
 *   exchangeCode(code)             -> tokens  { accessToken, refreshToken, expiresAt }
 *   refresh(tokens)                -> tokens  renovados
 *   getProfile(token)              -> { id, name }
 *   listPlaylists(token)           -> [{ id, name, owner, image, tracks }]
 *   getPlaylistInfo(token, id)     -> { name, total }
 *   getTrackPage(token, id, offset)-> [track]
 *   controls?: { transfer, play, pause }   si el reproductor del cliente necesita al servidor
 *
 * Una canción ("track") siempre tiene esta forma, venga del servicio que venga:
 *   { id, ref, name, artist, album, year, cover, preview }
 *   ref     referencia para reproducirla en ese servicio (p. ej. una URI de Spotify)
 *   preview URL de audio corto, si el servicio la da (null si no)
 */

const PROVIDERS = {
    spotify: () => require("./spotify")
};

function loadProvider(name) {
    const load = PROVIDERS[name];

    if (!load) {
        throw new Error(`MUSIC_PROVIDER "${name}" no existe. Opciones: ${Object.keys(PROVIDERS).join(", ")}.`);
    }

    return load();
}

module.exports = { loadProvider };
