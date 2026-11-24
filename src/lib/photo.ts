// A photo from the camera of a phone is 12 megapixels and several MB; the task it goes to needs a picture a person can
// read, not the sensor's file. Before it is kept and sent it is scaled down to `MAX_EDGE` px on the longer side and
// written as WebP (smaller than JPEG at the same look, and every browser that can record on a phone reads it). A photo
// that is small enough already, one that is no still picture (a GIF may move), and one the browser cannot decode (HEIC
// in many WebViews) go on as they are: the page never loses a photo to this step.

/** The longer side of a photo that goes to the hub, in pixels. */
export const MAX_EDGE = 2048;
/** The quality of the WebP (0 to 1). */
export const QUALITY = 0.82;

/** The size a `width` x `height` picture is scaled to so that its longer side is at most `max`; the same when it fits. */
export function fitWithin(width: number, height: number, max: number = MAX_EDGE): { width: number; height: number } {
  const longer = Math.max(width, height);
  if (longer <= max) return { width, height };
  const scale = max / longer;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** What the browser gives for decoding and drawing; replaced in a test. */
export interface Canvasing {
  decode(blob: Blob): Promise<{ width: number; height: number; draw(width: number, height: number): Promise<Blob | null> }>;
}

/** The browser's own: `createImageBitmap` and `OffscreenCanvas`, which a phone's Chrome has. */
export const browserCanvasing: Canvasing = {
  async decode(blob) {
    const bitmap = await createImageBitmap(blob);
    return {
      width: bitmap.width,
      height: bitmap.height,
      async draw(width, height) {
        const canvas = new OffscreenCanvas(width, height);
        const context = canvas.getContext('2d');
        if (!context) return null;
        context.drawImage(bitmap, 0, 0, width, height);
        bitmap.close();
        return canvas.convertToBlob({ type: 'image/webp', quality: QUALITY });
      },
    };
  },
};

/** The photo as it goes on: scaled down and as WebP when it is larger than `MAX_EDGE`, else the same blob. */
export async function shrinkPhoto(blob: Blob, canvasing: Canvasing | null = typeof createImageBitmap === 'function' && typeof OffscreenCanvas === 'function' ? browserCanvasing : null): Promise<Blob> {
  const type = blob.type.split(';')[0]!.trim().toLowerCase();
  if (canvasing === null || type === 'image/gif' || !type.startsWith('image/')) return blob;
  try {
    const picture = await canvasing.decode(blob);
    const size = fitWithin(picture.width, picture.height);
    if (size.width === picture.width && size.height === picture.height) return blob;
    const smaller = await picture.draw(size.width, size.height);
    // A result that is no WebP (a browser that cannot write it falls back to PNG) or no smaller is not taken.
    return smaller && smaller.type === 'image/webp' && smaller.size < blob.size ? smaller : blob;
  } catch {
    return blob;
  }
}
