const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
};

/** Strips HTML tags and decodes the entities providers actually emit. */
export function stripHtml(input: string | null | undefined): string {
  if (!input) return '';
  return input
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/p>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#?\w+);/g, (match, entity: string) => ENTITIES[entity.toLowerCase()] ?? match)
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Trims to roughly `maxChars` on a sentence boundary.
 *
 * Museum descriptions run to several thousand characters. The reveal panel wants
 * two or three sentences of context, not an exhibition catalogue entry, and
 * truncating mid-word looks broken.
 */
export function summarize(input: string | null | undefined, maxChars = 420): string | null {
  const text = stripHtml(input);
  if (!text) return null;
  if (text.length <= maxChars) return text;

  const window = text.slice(0, maxChars + 120);
  const sentenceEnd = Math.max(
    window.lastIndexOf('. '),
    window.lastIndexOf('! '),
    window.lastIndexOf('? '),
  );
  if (sentenceEnd > maxChars * 0.45) return window.slice(0, sentenceEnd + 1);

  const wordEnd = window.lastIndexOf(' ', maxChars);
  return `${window.slice(0, wordEnd > 0 ? wordEnd : maxChars).trimEnd()}…`;
}

/** Collapses "Gypsum alabaster, paint, gold leaf" to something scannable. */
export function tidyMaterial(input: string | null | undefined): string | null {
  const text = stripHtml(input);
  if (!text) return null;
  const parts = text
    .split(/[,;]/)
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, 3);
  const joined = parts.join(', ');
  return joined ? joined.charAt(0).toUpperCase() + joined.slice(1) : null;
}

/** Normalized title used for cross-provider duplicate detection. */
export function titleKey(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(the|a|an|of|from|with|and|fragment|fragmentary)\b/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Builds a place label from coarse-to-fine parts without repeating any of them.
 *
 * Naively joining a gazetteer title with the provider's region and country
 * produces "Thebes, Egypt, Upper Egypt, Egypt", because the gazetteer's own label
 * already carries the country. Comparison is case- and accent-insensitive so
 * "Egypt" and "egypt" collapse.
 */
export function joinPlaceParts(parts: Array<string | null | undefined>, max = 3): string {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const part of parts) {
    if (!part) continue;
    for (const segment of part.split(',')) {
      const value = tidyPlaceName(segment);
      if (!value) continue;
      const key = value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(value);
      if (out.length >= max) return out.join(', ');
    }
  }
  return out.join(', ');
}

/**
 * Tidies a single place name for display.
 *
 * Pleiades titles carry name variants separated by a slash ("Nev-Shapur/Nishapur",
 * "Consabura/Consabrum"). Both are useful to a player, so the alternative becomes a
 * parenthetical rather than being dropped or left as a slash.
 */
export function tidyPlaceName(input: string): string {
  const value = input.trim().replace(/\s+/g, ' ');
  if (!value) return '';
  const variants = value
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean);
  if (variants.length < 2) return value;
  return `${variants[0]} (${variants.slice(1).join(', ')})`;
}
