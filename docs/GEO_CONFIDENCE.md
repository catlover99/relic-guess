# Geographic confidence

The single most important correctness question in this project is **which of an
object's several locations the game asks the player to find**.

Museum records routinely attach three or more non-equivalent places to one object,
and every metadata standard reviewed — CIDOC-CRM, LIDO, Getty CDWA — models them as
structurally distinct rather than as variants of one field. Collapsing them
produces rounds where the correct answer for an Egyptian statue is midtown
Manhattan.

## The four senses of "where"

| Sense                | Meaning                                   | In this codebase                                                              |
| -------------------- | ----------------------------------------- | ----------------------------------------------------------------------------- |
| **Findspot**         | Where the object was dug up or discovered | `origin.kind = 'findspot'`                                                    |
| **Creation**         | Where it was made                         | `origin.kind = 'creation'`                                                    |
| **Cultural origin**  | Where the producing culture was centred   | `origin.kind = 'cultural-origin'`                                             |
| **Current location** | The museum holding it today               | **Never used as an answer.** Stored in `heldBy` and shown only in the reveal. |

Findspot is preferred when a provider offers both, because it is the physically
verifiable location. The reveal screen always states which sense was being asked
(`"Where it was found"` vs `"Where it was made"`), so a player who put their pin
where an object was _made_ when the answer was where it was _excavated_ can see why.

## Coordinate tiers

`origin.tier` records how specific the coordinate is, independently of what it
means. A findspot can be country-precision, and a creation place can be exact —
so tier and kind are separate fields.

| Tier             | Example                          | Confidence | Baseline uncertainty | Playable        |
| ---------------- | -------------------------------- | ---------- | -------------------- | --------------- |
| `findspot`       | "Senenmut Quarry, Deir el-Bahri" | 0.98       | 15 km                | ✅              |
| `site`           | "Nimrud", "Knossos", "Vulci"     | 0.92       | 30 km                | ✅              |
| `city`           | "Athens", "Ravenna"              | 0.84       | 60 km                | ✅              |
| `subregion`      | "Upper Egypt, Thebes", "Attica"  | 0.62       | 160 km               | ✅              |
| `culture-region` | "Mesopotamia", "Thrace", "Nubia" | 0.42       | 380 km               | ✅              |
| `country`        | centroid of Egypt                | 0.25       | 520 km               | ❌ **excluded** |

Country tier is excluded from the playable pool by `isPlayableTier`. Guessing the
centroid of a modern nation is a question about borders, not about archaeology, and
the research measured that **3,713 of the Met's 3,716 `"Excavated in"` records
resolve no finer than a modern country** — so admitting that tier would flood the
pool with rounds that look precise and are not.

### Modifiers applied on top of the tier

`buildOrigin()` adjusts both numbers before storing them:

- **Origin kind.** A `cultural-origin` attribution widens uncertainty by 1.35× and
  cuts confidence to 0.8× — the object may have travelled from where its culture
  was centred. An `attributed` place ("probably from…") is penalised harder.
- **Gazetteer precision.** Pleiades marks many places `rough` (a bounding box
  rather than a surveyed point); those double the uncertainty.
- **Measured extent.** When Pleiades publishes a `bbox`, half its diagonal is used
  directly instead of the tier default, bounded below by 8 km and above by the tier
  baseline. Amarna's box is ~1.5 km across, which is real evidence and much better
  than the site-tier guess of 30 km. The upper bound stops a suspiciously tight box
  on a broad region from making scoring harsher than the data justifies.

The 8 km floor exists because nobody can place a pin on a world map more precisely
than that; charging for the last few kilometres would measure mouse accuracy rather
than knowledge.

## How scoring uses this

`scoreGuess` forgives `origin.uncertaintyKm` before charging distance:

```
effective = max(0, distance − uncertaintyKm)
score     = 5000 · e^(−effective / 1500)
```

A guess inside the uncertainty radius scores full marks, because it is as good as
the source data can distinguish. Beyond it, the score decays continuously — there
are no bucket boundaries where 199 km and 201 km differ by a third of the round.

