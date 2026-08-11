# Artifact data sources

Everything below was verified against live endpoints and official licence pages in
August 2026. Anything that could not be verified is marked as such and is **not**
relied on by the pipeline.

## Comparison

| Source                       | Official API / dataset                                                              | Key                             | Fields available                                                                                                                                                                     | Images                       | Coordinates                               | Coordinate quality                                      | Metadata licence                              | Image licence                             | Attribution required    | Rate limits                    | Geographic strengths                                | Historical strengths             | Integration | Priority                        |
| ---------------------------- | ----------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- | ----------------------------------------- | ------------------------------------------------------- | --------------------------------------------- | ----------------------------------------- | ----------------------- | ------------------------------ | --------------------------------------------------- | -------------------------------- | ----------- | ------------------------------- |
| **Pleiades** (gazetteer)     | `atlantides.org/downloads/pleiades/dumps/pleiades-places-latest.csv.gz` + `-names-` | No                              | title, alt names, `reprLat/Long`, `bbox`, `featureTypes`, `locationPrecision`, min/max date                                                                                          | n/a                          | **Yes**                                   | Best available; self-declared precise/rough + real bbox | **CC BY 3.0 US**                              | n/a                                       | **Yes**                 | Static dump                    | Mediterranean + Near East, ancient                  | −1548 → 640 CE typical           | 1           | **1 — mandatory**               |
| **Metropolitan Museum**      | `collectionapi.metmuseum.org/public/collection/v1/`                                 | No                              | `geographyType`, `country`, `region`, `subregion`, `locale`, `locus`, `excavation`, `culture`, `period`, `dynasty`, `medium`, `classification`, `objectBegin/EndDate`, `isHighlight` | Yes, CC0 subset, hotlinkable | No — names only                           | n/a; needs gazetteer                                    | **CC0 1.0**                                   | Public domain where `isPublicDomain`      | Requested, not required | 80 req/s documented            | Egypt/Nubia to trench level; Ancient West Asia good | Pharaonic → medieval             | 2           | **1**                           |
| **Cleveland Museum**         | `openaccess-api.clevelandart.org/api/artworks/`                                     | No                              | **`find_spot`**, `culture[]`, `creation_date_earliest/latest`, `technique`, `type`, `did_you_know`, `description`, `is_highlight`, image dimensions                                  | Yes, CC0 subset              | No                                        | n/a                                                     | **CC0 1.0**                                   | CC0 where `share_license_status == "CC0"` | Not required            | Undocumented; `limit` max 1000 | Egypt, ANE, East Asia, Africa, Americas             | Broad                            | 1           | **1**                           |
| **Wikidata / Commons**       | `query.wikidata.org/sparql`                                                         | No (UA required)                | P189 findspot, P1071 creation, P2596 culture, P186 material, P571 inception, P195 collection, P625 coords, sitelink count                                                            | Commons, per-file licence    | **Yes**                                   | Mixed — must be filtered by place-entity type           | **CC0 1.0**                                   | **Per file — varies**                     | Per Commons file        | 60 s timeout, 5 parallel/IP    | Global                                              | All periods                      | 3           | **1**                           |
| **Art Institute of Chicago** | `api.artic.edu/api/v1/`                                                             | No                              | `place_pivots` (**with qualifier**), `place_of_origin`, `date_start/end`, `medium_display`, `classification_title`, `short_description`, `is_boosted`                                | Yes, CC0 subset, IIIF        | No                                        | n/a                                                     | CC0 1.0, **except `description` = CC BY 4.0** | CC0 where `is_public_domain`              | For description text    | 60 req/min anonymous           | Broad but often country-level                       | Broad, ancient thin              | 1           | **2**                           |
| Victoria & Albert            | `api.vam.ac.uk/v2/`                                                                 | No                              | `placesOfOrigin[]` with `association: made\|found` — the best geographic model of any museum API                                                                                     | Yes, IIIF                    | No                                        | n/a                                                     | **No open licence — bespoke terms**           | Non-commercial only                       | Yes                     | **≤3,000/day, ≤1/s**           | Broad                                               | Broad                            | 2           | **Excluded — see below**        |
| Smithsonian                  | `api.si.edu/openaccess/` + AWS bulk                                                 | **Yes** (free, instant)         | Nested EDAN `freetext` place terms                                                                                                                                                   | CC0 subset                   | No                                        | n/a                                                     | CC0 1.0                                       | CC0 subset                                | No                      | 1,000/hr registered            | Global, NMNH/NMAI                                   | Broad                            | 4           | 3                               |
| Harvard Art Museums          | `api.harvardartmuseums.org`                                                         | **Yes — reviewed request form** | —                                                                                                                                                                                    | —                            | —                                         | —                                                       | Not verified                                  | Not verified                              | —                       | —                              | —                                                   | —                                | 3           | Excluded (no self-serve key)    |
| Europeana                    | `api.europeana.eu`                                                                  | **Yes**; project keys 1–5 days  | Aggregated                                                                                                                                                                           | Per-item `edm:rights`        | No                                        | n/a                                                     | CC0 (**unverified**)                          | Varies                                    | Varies                  | Personal limits being reduced  | Europe                                              | Broad                            | 3           | 4                               |
| Rijksmuseum                  | `data.rijksmuseum.nl` (old API **HTTP 410**)                                        | No                              | Linked Art production place                                                                                                                                                          | CC-BY                        | No                                        | n/a                                                     | CC-BY                                         | CC-BY / PD                                | **Yes**                 | Undocumented                   | Netherlands/Europe                                  | Weak on antiquity                | 4           | 4                               |
| Getty TGN                    | `tgndownloads.getty.edu` (3.49 GB, stale)                                           | No                              | Place hierarchy                                                                                                                                                                      | n/a                          | LOD only — **service degraded (499/504)** | Unverified                                              | ODC-By 1.0                                    | n/a                                       | **Yes**                 | n/a                            | Global                                              | Historical names                 | 4           | Excluded                        |
| Open Context                 | `opencontext.org/query/.json?response=geo-record`                                   | No (UA required)                | Excavation context, GeoJSON geometry, early/late BCE-CE                                                                                                                              | Field photography            | **Yes**                                   | **Sub-metre — best in class**                           | **Varies per project**                        | Varies per project                        | Yes, per project        | Undocumented                   | Italy, Mediterranean, Near East                     | Excavation-grade                 | 3           | 3                               |
| ARIADNE                      | `portal.ariadne-infrastructure.eu/api/search` (**undocumented**)                    | No                              | `spatial[].geopoint`, PeriodO periods, Wikidata country links                                                                                                                        | **Effectively none**         | Yes                                       | Site centroid                                           | Per-provider                                  | n/a                                       | Per provider            | Undocumented                   | Europe-wide                                         | Excellent periodisation          | 4           | 4 (enrichment only)             |
| iDAI.objects Arachne         | `arachne.dainst.org/data/`                                                          | No                              | **`places[].relation = Fundort\|Aufbewahrungsort`, each geocoded**                                                                                                                   | Yes, multi-image             | **Yes**                                   | Gazetteer-backed, site level                            | **Unverified**                                | **Unverified — assume reserved**          | Unknown                 | Undocumented                   | Classical Mediterranean                             | Etruscan/Greek/Roman outstanding | 3           | **Blocked on licensing**        |
| iDAI Gazetteer               | `gazetteer.dainst.org/search.json`                                                  | No                              | coords + **`confidence` 0–3**, `sameAs` → Pleiades/GeoNames                                                                                                                          | n/a                          | Yes                                       | Explicit confidence                                     | Unverified                                    | n/a                                       | Unknown                 | Undocumented                   | Ancient + modern                                    | Ancient strong                   | 2           | 2 (future)                      |
| Louvre                       | `collections.louvre.fr/…/{ark}.json`                                                | No                              | **`placeOfCreation`, `placeOfDiscovery`** (sparsely filled)                                                                                                                          | **© restricted**             | No                                        | n/a                                                     | Not stated                                    | **Not open**                              | Yes                     | Undocumented                   | Egypt, Near East, Classical                         | Excellent                        | 4           | Excluded                        |
| British Museum               | ~~`collection.britishmuseum.org/sparql`~~                                           | —                               | —                                                                                                                                                                                    | —                            | —                                         | —                                                       | —                                             | —                                         | —                       | —                              | —                                                   | —                                | —           | **Dead — connection times out** |
| Portable Antiquities Scheme  | `finds.org.uk`                                                                      | Unknown                         | Findspot, deliberately fuzzed to a 1 km OS grid square (confirmed in their AGPL source)                                                                                              | Yes                          | Yes, **1 km fuzzed**                      | ~380 m mean displacement                                | **Unverified**                                | **Unverified**                            | Unknown                 | Unknown                        | England & Wales                                     | Roman → medieval                 | ?           | **Blocked — Cloudflare 403**    |
| GeoNames                     | `download.geonames.org` (400 MB)                                                    | No                              | Modern settlements                                                                                                                                                                   | n/a                          | Yes                                       | Good for modern places                                  | CC BY 4.0                                     | n/a                                       | Yes                     | Static                         | Global modern                                       | **Weak on ancient names**        | 1           | Fallback only                   |

