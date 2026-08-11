import type { CoordTier } from '../../src/data/schema.js';
import { normalizePlaceKey } from './gazetteer.js';

/**
 * Controlled culture → place resolution.
 *
 * Culture names are **not** place names and must never be handed to a place
 * gazetteer. Doing so produced the worst data errors in this project:
 *
 * - "Attic" matched **Attichy**, a commune in Oise, France (90 records)
 * - "Chimú" matched **Gribskov Municipality**, Denmark
 * - "British" matched **Welsh** (a language item)
 * - "Spanish" matched **Spanish River**, Canada
 * - "Avar" matched **Avaray**, France
 *
 * Every one came from a prefix or alias match in a full-text place search. So
 * cultures resolve *only* through the exact, hand-checked table below. An
 * unrecognised culture resolves to nothing, and the record is dropped — a smaller
 * dataset is worth far more than a plausible-looking wrong answer.
 *
 * Two rules constrain what may appear here:
 *
 * 1. **Never finer than `subregion`.** A culture is not a point. The only
 *    exceptions are cultures defined by a single site (Teotihuacan), where the
 *    culture and the place genuinely coincide.
 * 2. **A defensible centre, or nothing.** Cultures too diffuse to have one
 *    (Gravettian, "Islamic", "South Asian") are deliberately absent. They are
 *    listed in `UNRESOLVABLE_CULTURES` so the intent is explicit rather than
 *    looking like an oversight.
 */
export interface CulturePlace {
  /** Display label for the cultural centre or heartland. */
  label: string;
  lat: number;
  lon: number;
  tier: CoordTier;
  /** Modern country the coordinate falls in, for region inference and auditing. */
  country: string | null;
  /** Why this centre is defensible. Shown in provenance, not in the UI. */
  note: string;
}

/**
 * Keys are matched after `normalizePlaceKey`, so they are lower-cased,
 * accent-stripped and punctuation-collapsed. Include adjectival and alternative
 * forms explicitly — no stemming, no fuzzy matching.
 */
