import type { Artifact, GeoPoint } from '@/data/schema';

/**
 * Macro-regions used for the region-locked game modes and for balancing a
 * session so it does not serve five Mediterranean rounds in a row.
 *
 * These are cultural/archaeological groupings rather than strict continents:
 * "Mediterranean" is more useful to a history game than splitting Greece from
 * Turkey from Tunisia.
 */
export const REGIONS = [
  { id: 'mediterranean', label: 'Mediterranean', blurb: 'Greece, Rome, Iberia, North Africa' },
  { id: 'west-asia', label: 'West Asia', blurb: 'Mesopotamia, Persia, the Levant, Anatolia' },
  { id: 'africa', label: 'Africa', blurb: 'Egypt, Nubia, West and Southern Africa' },
  { id: 'europe', label: 'Europe', blurb: 'Celtic, Norse, Frankish and medieval Europe' },
  { id: 'south-asia', label: 'South Asia', blurb: 'Indus Valley, India, Sri Lanka' },
  { id: 'east-asia', label: 'East Asia', blurb: 'China, Korea, Japan' },
  { id: 'southeast-asia', label: 'Southeast Asia', blurb: 'Khmer, Java, Vietnam' },
  { id: 'americas', label: 'The Americas', blurb: 'Maya, Inca, Moche, Mississippian' },
  { id: 'oceania', label: 'Oceania', blurb: 'Polynesia, Melanesia, Australia' },
] as const;

export type RegionId = (typeof REGIONS)[number]['id'];

const COUNTRY_REGIONS: Record<string, RegionId> = {
  // Mediterranean
  greece: 'mediterranean',
  italy: 'mediterranean',
  cyprus: 'mediterranean',
  malta: 'mediterranean',
  spain: 'mediterranean',
  portugal: 'mediterranean',
  tunisia: 'mediterranean',
  algeria: 'mediterranean',
  morocco: 'mediterranean',
  libya: 'mediterranean',
  'vatican city': 'mediterranean',
  'san marino': 'mediterranean',
  // West Asia
  iraq: 'west-asia',
  iran: 'west-asia',
  turkey: 'west-asia',
  türkiye: 'west-asia',
  syria: 'west-asia',
  lebanon: 'west-asia',
  israel: 'west-asia',
  palestine: 'west-asia',
  jordan: 'west-asia',
  'saudi arabia': 'west-asia',
  yemen: 'west-asia',
  oman: 'west-asia',
  'united arab emirates': 'west-asia',
  kuwait: 'west-asia',
  bahrain: 'west-asia',
  qatar: 'west-asia',
  armenia: 'west-asia',
  georgia: 'west-asia',
  azerbaijan: 'west-asia',
  afghanistan: 'west-asia',
  turkmenistan: 'west-asia',
  uzbekistan: 'west-asia',
  tajikistan: 'west-asia',
  kyrgyzstan: 'west-asia',
  kazakhstan: 'west-asia',
  // Africa
  egypt: 'africa',
  nubia: 'africa',
  sudan: 'africa',
  ethiopia: 'africa',
  nigeria: 'africa',
  ghana: 'africa',
  mali: 'africa',
  benin: 'africa',
  cameroon: 'africa',
  'democratic republic of the congo': 'africa',
  kenya: 'africa',
  tanzania: 'africa',
  'south africa': 'africa',
  zimbabwe: 'africa',
  namibia: 'africa',
  // Europe
  'united kingdom': 'europe',
  england: 'europe',
  scotland: 'europe',
  wales: 'europe',
  ireland: 'europe',
  france: 'europe',
  germany: 'europe',
  austria: 'europe',
  switzerland: 'europe',
  netherlands: 'europe',
  belgium: 'europe',
  denmark: 'europe',
  norway: 'europe',
  sweden: 'europe',
  finland: 'europe',
  iceland: 'europe',
  poland: 'europe',
  'czech republic': 'europe',
  czechia: 'europe',
  slovakia: 'europe',
  hungary: 'europe',
  romania: 'europe',
  bulgaria: 'europe',
  serbia: 'europe',
  croatia: 'europe',
  slovenia: 'europe',
  'bosnia and herzegovina': 'europe',
  albania: 'europe',
  'north macedonia': 'europe',
  ukraine: 'europe',
  russia: 'europe',
  belarus: 'europe',
  moldova: 'europe',
  lithuania: 'europe',
  latvia: 'europe',
  estonia: 'europe',
  // South Asia
  india: 'south-asia',
  pakistan: 'south-asia',
  nepal: 'south-asia',
  'sri lanka': 'south-asia',
  bangladesh: 'south-asia',
  bhutan: 'south-asia',
  // East Asia
  china: 'east-asia',
  mongolia: 'east-asia',
  japan: 'east-asia',
  'south korea': 'east-asia',
  'north korea': 'east-asia',
  korea: 'east-asia',
  taiwan: 'east-asia',
  // Southeast Asia
  cambodia: 'southeast-asia',
  thailand: 'southeast-asia',
  vietnam: 'southeast-asia',
  laos: 'southeast-asia',
  myanmar: 'southeast-asia',
  burma: 'southeast-asia',
  indonesia: 'southeast-asia',
  malaysia: 'southeast-asia',
  philippines: 'southeast-asia',
  singapore: 'southeast-asia',
  brunei: 'southeast-asia',
  // Americas
  mexico: 'americas',
  guatemala: 'americas',
  belize: 'americas',
  honduras: 'americas',
  'el salvador': 'americas',
  nicaragua: 'americas',
  'costa rica': 'americas',
  panama: 'americas',
  colombia: 'americas',
  venezuela: 'americas',
  ecuador: 'americas',
  peru: 'americas',
  bolivia: 'americas',
  chile: 'americas',
  argentina: 'americas',
  brazil: 'americas',
  paraguay: 'americas',
  uruguay: 'americas',
  'united states': 'americas',
  'united states of america': 'americas',
  usa: 'americas',
  canada: 'americas',
  cuba: 'americas',
  haiti: 'americas',
  'dominican republic': 'americas',
  jamaica: 'americas',
  // Oceania
  australia: 'oceania',
  'new zealand': 'oceania',
  'papua new guinea': 'oceania',
  fiji: 'oceania',
  'solomon islands': 'oceania',
  vanuatu: 'oceania',
  samoa: 'oceania',
  tonga: 'oceania',
  'french polynesia': 'oceania',
  'marshall islands': 'oceania',
  micronesia: 'oceania',
  palau: 'oceania',
  kiribati: 'oceania',
  'easter island': 'oceania',
};

