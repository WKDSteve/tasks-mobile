// A native <dialog> shown as a modal (MUI-01: a consequential step is confirmed). The browser brings the inert page,
// the focus containment, the top layer and the close request (Esc, the back gesture of Android); this page adds
// neither a focus trap nor an Esc handler.

/**
 * Svelte action: open the dialog it sits on with `showModal()`.
 *
 * `closedby` is never `any`: a tap beside the dialog must neither confirm nor discard anything. `closerequest` (the
 * default of a modal) closes on Esc and the back gesture; `none` only on the dialog's own buttons. It is set here
 * because the attribute is progressive enhancement: where the browser does not know `closedby`, Esc still closes the
 * modal (the `cancel` event, then `close`), so the page reacts to `close` and does not depend on the attribute.
 */
export function modal(node: HTMLDialogElement, closedby: 'closerequest' | 'none' = 'closerequest'): void {
  node.setAttribute('closedby', closedby);
  if (!node.open) node.showModal();
}
