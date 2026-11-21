import { describe, expect, it } from 'vitest';
import { meetingFromAddress, PUSH_KINDS, pushKey, readNotice, taskFromAddress, withoutTask } from './push';

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

  it('subscribes to the notices of the meetings, before the beginning and after the end', () => {
    expect(PUSH_KINDS).toEqual(['remind', 'decision', 'meeting', 'meeting_end']);
    expect(readNotice({ kind: 'meeting', id: 'garden/zaun' })).toEqual({ kind: 'meeting', id: 'garden/zaun' });
    expect(readNotice({ kind: 'meeting_end', id: 'garden/zaun-2026-11-21' })).toEqual({ kind: 'meeting_end', id: 'garden/zaun-2026-11-21' });
    expect(readNotice({ kind: 'meeting', id: '../x' })).toBeNull();
  });

  it('opens a meeting from the address only with an id, and takes it out of the address', () => {
    expect(meetingFromAddress('?meeting=garden%2Fzaun')).toBe('garden/zaun');
    expect(meetingFromAddress('?meeting=..%2Fetc')).toBeNull();
    expect(meetingFromAddress('?task=garden/zaun')).toBeNull();
    expect(withoutTask('/m/', '?meeting=garden/zaun&x=1', '')).toBe('/m/?x=1');
  });
});