## Integrated

Four content providers plus one gazetteer, chosen on three constraints: no API key,
a licence compatible with baking a static dataset into a build, and images that may
be hotlinked.

| Provider                     | Records in the current bundle | Why                                                                                                                                                                                                                                                                                                                 |
| ---------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Wikidata + Commons**       | ~1,080                        | The only source that supplies artifact→coordinate directly, via `P189`/`P1071`. Also the only one with Wikipedia lead paragraphs, which are the best general-reader educational text available.                                                                                                                     |
| **Cleveland Museum**         | ~410                          | Easiest high-quality ingest: everything CC0, no key, real `find_spot` field, `did_you_know` written for gallery visitors, and image dimensions in the response.                                                                                                                                                     |
| **Art Institute of Chicago** | ~220                          | CC0, IIIF images at exactly the width requested, and `place_pivots` gives an explicit production qualifier.                                                                                                                                                                                                         |
| **Metropolitan Museum**      | ~80–150                       | The best findspot granularity in the set (`locus`, `locale`, `excavation`) and a curatorial `isHighlight` flag that is the strongest fame signal available. Yield is low because its geography fields are populated on only ~16% of the collection — the budget is therefore weighted heavily towards Egyptian Art. |
| **Pleiades** (gazetteer)     | 42,000 places / 55,000 names  | Turns the museums' place-_name_ strings into coordinates. Without it the Met, Cleveland and AIC are unusable, because none of them return coordinates.                                                                                                                                                              |

