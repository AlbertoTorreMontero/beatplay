# BeatPlay

Juegos musicales con tus playlists, para jugar solo o con amigos.

| Juego | Qué es |
|---|---|
| **Intro** | Adivina la canción con su primer segundo. Si no, se desbloquea un poco más (1, 2, 4, 7, 11 y 16 s). Cuanto antes, más puntos; si fallas la última, se acaba la racha. |
| **Pulsador** | Multijugador (hasta 20): la canción suena en el dispositivo del anfitrión y todos adivinan desde su móvil, sin cuenta. Un minuto por canción; quien acierta antes suma más. Fallar no resta. |
| **Snake** | Cada portada que comes cambia la canción. En modo **Synth** la serpiente acelera a lo largo de la canción y el tablero toma el color de la portada. |
| **Bingo** | Genera cartones (3 × 9, 15 canciones) con la playlist entera, imprímelos y usa *Cantar* para poner la música en orden aleatorio. |
| **Hipster** | Escucha una canción y colócala en su año dentro de la línea temporal. Con tu playlist o con la selección oficial. |
| **Music Roulette** | Multijugador (hasta 10): cinco portadas de la playlist de alguien, quince segundos para adivinar de quién es. |

## Cómo entra cada usuario

Spotify solo deja 5 cuentas por app en *Development Mode*, así que cada usuario usa **su propia app de Spotify**:

1. La primera vez, la pantalla de login le guía (unos 3 minutos): crea una app en el panel de desarrolladores,
   pega la Redirect URI que le mostramos y copia su Client ID en BeatPlay.
2. BeatPlay entra con PKCE (sin secreto) usando ese Client ID. Cada uno es el único usuario de su app, así que el
   límite no le afecta. Hace falta Premium (Spotify lo exige para crear apps y para el reproductor).
3. El navegador recuerda el Client ID, y el servidor lo asocia a su cuenta para entrar desde otro dispositivo
   escribiendo su usuario o email.

Si configuras `SPOTIFY_CLIENT_ID` y `SPOTIFY_CLIENT_SECRET`, tus 5 cuentas autorizadas pueden entrar con la app
compartida sin configurar nada ("Estoy en la lista de amigos").

**Partidas en grupo:** solo quien pone la música necesita cuenta. En Music Roulette, los invitados entran sin cuenta
con el enlace de la sala y eligen su playlist pegando su enlace público (se lee de la página pública de Spotify,
sin API; es una vía no oficial).

## Ejecutarlo en local

Requisitos: Node.js 20 o superior.

```bash
npm install
cp .env.example .env      # y rellena las credenciales
npm start                 # o npm run dev para reiniciar al guardar
```

Abre **http://127.0.0.1:3000**. Spotify no acepta `localhost` como Redirect URI: registra
`http://127.0.0.1:3000/callback`. Si entras por `localhost`, el servidor te redirige a `127.0.0.1`.

Mientras la app esté en *Development Mode*, Spotify solo deja entrar a las cuentas añadidas en
*Dashboard → User Management* (máximo 25). Cada amigo inicia sesión con su propia cuenta.

## Llamadas a la API: las mínimas

Regla del proyecto: todo se hace con el menor número posible de llamadas a la API de Spotify
(en *Development Mode* limita enseguida).

- El perfil se guarda al iniciar sesión; `/api/me` no llama a Spotify.
- Playlists y canciones se cachean por usuario 30 minutos. El total de canciones sale de esa caché o de la
  primera página: no hay llamada aparte.
- Una muestra (Snake, Roulette) es una sola página; Hipster, dos como mucho.
- Cada canción se pide por la API (una llamada, la canción exacta: es lo único fiable). Si llegan varias
  seguidas solo se pide la última, con al menos 1 s entre llamadas. Pausar, reanudar, buscar y repetir la
  misma canción lo hace el SDK del navegador, sin API.
- La selección oficial de Hipster se guarda en disco y la comparten todos.
- Si Spotify responde 429, el servidor no vuelve a llamarle hasta que pasa la espera que indica.

## Estructura

```
src/
  server/
    index.js             Punto de entrada (npm start)
    config.js            Variables de entorno
    app.js               Express: páginas, login y API
    session.js           Sesión cifrada en la cookie (sobrevive a reinicios) y renovación de tokens
    accounts.js          Correo → Client ID de cada persona (Upstash Redis o data/accounts.json)
    library.js           Caché y muestras aleatorias de playlists (independiente del servicio)
    routes/              auth.js (login) y api.js (/api/*)
    providers/           Adaptadores de servicios de música: index.js (interfaz) y spotify.js
    rooms/               Salas online: hub.js (código, entrar, reconexión), roulette.js y buzzer.js (reglas
                         de cada juego) y socket.js (WebSocket)
  client/
    landing/             Portada (/)
    app/                 Menú y controlador de la app (/app)
    games/<juego>/       HTML, CSS y JS de cada juego (módulos ES)
    lib/                 api.js, ui.js, playlists.js, room.js (conexión a salas), song-search.js
                         (buscador para responder) y player/ (reproductor)
    styles/              tokens.css (colores, tipos, espacios) y base.css (componentes)
    assets/fonts/        Fuentes alojadas en el propio servidor
test/                    Tests de integración y Spotify simulado
```

## Cambiar de servicio de música

Los juegos no saben qué servicio hay detrás: usan un modelo de canción neutro
(`{ id, ref, name, artist, album, year, cover, preview }`) y dos interfaces.

1. **Servidor:** crea `src/server/providers/<nombre>.js` con la interfaz descrita en
   `providers/index.js` (login, perfil, playlists, páginas de canciones) y regístralo allí.
2. **Cliente:** el reproductor es el Web Playback SDK (`lib/player/spotify-sdk.js`). Otro servicio
   necesita su propio adaptador con la misma forma, usado desde `player/index.js`.
3. Pon `MUSIC_PROVIDER=<nombre>` en el `.env`.

## Desplegarlo (Render)

1. *New → Web Service* con este repositorio. Build: `npm install`. Start: `npm start`.
2. Variables de entorno: las de `.env.example`, con `SPOTIFY_REDIRECT_URI=https://TU-APP.onrender.com/callback`.
3. Si usas la app compartida, añade esa misma Redirect URI en su Dashboard.
4. Para que "Ya estoy registrado" funcione tras reinicios: crea una base gratis en Upstash (Redis)
   y añade `UPSTASH_REDIS_REST_URL` y `UPSTASH_REDIS_REST_TOKEN`.
5. *Health check path*: `/healthz`.

La sesión va cifrada en la cookie: reiniciar o dormir el servicio no obliga a volver a entrar.
Las salas sí viven en memoria: si el servicio se reinicia, las salas abiertas se pierden.

La música suena siempre en la web (Web Playback SDK, Premium). En móviles Spotify no lo soporta
oficialmente: la música se pone desde un ordenador y los demás juegan desde el móvil.

## Notas sobre Spotify

- Spotify retiró *audio features* y *audio analysis* para las apps nuevas, así que no hay tempo ni
  beats: el modo Synth usa la posición real de la canción y el color de la portada.
- Solo se pueden leer playlists propias o colaborativas.
- Music Roulette no reproduce audio a propósito: las condiciones de Spotify no permiten sincronizar
  sus grabaciones con contenido visual.

## Tests

```bash
npm test
```

Arranca el servidor con Spotify simulado (`test/mock-spotify.js`) y comprueba sesiones, OAuth,
renovación de token, caché, Hipster y la partida completa de Music Roulette con reconexión.
