import { describe, expect, it } from 'vitest';
import { chooseLang, DICTIONARIES, translator } from './i18n';

describe('i18n (WEB-24)', () => {
  it('has the same keys in both languages, none empty', () => {
    const de = Object.keys(DICTIONARIES.de).sort();
    const en = Object.keys(DICTIONARIES.en).sort();
    expect(en).toEqual(de);
    for (const dictionary of Object.values(DICTIONARIES)) {
      for (const text of Object.values(dictionary)) expect(text.trim()).not.toBe('');
    }
  });

  it('uses the same holes in both languages', () => {
    const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const key of Object.keys(DICTIONARIES.de) as (keyof typeof DICTIONARIES.de)[]) {
      expect(holes(DICTIONARIES.en[key]), key).toEqual(holes(DICTIONARIES.de[key]));
    }
  });

  it('picks the language of the phone, English otherwise', () => {
    expect(chooseLang(['de-AT', 'en'])).toBe('de');
    expect(chooseLang(['fr'])).toBe('en');
    expect(translator('de')('list.questions', { n: 2 })).toBe('2 offene Fragen');
  });
});
