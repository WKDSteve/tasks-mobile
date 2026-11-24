import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The pairing screen is not reachable in the synthetic page (it is paired), so its fields are checked in the source: the
// code and the device name are no words for a spell checker or a translator, and the name starts with a capital.
describe('the fields of the pairing form', () => {
  const source = readFileSync('src/views/Pair.svelte', 'utf8');
  const field = (id: string): string => source.split('\n').find((line) => line.includes(`id="${id}"`)) ?? '';

  it('the code has spellcheck off and no capital', () => {
    expect(field('pair-code')).toContain('spellcheck="false"');
    expect(field('pair-code')).toContain('autocapitalize="off"');
  });

  it('the device name has spellcheck off, capital words and is not translated', () => {
    expect(field('pair-name')).toContain('spellcheck="false"');
    expect(field('pair-name')).toContain('autocapitalize="words"');
    expect(field('pair-name')).toContain('translate="no"');
  });
});