export const CULTURE_PLACES: Record<string, CulturePlace> = {
  /* ---- Aegean & Greek world -------------------------------------- */
  attic: {
    label: 'Attica',
    lat: 38.05,
    lon: 23.8,
    tier: 'subregion',
    country: 'Greece',
    note: 'Attic pottery was produced in Athens and its Attic hinterland',
  },
  attica: {
    label: 'Attica',
    lat: 38.05,
    lon: 23.8,
    tier: 'subregion',
    country: 'Greece',
    note: 'Attic pottery was produced in Athens and its Attic hinterland',
  },
  'greek attic': {
    label: 'Attica',
    lat: 38.05,
    lon: 23.8,
    tier: 'subregion',
    country: 'Greece',
    note: 'Attic pottery was produced in Athens and its Attic hinterland',
  },
  corinthian: {
    label: 'Corinthia',
    lat: 37.9,
    lon: 22.88,
    tier: 'subregion',
    country: 'Greece',
    note: 'Corinthian wares were produced at Corinth',
  },
  laconian: {
    label: 'Laconia',
    lat: 37.05,
    lon: 22.43,
    tier: 'subregion',
    country: 'Greece',
    note: 'Laconian production centred on Sparta',
  },
  boeotian: {
    label: 'Boeotia',
    lat: 38.37,
    lon: 23.1,
    tier: 'subregion',
    country: 'Greece',
    note: 'Boeotian workshops centred on Thebes and Tanagra',
  },
  rhodian: {
    label: 'Rhodes',
    lat: 36.2,
    lon: 28.0,
    tier: 'subregion',
    country: 'Greece',
    note: 'Rhodian production centred on the island of Rhodes',
  },
  cycladic: {
    label: 'the Cyclades',
    lat: 37.05,
    lon: 25.15,
    tier: 'subregion',
    country: 'Greece',
    note: 'Cycladic culture is defined by the Cycladic islands',
  },
  minoan: {
    label: 'Crete',
    lat: 35.24,
    lon: 24.81,
    tier: 'subregion',
    country: 'Greece',
    note: 'Minoan civilisation was centred on Crete',
  },
  mycenaean: {
    label: 'the Mycenaean Argolid',
    lat: 37.73,
    lon: 22.76,
    tier: 'culture-region',
    country: 'Greece',
    note: 'Mycenaean centres clustered in the Argolid and wider Peloponnese',
  },
  'ancient greece': {
    label: 'the Aegean Greek world',
    lat: 38.5,
    lon: 23.7,
    tier: 'culture-region',
    country: 'Greece',
    note: 'Greek material culture centred on the Aegean; deliberately region-level',
  },
  'hellenistic period': {
    label: 'the Eastern Mediterranean',
    lat: 36.5,
    lon: 28.5,
    tier: 'culture-region',
    country: null,
    note: 'Hellenistic production spanned the eastern Mediterranean',
  },
  cypriot: {
    label: 'Cyprus',
    lat: 35.05,
    lon: 33.2,
    tier: 'subregion',
    country: 'Cyprus',
    note: 'Cypriot material culture is defined by the island',
  },

  /* ---- Italy & Rome ---------------------------------------------- */
  etruscan: {
    label: 'Etruria',
    lat: 42.6,
    lon: 11.8,
    tier: 'culture-region',
    country: 'Italy',
    note: 'Etruscan heartland between the Arno and the Tiber',
  },
  'ancient rome': {
    label: 'Rome and its Italian heartland',
    lat: 41.89,
    lon: 12.48,
    tier: 'culture-region',
    country: 'Italy',
    note: 'Roman production was empire-wide; centred on Rome, region-level by design',
  },
  'culture of ancient rome': {
    label: 'Rome and its Italian heartland',
    lat: 41.89,
    lon: 12.48,
    tier: 'culture-region',
    country: 'Italy',
    note: 'Roman production was empire-wide; centred on Rome, region-level by design',
  },
  roman: {
    label: 'Rome and its Italian heartland',
    lat: 41.89,
    lon: 12.48,
    tier: 'culture-region',
    country: 'Italy',
    note: 'Roman production was empire-wide; centred on Rome, region-level by design',
  },
  apulian: {
    label: 'Apulia',
    lat: 41.0,
    lon: 16.6,
    tier: 'subregion',
    country: 'Italy',
    note: 'Apulian red-figure production centred on Taras and its hinterland',
  },
  villanovan: {
    label: 'the Villanovan Po and Tiber valleys',
    lat: 44.5,
    lon: 11.35,
    tier: 'culture-region',
    country: 'Italy',
    note: 'Villanovan culture centred on Bologna and Etruria',
  },

  /* ---- Egypt & Nubia --------------------------------------------- */
  'ancient egypt': {
    label: 'the Egyptian Nile valley',
    lat: 26.5,
    lon: 31.5,
    tier: 'culture-region',
    country: 'Egypt',
    note: 'Egyptian production followed the Nile; region-level by design',
  },
  egyptian: {
    label: 'the Egyptian Nile valley',
    lat: 26.5,
    lon: 31.5,
    tier: 'culture-region',
    country: 'Egypt',
    note: 'Egyptian production followed the Nile; region-level by design',
  },
  coptic: {
    label: 'Byzantine and Coptic Egypt',
    lat: 26.5,
    lon: 31.5,
    tier: 'culture-region',
    country: 'Egypt',
    note: 'Coptic material culture is Christian Egypt, along the Nile',
  },
  meroitic: {
    label: 'Meroitic Nubia',
    lat: 16.93,
    lon: 33.75,
    tier: 'culture-region',
    country: 'Sudan',
    note: 'Meroitic kingdom centred on Meroë',
  },
  napatan: {
    label: 'Napatan Nubia',
    lat: 18.53,
    lon: 31.83,
    tier: 'culture-region',
    country: 'Sudan',
    note: 'Napatan kingdom centred on Napata',
  },

  /* ---- Mesopotamia, Levant, Iran --------------------------------- */
  sumerian: {
    label: 'Sumer',
    lat: 31.3,
    lon: 45.9,
    tier: 'culture-region',
    country: 'Iraq',
    note: 'Sumerian city-states of southern Mesopotamia',
  },
  'neo sumerian': {
    label: 'Sumer',
    lat: 31.3,
    lon: 45.9,
    tier: 'culture-region',
    country: 'Iraq',
    note: 'Ur III period, southern Mesopotamia',
  },
  akkadian: {
    label: 'Akkad',
    lat: 33.1,
    lon: 44.3,
    tier: 'culture-region',
    country: 'Iraq',
    note: 'Akkadian heartland in central Mesopotamia',
  },
  babylonian: {
    label: 'Babylonia',
    lat: 32.5,
    lon: 44.4,
    tier: 'culture-region',
    country: 'Iraq',
    note: 'Babylonia, southern Mesopotamia',
  },
  'neo babylonian': {
    label: 'Babylonia',
    lat: 32.5,
    lon: 44.4,
    tier: 'culture-region',
    country: 'Iraq',
    note: 'Neo-Babylonian empire centred on Babylon',
  },
  assyrian: {
    label: 'Assyria',
    lat: 36.3,
    lon: 43.2,
    tier: 'culture-region',
    country: 'Iraq',
    note: 'Assyrian heartland on the upper Tigris',
  },
  'neo assyrian': {
    label: 'Assyria',
    lat: 36.3,
    lon: 43.2,
    tier: 'culture-region',
    country: 'Iraq',
    note: 'Neo-Assyrian empire centred on Nimrud, Nineveh and Assur',
  },
  elamite: {
    label: 'Elam',
    lat: 31.5,
    lon: 48.9,
    tier: 'culture-region',
    country: 'Iran',
    note: 'Elamite heartland in Khuzestan, centred on Susa',
  },
  achaemenid: {
    label: 'the Achaemenid heartland, Fars',
    lat: 29.94,
    lon: 52.89,
    tier: 'culture-region',
    country: 'Iran',
    note: 'Achaemenid dynastic centre at Persepolis and Pasargadae',
  },
  parthian: {
    label: 'the Parthian Iranian plateau',
    lat: 34.0,
    lon: 49.5,
    tier: 'culture-region',
    country: 'Iran',
    note: 'Parthian empire centred on the Iranian plateau and Mesopotamia',
  },
  sasanian: {
    label: 'the Sasanian heartland',
    lat: 32.5,
    lon: 48.5,
    tier: 'culture-region',
    country: 'Iran',
    note: 'Sasanian empire centred on Fars and Ctesiphon',
  },
  hittite: {
    label: 'the Hittite central Anatolian plateau',
    lat: 40.02,
    lon: 34.62,
    tier: 'culture-region',
    country: 'Turkey',
    note: 'Hittite kingdom centred on Hattusa',
  },
  hattian: {
    label: 'central Anatolia',
    lat: 40.02,
    lon: 34.62,
    tier: 'culture-region',
    country: 'Turkey',
    note: 'Hattian culture of the central Anatolian plateau',
  },
  urartian: {
    label: 'Urartu',
    lat: 38.5,
    lon: 43.4,
    tier: 'culture-region',
    country: 'Turkey',
    note: 'Urartian kingdom around Lake Van',
  },
  phoenician: {
    label: 'Phoenicia',
    lat: 33.9,
    lon: 35.5,
    tier: 'culture-region',
    country: 'Lebanon',
    note: 'Phoenician city-states of the Levantine coast',
  },
  israelite: {
    label: 'the southern Levant',
    lat: 31.75,
    lon: 35.2,
    tier: 'culture-region',
    country: 'Israel',
    note: 'Israelite and Judahite highlands',
  },
  edomite: {
    label: 'Edom',
    lat: 30.7,
    lon: 35.6,
    tier: 'culture-region',
    country: 'Jordan',
    note: 'Edomite territory south-east of the Dead Sea',
  },
  ghassulian: {
    label: 'the Jordan valley',
    lat: 31.82,
    lon: 35.6,
    tier: 'culture-region',
    country: 'Jordan',
    note: 'Chalcolithic Ghassulian culture, type site Teleilat Ghassul',
  },
  nabataean: {
    label: 'Nabataea',
    lat: 30.33,
    lon: 35.44,
    tier: 'culture-region',
    country: 'Jordan',
    note: 'Nabataean kingdom centred on Petra',
  },

  /* ---- Europe ---------------------------------------------------- */
  'ancient celts': {
    label: 'the Celtic Hallstatt and La Tène zone',
    lat: 47.6,
    lon: 10.0,
    tier: 'culture-region',
    country: null,
    note: 'Hallstatt and La Tène heartland north of the Alps',
  },
  celtic: {
    label: 'the Celtic Hallstatt and La Tène zone',
    lat: 47.6,
    lon: 10.0,
    tier: 'culture-region',
    country: null,
    note: 'Hallstatt and La Tène heartland north of the Alps',
  },
  frankish: {
    label: 'the Frankish heartland',
    lat: 49.5,
    lon: 4.5,
    tier: 'culture-region',
    country: 'France',
    note: 'Merovingian Austrasia and Neustria, between Rhine and Seine',
  },
  merovingian: {
    label: 'the Frankish heartland',
    lat: 49.5,
    lon: 4.5,
    tier: 'culture-region',
    country: 'France',
    note: 'Merovingian Austrasia and Neustria',
  },
  'anglo saxon': {
    label: 'Anglo-Saxon England',
    lat: 52.3,
    lon: 0.5,
    tier: 'culture-region',
    country: 'United Kingdom',
    note: 'Anglo-Saxon eastern England',
  },
  byzantine: {
    label: 'the Byzantine Aegean',
    lat: 40.5,
    lon: 28.0,
    tier: 'culture-region',
    country: 'Turkey',
    note: 'Byzantine production centred on Constantinople and the Aegean',
  },

  /* ---- The Americas ---------------------------------------------- */
  moche: {
    label: 'the Moche north coast of Peru',
    lat: -8.16,
    lon: -79.0,
    tier: 'culture-region',
    country: 'Peru',
    note: 'Moche culture of the north-coast river valleys, centred near Trujillo',
  },
  mochica: {
    label: 'the Moche north coast of Peru',
    lat: -8.16,
    lon: -79.0,
    tier: 'culture-region',
    country: 'Peru',
    note: 'Mochica is a synonym for Moche',
  },
  chimu: {
    label: 'the Chimú north coast of Peru',
    lat: -8.11,
    lon: -79.07,
    tier: 'culture-region',
    country: 'Peru',
    note: 'Chimú kingdom centred on Chan Chan',
  },
  nasca: {
    label: 'the Nasca south coast of Peru',
    lat: -14.7,
    lon: -75.13,
    tier: 'culture-region',
    country: 'Peru',
    note: 'Nasca culture of the south-coast valleys',
  },
  nazca: {
    label: 'the Nasca south coast of Peru',
    lat: -14.7,
    lon: -75.13,
    tier: 'culture-region',
    country: 'Peru',
    note: 'Nasca culture of the south-coast valleys',
  },
  chavin: {
    label: 'the Chavín highlands',
    lat: -9.59,
    lon: -77.18,
    tier: 'culture-region',
    country: 'Peru',
    note: 'Chavín culture centred on Chavín de Huántar',
  },
  wari: {
    label: 'the Wari highlands',
    lat: -13.07,
    lon: -74.22,
    tier: 'culture-region',
    country: 'Peru',
    note: 'Wari empire centred near Ayacucho',
  },
  huari: {
    label: 'the Wari highlands',
    lat: -13.07,
    lon: -74.22,
    tier: 'culture-region',
    country: 'Peru',
    note: 'Huari is a synonym for Wari',
  },
  inca: {
    label: 'the Inca heartland around Cusco',
    lat: -13.52,
    lon: -71.98,
    tier: 'culture-region',
    country: 'Peru',
    note: 'Inca empire centred on Cusco',
  },
  tiwanaku: {
    label: 'the Tiwanaku Titicaca basin',
    lat: -16.55,
    lon: -68.67,
    tier: 'culture-region',
    country: 'Bolivia',
    note: 'Tiwanaku centred on the southern Lake Titicaca basin',
  },
  paracas: {
    label: 'the Paracas south coast of Peru',
    lat: -13.84,
    lon: -76.25,
    tier: 'culture-region',
    country: 'Peru',
    note: 'Paracas culture of the Ica and Pisco valleys',
  },
  maya: {
    label: 'the Maya lowlands',
    lat: 17.2,
    lon: -89.6,
    tier: 'culture-region',
    country: null,
    note: 'Maya area spanning the Yucatán, Petén and Guatemalan highlands',
  },
  aztec: {
    label: 'the Aztec Basin of Mexico',
    lat: 19.43,
    lon: -99.13,
    tier: 'culture-region',
    country: 'Mexico',
    note: 'Mexica/Aztec empire centred on Tenochtitlan',
  },
  mexica: {
    label: 'the Aztec Basin of Mexico',
    lat: 19.43,
    lon: -99.13,
    tier: 'culture-region',
    country: 'Mexico',
    note: 'Mexica/Aztec empire centred on Tenochtitlan',
  },
  teotihuacan: {
    label: 'Teotihuacan',
    lat: 19.69,
    lon: -98.84,
    tier: 'site',
    country: 'Mexico',
    note: 'Teotihuacan culture is defined by the single city; site-level is exact here',
  },
  olmec: {
    label: 'the Olmec Gulf coast',
    lat: 17.9,
    lon: -94.7,
    tier: 'culture-region',
    country: 'Mexico',
    note: 'Olmec heartland in southern Veracruz and Tabasco',
  },
  zapotec: {
    label: 'the Valley of Oaxaca',
    lat: 17.04,
    lon: -96.77,
    tier: 'culture-region',
    country: 'Mexico',
    note: 'Zapotec culture centred on Monte Albán',
  },
  mixtec: {
    label: 'the Mixteca',
    lat: 17.3,
    lon: -97.5,
    tier: 'culture-region',
    country: 'Mexico',
    note: 'Mixtec culture of western Oaxaca',
  },
  'ancestral pueblo': {
    label: 'the Ancestral Pueblo Four Corners',
    lat: 36.9,
    lon: -108.5,
    tier: 'culture-region',
    country: 'United States',
    note: 'Ancestral Pueblo (Anasazi) culture of the Colorado Plateau',
  },
  'ancestral pueblo anasazi': {
    label: 'the Ancestral Pueblo Four Corners',
    lat: 36.9,
    lon: -108.5,
    tier: 'culture-region',
    country: 'United States',
    note: 'Ancestral Pueblo (Anasazi) culture of the Colorado Plateau',
  },

  /* ---- Africa, Asia ---------------------------------------------- */
  'edo peoples': {
    label: 'the Kingdom of Benin',
    lat: 6.34,
    lon: 5.62,
    tier: 'culture-region',
    country: 'Nigeria',
    note: 'Edo people of the Benin kingdom, centred on Benin City',
  },
  benin: {
    label: 'the Kingdom of Benin',
    lat: 6.34,
    lon: 5.62,
    tier: 'culture-region',
    country: 'Nigeria',
    note: 'Benin kingdom centred on Benin City',
  },
  nok: {
    label: 'the Nok Jos plateau',
    lat: 9.5,
    lon: 8.5,
    tier: 'culture-region',
    country: 'Nigeria',
    note: 'Nok culture of the Jos plateau',
  },
  gandharan: {
    label: 'Gandhara',
    lat: 34.17,
    lon: 72.03,
    tier: 'culture-region',
    country: 'Pakistan',
    note: 'Gandharan art of the Peshawar and Swat valleys',
  },
  gandhara: {
    label: 'Gandhara',
    lat: 34.17,
    lon: 72.03,
    tier: 'culture-region',
    country: 'Pakistan',
    note: 'Gandharan art of the Peshawar and Swat valleys',
  },
  korea: {
    label: 'the Korean peninsula',
    lat: 36.5,
    lon: 127.9,
    tier: 'culture-region',
    country: 'South Korea',
    note: 'Korean production across the peninsula; region-level by design',
  },
};