## Deliberately excluded

- **Victoria & Albert.** Semantically the best geographic model found — it tags each
  place `made` or `found` — and still unusable here. Its terms (§9.3) state: _"You
  will not cache or store any content returned by the V&A API for more than four
  weeks"_ and _"you must use the image url returned by our API rather than create a
  copy on your local web server"_, with API use limited to _"non-commercial personal
  and educational purposes"_. A build-time bundle is a cache by definition, so a
  V&A-derived dataset would legally expire every 28 days. Revisit only with a
  monthly rebuild and written permission from V&A Images.
- **Harvard Art Museums** — key requires a reviewed request form, not self-service.
- **Europeana** — project key needed for any real volume, and personal-key limits
  are being reduced through 2026.
- **Smithsonian** — key is free and instant, so it is a cheap future addition; EDAN's
  deeply nested `freetext` place data is the real cost.
- **iDAI.objects Arachne** — **no longer blocked; recommended as the next
  integration.** Licensing has been cleared for this project, and a follow-up
  technical assessment found it is the only source that ships a coordinate physically
  attached to a place record explicitly typed `"relation": "Fundort"` — no name
  matching, no gazetteer guesswork. See "Arachne" below.
- **Open Context** — sub-metre excavation coordinates, but per-project licences
  require per-record checks and its images are trench photography rather than object
  photography.
- **Louvre** — images carry an explicit `©` notice and there is no enumeration API.
- **British Museum** — endpoint accepts no TCP connections.
- **Portable Antiquities Scheme** — Cloudflare-blocked from this network, so its
  licence and attribution could not be verified. Its 1 km findspot fuzzing would
  actually suit this game well; it needs terms in writing first.
- **Getty TGN** — LOD/SPARQL degraded, and the only downloadable dumps are the
  archived 3.49 GB legacy XML, no longer refreshed.

## Attribution and licensing obligations

These are requirements, not courtesies.

- **Pleiades — CC BY 3.0.** Attribution is **mandatory**. Credited on the landing
  screen and in the reveal panel when a coordinate came from it.
- **AIC `description` — CC BY 4.0.** All other AIC data is CC0. Records whose
  description text is used carry the stricter licence in `metadataLicense`, and it
  is displayed with the artifact.
