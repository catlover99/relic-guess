# Architecture

## Shape

A static single-page app with no backend, plus an offline ingestion pipeline that
produces the one data file the app reads.

```
scripts/                      Node, run by hand or in CI. Never ships to the browser.
├── ingest.ts                 Orchestrator: harvest → filter → dedupe → report → write
├── basemap.ts                Natural Earth → the guessing map (countries, capitals)
├── providers/                One adapter per source, each emitting Artifact[]
│   ├── wikidata.ts           SPARQL, two passes (findspot / creation place)
│   ├── met.ts                REST, department-weighted sampling
│   ├── cma.ts                REST, CC0-only records
│   └── aic.ts                Search for ids → batch fetch with place qualifiers
└── lib/
    ├── http.ts               Retry, timeout, bounded concurrency, on-disk cache
    ├── gazetteer.ts          Pleiades + curated + Wikidata place resolution
    ├── places.curated.ts     Hand-checked ancient places and country centroids
    ├── geoTiers.ts           Coordinate tier → confidence + uncertainty
    ├── quality.ts            Rejection rules, quality score, fame score
    ├── dedupe.ts             Within- and cross-provider duplicate removal
    └── text.ts               HTML stripping, summarising, title normalisation

public/data/artifacts.json    The artifact collection.
public/data/basemap.json      The guessing map: countries, lakes, capitals.

src/
├── data/schema.ts            The normalized Artifact model + runtime validation.
│                             The single contract between scripts/ and src/.
├── game/                     Pure logic, no React
│   ├── geo.ts                Haversine, bearing, great-circle segments
│   ├── scoring.ts            Forgiving stretched-exponential curve with tolerance
│   ├── share.ts              The spoiler-free result block
│   ├── selection.ts          Diversity-constrained round selection, difficulty
│   ├── regions.ts / eras.ts  Macro-region and era classification
│   ├── random.ts             Seeded PRNG (daily challenge, reproducible tests)
│   ├── persist.ts            localStorage profile, guarded against failure
│   └── store.ts              zustand store: the game state machine
├── components/
│   ├── map/                  Vanilla Leaflet + the Natural Earth atlas layer
│   ├── screens/              Start, Round, Summary
│   ├── ui/                   Button, Panel, Chip, Dialog, Skeleton…
│   └── …                     ArtifactImage, ClueList, RevealPanel, ScoreReveal
├── hooks/                    useMediaQuery, useResolvedTheme
└── styles/index.css          Design tokens + base + utilities
```

## Decisions

### No backend, and no third-party requests at play time

Every artifact, description, coordinate and licence string is resolved at build
time and baked into `public/data/artifacts.json` (~5.8 MB, ~610 KB gzipped, one
cached request).

This replaced a design that fetched `/artifacts.json`, parsed and shuffled it on
every load, and then made a **live Wikipedia REST call per round** with no
cancellation — so a slow response could overwrite a newer round's text. Prebaking
removes an entire class of failure: museum API outages, rate limits, and races
cannot affect a session that is already running, and round transitions need no
network at all.

The cost is that new artifacts require a rebuild. For a dataset that changes on the
order of months, that is the right trade.

### Vite + React, in TypeScript

Vite and React were already here and are a good fit; both were kept. The move to
TypeScript was not cosmetic — the ingestion pipeline and the game share one
`Artifact` type, and that shared contract is what makes it safe to add a provider
adapter without reading the UI.

### A baked Natural Earth basemap, not a tile provider

The map is drawn from `public/data/basemap.json` — country outlines, lakes and
national capitals extracted from Natural Earth at build time — rather than fetched
from a tile server. Players reported two problems that no keyless raster provider
can fix:

- **Place names appeared in the local language.** Someone who cannot read Greek
  was shown "Ελλάδα", which defeats a game about identifying countries.
- **Labels were unreadable on a phone.** OSM bakes ~11px text into a tile, and
  Leaflet's `detectRetina` then draws it at half scale.

