import { describe, expect, it } from 'vitest';
import { downscaleImageForUpload } from './image-downscale';

function fileOf(name: string, type: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type });
}

describe('client image downscale before upload', () => {
  it('passes non-image files through unchanged', async () => {
    const pdf = fileOf('proof.pdf', 'application/pdf');
    await expect(downscaleImageForUpload(pdf)).resolves.toBe(pdf);
  });

  it('passes unsupported image types through unchanged', async () => {
    const gif = fileOf('animation.gif', 'image/gif');
    await expect(downscaleImageForUpload(gif)).resolves.toBe(gif);
  });

  it('falls back to the original file when the runtime has no image decoder', async () => {
    // jsdom has neither createImageBitmap nor a usable canvas: the helper
    // must degrade to a pass-through instead of blocking the upload.
    const png = fileOf('screenshot.png', 'image/png');
    await expect(downscaleImageForUpload(png)).resolves.toBe(png);
  });
});
