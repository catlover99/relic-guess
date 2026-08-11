import type { Artifact, ProviderId } from '../../src/data/schema.js';
import type { Gazetteer } from './gazetteer.js';

export interface HarvestContext {
  gazetteer: Gazetteer;
  /** Soft cap on candidate records to request per provider. */
  limit: number;
  /** ISO timestamp stamped onto every record from this run. */
  now: string;
  /** Deterministic sampling seed so repeat runs pick the same objects. */
  seed: number;
  log: (message: string) => void;
}

export interface ProviderAdapter {
  id: ProviderId;
  /** Display name shown in the credits panel. */
  name: string;
  /** Provider homepage / open-access landing page. */
  url: string;
  metadataLicense: string;
  imageLicense: string;
  /** Verbatim credit string the provider asks us to display. */
  attribution: string;
  harvest(context: HarvestContext): Promise<Artifact[]>;
}

export interface HarvestStats {
  requested: number;
  normalized: number;
  skippedNoGeo: number;
  skippedNoImage: number;
}