- **Wikimedia Commons — per-file.** There is no blanket licence. The bundle stores
  `"See Wikimedia Commons file page"` rather than asserting a licence it has not
  checked, and every artifact links to its source record.
- **OpenStreetMap — ODbL.** `© OpenStreetMap contributors`, linking to the copyright
  page, rendered by the map's attribution control.
- **Met / Cleveland / AIC / Wikidata metadata — CC0.** No attribution legally
  required; all four are credited anyway.

### What must not be claimed

- **Not** "all museum images are free": CC0 covers only the public-domain subset,
  which is why every adapter filters on `isPublicDomain` / `is_public_domain` /
  `share_license_status == "CC0"`.
- **Not** "these objects are out of copyright": the museums say they _believe_ the
  works are public domain or waive rights they _might_ have. AIC states outright that
  it makes no warranty about reproduction rights. Third-party rights remain the
  deployer's problem.
- **Not** affiliated with or endorsed by any museum. The Met and Cleveland both
  prohibit implying endorsement; AIC prohibits use of its logo and building image.
- **Not** "map tiles are guaranteed": the OSM tile policy is explicit that
  availability is best-effort and access may be withdrawn without notice.

## Map tiles

The default basemap is the OSMF standard layer, chosen for **documented
permission** rather than looks. Compliance requirements, all met:

- visible attribution linking to `openstreetmap.org/copyright`;
- a real `Referer` header — so `index.html` sets
  `referrer: strict-origin-when-cross-origin`, and a stricter policy would get the
  app blocked;
- no bulk prefetching, no offline caching, no server-side tile proxy.

Two alternatives were evaluated and rejected as defaults:

- **CARTO** basemaps look better for a game (label-free styles) but publish **no
  free-tier usage policy at all** — their only relevant statement is that commercial
  use requires an Enterprise licence. Using them means relying on undocumented
  tolerance.
- **Stadia Maps** has the clearest permission of any provider (free plan, 200,000
  tiles/month) but requires registered domain-based authentication and forbids
  commercial use on the free plan.

Either can be adopted without code changes via `VITE_TILE_URL_LIGHT`,
`VITE_TILE_URL_DARK`, `VITE_TILE_ATTRIBUTION` and `VITE_TILE_SUBDOMAINS`.

Because OSM publishes no dark style, dark mode inverts the raster tiles in CSS. If a
provider-supplied dark URL is configured, the filter is switched off automatically.

## Re-running the ingest

```bash
npm run ingest                                   # all providers, default budgets
npm run ingest -- --provider=met --limit=500     # one provider, smaller budget
npm run ingest -- --dry                          # report only, do not write
npm run ingest -- --seed=123                      # change the deterministic sample
```

Every HTTP response is cached under `.cache/http`, so re-running to tweak
normalisation costs nothing and does not re-hammer the providers. The Pleiades dumps
are cached under `.cache/gazetteer`. Set `INGEST_CONTACT` to a contactable URL or
email — Wikimedia's User-Agent policy requires one and will block anonymous scripts.

### Photograph verification

The run verifies every artifact's photograph before dedupe, and drops artifacts with
no working rendition. Three states are tracked, and they are not interchangeable:

1. **URL present** — a provider returned a string. This is the only guarantee the
   provider APIs actually make, and a surprising share of those strings 404, redirect
   to a placeholder, or answer 200 with an HTML error page.
2. **Verified during ingest** — a ranged GET returned real image bytes, confirmed by
   magic-byte signature rather than `Content-Type`. Stamped on the record as
   `image.verifiedAt`, and the rendition that worked is promoted to `image.url` with
   the rest kept in `image.alternates`.
3. **Verified during a session** — the image loaded and decoded in the player's own
   browser. Only this state makes an artifact playable; see
   [ARCHITECTURE](ARCHITECTURE.md) for why the ingest stamp cannot substitute for it.

Verdicts are cached on disk in `.cache/image-verify.json` — good URLs for 30 days,
failures for 3, since failures are more often transient. So the first run pays for
several thousand requests and later runs verify only genuinely new images.

**A throttled request is not a failure.** `429`, `408`, `5xx`, `403`, a timeout and a
dropped connection are all classified _inconclusive_: retried with backoff, honouring
`Retry-After`, never written to the cache, and never a reason to drop an artifact. An
artifact whose renditions were only ever inconclusive ships with `verifiedAt: null`
and is checked in the browser like any other. The first version of this stage did not
make that distinction and deleted 1,026 perfectly good records in one run — a data
loss that looked exactly like a successful build.

