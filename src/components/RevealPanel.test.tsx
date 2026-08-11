import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RevealPanel } from './RevealPanel';
import { ClueList } from './ClueList';
import { scoreGuess } from '@/game/scoring';
import type { RoundResult } from '@/game/store';
import { makeArtifact, type ArtifactOverrides } from '@/test/factories';

function makeResult(overrides: ArtifactOverrides = {}, guess = { lat: 30, lon: 30 }): RoundResult {
  const artifact = makeArtifact(overrides);
  return { artifact, guess, breakdown: scoreGuess(guess, artifact.origin) };
}

describe('RevealPanel', () => {
  it('states the answer, the score and the distance', () => {
    render(<RevealPanel result={makeResult()} />);

    expect(screen.getByText('Thebes, Egypt')).toBeInTheDocument();
    expect(screen.getByText('Sphinx of Hatshepsut')).toBeInTheDocument();
    expect(screen.getByRole('meter', { name: /round score/i })).toBeInTheDocument();
    expect(screen.getByText(/off by/i)).toBeInTheDocument();
  });

  it('says which sense of location was being asked for', () => {
    // A player who pinned where an object was *made* when the answer was where it
    // was excavated must be able to see that, rather than assume a bug.
    const findspot = render(<RevealPanel result={makeResult({ origin: { kind: 'findspot' } })} />);
    expect(screen.getByText(/where it was found/i)).toBeInTheDocument();
    findspot.unmount();

    render(<RevealPanel result={makeResult({ origin: { kind: 'creation' } })} />);
    expect(screen.getByText(/where it was made/i)).toBeInTheDocument();
  });

  it('discloses how precisely the origin is recorded', () => {
    render(<RevealPanel result={makeResult({ origin: { tier: 'culture-region' } })} />);
    expect(screen.getByText(/recorded to cultural region/i)).toBeInTheDocument();
  });

  it('shows the educational fields when present', () => {
    render(<RevealPanel result={makeResult()} />);
    expect(screen.getByText('Ancient Egyptian')).toBeInTheDocument();
    expect(screen.getByText('New Kingdom')).toBeInTheDocument();
    expect(screen.getByText('Granite')).toBeInTheDocument();
    expect(screen.getByText(/MMA excavations/)).toBeInTheDocument();
    expect(screen.getByText('The Metropolitan Museum of Art')).toBeInTheDocument();
    expect(screen.getByText(/granite sphinx/i)).toBeInTheDocument();
  });

  it('omits rows for fields the provider does not supply', () => {
    render(
      <RevealPanel
        result={makeResult({
          description: null,
          culture: null,
          period: null,
          material: null,
          discovery: null,
          heldBy: null,
          accessionNumber: null,
        })}
      />,
    );
    expect(screen.queryByText('Culture')).not.toBeInTheDocument();
    expect(screen.queryByText('Material')).not.toBeInTheDocument();
    expect(screen.queryByText('Held by')).not.toBeInTheDocument();
    // The answer itself is still present.
    expect(screen.getByText('Thebes, Egypt')).toBeInTheDocument();
  });

  it('credits the image and metadata licences', () => {
    render(<RevealPanel result={makeResult()} />);
    expect(screen.getByText(/CC0 1\.0/)).toBeInTheDocument();
    expect(screen.getByText(/hand-checked gazetteer/i)).toBeInTheDocument();
  });

  it('links to the source record in a new tab', () => {
    render(<RevealPanel result={makeResult()} />);
    const link = screen.getByRole('link', { name: /view the original record/i });
    expect(link).toHaveAttribute('href', 'https://www.metmuseum.org/art/collection/search/1');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noreferrer'));
  });

  it('announces the outcome as one sentence for assistive technology', () => {
    render(<RevealPanel result={makeResult()} />);
    expect(screen.getByRole('status')).toHaveTextContent(/points\. Your guess was/i);
  });

  it('handles a very long title without crashing', () => {
    const title = 'Fragmentary limestone relief '.repeat(12).trim();
    render(<RevealPanel result={makeResult({ title })} />);
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Fragmentary limestone');
  });
});

describe('ClueList', () => {
  it('never names a place before the guess', () => {
    // The whole point of the pre-guess panel is that it cannot leak the answer.
    const artifact = makeArtifact();
    for (const difficulty of ['explorer', 'scholar', 'expert'] as const) {
      const { container, unmount } = render(
        <ClueList artifact={artifact} difficulty={difficulty} />,
      );
      const text = container.textContent ?? '';
      expect(text).not.toContain('Thebes');
      expect(text).not.toContain('Egypt,');
      unmount();
    }
  });

  it('reveals culture, date and material on Explorer', () => {
    render(<ClueList artifact={makeArtifact()} difficulty="explorer" />);
    expect(screen.getByText('Ancient Egyptian')).toBeInTheDocument();
    expect(screen.getByText('ca. 1473–1458 BCE')).toBeInTheDocument();
    expect(screen.getByText('Granite')).toBeInTheDocument();
  });

  it('withholds culture and date on Scholar', () => {
    render(<ClueList artifact={makeArtifact()} difficulty="scholar" />);
    expect(screen.queryByText('Ancient Egyptian')).not.toBeInTheDocument();
    expect(screen.queryByText('ca. 1473–1458 BCE')).not.toBeInTheDocument();
    expect(screen.getByText('Bronze Age')).toBeInTheDocument();
  });

  it('shows only the object type on Expert', () => {
    render(<ClueList artifact={makeArtifact()} difficulty="expert" />);
    expect(screen.getByText('Sculpture')).toBeInTheDocument();
    expect(screen.queryByText('Bronze Age')).not.toBeInTheDocument();
  });

  it('explains itself when there is nothing to show', () => {
    render(<ClueList artifact={makeArtifact({ objectType: null })} difficulty="expert" />);
    expect(screen.getByText(/no clues on this difficulty/i)).toBeInTheDocument();
  });
});
