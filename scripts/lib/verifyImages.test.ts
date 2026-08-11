import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyArtifactImages } from './verifyImages';
import { makeArtifact } from '../../src/test/factories';

/**
 * Ingest-time photograph verification.
 *
 * The rule these tests exist to protect: a *definite* failure drops the artifact, an
 * *inconclusive* one never does. The first run of this stage treated `429` as a
 * failure and silently deleted 1,026 good Met artifacts, which is the kind of data
 * loss that looks like a successful build.
 */

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

function imageResponse(): Response {
  return new Response(JPEG, { status: 200, headers: { 'content-type': 'image/jpeg' } });
}

function statusResponse(status: number): Response {
  return new Response('nope', { status, headers: { 'content-type': 'text/plain' } });
}

function htmlResponse(): Response {
  return new Response('<html>not found</html>', {
    status: 200,
    headers: { 'content-type': 'text/html' },
  });
}

let cachePath: string;
let cacheDir: string;

beforeEach(async () => {
  // Never touch the real .cache/image-verify.json.
  cacheDir = await mkdtemp(path.join(tmpdir(), 'verify-images-'));
  cachePath = path.join(cacheDir, 'image-verify.json');
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(cacheDir, { recursive: true, force: true });
});

/** Routes each URL to a queue of responses, so retries can be given a different one. */
function stubFetch(routes: Record<string, Array<() => Response>>) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      const queue = routes[url];
      if (!queue || queue.length === 0) throw new Error(`unstubbed URL: ${url}`);
      const next = queue.length > 1 ? queue.shift()! : queue[0]!;
      return next();
    }),
  );
  return calls;
}

function artifactWith(url: string, alternates: string[] = []) {
  return makeArtifact({ id: `met:${url}`, image: { url, alternates } });
}

describe('verifyArtifactImages — definite failures', () => {
  it('drops an artifact whose photograph is a 404', async () => {
    const artifact = artifactWith('https://cdn.test/gone.jpg');
    stubFetch({ 'https://cdn.test/gone.jpg': [() => statusResponse(404)] });

    const result = await verifyArtifactImages([artifact], { cachePath, retryDelayMs: 0 });

    expect(result.artifacts).toHaveLength(0);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0]!.reason).toBe('http-404');
  });

  it('drops a 200 that carries an HTML error page', async () => {
    const artifact = artifactWith('https://cdn.test/hotlink.jpg');
    stubFetch({ 'https://cdn.test/hotlink.jpg': [() => htmlResponse()] });

    const result = await verifyArtifactImages([artifact], { cachePath, retryDelayMs: 0 });

    expect(result.artifacts).toHaveLength(0);
    expect(result.dropped[0]!.reason).toBe('html-not-image');
  });

  it('keeps an artifact whose photograph is real image bytes', async () => {
    const artifact = artifactWith('https://cdn.test/good.jpg');
    stubFetch({ 'https://cdn.test/good.jpg': [() => imageResponse()] });

    const result = await verifyArtifactImages([artifact], { cachePath, retryDelayMs: 0 });

    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]!.image.verifiedAt).toBeTruthy();
    expect(result.unverified).toHaveLength(0);
  });
});