/**
 * Cultures deliberately left unresolved, with the reason.
 *
 * Recorded explicitly so that a future reader can see these were considered and
 * rejected, rather than assuming the table is simply incomplete. A record whose
 * only geography is one of these is dropped.
 */
export const UNRESOLVABLE_CULTURES: Record<string, string> = {
  islamic: 'a religion spanning three continents, not a place',
  'sasanian or islamic': 'the provider itself is undecided between two attributions',
  gravettian: 'Upper Palaeolithic industry spread across Europe with no defensible centre',
  aurignacian: 'Upper Palaeolithic industry spread across Europe with no defensible centre',
  magdalenian: 'Upper Palaeolithic industry spread across western Europe',
  'south asian': 'subcontinental in scale; coarser than any playable region',
  'southeast asian': 'spans a dozen modern countries',
  himalayan: 'a mountain range spanning several countries',
  german: 'a modern nationality, not a place of production',
  french: 'a modern nationality, not a place of production',
  british: 'a modern nationality, not a place of production',
  italian: 'a modern nationality; use the historical culture instead',
  spanish: 'a modern nationality, not a place of production',
  iran: 'a modern country name in the culture field; country tier is not playable',
  avar: 'steppe confederation with no single defensible centre',
};

export interface CultureMatch extends CulturePlace {
  /** The exact culture token that matched, for provenance. */
  matchedToken: string;
}

