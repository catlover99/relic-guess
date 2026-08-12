import { ExternalLink, Landmark, MapPin, Shovel } from 'lucide-react';
import type { Artifact } from '@/data/schema';
import { eraOf, eraWithRange, formatYearRange } from '@/game/eras';
import { regionLabel, regionOf } from '@/game/regions';
import type { RoundResult } from '@/game/store';
import { cn } from '@/lib/cn';
import { ScoreReveal } from './ScoreReveal';
import { Chip, FactRow, SectionTitle } from './ui/primitives';

const ORIGIN_KIND_COPY: Record<Artifact['origin']['kind'], string> = {
  findspot: 'Where it was found',
  creation: 'Where it was made',
  'cultural-origin': 'Where its culture was centred',
  attributed: 'Where it is thought to be from',
};

/**
 * Extra disclosure for origins that were *inferred*, not recorded.
 *
 * A cultural centre is a reasonable answer when no provenance exists, but the
 * player must not be led to think it is a findspot. The heading already says
 * "centred"; this spells out that the object itself was not located.
 */
const ORIGIN_KIND_NOTE: Partial<Record<Artifact['origin']['kind'], string>> = {
  'cultural-origin':
    'No findspot is recorded for this object, so the answer is the heartland of the culture that made it.',
  attributed: 'The holding museum records this origin as uncertain.',
};

/**
 * Heading for the object's own location, chosen from what the record actually
 * says. "Excavated at" is not applied to a place the museum only calls a place of
 * manufacture, and "Found at" is never used for an attribution the provider
 * itself hedges.
 */
const OBJECT_ROLE_COPY: Record<'found' | 'excavated' | 'made' | 'attributed', string> = {
  found: 'Found at',
  excavated: 'Excavated at',
  made: 'Made at',
  attributed: 'Attributed to',
};

const TIER_COPY: Record<Artifact['origin']['tier'], string> = {
  findspot: 'exact findspot',
  site: 'archaeological site',
  city: 'city',
  subregion: 'region',
  'culture-region': 'cultural region',
  country: 'country',
};

/**
 * Everything the player learns after guessing.
 *
 * Deliberately ordered as answer → score → context: the two things a player wants
 * immediately are where it was actually from and how they did, and the
 * educational material earns attention only after those are satisfied.
 *
 * It also states *which sense* of location was being asked for. A player who put
 * their pin where an object was made, when the answer was where it was excavated,
 * deserves to know that rather than assume the game is wrong.
 */
