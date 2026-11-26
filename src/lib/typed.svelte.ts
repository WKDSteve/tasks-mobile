// What a person typed into a small form and did not send yet, kept while the page shows another screen: a line of the
// minutes of a meeting, and the reason for a learning point that is seen or dropped. Left for another screen, the form
// comes back as it was (the android back gesture sends no `beforeunload`, so a warning could never ask). Kept in the
// memory of the page only; the new-task form has its own, longer-lived draft (`draftStore`).

/** The line typed for the minutes of one meeting. */
export const minutesLine = $state<{ meeting: string; text: string }>({ meeting: '', text: '' });

/** The reason being typed for one point of one path, and the state the point is to get. */
export const pointReason = $state<{ path: string; key: string; state: 'seen' | 'dropped' | null; text: string }>({
  path: '',
  key: '',
  state: null,
  text: '',
});

/**
 * The result being typed for the exercise of one point of one path (its proof), and whether its sheet is open: closed
 * by a close request or left for another screen, the text is still there when the sheet is opened again.
 */
export const pointResult = $state<{ path: string; key: string; open: boolean; text: string }>({
  path: '',
  key: '',
  open: false,
  text: '',
});

/** The text typed for the minutes of `meeting` (empty for another meeting than the one typed for). */
export function lineFor(meeting: string): string {
  return minutesLine.meeting === meeting ? minutesLine.text : '';
}

export function setLine(meeting: string, text: string): void {
  minutesLine.meeting = meeting;
  minutesLine.text = text;
}
