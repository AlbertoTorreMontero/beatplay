# BeatPlay

Juegos musicales con tus playlists, para jugar solo o con amigos.

| Juego | Qué es |
|---|---|
| **Snake** | Cada portada que comes cambia la canción. En modo **Synth** la serpiente acelera a lo largo de la canción y el tablero toma el color de la portada. |
| **Bingo** | Genera cartones (3 × 9, 15 canciones) con la playlist entera, imprímelos y usa *Cantar* para poner la música en orden aleatorio. |
| **Hipster** | Escucha una canción y colócala en su año dentro de la línea temporal. Con tu playlist o con la selección oficial. |
| **Music Roulette** | Multijugador (hasta 10): cinco portadas de la playlist de alguien, quince segundos para adivinar de quién es. |

## Ejecutarlo en local

Requisitos: Node.js 20 o superior y una app en el [Dashboard de Spotify](https://developer.spotify.com/dashboard)
(Web API + Web Playback SDK). Para que suene la música hace falta **Spotify Premium**.

```bash
npm install
cp .env.example .env      # y rellena las credenciales
npm start                 # o npm run dev para reiniciar al guardar
```

Abre **http://127.0.0.1:3000**. Spotify no acepta `localhost` como Redirect URI: registra
`http://127.0.0.1:3000/callback`. Si entras por `localhost`, el servidor te redirige a `127.0.0.1`.

Mientras la app esté en *Development Mode*, Spotify solo deja entrar a las cuentas añadidas en
*Dashboard → User Management* (máximo 25). Cada amigo inicia sesión con su propia cuenta.

## Estructura

```
src/
  server/
    index.js             Punto de entrada (npm start)
    config.js            Variables de entorno
    app.js               Express: páginas, login y API
    session.js           Sesiones por navegador (cookie) y renovación de tokens
    library.js           Caché y muestras aleatorias de playlists (independiente del servicio)
    routes/              auth.js (login) y api.js (/api/*)
    providers/           Adaptadores de servicios de música: index.js (interfaz) y spotify.js
    roulette/            game.js (salas y reglas) y socket.js (WebSocket)
  client/
    landing/             Portada (/)
    app/                 Menú y controlador de la app (/app)
    games/<juego>/       HTML, CSS y JS de cada juego (módulos ES)
    lib/                 api.js, ui.js, playlists.js y player/ (reproductor)
    styles/              tokens.css (colores, tipos, espacios) y base.css (componentes)
    assets/fonts/        Fuentes alojadas en el propio servidor
test/                    Tests de integración y Spotify simulado
```

## Cambiar de servicio de música

Los juegos no saben qué servicio hay detrás: usan un modelo de canción neutro
(`{ id, ref, name, artist, album, year, cover, preview }`) y dos interfaces.

1. **Servidor:** crea `src/server/providers/<nombre>.js` con la interfaz descrita en
   `providers/index.js` (login, perfil, playlists, páginas de canciones) y regístralo allí.
2. **Cliente:** el proveedor indica qué reproductor usar (`playback`). Si el servicio da audios de
   muestra, `preview` ya funciona con cualquier URL. Si tiene SDK propio, crea
   `src/client/lib/player/<nombre>.js` siguiendo `player/index.js`.
3. Pon `MUSIC_PROVIDER=<nombre>` en el `.env`.

## Desplegarlo (Render)

1. *New → Web Service* con este repositorio. Build: `npm install`. Start: `npm start`.
2. Variables de entorno: las de `.env.example`, con `SPOTIFY_REDIRECT_URI=https://TU-APP.onrender.com/callback`.
3. Añade esa misma Redirect URI en el Dashboard de Spotify.
4. *Health check path*: `/healthz`.

Las sesiones y las salas viven en memoria: si el servicio se reinicia o se duerme (plan gratuito),
hay que volver a iniciar sesión y las salas abiertas se pierden.

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