export function RevealPanel({ result, className }: { result: RoundResult; className?: string }) {
  const { artifact, breakdown, guess, geography } = result;
  const { origin } = artifact;
  const era = eraOf(artifact);
  const region = regionOf(artifact);
  const dateText =
    artifact.dateDisplay ?? formatYearRange(artifact.yearStart, artifact.yearEnd) ?? null;

  return (
    <div className={cn('space-y-5', className)}>
      <ScoreReveal
        breakdown={breakdown}
        guess={guess}
        origin={origin}
        regionIsHeartland={geography.regionIsHeartland}
      />

      <hr className="border-line" />

      {/*
        The answer, in up to two parts.

        A Heartland round is graded against the culture's homeland, and the object
        itself was often dug up somewhere else entirely — the Venus de Milo was
        found on Milos, 205 km from the centre of the Aegean Greek world. Showing
        one place and calling it "the answer" hid whichever of the two the player
        had not been told about. When both exist they get their own rows, so it is
        obvious which one the score was measured to.
      */}
      <section aria-labelledby="reveal-answer">
        <SectionTitle className="mb-1.5">
          <span id="reveal-answer">
            {geography.regionIsHeartland ? 'Cultural heartland' : ORIGIN_KIND_COPY[origin.kind]}
          </span>
        </SectionTitle>
        <p className="flex items-start gap-2 font-display text-xl">
          <MapPin size={18} className="mt-1 shrink-0 text-origin" aria-hidden />
          <span className="min-w-0 break-words">{geography.region.label}</span>
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {geography.regionIsHeartland ? (
            <Chip tone="origin">Scored within {Math.round(geography.region.radiusKm)} km</Chip>
          ) : (
            <Chip tone="origin">Recorded to {TIER_COPY[origin.tier]}</Chip>
          )}
          {region && <Chip>{regionLabel(region)}</Chip>}
        </div>
        {geography.regionIsHeartland ? (
          <p className="mt-2 text-xs leading-relaxed text-ink-3">
            Your guess was scored against the region this culture occupied, not a single spot on the
            map.
          </p>
        ) : (
          ORIGIN_KIND_NOTE[origin.kind] && (
            <p className="mt-2 text-xs leading-relaxed text-ink-3">
              {ORIGIN_KIND_NOTE[origin.kind]}
            </p>
          )
        )}
      </section>

      {geography.objectLocation && (
        <section aria-labelledby="reveal-findspot">
          <SectionTitle className="mb-1.5">
            <span id="reveal-findspot">{OBJECT_ROLE_COPY[geography.objectLocation.role]}</span>
          </SectionTitle>
          <p className="flex items-start gap-2 font-display text-lg">
            <Shovel size={17} className="mt-1 shrink-0 text-ink-2" aria-hidden />
            <span className="min-w-0 break-words">{geography.objectLocation.label}</span>
          </p>
          <p className="mt-2 text-xs leading-relaxed text-ink-3">
            Where this object itself was recorded. It did not affect your score.
          </p>
        </section>
      )}

      <section aria-labelledby="reveal-object">
        <SectionTitle className="mb-1">
          <span id="reveal-object">The object</span>
        </SectionTitle>
        <h3 className="text-xl break-words">{artifact.title}</h3>
        {artifact.description && (
          <p className="mt-2 text-sm leading-relaxed text-ink-2">{artifact.description}</p>
        )}

        <dl className="mt-3">
          {artifact.culture && <FactRow label="Culture">{artifact.culture}</FactRow>}
          {/*
            Three separate statements, deliberately not merged:

              Date    early 4th century BCE      what the museum dates *this object* to
              Period  Late Classical            the museum's own period term
              Era     Classical Antiquity · c. 1200 BCE – 300 CE   our bracket, dated

            The object's own date is the precise one and always wins the top row.
            The era exists to tell a player who has never met the word "Classical"
            roughly when that was, so it is useless without its range.
          */}
          {dateText && <FactRow label="Date">{dateText}</FactRow>}
          {artifact.period && <FactRow label="Period">{artifact.period}</FactRow>}
          {era && <FactRow label="Era">{eraWithRange(era)}</FactRow>}
          {artifact.material && <FactRow label="Material">{artifact.material}</FactRow>}
          {artifact.objectType && <FactRow label="Type">{artifact.objectType}</FactRow>}
          {artifact.discovery && (
            <FactRow label="Discovery">
              <span className="inline-flex items-start gap-1.5">
                <Shovel size={13} className="mt-1 shrink-0 text-ink-3" aria-hidden />
                {artifact.discovery}
              </span>
            </FactRow>
          )}
          {artifact.heldBy && (
            <FactRow label="Held by">
              <span className="inline-flex items-start gap-1.5">
                <Landmark size={13} className="mt-1 shrink-0 text-ink-3" aria-hidden />
                {artifact.heldBy}
              </span>
            </FactRow>
          )}
          {artifact.accessionNumber && (
            <FactRow label="Accession">
              <span className="font-mono text-xs">{artifact.accessionNumber}</span>
            </FactRow>
          )}
        </dl>
      </section>

      <footer className="space-y-2 border-t border-line pt-3">
        <a
          href={artifact.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-brand underline decoration-brand/40 underline-offset-2 hover:decoration-brand"
        >
          View the original record
          <ExternalLink size={14} aria-hidden />
        </a>
        <p className="text-2xs leading-relaxed text-ink-3">
          Image: {artifact.image.attribution} — {artifact.image.license}. Metadata:{' '}
          {artifact.metadataLicense}. Coordinates resolved via {resolverName(origin.resolvedBy)}.
        </p>
      </footer>
    </div>
  );
}

function resolverName(resolvedBy: Artifact['origin']['resolvedBy']): string {
  switch (resolvedBy) {
    case 'pleiades':
      return 'the Pleiades gazetteer of ancient places';
    case 'wikidata':
      return 'Wikidata';
    case 'curated':
      return 'a hand-checked gazetteer';
    case 'culture':
      return 'a hand-checked table of cultural heartlands';
    case 'provider':
      return 'the source collection';
  }
}
