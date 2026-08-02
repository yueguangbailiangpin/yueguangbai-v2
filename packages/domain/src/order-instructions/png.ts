const PNG_SIGNATURE = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const FORBIDDEN_TEXT_CHUNKS = new Set(['tEXt', 'iTXt', 'zTXt', 'eXIf']);

export interface PngValidationResult {
  width: number;
  height: number;
  forbiddenChunkTypes: readonly string[];
}

export function validateKeywordPng(
  bytes: Uint8Array<ArrayBuffer>,
): PngValidationResult {
  if (!(bytes instanceof Uint8Array)
    || bytes.byteLength < 33
    || !PNG_SIGNATURE.every((value, index) => bytes[index] === value)) {
    throw new Error('invalid_png');
  }

  const view = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  );
  const forbidden: string[] = [];
  let width = 0;
  let height = 0;
  let offset = 8;
  let sawIhdr = false;
  let sawIend = false;

  while (offset + 12 <= bytes.byteLength) {
    const length = view.getUint32(offset, false);
    const typeOffset = offset + 4;
    const dataOffset = offset + 8;
    const end = dataOffset + length + 4;
    if (end > bytes.byteLength) throw new Error('invalid_png_chunk');
    const type = String.fromCharCode(
      bytes[typeOffset] ?? 0,
      bytes[typeOffset + 1] ?? 0,
      bytes[typeOffset + 2] ?? 0,
      bytes[typeOffset + 3] ?? 0,
    );
    if (FORBIDDEN_TEXT_CHUNKS.has(type)) forbidden.push(type);
    if (type === 'IHDR') {
      if (sawIhdr || length !== 13 || offset !== 8) {
        throw new Error('invalid_png_ihdr');
      }
      width = view.getUint32(dataOffset, false);
      height = view.getUint32(dataOffset + 4, false);
      if (width < 1 || height < 1 || width > 8192 || height > 8192) {
        throw new Error('invalid_png_dimensions');
      }
      sawIhdr = true;
    }
    if (type === 'IEND') {
      if (length !== 0) throw new Error('invalid_png_iend');
      sawIend = true;
      if (end !== bytes.byteLength) throw new Error('png_trailing_bytes');
      break;
    }
    offset = end;
  }

  if (!sawIhdr || !sawIend) throw new Error('invalid_png_structure');
  if (forbidden.length > 0) throw new Error('png_text_metadata_forbidden');
  return Object.freeze({
    width,
    height,
    forbiddenChunkTypes: Object.freeze(forbidden),
  });
}
