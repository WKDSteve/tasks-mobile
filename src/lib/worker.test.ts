import { describe, expect, it } from 'vitest';
import { WORKER_POLICY, WORKER_URL, workerScriptUrl, workerUrl } from './worker';

describe('the Trusted Types policy of the worker', () => {
  it('lets through the address of the worker and nothing else', () => {
    expect(workerScriptUrl('./sw.js')).toBe('./sw.js');
    for (const other of ['https://evil.example/sw.js', './sw.js?x', '/sw.js', 'data:text/javascript,1', './SW.js']) {
      expect(() => workerScriptUrl(other)).toThrow(TypeError);
    }
  });

  it('makes the policy under its name, with that rule', () => {
    const made: { name: string; rule: (s: string) => string }[] = [];
    const tt = {
      createPolicy(name: string, rules: { createScriptURL(input: string): string }) {
        made.push({ name, rule: rules.createScriptURL });
        return { createScriptURL: (s: string) => rules.createScriptURL(s) };
      },
    };
    expect(workerUrl(tt)).toBe(WORKER_URL);
    expect(made[0]?.name).toBe(WORKER_POLICY);
    expect(() => made[0]?.rule('./other.js')).toThrow();
  });

  it('is the plain address where the browser has no Trusted Types', () => {
    expect(workerUrl(undefined)).toBe('./sw.js');
  });
});