The reveal draws the uncertainty radius as a dashed ring whenever it exceeds 80 km,
and explains the forgiveness in words. Players tolerate imprecision they were told
about; unexplained imprecision reads as a bug.

### A known trade-off

Full forgiveness inside the radius means a `culture-region` round (380 km) is
easier to max out than a `findspot` round (15 km). The alternative — multiplying
the score by tier confidence, so a perfect coarse round caps at ~2,100 — is fairer
across rounds but confusing to a player who did everything right.

This implementation keeps the maximum reachable on every round and manages the
imbalance on the **supply** side instead: coarse tiers are a minority of the pool
(see the ingest report), the pool is sorted by quality, and the tier is always
disclosed. If round-to-round fairness later matters more than legibility, the
change is a single multiplication in `scoring.ts`.

## Provider-specific hazards

Each of these was verified against live API responses and is handled in the
relevant adapter:

- **Met `geographyType`** is free text with 119 observed values, pipe-delimited for
  multi-valued records, and populated on only ~12% of the collection. `"Said to be
from"`, `"Formerly considered made in"` and `"Object place"` are **rejected
  outright** — the museum does not assert them. An _empty_ `geographyType` is
  treated as `cultural-origin`, not as production, because unqualified is not the
  same as "made in".
- **Met `country`** is not an ISO country: "Nubia", "Mesopotamia" and "Persia" all
  appear there. It is resolved through the gazetteer like any other place string.
- **Met Greek & Roman Art** populates no geography fields at all; location is
  encoded only in `culture` ("Roman, Asia Minor, Tarsus"), which the adapter parses
  coarse-to-fine as a fallback and records as `cultural-origin`.
- **AIC `place_of_origin`** is the worst trap in the set: roughly **89% of AIC's
  place assertions are the artist's nationality**, and the flattened field exposes
  them without the qualifier. The adapter fetches `place_pivots` and accepts a
  record only when a pivot's `qualifier_title` is `"Object made in:"` or
  `"Object designed in:"`.
