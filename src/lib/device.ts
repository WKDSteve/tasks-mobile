// This phone's login at the hub (appkit-ui/device) as the page needs it. A hub that answers 429 is there but has too
// many logins right now (appkit counts pairings, challenges and device sessions together, 10 a minute): the page says
// so and tries again by itself, it does not show the hub as gone.

import { ApiError } from 'appkit-ui/client';
import { deviceLogin, pairDevice, type DeviceDeps } from 'appkit-ui/device';
import type { DeviceLogin } from './app.svelte';
import { HubBusy } from './source';

/** A session for the device kept here; `busy` for a 429 on the challenge or the session; throws when no hub answers. */
export async function loginAt(deps: DeviceDeps): Promise<DeviceLogin> {
  try {
    return await deviceLogin(deps);
  } catch (error) {
    if (error instanceof ApiError && error.status === 429) return { kind: 'busy' };
    throw error;
  }
}

/** Pair this phone with a one-time code; `HubBusy` for a 429 (the code is not used up: it can be tried again). */
export async function pairAt(deps: DeviceDeps, code: string, name: string): Promise<string> {
  try {
    return await pairDevice(deps, code, name);
  } catch (error) {
    if (error instanceof ApiError && error.status === 429) throw new HubBusy();
    throw error;
  }
}
