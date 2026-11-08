// The service worker is registered with a script URL, which Trusted Types guards. This page has one policy of its
// own for it, `tasks-mobile-worker`, and it turns exactly one string into a script URL: the address of the worker.
// Anything else it is asked for is refused, so the policy cannot be used to load another script.

export const WORKER_URL = './sw.js';
export const WORKER_POLICY = 'tasks-mobile-worker';

interface ScriptUrlPolicy {
  createScriptURL(input: string): unknown;
}

interface TrustedTypesLike {
  createPolicy(name: string, rules: { createScriptURL(input: string): string }): ScriptUrlPolicy;
}

/** The only thing the policy lets through. */
export function workerScriptUrl(input: string): string {
  if (input !== WORKER_URL) throw new TypeError('not the service worker');
  return input;
}

/** The address of the worker as the browser wants it: a trusted script URL where Trusted Types exist, else the string. */
export function workerUrl(trustedTypes: TrustedTypesLike | undefined): string {
  if (!trustedTypes) return WORKER_URL;
  const policy = trustedTypes.createPolicy(WORKER_POLICY, { createScriptURL: workerScriptUrl });
  return policy.createScriptURL(WORKER_URL) as string;
}
