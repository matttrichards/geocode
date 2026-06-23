# geo7 — development notes

## Running the local preview

The app is static (HTML + ES modules + Leaflet). ES modules and the service
worker need HTTP — opening `index.html` from `file://` won't work. From the repo
root:

```bash
python3 -m http.server 8765
```

Then open http://localhost:8765/. Useful entry points:

- Cold open (manual entry): `http://localhost:8765/`
- Resolved shared link: `http://localhost:8765/?c=CR&code=he55v3&n=Gate%20on%20the%20left`
- Not found: `http://localhost:8765/?c=CR&code=999` (wrong length) or `?c=ZZ&code=he55v3`

## Service worker & caching (read this if you see stale changes)

`sw.js` is a cache-first service worker for offline/PWA support. In production it
makes the app load instantly and work offline — but during development it will
happily serve **old, cached** copies of `index.html` / `app.js` / `style.css`,
which makes edits look like they "didn't take."

**This is handled automatically now:** `app.js` skips service-worker
registration on `localhost` / `127.0.0.1` and actively unregisters any existing
worker and clears its caches. So local development always serves fresh assets
straight from the dev server — no manual cache-busting needed.

If you ever test on a non-localhost host (a LAN IP, a staging domain) and see
stale content, either:

- Open Chrome DevTools → **Application → Service Workers**, check **"Update on
  reload"** and/or **"Bypass for network"** (these persist while DevTools is
  open), or
- Click **Unregister** there and hard-reload (Cmd+Shift+R / Ctrl+Shift+R).

**When you change anything cached for production**, bump `CACHE_NAME` in `sw.js`
(currently `geo7-v99`). The `activate` handler deletes old caches, so bumping the
version forces returning production users onto the new assets.

## File layout

```
index.html        # app shell: map + top chrome (search) + bottom sheet + overlays
manifest.json     # PWA manifest
sw.js             # service worker (production caching)
css/style.css     # all styles; design tokens are CSS vars in :root
js/codec.js       # base-28 geo7 codec — DO NOT EDIT (ported from the Python codec)
js/app.js         # all app logic
```

## Map interaction (added beyond the original design handoff)

The original "code → directions" design handoff intentionally stripped the app
down to a recipient-first trust-and-handoff page (no map search, no tap-to-select).
The following Google-Maps-style interactions were added on top of that, at the
founder's request — the recipient link-resolution flow is unchanged:

- **Search/address bar** (top): type to search places (Nominatim); it also
  auto-fills with the address of whatever point is currently selected.
- **Left-click the map**: drops a pin, encodes the point to a geo7 code,
  reverse-geocodes the place name, and shows a "Dropped pin" card with
  Get directions / Share / Copy code.
- **Right-click the map**: context menu with the coordinates (tap to copy),
  What's here?, Directions to here, Share this location, Copy geo7 code.
- **Collapsible bottom sheet**: tap or drag the grab handle to minimize the sheet
  to a peek (so the map is free to navigate); it auto-expands when a new point is
  selected.

If the design spec (`README` from the design bundle) is restored, fold these
behaviors back into it so the spec and code don't drift.