Every alternative was evaluated and rejected on its own terms: Wikimedia's
`osm-intl` translates but its policy limits the tiles to Wikimedia-hosted sites;
Esri's keyless raster basemaps are legacy endpoints Esri documents as removable
without notice, with no clear commercial licence; vector tiles (OpenFreeMap and
similar) solve language and clutter but ship 0.6–1.5 MB _per tile_ at the zooms
this game opens at.

Natural Earth is public domain, carries `NAME_EN` and cartographer-placed label
anchors, and contains no roads, shops or transit to strip out. The whole world is
747 KB — 274 KB gzipped, cached once. Consequences:

- **Clutter is impossible rather than filtered.** There is no POI layer to hide.
- **Label size and density are ours.** Country names are DOM text, so a phone gets
  _larger_ type (15px vs 13px), crisp at any device pixel ratio, and Natural
  Earth's own `MIN_LABEL`/`MAX_LABEL` decide what is worth naming at each zoom.
- **No runtime third-party dependency**, rate limit, tile-usage policy or
  attribution obligation — the credit shown is a courtesy.
- **Dark mode needs no filter hack.** Geometry is painted from CSS custom
  properties (canvas ignores `className`, so the tokens are read via
  `getComputedStyle` and re-read on theme change).

Geometry goes through Leaflet's own canvas renderer and labels are `divIcon`
markers, so none of Leaflet's pan/zoom bookkeeping is reimplemented.

### Vanilla Leaflet, not react-leaflet

`react-leaflet` was removed. Three things the game needs are awkward through it and
direct with the imperative API:

1. **Drag-versus-tap discrimination.** Placement is driven by raw `pointerdown` /
   `pointerup` with a 12px movement threshold, because on touch devices a short pan
   still synthesises a click — which in the previous version dropped a guess pin in
   the ocean every time the player tried to scroll the map.
2. **Keyboard placement.** The map container is focusable; arrows pan, `+`/`-` zoom,
   and Enter places the pin at the viewport centre.
3. **`fitBounds` with asymmetric padding**, so a revealed marker never lands under
   the action bar.

Leaflet also stays out of the entry bundle entirely (see chunking below).

### Tailwind v4 via PostCSS, not the Vite plugin

The project previously carried three overlapping styling systems: Vite's default
dark-mode boilerplate, Tailwind v3 `@tailwind` directives (no-ops under v4), a v3
`tailwind.config.js` that v4 ignores, and an unused shadcn neutral-grey token set.
All of it is gone, replaced by one token layer in `styles/index.css` using v4's
`@theme`.

Tailwind is wired through **PostCSS** rather than `@tailwindcss/vite`. The Vite
plugin loads without error in this environment but never compiles: Vite's own
`@import` inlining resolves `@import "tailwindcss"` first, and the output ends up
containing Tailwind's raw `@theme default` block with **zero generated utilities** —
a failure that produces a page with every class name present and no styles at all.
The PostCSS integration is unaffected. `@source` globs are declared explicitly for
the same reason: the automatic crawler returns an empty candidate set on this
mounted Windows filesystem.

### Scoring is forgiving on purpose

`5000 · e^(−(d/2500)^1.35)`. The original was a plain exponential with a 1,500 km
scale, which charged 28% of a round for a 500 km miss — but 500 km is _inside_
several of the cultural regions the game asks about. The exponent above 1 flattens
the curve through the first few hundred kilometres and keeps the far tail steep, so
a wrong-continent guess still scores single digits.

| km     | old   | new   |
| ------ | ----- | ----- |
| 250    | 4,232 | 4,782 |
| 500    | 3,583 | 4,462 |
| 1,000  | 2,567 | 3,740 |
| 2,000  | 1,318 | 2,386 |
| 5,000  | 178   | 391   |
| 10,000 | 6     | 8     |

On top of the curve, two independent radii are forgiven, and the reveal says which
one applied: the coordinate's own `uncertaintyKm` (the museum's record is vague)
and the mode's `toleranceKm` (the game only ever asked for the region).

### Heartland and findspot are separate geographic facts

An artifact used to carry one coordinate whose `kind` said whether it was a
findspot, a production place or a cultural centre. That made them alternatives, so
a reveal could say where an object was dug up _or_ describe the region the guess
was graded against — never both.

