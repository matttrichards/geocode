# geocode — short, shareable location codes
You can play around with a simple UI I built for it here: https://geoloc.cc/

Feel free to build your own UI!

A geocode code turns a precise point on Earth into a short, human-shareable string
like `h3xex8`, and back — with **no server, no database, and no central
authority**. The mapping is a pure function of published constants, so anyone can
compute the same codes offline, in any language, or on paper.

```
CR/h3xex8   →  9.92817, -84.09071   (a ~18 m cell in San José, Costa Rica)
```

- **Permissionless & permanent.** Nothing to run or shut down; a code resolves to
  the same point forever.
- **Short.** A human-known region prefix (`CR`, `US-AK`) carries the country for
  free, so the code itself is just 6–8 characters.
- **Precise.** ~18 m cells — enough to pinpoint a doorway.
- **Offline.** Encoding/decoding needs only this repo.

## How it works (in one paragraph)

Each region is a frozen bounding box tiled into ~18 m cells. A code is just the
cell's index written in a 28-character alphabet. The grid dimensions for every
region are **precomputed and frozen** in `regions.v1.json`, so the encode/decode
path uses only exact integer arithmetic — guaranteeing bit-identical codes across
every implementation. Full definition in **[docs/SPEC.md](docs/SPEC.md)**.

## Usage (JavaScript)

```js
import { encode, decode } from "./js/codec.js";

encode(9.9281, -84.0907, "CR").code;   // "h3xex8"
decode("h3xex8", "CR");                 // { lat: 9.92817, lon: -84.09071 }
```

## Repository layout

| Path | What |
|---|---|
| `docs/SPEC.md` | The complete, frozen specification |
| `regions.v1.json` | Frozen region table — boxes, cell counts, names (271 regions) |
| `js/codec.js` | Reference codec (encode / decode / precision) |
| `js/regions.gen.js` | Generated mirror of `regions.v1.json` |
| `tools/gen-regions.mjs` | Regenerates the region table from Natural Earth |
| `index.html`, `js/app.js`, `css/`, `sw.js` | The reference PWA |

## Test vectors

Any conforming implementation must reproduce these exactly (see SPEC §7):

```
encode(9.9281,  -84.0907,  "CR")    -> "h3xex8"
encode(38.8895, -77.0353,  "US")    -> "23yuvwf0"
encode(52.5200,  13.4050,  "DE")    -> "2m8pw3v"
encode(35.6762, 139.6503,  "JP")    -> "0ncy6pn7"
encode(61.2181, -149.9003, "US-AK") -> "0txm1rr2"
encode(4.9227,  -52.3269,  "FR-GF") -> "p0fmhj"
```

## Status

**Frozen — v1 (2026-06-23).** The constants and region boxes are immutable; any
future change requires a new version under a new namespace (SPEC §9).

## Prior art

geocode is in the family of open, deterministic geocoding grids. The closest is
Google's [Open Location Code / Plus Codes](https://github.com/google/open-location-code)
(Apache-2.0). See SPEC §10 for an honest comparison.

## License

- **Code** (`js/codec.js`, `js/app.js`, `tools/`, `sw.js`, …): Apache License 2.0 —
  see [`LICENSE`](LICENSE).
- **Specification & region data** (`docs/SPEC.md`, `regions.v1.json`,
  `js/regions.gen.js`): public domain under CC0 1.0 — see [`LICENSE-CC0`](LICENSE-CC0).

Use it for anything, forever, without permission.