/**
 * Coarse fallback boxes, tried in order, for records whose country string we do
 * not recognise. Deliberately generous — a wrong region only affects filtering
 * and balance, never the answer itself.
 */
const BOXES: Array<{
  region: RegionId;
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
}> = [
  { region: 'west-asia', latMin: 12, latMax: 45, lonMin: 34, lonMax: 80 },
  { region: 'africa', latMin: 20, latMax: 33, lonMin: 24, lonMax: 37 }, // Egypt/Nubia corridor
  { region: 'mediterranean', latMin: 29, latMax: 47, lonMin: -10, lonMax: 34 },
  { region: 'europe', latMin: 35, latMax: 72, lonMin: -25, lonMax: 45 },
  { region: 'africa', latMin: -36, latMax: 37, lonMin: -20, lonMax: 52 },
  { region: 'south-asia', latMin: 5, latMax: 37, lonMin: 60, lonMax: 92 },
  { region: 'southeast-asia', latMin: -11, latMax: 29, lonMin: 92, lonMax: 141 },
  { region: 'east-asia', latMin: 18, latMax: 54, lonMin: 100, lonMax: 146 },
  // Oceania is tested before the Americas: its box wraps the antimeridian, and the
  // Americas box starts at −170°, so the wider box would otherwise claim Polynesia.
  { region: 'oceania', latMin: -50, latMax: 10, lonMin: 110, lonMax: -120 },
  { region: 'americas', latMin: -56, latMax: 72, lonMin: -170, lonMax: -30 },
];

export function regionOf(artifact: Pick<Artifact, 'origin'>): RegionId | null {
  const country = artifact.origin.country?.trim().toLowerCase();
  if (country && COUNTRY_REGIONS[country]) return COUNTRY_REGIONS[country]!;

  // Some providers put a historical name where a country belongs.
  if (country) {
    for (const [key, region] of Object.entries(COUNTRY_REGIONS)) {
      if (country.includes(key)) return region;
    }
  }
  return regionFromPoint(artifact.origin);
}

export function regionFromPoint({ lat, lon }: GeoPoint): RegionId | null {
  for (const box of BOXES) {
    const lonMatch =
      box.lonMin <= box.lonMax
        ? lon >= box.lonMin && lon <= box.lonMax
        : lon >= box.lonMin || lon <= box.lonMax; // wraps the antimeridian
    if (lat >= box.latMin && lat <= box.latMax && lonMatch) return box.region;
  }
  return null;
}

export function regionLabel(id: RegionId | null): string {
  return REGIONS.find((r) => r.id === id)?.label ?? 'Unknown region';
}
