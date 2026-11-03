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
 *   setup                          datos para la pantalla de login (p. ej. si cada usuario usa su propia app)
 *   startLogin(query)              -> login   datos que se guardan hasta la vuelta del login
 *   authorizeUrl(state, login)     URL a la que mandar al usuario para iniciar sesión
 *   exchangeCode(code, login)      -> tokens  { accessToken, refreshToken, expiresAt, clientId?, ownApp? }
 *   refresh(tokens)                -> tokens  renovados
 *   getProfile(token)              -> { id, name, email }
 *   listPlaylists(token)           -> [{ id, name, owner, image, tracks }]
 *   getTrackPage(token, id, offset)-> { total, tracks }   el total viene en la misma llamada
 *   readPublicPlaylist?(url)       -> { name, tracks }  playlist pública sin iniciar sesión (invitados)
 *   controls?: { play, transfer, pause, resume, seek }   si el reproductor del cliente necesita al servidor
 *   listDevices?(token)            -> [{ id, name, type, active }]  dispositivos (Spotify Connect, móvil)
 *
 * Una canción ("track") siempre tiene esta forma, venga del servicio que venga:
 *   { id, ref, name, artist, album, year, cover, preview, duration }
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