`Artifact.heartland` is now a separate field alongside `origin`:

| Field       | Claim                                        | Example                               |
| ----------- | -------------------------------------------- | ------------------------------------- |
| `origin`    | where _this object_ was found or made        | Milos, Greece                         |
| `heartland` | where the _culture that made it_ was centred | the Aegean Greek world, 380 km radius |

`game/geography.ts` is the single place that turns those into a round. It answers
three questions — what was scored, what should be pinned as the object's own
location, and whether the two differ — and the map, the reveal panel and the
scorer all read that one answer rather than deriving their own.

A revealed Heartland round therefore shows three distinct things, never collapsed
into one marker: the guess (teardrop pin), the scored region (flag plus a circle
whose radius _is_ the scoring rule, always drawn), and the object's own findspot
(surveyor's stake), when the record has one that is genuinely artifact-specific.
The distance line connects the guess to the scored centre only — nothing was
measured to the findspot, and a line would say otherwise.

### Modes set precision, not just clue count

**Heartland** is the default and the daily challenge's mode, and it grades against
the culture's homeland rather than the object's own findspot — a different
question, not a looser version of the same one. Artifacts whose culture the curated
table does not cover fall back to their own recorded place. Most objects in the
collection have no findspot at all — the honest question for them is "where was
this culture centred", which is a question about a region a few hundred kilometres
across — so Heartland forgives 300 km, Scholar 120 km, and Expert scores against
the recorded coordinate itself. Demanding trench-level precision by default was
punishing players for the dataset's own imprecision.

### zustand for game state

The game is a state machine (`loading → menu → playing → revealed → summary`). The
store holds it as plain functions over plain data, with no React in the file, so
`store.test.ts` drives a whole five-round session and asserts on transitions
directly. Selectors keep re-renders scoped — the map does not re-render when the
score animates.

### Code splitting by screen

`src/app/lazyScreens.ts` dynamically imports the round and summary screens. Leaflet
and framer-motion follow the import graph into the round chunk, so the landing page
ships ~80 KB gzipped instead of ~170 KB. The landing screen then warms both chunks
on mount, so the lazy boundary never actually shows a fallback in practice.

A `manualChunks` map was tried first and silently produced no split; following the
real import graph is both simpler and more reliable.

### Photographs are verified before selection, not after

The photograph _is_ the round: an artifact whose image will not load cannot be
guessed at, so a broken image has to make the artifact ineligible rather than
produce an error in the round. An image URL can be dead in three different senses,
and the app tracks them separately:

| State                      | Meaning                                                                  | Where              |
| -------------------------- | ------------------------------------------------------------------------ | ------------------ |
| **URL present**            | A provider returned a string. No evidence it resolves to anything.       | `image.url`        |
| **Verified during ingest** | It answered with real image bytes from the build machine, at build time. | `image.verifiedAt` |
| **Verified this session**  | It loaded and decoded in _this_ player's browser, on their network.      | `imageValidation`  |

Only the third makes a round playable. Ingest verification (`scripts/lib/verifyImages.ts`)
uses a ranged GET and checks the magic bytes — a 200 carrying an HTML error page is
the classic hotlink failure — and caches verdicts on disk, so a re-run costs nothing
for images already checked. It cannot catch images that die afterwards, because CDN
URLs expire and hotlink policy changes, hence the runtime layer.

Runtime validation (`src/game/imageValidation.ts`) uses `new Image()` plus `decode()`
with a timeout, never `fetch`/`HEAD`: museum CDNs commonly serve images without
CORS headers, so a fetch would reject images an `<img>` displays perfectly. Verdicts
are memoised per URL for the tab's lifetime. Each artifact carries ordered fallback
renditions in `image.alternates`; `thumbUrl` is deliberately excluded, since a
400 px thumbnail is not a playable photograph.

`buildSession` (`src/game/session.ts`) then does filtering and seeded ordering
_first_, verifies candidates in fixed-size chunks along that order, and writes
results back into an index-aligned array. The daily challenge depends on this:
selecting five and substituting the broken ones would give two players different
puzzles for the same date, and collecting results in completion order would make the
puzzle depend on which CDN answered first. Chunk size is a constant rather than the
concurrency for the same reason — a faster client must not see a larger verified
pool at its first selection attempt.

If a verified image still dies mid-round, `findReplacement` swaps in another
artifact and the round is not counted; if the pool cannot yield five playable
rounds, the session fails with a recoverable message rather than a broken one.

### One structural breakpoint, chosen by area

The round screen has two layouts, selected with `matchMedia`:

- **Split** — `(min-width: 64rem)` **or** `(min-width: 40rem) and (max-height: 34rem)`.
  Artifact panel in a column, map in the rest, nothing overlapping.
- **Stacked** — everything else. A vertical flex column: header, collapsible
  artifact card, map (`flex-1`), action bar.

The second clause of the split query matters: a phone in landscape (844×390) is
below the width breakpoint, and stacking on it leaves the map about 50 pixels tall.

Both layouts are sized in `dvh` and use `env(safe-area-inset-*)` padding, so a
collapsing mobile toolbar resizes the map rather than pushing the primary button
off-screen, and nothing sits under a notch. Because the stacked layout is a flex
column rather than absolute overlays, the map is never covered and the action bar is
always reachable — no fixed-position or z-index games.

## Data flow

```
providers ──► Artifact[] ──► rejectArtifact() ──► verifyArtifactImages() ──► dedupe()
                             (quality gate)      (dead photos dropped)      (best kept)
                                                                    │
                                                                    ▼
                                                             artifacts.json
                                                                    │
                                                                    ▼
                                            parseBundle() drops invalid records
                                                                    │
                                                                    ▼
                          orderCandidates() ── filter + seeded order (deterministic)
                                                                    │
                                                                    ▼
                        resolveArtifactImage() ── photographs confirmed in the browser
                                                                    │
                                                                    ▼
                            pickDiverseRounds() ── 5 diverse, playable artifacts
                                                                    │
                                                                    ▼
                            setGuess → submitGuess → scoreGuess → nextRound
```

`parseBundle` validates at runtime rather than trusting the asset: a bundle can go
stale or be written by a half-failed ingest, and dropping one bad record is better
than crashing a live session.

## Testing

| Layer      | Tool       | What it covers                                                                                                                                                    |
| ---------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pure logic | Vitest     | Distance, bearing, antimeridian splitting, scoring curve and tolerance, selection diversity and determinism, era/region classification                            |
| Pipeline   | Vitest     | Coordinate tier→confidence mapping, rejection rules, fame/quality scores, deduplication rules, place-key normalisation                                            |
| Store      | Vitest     | The full state machine, persistence, daily-challenge determinism, load failures                                                                                   |
| Images     | Vitest     | Session assembly with broken photographs: replacement, bounded verification, exhaustion, and determinism under scrambled completion order and varying concurrency |
| Images     | Playwright | Real browser failures — 404, aborted connection, 200-carrying-HTML — never becoming a round, at desktop and mobile sizes                                          |
| End-to-end | Playwright | The whole loop, at eight viewports: start → guess → submit → reveal → score → next → summary                                                                      |
| Layout     | Playwright | Horizontal overflow, touch-target size, primary action in viewport, map share of viewport, image containment, page-level scroll                                   |

The E2E suite stubs the artifact bundle, map tiles and images, so it neither depends
on nor sends traffic to third-party services, and its assertions about scores and
titles are stable regardless of the last ingest.

## Environment

| Variable                                     | Purpose                                                                      |
| -------------------------------------------- | ---------------------------------------------------------------------------- |
| `INGEST_CONTACT`                             | Contact URL/email in the ingest User-Agent. Wikimedia's policy requires one. |
| `VITE_TILE_URL_LIGHT` / `VITE_TILE_URL_DARK` | Override the basemap (e.g. to a keyed provider).                             |
| `VITE_TILE_ATTRIBUTION`                      | Attribution HTML matching that provider.                                     |
| `VITE_TILE_SUBDOMAINS`                       | Subdomain rotation for `{s}` in the tile URL.                                |

No secrets are needed to build or run: every integrated source is keyless.
