import { describe, expect, it } from 'vitest';
import { checkDraft } from './capture';

const areas = ['garden', 'kitchen'];

describe('checkDraft', () => {
  it('makes a new operation of a good draft, without an empty body', () => {
    expect(checkDraft({ area: 'garden', title: '  Water  ', context: '' }, areas)).toEqual({
      ok: true,
      op: { op: 'new', area: 'garden', title: 'Water' },
    });
    expect(checkDraft({ area: 'garden', title: 'Water', context: 'twice' }, areas)).toEqual({
      ok: true,
      op: { op: 'new', area: 'garden', title: 'Water', body: 'twice' },
    });
  });

  it('refuses an area this phone may not write to', () => {
    expect(checkDraft({ area: 'secret', title: 'x', context: '' }, areas)).toEqual({ ok: false, problems: ['area_unknown'] });
  });

  it('names every problem at once', () => {
    const result = checkDraft({ area: 'nowhere', title: '', context: 'y'.repeat(2001) }, areas);
    expect(result).toEqual({ ok: false, problems: ['title_empty', 'context_long', 'area_unknown'] });
  });

  it('refuses a title of two lines, and an overlong one', () => {
    expect(checkDraft({ area: 'garden', title: 'a\nb', context: '' }, areas)).toMatchObject({ problems: ['title_lines'] });
    expect(checkDraft({ area: 'garden', title: 'a'.repeat(201), context: '' }, areas)).toMatchObject({ problems: ['title_long'] });
  });

  it('refuses hidden characters (bidi override, zero width, controls)', () => {
    for (const bad of [0x202e, 0x200b, 0x0007, 0xfeff, 0x2066]) {
      const ch = String.fromCodePoint(bad);
      expect(checkDraft({ area: 'garden', title: `a${ch}b`, context: '' }, areas)).toMatchObject({ problems: ['hidden_chars'] });
      expect(checkDraft({ area: 'garden', title: 'ok', context: `a${ch}b` }, areas)).toMatchObject({ problems: ['hidden_chars'] });
    }
  });

  it('lets line breaks and tabs through in the context', () => {
    expect(checkDraft({ area: 'garden', title: 'ok', context: 'a\n\tb' }, areas).ok).toBe(true);
  });
});
