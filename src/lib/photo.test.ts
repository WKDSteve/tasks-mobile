import { describe, expect, it } from 'vitest';
import { fitWithin, MAX_EDGE, shrinkPhoto, type Canvasing } from './photo';

/** A browser that decodes any blob as `width` x `height` and draws what it is asked for as a WebP of `bytes` bytes. */
function canvasing(width: number, height: number, bytes = 1000): { api: Canvasing; drawn: { width: number; height: number }[] } {
  const drawn: { width: number; height: number }[] = [];
  return {
    drawn,
    api: {
      decode: async () => ({
        width,
        height,
        draw: async (w, h) => {
          drawn.push({ width: w, height: h });
          return new Blob([new Uint8Array(bytes)], { type: 'image/webp' });
        },
      }),
    },
  };
}
const photo = (bytes: number, type = 'image/jpeg') => new Blob([new Uint8Array(bytes)], { type });

describe('the size of a photo that goes to the hub', () => {
  it('keeps a picture that fits, and scales the longer side down to the limit, keeping the proportions', () => {
    expect(fitWithin(1200, 800)).toEqual({ width: 1200, height: 800 });
    expect(fitWithin(4000, 3000)).toEqual({ width: MAX_EDGE, height: 1536 });
    expect(fitWithin(3000, 4000)).toEqual({ width: 1536, height: MAX_EDGE });
  });

  it('a 4000 x 3000 photo is drawn at 2048 x 1536 and goes on as the smaller WebP', async () => {
    const c = canvasing(4000, 3000);
    const original = photo(5_000_000);
    const result = await shrinkPhoto(original, c.api);
    expect(c.drawn).toEqual([{ width: 2048, height: 1536 }]);
    expect(result.type).toBe('image/webp');
    expect(result.size).toBeLessThan(original.size);
  });

  it('leaves a small photo, a GIF and a file that cannot be decoded as they are', async () => {
    const small = photo(300_000);
    expect(await shrinkPhoto(small, canvasing(1600, 1200).api)).toBe(small);
    const gif = photo(9_000_000, 'image/gif');
    expect(await shrinkPhoto(gif, canvasing(4000, 3000).api)).toBe(gif);
    const heic = photo(4_000_000, 'image/heic');
    const broken: Canvasing = { decode: async () => Promise.reject(new Error('cannot decode')) };
    expect(await shrinkPhoto(heic, broken)).toBe(heic);
    expect(await shrinkPhoto(heic, null)).toBe(heic);
  });

  it('does not take a result that is larger than the original', async () => {
    const original = photo(20_000);
    expect(await shrinkPhoto(original, canvasing(4000, 3000, 90_000).api)).toBe(original);
  });
});
