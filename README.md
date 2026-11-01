# Tambayan

A little 3D multiplayer world to hang out in. It runs in the browser, on a phone or a PC.

**Play it: https://seirios-aster.github.io/My-World/**

On a phone, open the link in Chrome or Safari (not inside Messenger or Facebook, because Google sign-in does not work there), and play in landscape. You can add it to your Home Screen to play full screen.

## What's in it

- A town and its surroundings with a day and night cycle, a real star sky with constellations, weather, and seasonal looks (Christmas town in the second half of December, Halloween).
- Other players, chat and emoji, with a character menu for your look.
- Background music (day, night and beach) and ambient sounds. The game master (GM) can set the playlists.
- Tools for the GM: the game clock and time zone, weather, music, and who is online.

## How it is built

- The game is `index.html` (the page), `style.css` (the look), `textures.js` (the built-in textures) and `game.js` (all the game code), written with [three.js](https://threejs.org/) (loaded from a CDN).
- `sw.js` is the service worker and `manifest.json` makes it installable.
- `models/` and `assets/` hold the 3D models and the music. `chibi_*.glb` are the character models.
- Accounts, saved characters and multiplayer use [Supabase](https://supabase.com/) (Google sign-in only).

## Run it locally

Serve the folder with any static server, for example `python3 -m http.server`, then open `http://localhost:8000`.

## Deployment

Pushing to `develop` deploys the site to GitHub Pages through `.github/workflows/static.yml`. The workflow copies the game files and writes `assets/music.json`, the list of songs the game plays. New songs only need to be added to `assets/`.

## Supabase setup

The game keeps working without these, but some features are off until they are run. Run the files in the Supabase SQL editor, in this order (each is safe to run more than once):

1. `supabase-world-clock.sql` (game clock, GM list and settings)
2. `supabase-world-weather.sql`
3. `supabase-profiles.sql` (saved characters)
4. `supabase-gm-tools.sql` (needs the `gm-admin` Edge Function from `supabase/functions`)
5. `supabase-sky-guests.sql` (needs the `sky-pass` Edge Function and a `SKY_PASS` secret)

## Secrets

The key in `index.html` is Supabase's public publishable key, which is meant to be in the page. Access is controlled by row-level security in the database. Never commit a Supabase secret key (`sb_secret_...` or `service_role`), database password or any other private key. Put those in Edge Function secrets instead.
