/**
 * Client-side image downsampling before upload (user decision 2026-08-24):
 * every image type — including order evidence screenshots — is re-encoded
 * to JPEG with its longest edge capped, so multi-megabyte phone screenshots
 * never reach storage untouched.  Non-image files pass through unchanged.
 * Any decode/canvas failure falls back to the original file rather than
 * blocking the upload; the server-side size ceiling stays the backstop.
 */
const MAXIMUM_LONGEST_EDGE = 1600;
const JPEG_QUALITY = 0.85;
const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export async function downscaleImageForUpload(file: File): Promise<File> {
  if (!IMAGE_MIMES.has(file.type.trim().toLocaleLowerCase('en-US'))) {
    return file;
  }
  if (typeof createImageBitmap !== 'function'
    || typeof OffscreenCanvas === 'undefined'
    && typeof document === 'undefined') {
    return file;
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }
  try {
    const scale = Math.min(
      1,
      MAXIMUM_LONGEST_EDGE / Math.max(bitmap.width, bitmap.height),
    );
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    let blob: Blob | null;
    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext('2d');
      if (context === null) return file;
      context.drawImage(bitmap, 0, 0, width, height);
      blob = await canvas.convertToBlob({
        type: 'image/jpeg',
        quality: JPEG_QUALITY,
      }).catch(() => null);
    } else {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (context === null) return file;
      context.drawImage(bitmap, 0, 0, width, height);
      blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY);
      });
      if (blob === null) return file;
    }
    bitmap.close();
    if (blob === null) return file;
    if (blob.size >= file.size && scale === 1
      && file.type === 'image/jpeg') {
      // Already a small-enough JPEG: re-encoding would only lose quality.
      return file;
    }
    return new File([blob], jpegFileName(file.name), {
      type: 'image/jpeg',
      lastModified: file.lastModified,
    });
  } catch {
    return file;
  }
}

function jpegFileName(name: string): string {
  const lastDot = name.lastIndexOf('.');
  const base = lastDot > 0 ? name.slice(0, lastDot) : name;
  return `${base || 'upload'}.jpg`;
}
