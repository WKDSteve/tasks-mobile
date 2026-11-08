import { describe, expect, it } from 'vitest';
import { readShare, safeLink, withoutShare } from './share';

function q(params: Record<string, string>): string {
  return `?${new URLSearchParams(params).toString()}`;
}

describe('share target (MSEC-07: input from other apps is hostile)', () => {
  it('is no share without its parameters', () => {
    expect(readShare('')).toBeNull();
    expect(readShare('?title=x&text=y')).toBeNull();
  });

  it('takes the title, the text and a web link', () => {
    expect(readShare(q({ share_title: 'Article', share_text: 'Read later', share_url: 'https://example.org/a' }))).toEqual({
      title: 'Article',
      context: 'Read later\nhttps://example.org/a',
    });
  });

  it('takes the first line of the text as the title when there is none', () => {
    expect(readShare(q({ share_text: 'First line\nsecond line' }))).toEqual({ title: 'First line', context: 'second line' });
  });

  it('does not repeat a link the text holds already', () => {
    expect(readShare(q({ share_title: 'T', share_text: 'see https://example.org/a', share_url: 'https://example.org/a' }))).toEqual({
      title: 'T',
      context: 'see https://example.org/a',
    });
  });

  it('drops links that are not web links', () => {
    expect(safeLink('javascript:alert(1)')).toBeNull();
    expect(safeLink('data:text/html,<b>x</b>')).toBeNull();
    expect(safeLink('intent://scan/#Intent;scheme=zxing;end')).toBeNull();
    expect(safeLink('file:///etc/passwd')).toBeNull();
    expect(safeLink('https://user:pw@example.org/')).toBeNull();
    expect(safeLink('https://example.org/ x')).toBeNull();
    expect(safeLink('https://example.org/x')).toBe('https://example.org/x');
  });

  it('drops hidden characters and controls and cuts the lengths', () => {
    const hidden = String.fromCodePoint(0x202e) + String.fromCodePoint(0x200b) + String.fromCodePoint(0x0007);
    const shared = readShare(q({ share_title: `a${hidden}b`.padEnd(1000, 'x'), share_text: 'y'.repeat(10_000) }));
    expect(shared?.title.startsWith('ab')).toBe(true);
    expect([...(shared?.title ?? '')].length).toBe(200);
    expect([...(shared?.context ?? '')].length).toBeLessThanOrEqual(2000);
  });

  it('takes the share out of the address and keeps the rest', () => {
    expect(withoutShare('/m/', q({ share_title: 'x', share_url: 'https://e.org', keep: '1' }), '#r')).toBe('/m/?keep=1#r');
    expect(withoutShare('/m/', q({ share_text: 'x' }), '')).toBe('/m/');
  });
});
