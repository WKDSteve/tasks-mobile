import { describe, expect, it } from 'vitest';
import type { DeviceDeps, DeviceRecord } from 'appkit-ui/device';
import { loginAt, pairAt } from './device';
import { HubBusy } from './source';

const DEVICE = 'd'.repeat(32);

/** A kept device and a hub that answers the challenge with `status` (and a body of the hub's error shape). */
function hubAnswering(status: number): { deps: DeviceDeps; asked: string[]; cleared: () => boolean } {
  const asked: string[] = [];
  let cleared = false;
  const record = { id: DEVICE, keys: {} as CryptoKeyPair } as DeviceRecord;
  const deps: DeviceDeps = {
    fetchFn: (async (input: RequestInfo | URL) => {
      asked.push(String(input));
      return new Response(JSON.stringify({ error: { code: 'rate_limited', message: 'too many attempts' } }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch,
    subtle: globalThis.crypto.subtle,
    store: {
      load: async () => record,
      save: async () => undefined,
      clear: async () => {
        cleared = true;
      },
    },
    origin: 'https://phone.test',
  };
  return { deps, asked, cleared: () => cleared };
}

describe('the login of this device', () => {
  it('a 429 on the challenge is a busy hub, not an unreachable one, and the device is kept', async () => {
    const hub = hubAnswering(429);
    expect(await loginAt(hub.deps)).toEqual({ kind: 'busy' });
    expect(hub.asked).toEqual(['/auth/device/challenge']);
    expect(hub.cleared()).toBe(false);
  });

  it('other refusals of the challenge stay errors', async () => {
    await expect(loginAt(hubAnswering(500).deps)).rejects.toMatchObject({ status: 500 });
  });

  it('a 429 on pairing is a busy hub, and nothing is kept', async () => {
    const hub = hubAnswering(429);
    let saved = false;
    hub.deps.store.save = async () => {
      saved = true;
    };
    await expect(pairAt(hub.deps, 'c'.repeat(32), 'Phone')).rejects.toBeInstanceOf(HubBusy);
    expect(hub.asked).toEqual(['/auth/device/pair']);
    expect(saved).toBe(false);
  });

  it('other refusals of pairing stay the error of the hub', async () => {
    await expect(pairAt(hubAnswering(404).deps, 'c'.repeat(32), 'Phone')).rejects.toMatchObject({ status: 404 });
  });

  it('no hub at all stays an error (the page is offline)', async () => {
    const hub = hubAnswering(200);
    hub.deps.fetchFn = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    await expect(loginAt(hub.deps)).rejects.toBeInstanceOf(TypeError);
  });
});
