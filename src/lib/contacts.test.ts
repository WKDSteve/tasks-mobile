import { describe, expect, it } from 'vitest';
import { contactOp, emptyForm, formOf } from './contactForm';
import { contactBrief, contactDetail, contactList, plainEmail, plainPhone, ShapeError } from './parse';
import { rightFor } from './rights';
import type { DataClass } from './types';

const classes = new Map<string, DataClass>([
  ['garden', 'public'],
  ['kitchen', 'internal'],
  ['secret', 'private'],
]);

const entry = (area: string, extra: Record<string, unknown> = {}) => ({
  id: `${area}/rick`,
  area,
  name: 'Rick',
  tags: ['a'],
  etag: 'e1',
  ...extra,
});

describe('the contacts the hub cut', () => {
  it('keeps contacts of shown areas only, by name, and says whether the data was given', () => {
    const doc = {
      kind: 'tasks.contacts',
      items: [
        entry('garden', { name: 'Zed', emails: ['z@example.org'], phones: ['+49 30 1234'], summary: 'Hi' }),
        entry('kitchen', { name: 'Anna' }),
        entry('secret', { name: 'Hidden', emails: ['h@example.org'] }),
        entry('loose', { name: 'Unclassified' }),
      ],
      partial: true,
    };
    const list = contactList(doc, classes);
    expect(list.contacts.map((c) => [c.name, c.data])).toEqual([
      ['Anna', false],
      ['Zed', true],
    ]);
    expect(list.partial).toBe(true);
    // Without the data the page holds no address, no number and no text of the contact.
    expect(list.contacts[0]).toMatchObject({ emails: [], phones: [], summary: null });
  });

  it('takes only an address or a number a link can carry', () => {
    expect(plainEmail('a.b@example.org')).toBe('a.b@example.org');
    for (const bad of ['a@b', 'a b@c.de', 'a@b.de?bcc=x@y.de', 'a@b.de#x', '<a@b.de>', 'a@@b.de', 'a%40b.de', 'javascript:alert(1)']) expect(plainEmail(bad), bad).toBeNull();
    expect(plainPhone('+49 170 1234567')).toBe('+49 170 1234567');
    for (const bad of ['', '12', '1234;ATD', 'tel:123', '+49 170 12x', '0'.repeat(50)]) expect(plainPhone(bad), bad).toBeNull();
    const c = contactBrief(entry('garden', { emails: ['ok@example.org', 'a@b.de?x=1'], phones: ['12;34', '030 123456'] }), classes);
    expect(c?.emails).toEqual(['ok@example.org']);
    expect(c?.phones).toEqual(['030 123456']);
  });

  it('refuses a contact of a hidden area, and a document that is none', () => {
    expect(() => contactDetail({ kind: 'tasks.contact', contact: entry('secret') }, classes)).toThrow(ShapeError);
    expect(() => contactDetail({ kind: 'tasks.meeting' }, classes)).toThrow(ShapeError);
    expect(() => contactList({ kind: 'tasks.contacts' }, classes)).toThrow(ShapeError);
  });

  it('gives the notes only with the data, and the meetings by id and title', () => {
    const open = contactDetail({ kind: 'tasks.contact', contact: entry('garden', { emails: [] }), notes: 'N', history: [{ id: 'garden/m1', title: 'M', present: true }, { id: 'nope', title: 'x' }] }, classes);
    expect(open.notes).toBe('N');
    expect(open.history).toEqual([{ id: 'garden/m1', title: 'M', present: true }]);
    const closed = contactDetail({ kind: 'tasks.contact', contact: entry('kitchen'), notes: 'leak' }, classes);
    expect(closed.notes).toBe('');
  });
});

describe('the form of a contact', () => {
  const brief = contactBrief(entry('garden', { org: 'ACME', emails: ['a@example.org'], phones: ['030 123456'], tags: ['x', 'y'] }), classes)!;

  it('makes a new contact with the fields that are filled', () => {
    const check = contactOp({ ...emptyForm('garden'), name: ' Cora ', emails: 'c@example.org\n\n d@example.org ', tags: 'a, b,' }, null);
    expect(check).toEqual({ ok: true, op: { op: 'contact_new', area: 'garden', name: 'Cora', fields: { emails: ['c@example.org', 'd@example.org'], tags: ['a', 'b'] } } });
    expect(contactOp({ ...emptyForm('garden'), name: 'Solo' }, null)).toEqual({ ok: true, op: { op: 'contact_new', area: 'garden', name: 'Solo' } });
  });

  it('writes only what differs, with the version read, and clears a field with null', () => {
    const form = { ...formOf(brief), role: 'Chef', org: '' };
    expect(contactOp(form, brief)).toEqual({ ok: true, op: { op: 'contact_set', id: 'garden/rick', patch: { org: null, role: 'Chef' }, if_match: 'e1' } });
    expect(contactOp(formOf(brief), brief)).toEqual({ ok: false, problems: ['nothing'] });
  });

  it('leaves the addresses and numbers alone when the hub did not give them', () => {
    const closed = contactBrief(entry('kitchen'), classes)!;
    const form = { ...formOf(closed), emails: 'injected@example.org', role: 'R' };
    expect(contactOp(form, closed)).toEqual({ ok: true, op: { op: 'contact_set', id: 'kitchen/rick', patch: { role: 'R' }, if_match: 'e1' } });
  });

  it('names the field of a problem, never its text', () => {
    const check = contactOp({ ...emptyForm('garden'), name: ' ', emails: 'secret-text', phones: 'x;y' }, null);
    expect(check).toEqual({ ok: false, problems: ['name', 'email', 'phone'] });
    expect(JSON.stringify(check)).not.toContain('secret-text');
  });

  it('needs `create` for a new contact and `change` for a change', () => {
    expect(rightFor({ op: 'contact_new', area: 'garden', name: 'x' })).toBe('create');
    expect(rightFor({ op: 'contact_set', id: 'garden/x', patch: { role: 'y' } })).toBe('change');
  });
});