describe('verifyArtifactImages — throttling is not a failure', () => {
  it('keeps an artifact the CDN only ever rate-limited', async () => {
    const artifact = artifactWith('https://cdn.test/busy.jpg');
    stubFetch({ 'https://cdn.test/busy.jpg': [() => statusResponse(429)] });

    const result = await verifyArtifactImages([artifact], { cachePath, retryDelayMs: 0 });

    expect(result.dropped).toHaveLength(0);
    expect(result.artifacts).toHaveLength(1);
    // Kept, but honestly labelled: nothing confirmed this photograph.
    expect(result.artifacts[0]!.image.verifiedAt).toBeNull();
    expect(result.unverified[0]!.reason).toBe('http-429');
  });

  it.each([500, 503, 408, 403])(
    'treats %i as inconclusive, not as a dead image',
    async (status) => {
      const artifact = artifactWith('https://cdn.test/x.jpg');
      stubFetch({ 'https://cdn.test/x.jpg': [() => statusResponse(status)] });

      const result = await verifyArtifactImages([artifact], { cachePath, retryDelayMs: 0 });

      expect(result.dropped).toHaveLength(0);
      expect(result.artifacts).toHaveLength(1);
    },
  );

  it('retries a throttled URL and confirms it when the CDN recovers', async () => {
    const artifact = artifactWith('https://cdn.test/slow.jpg');
    const calls = stubFetch({
      'https://cdn.test/slow.jpg': [() => statusResponse(429), () => imageResponse()],
    });

    const result = await verifyArtifactImages([artifact], { cachePath, retryDelayMs: 0 });

    expect(calls.length).toBeGreaterThan(1);
    expect(result.artifacts[0]!.image.verifiedAt).toBeTruthy();
    expect(result.unverified).toHaveLength(0);
  });

  it('never caches an inconclusive verdict', async () => {
    const artifact = artifactWith('https://cdn.test/busy2.jpg');
    const calls = stubFetch({ 'https://cdn.test/busy2.jpg': [() => statusResponse(429)] });

    await verifyArtifactImages([artifact], { cachePath, retryDelayMs: 0 });
    const afterFirst = calls.length;
    await verifyArtifactImages([artifact], { cachePath, retryDelayMs: 0 });

    // A busy afternoon must not become three days of missing artifacts.
    expect(calls.length).toBeGreaterThan(afterFirst);
  });
});

describe('verifyArtifactImages — renditions', () => {
  it('promotes the alternate that works and keeps the rest as fallbacks', async () => {
    const artifact = artifactWith('https://cdn.test/dead.jpg', ['https://cdn.test/alt.jpg']);
    stubFetch({
      'https://cdn.test/dead.jpg': [() => statusResponse(404)],
      'https://cdn.test/alt.jpg': [() => imageResponse()],
    });

    const result = await verifyArtifactImages([artifact], { cachePath, retryDelayMs: 0 });
    const image = result.artifacts[0]!.image;

    expect(image.url).toBe('https://cdn.test/alt.jpg');
    expect(image.alternates).toEqual(['https://cdn.test/dead.jpg']);
    expect(image.verifiedAt).toBeTruthy();
    expect(result.promoted).toBe(1);
  });

  it('drops only when every rendition definitely fails', async () => {
    const artifact = artifactWith('https://cdn.test/a.jpg', ['https://cdn.test/b.jpg']);
    stubFetch({
      'https://cdn.test/a.jpg': [() => statusResponse(404)],
      'https://cdn.test/b.jpg': [() => statusResponse(410)],
    });

    const result = await verifyArtifactImages([artifact], { cachePath, retryDelayMs: 0 });
    expect(result.artifacts).toHaveLength(0);
  });

  it('keeps the artifact when one rendition is dead and another is merely throttled', async () => {
    const artifact = artifactWith('https://cdn.test/c.jpg', ['https://cdn.test/d.jpg']);
    stubFetch({
      'https://cdn.test/c.jpg': [() => statusResponse(404)],
      'https://cdn.test/d.jpg': [() => statusResponse(429)],
    });

    const result = await verifyArtifactImages([artifact], { cachePath, retryDelayMs: 0 });

    expect(result.artifacts).toHaveLength(1);
    expect(result.unverified).toHaveLength(1);
  });
});

describe('verifyArtifactImages — caching', () => {
  it('reuses a stored verdict instead of re-requesting', async () => {
    const artifact = artifactWith('https://cdn.test/cached.jpg');
    const calls = stubFetch({ 'https://cdn.test/cached.jpg': [() => imageResponse()] });

    await verifyArtifactImages([artifact], { cachePath, retryDelayMs: 0 });
    expect(calls).toHaveLength(1);

    const second = await verifyArtifactImages([artifact], { cachePath, retryDelayMs: 0 });
    expect(calls).toHaveLength(1);
    expect(second.fromCache).toBe(1);
    expect(second.artifacts).toHaveLength(1);
  });

  it('remembers a definite failure so the next run drops it for free', async () => {
    const artifact = artifactWith('https://cdn.test/dead2.jpg');
    const calls = stubFetch({ 'https://cdn.test/dead2.jpg': [() => statusResponse(404)] });

    await verifyArtifactImages([artifact], { cachePath, retryDelayMs: 0 });
    const second = await verifyArtifactImages([artifact], { cachePath, retryDelayMs: 0 });

    expect(calls).toHaveLength(1);
    expect(second.artifacts).toHaveLength(0);
    expect(second.fromCache).toBe(1);
  });
});
