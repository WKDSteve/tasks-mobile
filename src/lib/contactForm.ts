// The form of a contact on the phone: the text of its fields in, one operation out. The page decides nothing about
// the contact beyond what a link needs to be safe (`plainEmail`, `plainPhone`): the engine judges the rest, and the
// hub lets a phone write exactly these fields (`device_op_fields`, MOB-02). No address and no number is ever put into
// a notice or a problem: a problem names the field, never its text.

import { plainEmail, plainPhone } from './parse';
import type { ContactBrief, ContactFields, Op } from './types';

export interface ContactForm {
  area: string;
  name: string;
  org: string;
  role: string;
  /** One address per line. */
  emails: string;
  /** One number per line. */
  phones: string;
  /** Words separated by commas. */
  tags: string;
}

export type ContactProblem = 'name' | 'email' | 'phone' | 'tag' | 'nothing';

export type ContactCheck = { ok: true; op: Op } | { ok: false; problems: ContactProblem[] };

export function emptyForm(area: string): ContactForm {
  return { area, name: '', org: '', role: '', emails: '', phones: '', tags: '' };
}

/** The form of a contact that is there. */
export function formOf(contact: ContactBrief): ContactForm {
  return {
    area: contact.area,
    name: contact.name,
    org: contact.org ?? '',
    role: contact.role ?? '',
    emails: contact.emails.join('\n'),
    phones: contact.phones.join('\n'),
    tags: contact.tags.join(', '),
  };
}

const lines = (text: string): string[] =>
  text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '');

const words = (text: string): string[] =>
  text
    .split(',')
    .map((w) => w.trim())
    .filter((w) => w !== '');

const same = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * The operation of the form: a new contact when `before` is null, else only what differs from `before`, on the version
 * the form was opened on. A change of the addresses or numbers is written only when the hub gave them (`before.data`).
 */
export function contactOp(form: ContactForm, before: ContactBrief | null): ContactCheck {
  const problems: ContactProblem[] = [];
  const name = form.name.trim();
  if (name === '' || name.length > 200) problems.push('name');
  const emails = lines(form.emails);
  const phones = lines(form.phones);
  const tags = words(form.tags);
  if (emails.length > 20 || emails.some((e) => plainEmail(e) === null)) problems.push('email');
  if (phones.length > 20 || phones.some((p) => plainPhone(p) === null)) problems.push('phone');
  if (tags.length > 20 || tags.some((t) => t.length > 40)) problems.push('tag');
  if (problems.length > 0) return { ok: false, problems };

  const org = form.org.trim();
  const role = form.role.trim();
  if (before === null) {
    const fields: ContactFields = {};
    if (org !== '') fields.org = org;
    if (role !== '') fields.role = role;
    if (emails.length > 0) fields.emails = emails;
    if (phones.length > 0) fields.phones = phones;
    if (tags.length > 0) fields.tags = tags;
    return { ok: true, op: { op: 'contact_new', area: form.area, name, ...(Object.keys(fields).length > 0 ? { fields } : {}) } };
  }
  const patch: ContactFields & { name?: string } = {};
  if (name !== before.name) patch.name = name;
  if (org !== (before.org ?? '')) patch.org = org === '' ? null : org;
  if (role !== (before.role ?? '')) patch.role = role === '' ? null : role;
  if (before.data) {
    if (!same(emails, before.emails)) patch.emails = emails;
    if (!same(phones, before.phones)) patch.phones = phones;
  }
  if (!same(tags, before.tags)) patch.tags = tags;
  if (Object.keys(patch).length === 0) return { ok: false, problems: ['nothing'] };
  return { ok: true, op: { op: 'contact_set', id: before.id, patch, ...(before.etag ? { if_match: before.etag } : {}) } };
}
