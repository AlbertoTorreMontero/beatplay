# BeatPlay

Juegos musicales sobre tus playlists de Spotify, para jugar con amigos.

| Juego | Qué es |
|---|---|
| **Snake** | Cada portada que comes cambia la canción. Modo **Clásico** y modo **Synth** (ver abajo). |
| **Bingo** | Genera cartones con las canciones de una playlist. |
| **Hipster** | Escucha una canción y colócala en su año dentro de la línea temporal. Con tu playlist o con la oficial. |
| **Music Roulette** | Multijugador (hasta 10): cinco portadas de la playlist de alguien, quince segundos para adivinar de quién es. |

## Requisitos

- Node.js 20 o superior.
- Una app en el [Dashboard de Spotify](https://developer.spotify.com/dashboard) (Web API + Web Playback SDK).
- **Spotify Premium** para reproducir música (lo exige el Web Playback SDK).
- Mientras la app esté en *Development Mode*, Spotify solo deja entrar a las cuentas que añadas en
  *Dashboard → User Management* (máximo 25). **Cada amigo inicia sesión con su propia cuenta.**

## Ejecutarlo en local

```bash
npm install
cp .env.example .env      # y rellena las credenciales
npm start
```

Abre **http://127.0.0.1:3000**. Spotify no acepta `localhost` como Redirect URI: registra
`http://127.0.0.1:3000/callback` en el Dashboard. Si entras por `localhost`, el servidor te
redirige a `127.0.0.1` para que la cookie de sesión funcione.

## Desplegarlo (Render)

1. *New → Web Service* con este repositorio. Build: `npm install`. Start: `npm start`.
2. Variables de entorno: `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REDIRECT_URI`
   (`https://TU-APP.onrender.com/callback`) y, si quieres Hipster Global, `HIPSTER_PLAYLIST_ID`.
3. Añade esa misma Redirect URI en el Dashboard de Spotify.
4. *Health check path*: `/healthz`.

Las sesiones y las salas viven en memoria: si el servicio se reinicia o se duerme (plan gratuito),
hay que volver a iniciar sesión y las salas abiertas se pierden.

## Modo Synth de Snake

Spotify retiró los endpoints de *audio features* y *audio analysis* para las apps nuevas, y el
SDK no expone el audio, así que **no hay tempo ni beats disponibles**. Synth usa solo datos reales:

- la **posición y duración** de la canción que suena (Web Playback SDK): la serpiente acelera a lo
  largo de cada canción y una barra sobre el tablero muestra el avance;
- el **color de la portada** (se muestrea la imagen real): rejilla, cabeza y comida lo toman.

## Music Roulette entre dispositivos

- Cada jugador lee sus playlists con su propia sesión y solo manda a la sala portada, título y artista.
- "Copiar enlace" genera `/app#sala=CODIGO`: quien lo abre entra directo (tras iniciar sesión).
- Si un móvil pierde la conexión o descarta la pestaña, vuelve a su sitio con un token
  (30 s de margen antes de ser expulsado).

## Tests

```bash
npm test
```

Arranca el servidor con Spotify simulado (`test/mock-spotify.js`) y comprueba sesiones, OAuth,
caché, Hipster y la partida completa de Roulette con reconexión.

## Estructura

```
server.js              Express + WebSocket (Roulette) + OAuth con Spotify
public/
  landing/             Portada
  app/                 Menú y controlador de la app
  games/<juego>/       HTML, CSS y JS de cada juego
  lib/                 Sesión, reproductor, playlists y utilidades compartidas
test/                  Tests de integración y mock de Spotify
```