- **Cleveland `find_spot`** is excellent when present but mixes verified findspots
  with dealer hearsay in the same field ("Said by Jacob Hirsch to have been
  excavated at Kerch"). Hearsay prefixes are rejected.
- **Wikidata `P189`** resolves to an _entity_, which may be a trench or a whole
  country — 1,865 items have a country as their "findspot". The tier is therefore
  derived from the place entity's own `P31` values, and `wikibase:geoPrecision` is
  deliberately ignored as a quality signal because ~40% of these claim
  physically impossible sub-metre accuracy.
- **Wikidata place-name search** must not be trusted blind: searching "East India"
  returns a **Docklands Light Railway station in London** as its top hit, with an
  exact label match and valid coordinates. The gazetteer filters candidates by what
  their description says they are, and returns nothing rather than guessing.

## Culture is not a place

Cultures resolve through a controlled table (`scripts/lib/cultures.ts`) and **never**
through a place gazetteer. This rule exists because breaking it produced the worst
data errors in the project's history:

| Culture string        | Resolved to                              | Records |
| --------------------- | ---------------------------------------- | ------- |
| `Greek, Attic`        | **Attichy**, a commune in Oise, France   | 90      |
| `Minoan`              | Zakros (right by luck, derived unsafely) | 13      |
| `Hattian` / `Hittite` | Central Anatolia Region                  | 10      |
| `British`             | **Welsh** (a language item)              | 7       |
| `Chimú`               | **Gribskov Municipality**, Denmark       | 3       |
| `Spanish`             | **Spanish River**, Canada                | 3       |
| `Avar`                | **Avaray**, France                       | 3       |
| `Greek, Rhodian`      | a _statue group_ at Olympia              | 1       |

Every one came from `wbsearchentities`, which is a full-text search returning prefix
and alias matches ranked by popularity — not a lookup. "Attic" matched "Attichy" as a
prefix; "Chimú" reached a Danish municipality that lists "North Coast" as an alias.

Two rules govern the table:

1. **Never finer than `subregion`.** A culture is not a point. The sole exception is
   Teotihuacan, where the culture is defined by one city.
2. **A defensible centre, or nothing.** Cultures too diffuse to have one — Gravettian,
   "Islamic", "South Asian", modern nationalities like "French" — are listed in
   `UNRESOLVABLE_CULTURES` with a reason, and their records are dropped. The intent is
   explicit rather than looking like an oversight.

Matching is exact against normalised tokens, including adjectival forms
(`attic` → Attica, `mochica` → Moche). Provider culture strings run coarse-to-fine
("Greek, Attic"), so the most specific segment wins.

A recorded findspot always outranks a culture inference, because confidence is
compared across all candidates and `cultural-origin` carries a 0.8× penalty.

## Place matching safeguards

A Wikidata candidate must satisfy **all three** constraints:

1. **Exact match.** The text Wikidata actually matched (`match.text`, label or alias)
   must normalise to exactly the query. This alone kills `Attic` → `Attichy`.
2. **Country compatibility.** If the provider named a country, the coordinate must
   plausibly lie in it. This is the only thing that kills `North Coast` → Denmark:
   Wikidata genuinely lists "North Coast" as an English alias of that municipality, so
   the exact-match rule passes it. Countries whose territory spans oceans (the US,
   France, Denmark…) are declared unconstrainable and the check abstains rather than
   guessing — a centroid carries no information when Hawaii is further from the
   contiguous US than Berlin is.
3. **Plausible semantic type.** The description must read like a settlement, region or
   archaeological site — not a band, a language, a river or a sculpture.

All surviving candidates are scored and the best is taken, never the first.

### Label and coordinate always describe the same entity

Provider context (region, country) is appended to a label **only** when the resolver
confirmed the match is consistent with that country. Splicing unconditionally produced
`Gribskov Municipality, North Coast, Peru` — a city from Denmark, a region from the
Met, and a country from the Met, of which only the first supplied the coordinate — and
`Cyprus, United Kingdom`, where the coordinate was in Cyprus and the country came from
a different entity's `P17`.

### Blank coordinates are not zero

`Number('')` is `0`, and `Number.isFinite(0)` is true, so blank `reprLat` columns in
the Pleiades names dump silently produced the coordinate (0, 0). 285 records in the
pre-fix bundle sat on Null Island in the Gulf of Guinea. Coordinate columns are now
parsed with an explicit blank check.

## Provenance

Every origin carries an `OriginProvenance` block — internal diagnostics, never shown
in the UI:

| Field                                  | Purpose                                                                                                         |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `source`                               | which provider field the geography came from (`met.culture`, `cma.find_spot`, …)                                |
| `rawText`                              | the provider's text before normalisation                                                                        |
| `query`                                | the normalised string actually looked up                                                                        |
| `matchType`                            | `curated-exact`, `pleiades-exact`, `wikidata-exact`, `culture-table`, `country-fallback`, `provider-coordinate` |
| `matchedLabel` / `matchedId`           | the record that supplied the coordinate                                                                         |
| `semanticType`                         | the matched record's own type or description                                                                    |
| `countryChecked` / `countryDistanceKm` | the country constraint and its result                                                                           |
| `reason`                               | free text, e.g. why a culture centre was used                                                                   |

This exists because attributing the Attichy and Gribskov failures each required
re-deriving the whole pipeline: nothing recorded what had been looked up or what
matched it. `npm run audit` reads these fields.

## Resolution order

`Gazetteer.resolve()` tries, in order:

1. **Curated entries** (`places.curated.ts`) — hand-checked, and the only layer that
   knows "Thebes" means Egypt in an Egyptian-department record, or that
   "Mesopotamia" is a cultural region rather than a city.
2. **Pleiades** — 42,000 ancient places with names, alternate names, feature types,
   a self-declared precision flag and a bounding box. Purpose-built for exactly this
   problem.
3. **Wikidata** — global fallback for the regions Pleiades does not cover (East
   Asia, the Americas, Oceania, Sub-Saharan Africa), filtered as described above.
4. **Country centroid** — recorded for completeness, then filtered out of play.

Every artifact stores `origin.resolvedBy` and `origin.resolvedId`, so any answer
can be traced back to the gazetteer record that produced it. The reveal screen
names the resolver.
