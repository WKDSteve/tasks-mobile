// A form that is not complete can still be sent: it says what is missing at the field (`aria-invalid`, `aria-describedby`,
// a short text) and puts the focus on the first field that is wrong. A button that is `disabled` for an empty field leaves
// the person guessing; it is locked only while a request runs.

/** Put the focus on the first field of `root` that says it is invalid; whether there was one. */
export function focusFirstInvalid(root: ParentNode | null | undefined): boolean {
  const field = root?.querySelector<HTMLElement>('[aria-invalid="true"]');
  if (!field) return false;
  field.focus();
  return true;
}