/**
 * Resolves a provider culture string to a cultural centre.
 *
 * Providers write cultures coarse-to-fine and comma-separated: "Greek, Attic",
 * "Roman, Asia Minor, Tarsus", "Korea, Goryeo dynasty (918–1392)". The most
 * specific usable segment wins, so "Greek, Attic" resolves to Attica rather than
 * to the whole Aegean.
 *
 * Matching is exact against normalised keys — the whole segment, or the whole
 * string. There is deliberately no substring, prefix or fuzzy matching.
 */
export function resolveCulture(culture: string | null | undefined): CultureMatch | null {
  if (!culture) return null;

  const whole = normalizePlaceKey(culture);
  const segments = culture
    .split(',')
    .map((part) => normalizePlaceKey(part))
    .filter((part) => part.length > 1);

  // Most specific first: the last segment, then backwards, then the whole string.
  const candidates = [...segments.reverse(), whole];

  for (const token of candidates) {
    const hit = CULTURE_PLACES[token];
    if (hit) return { ...hit, matchedToken: token };
  }
  return null;
}

/** Whether a culture string is knowingly unusable as geography. */
export function cultureRejectionReason(culture: string | null | undefined): string | null {
  if (!culture) return null;
  const whole = normalizePlaceKey(culture);
  const segments = culture.split(',').map((part) => normalizePlaceKey(part));
  for (const token of [whole, ...segments]) {
    const reason = UNRESOLVABLE_CULTURES[token];
    if (reason) return reason;
  }
  return null;
}