Requests are also paced per host, and carry the same contactable `User-Agent` as the
harvest. Wikimedia's `Special:FilePath` is a redirect service rather than a static
file host, and answers unpaced anonymous clients with `429 Retry-After: 10` almost
immediately; at one request every 1.2 s with a proper agent string it answers every
time. That pacing is why the stage takes tens of minutes on a cold cache, and it is
the right trade — these are donated public services.

The run prints a report: rejections by reason, duplicates by rule, and the
distribution by provider, tier, origin kind, region and era. Watch the rejection
tally after changing an adapter; a sudden jump in `coordinate-too-coarse` or
`no-metadata` means a field mapping broke.

## Arachne / iDAI.objects — assessment

Licensing is cleared for this project, so the remaining question was purely technical.
Every figure below was measured against the live API.

**Why it matters here.** The other four sources are limited two ways: coverage (Met
geography is populated on ~16% of records and its Greek & Roman department has none at
all; Cleveland's `find_spot` on ~1%; AIC gives production place only) and _resolution
risk_ — they supply place **strings** that must be matched against a gazetteer, which
is exactly what produced `Attic → Attichy` and `North Coast → Gribskov Municipality`.
Arachne removes both: the coordinate arrives pre-resolved with a semantic label, so the
name-matching step that caused those failures is skipped entirely.

|                                                      | Measured                                                             |
| ---------------------------------------------------- | -------------------------------------------------------------------- |
| Objects with image + findspot                        | **65,141** (exact facet count)                                       |
| Clean, site-level after filtering                    | **~46,500**                                                          |
| Place entries typed `Fundort`                        | 54.7% (outnumbers `Aufbewahrungsort` at 35.1%)                       |
| `gazetteerId` present on findspots                   | 99.5% — zero `Fundort` entries lacked one                            |
| Coordinates at 5–6 decimal places                    | 92.6%; spot-checked accurate to ~150 m at Hattuša, ~30 m at Pergamon |
| Findspots resolving to `archaeological-site`/`-area` | 71.5%                                                                |
| Findspot places carrying a **Pleiades** id           | ~41% — cross-walks into data already cached here                     |

Its relation vocabulary maps almost directly onto this project's `OriginKind`:
`Fundort`/`in situ` → `findspot`, `Entstehungsort` → `creation`, `unsicher` →
`attributed`. The gazetteer's `types` field drives `CoordTier`.

**Three contamination modes that must be filtered** — the semantic label is not
self-validating:

1. **Country centroids, 20%** (`{"name":"Griechenland","lat":"39","lon":"22"}`).
   Detectable by integer/1-dp coordinates and a comma-free name; classified as
   `country` tier, which `isPlayableTier` already excludes.
2. **Museum recorded as findspot, 1.4% overall but 15.5% of the German stratum** —
   e.g. a Pergamon statue with "Staatliche Museen, Antikensammlung Berlin" as its
   `Fundort`. Detect via gazetteer type `building-institution` plus a museum regex.
3. **Findspot coordinates identical to the holding place**, 2.3% overall but ~30% of
   the Iran and Syria strata. Sometimes legitimate (site museums); treat as a
   tier demotion rather than a rejection.

**Constraints.** `offset + limit ≤ 10000` (Elasticsearch window) and anonymous scroll
returns 401, so enumeration must be partitioned by facet. Metadata is **German only** —
`?lang=en` and `Accept-Language` are both ignored — but the burden is mostly closed
vocabularies (materials, relations, `facet_kulturkreis`) that map by hand exactly like
`cultures.ts`, plus a German century-date parser (`"3. Jh. n. Chr."`). Titles are the
awkward part: 11,001 seal records are titled with bare catalogue numbers. The server
serialises concurrent requests, so 2–4 workers is the ceiling. It is an undocumented SPA
backend that returns **HTTP 200 with HTML** for unknown paths, so responses must be
validated on `Content-Type` before parsing.

Geographic skew needs active balancing: 56% of the corpus is Greece.

**Verdict: integrate, difficulty 2/5** — lower than Met or CMA, because the hard part of
those adapters (free-text place parsing) does not exist here. Expected yield
40,000–46,000 usable records, of which ~33,000 at findspot/site tier.
