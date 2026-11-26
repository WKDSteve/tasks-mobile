import { describe, expect, it } from 'vitest';
import { hasBlock, needsResult, parseExercise, spans } from './exercise';

const BLOCK = [
  '**Aufgabe:** Schreibe eine Funktion,',
  'die einen `&str` leiht.',
  '**Fertig, wenn:** `cargo test` ist grün.',
  '**Nachweis:** Link zum Commit.',
  '**Ergebnis:**',
].join('\n');

describe('the exercise block of a learning point', () => {
  it('takes the labelled parts apart, the lines of a part joined', () => {
    expect(parseExercise(BLOCK)).toEqual({
      aufgabe: 'Schreibe eine Funktion, die einen `&str` leiht.',
      fertig: '`cargo test` ist grün.',
      nachweis: 'Link zum Commit.',
      ergebnis: '',
    });
  });

  it('leaves out text before the first label and parts with an unknown label; reads CRLF and any case', () => {
    expect(parseExercise('Vorweg\r\n**aufgabe:** A\r\n**Quelle:** x\r\nweiter\r\n**FERTIG, WENN:** B')).toEqual({ aufgabe: 'A', fertig: 'B' });
    expect(parseExercise(null)).toEqual({});
    expect(parseExercise('Kapitel 1 bis 4')).toEqual({});
  });

  it('has a block with a part Aufgabe, even an empty one (as the engine)', () => {
    expect(hasBlock(BLOCK)).toBe(true);
    expect(hasBlock('**Aufgabe:**')).toBe(true);
    expect(hasBlock('**Nachweis:** x')).toBe(false);
    expect(hasBlock('Kapitel 1 bis 4')).toBe(false);
    expect(hasBlock(null)).toBe(false);
  });

  it('needs a result only where a proof is asked for and the result is empty', () => {
    expect(needsResult(BLOCK)).toBe(true);
    expect(needsResult(`${BLOCK} https://example.org/c/1`)).toBe(false);
    expect(needsResult('**Aufgabe:** A\n**Ergebnis:**')).toBe(false);
    expect(needsResult('**Aufgabe:** A\n**Nachweis:**')).toBe(false);
    expect(needsResult(null)).toBe(false);
  });

  it('draws code as code and strong text without its marks, never as HTML', () => {
    expect(spans('Run `cargo test` and **not** `<b>`.')).toEqual([
      { kind: 'text', text: 'Run ' },
      { kind: 'code', text: 'cargo test' },
      { kind: 'text', text: ' and ' },
      { kind: 'strong', text: 'not' },
      { kind: 'text', text: ' ' },
      { kind: 'code', text: '<b>' },
      { kind: 'text', text: '.' },
    ]);
    // A mark that is not closed stays text; code keeps the stars it holds.
    expect(spans('a `b and **c')).toEqual([{ kind: 'text', text: 'a `b and **c' }]);
    expect(spans('`**x**`')).toEqual([{ kind: 'code', text: '**x**' }]);
    expect(spans('')).toEqual([]);
  });
});
