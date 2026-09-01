/**
 * Incremental CRC-32 (IEEE 802.3, reflected) for the streaming ZIP writer.
 * ZIP local headers need each member's CRC while data is still streaming, so
 * this mirrors the incremental SHA-256 helper: feed chunks, read the digest
 * once at the end.
 */
const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

export class IncrementalCrc32 {
  private crc = 0xffffffff;
  private finished = false;

  update(chunk: ArrayBuffer | ArrayBufferView): this {
    if (this.finished) throw new Error('crc32_already_finished');
    const view = chunk instanceof ArrayBuffer
      ? new Uint8Array(chunk)
      : new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    let crc = this.crc;
    for (let index = 0; index < view.byteLength; index += 1) {
      crc = TABLE[(crc ^ view[index]!) & 0xff]! ^ (crc >>> 8);
    }
    this.crc = crc;
    return this;
  }

  digest(): number {
    if (this.finished) throw new Error('crc32_already_finished');
    this.finished = true;
    return (this.crc ^ 0xffffffff) >>> 0;
  }
}
