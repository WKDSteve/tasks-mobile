import { describe, expect, it } from 'vitest';
import { acceptedType, assetName, checkAttachment, MAX_FILE_BYTES, MAX_FILES, restoreRef, sizeText } from './attach';
import { clock, startRecording, voiceType, type RecorderDeps } from './recorder';

const blob = (size: number, type: string) => ({ size, type }) as Blob;

describe('attachments', () => {
  it('takes photos and voice notes, nothing a browser would run', () => {
    expect(acceptedType('photo', 'image/jpeg')).toBe(true);
    expect(acceptedType('voice', 'audio/webm;codecs=opus')).toBe(true);
    expect(acceptedType('photo', 'image/svg+xml')).toBe(false);
    expect(acceptedType('photo', 'text/html')).toBe(false);
    expect(acceptedType('voice', 'image/jpeg')).toBe(false);
  });

  it('names the limit it holds: size, count, type, empty', () => {
    expect(checkAttachment({ blob: blob(10, 'image/png'), kind: 'photo' }, 0)).toBeNull();
    expect(checkAttachment({ blob: blob(MAX_FILE_BYTES + 1, 'image/png'), kind: 'photo' }, 0)).toBe('too_big');
    expect(checkAttachment({ blob: blob(10, 'image/png'), kind: 'photo' }, MAX_FILES)).toBe('too_many');
    expect(checkAttachment({ blob: blob(10, 'application/pdf'), kind: 'photo' }, 0)).toBe('wrong_type');
    expect(checkAttachment({ blob: blob(0, 'audio/webm'), kind: 'voice' }, 0)).toBe('empty');
  });

  it('names the asset from its kind and time, never from the phone file name', () => {
    const at = new Date(2026, 10, 10, 9, 5);
    expect(assetName('photo', 'image/jpeg', at, 1)).toBe('photo-2026-11-10-0905.jpg');
    expect(assetName('voice', 'audio/webm;codecs=opus', at, 2)).toBe('voice-2026-11-10-0905-2.webm');
    expect(assetName('voice', 'audio/x-unknown', at, 1)).toBe('voice-2026-11-10-0905.audio');
  });

  it('reads back only what it wrote (MSEC-13)', () => {
    const good = { key: 'file-0001', name: 'photo-x.jpg', type: 'image/jpeg', size: 3, kind: 'photo' };
    expect(restoreRef(good)).toEqual(good);
    expect(restoreRef({ ...good, name: '../x.jpg' })).toBeNull();
    expect(restoreRef({ ...good, key: 'a' })).toBeNull();
    expect(restoreRef({ ...good, type: 'text/html' })).toBeNull();
    expect(restoreRef({ ...good, size: MAX_FILE_BYTES + 1 })).toBeNull();
    expect(restoreRef({ ...good, kind: 'video' })).toBeNull();
  });

  it('says sizes for people', () => {
    expect(sizeText(100)).toBe('1 KB');
    expect(sizeText(820 * 1024)).toBe('820 KB');
    expect(sizeText(3.4 * 1024 * 1024)).toBe('3.4 MB');
  });
});

/** A microphone and a recorder that records two chunks. */
function fakeMedia() {
  const tracks: { stopped: boolean }[] = [];
  const asked: MediaStreamConstraints[] = [];
  class FakeRecorder {
    static isTypeSupported = (t: string) => t === 'audio/webm';
    state: RecordingState = 'inactive';
    mimeType = 'audio/webm';
    ondataavailable: ((e: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    start() {
      this.state = 'recording';
      this.ondataavailable?.({ data: new Blob(['ab']) });
    }
    stop() {
      this.state = 'inactive';
      this.ondataavailable?.({ data: new Blob(['cd']) });
      this.onstop?.();
    }
  }
  const deps = {
    getUserMedia: async (c: MediaStreamConstraints) => {
      asked.push(c);
      const track = { stopped: false, stop: () => (track.stopped = true) };
      tracks.push(track);
      return { getTracks: () => [track] } as unknown as MediaStream;
    },
    Recorder: FakeRecorder as unknown as RecorderDeps['Recorder'],
  };
  return { deps, tracks, asked };
}

describe('the voice note', () => {
  it('asks for the microphone only when it starts, and lets it go when it stops (AND-01)', async () => {
    const media = fakeMedia();
    expect(media.asked).toEqual([]);
    const rec = await startRecording(media.deps);
    expect(media.asked).toEqual([{ audio: true, video: false }]);
    expect(media.tracks[0]?.stopped).toBe(false);
    const note = await rec.stop();
    expect(media.tracks[0]?.stopped).toBe(true);
    expect(note?.type).toBe('audio/webm');
    expect(note?.size).toBe(4);
    // Stopping twice gives the same note.
    expect(await rec.stop()).toBe(note);
  });

  it('picks the first type the browser records', () => {
    expect(voiceType((t) => t === 'audio/mp4')).toBe('audio/mp4');
    expect(voiceType(() => false)).toBeNull();
  });

  it('shows the time as m:ss', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(65_400)).toBe('1:05');
  });
});
