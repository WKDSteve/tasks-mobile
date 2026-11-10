// A voice note from the microphone. The microphone is asked for only when the person presses the button (AND-01),
// never at the start, and is let go as soon as the recording ends: by the button, by the time limit, or because the
// page went to the background (a recording runs in the foreground only).

/** The media types tried, the first the browser can record is taken (Chrome on Android: WebM with Opus). */
export const VOICE_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg'];

export interface RecorderDeps {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
  Recorder: {
    new (stream: MediaStream, options?: MediaRecorderOptions): MediaRecorder;
    isTypeSupported(type: string): boolean;
  };
}

export interface Recording {
  /** Ends the recording; the note, or `null` when nothing was recorded. */
  stop(): Promise<Blob | null>;
}

/** The first type of `VOICE_TYPES` the browser records, or none (then the browser picks). */
export function voiceType(isTypeSupported: (type: string) => boolean): string | null {
  return VOICE_TYPES.find((t) => isTypeSupported(t)) ?? null;
}

/** Start recording; the microphone is released when the recording stops. */
export async function startRecording(deps: RecorderDeps): Promise<Recording> {
  const stream = await deps.getUserMedia({ audio: true, video: false });
  const type = voiceType((t) => deps.Recorder.isTypeSupported(t));
  let recorder: MediaRecorder;
  try {
    recorder = new deps.Recorder(stream, type ? { mimeType: type } : undefined);
  } catch (error) {
    for (const track of stream.getTracks()) track.stop();
    throw error;
  }
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  const note = (): Blob | null => {
    const kind = (recorder.mimeType || type || 'audio/webm').split(';')[0]!;
    return chunks.length === 0 ? null : new Blob(chunks, { type: kind });
  };
  const release = () => {
    for (const track of stream.getTracks()) track.stop();
  };
  const ended = new Promise<Blob | null>((resolve) => {
    recorder.onstop = () => {
      release();
      resolve(note());
    };
  });
  try {
    recorder.start(1000);
  } catch (error) {
    release();
    throw error;
  }
  let result: Promise<Blob | null> | null = null;
  return {
    stop: () => {
      if (result === null) {
        if (recorder.state !== 'inactive') {
          recorder.stop();
          result = ended;
        } else {
          // The recorder ended by itself (the microphone went away): no `stop` event is coming.
          release();
          result = Promise.resolve(note());
        }
      }
      return result;
    },
  };
}

/** `m:ss` of a duration. */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
