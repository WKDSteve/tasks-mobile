import { describe, expect, it } from 'vitest';
import { pushKey, readNotice, taskFromAddress, withoutTask } from './push';

const KEY = `B${'A'.repeat(86)}`;

describe('notices of the hub (PWA-06)', () => {
  it('takes the hub key only in its shape', () => {
    expect(pushKey({ key: KEY })).toBe(KEY);
    for (const bad of [null, {}, { key: 'short' }, { key: `${KEY}=` }, { key: 42 }]) expect(() => pushKey(bad)).toThrow();
  });

  it('reads a notice only as the kind of this app and the id of a task', () => {
    expect(readNotice({ kind: 'remind', id: 'garden/water' })).toEqual({ kind: 'remind', id: 'garden/water' });
    expect(readNotice({ kind: 'decision', id: null })).toEqual({ kind: 'decision', id: null });
    for (const bad of [null, 'remind', { kind: 'ci_red', id: null }, { kind: 'remind', id: '../x' }, { kind: 'remind', id: 'x' }, { kind: 'remind', id: 3 }])
      expect(readNotice(bad)).toBeNull();
  });

  it('opens a task from the address only with a task id, and takes it out of the address', () => {
    expect(taskFromAddress('?task=garden%2Fwater')).toBe('garden/water');
    expect(taskFromAddress('?task=garden/water&x=1')).toBe('garden/water');
    expect(taskFromAddress('?task=..%2Fetc')).toBeNull();
    expect(taskFromAddress('?task=javascript:alert(1)')).toBeNull();
    expect(taskFromAddress('')).toBeNull();
    expect(withoutTask('/m/', '?task=garden/water&x=1', '#a')).toBe('/m/?x=1#a');
    expect(withoutTask('/m/', '?task=garden/water', '')).toBe('/m/');
  });
});
