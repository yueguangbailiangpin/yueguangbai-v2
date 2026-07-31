export async function sha256Hex(
  input: string | ArrayBuffer | ArrayBufferView,
): Promise<string> {
  const bytes = toBytes(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
}

function toBytes(
  input: string | ArrayBuffer | ArrayBufferView,
): Uint8Array<ArrayBuffer> {
  if (typeof input === 'string') return new TextEncoder().encode(input);
  if (input instanceof ArrayBuffer) return new Uint8Array(input);

  // Copy ArrayBufferView input so the result always owns an ArrayBuffer,
  // avoiding SharedArrayBuffer/BufferSource type ambiguity.
  const source = new Uint8Array(
    input.buffer,
    input.byteOffset,
    input.byteLength,
  );
  const copy = new Uint8Array(source.byteLength);
  copy.set(source);
  return copy;
}
