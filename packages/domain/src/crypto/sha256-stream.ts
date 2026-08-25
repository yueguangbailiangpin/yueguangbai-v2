/**
 * Incremental (streaming) SHA-256 for Workers: crypto.subtle.digest can only
 * hash a complete buffer, but the cold-archive pipeline must hash ZIP streams
 * and Drive read-backs chunk by chunk without ever buffering a whole object
 * (Workers isolates are capped at 128 MB). Pure TypeScript, no Node APIs.
 */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

export class IncrementalSha256 {
  private readonly state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  private readonly block = new Uint8Array(64);
  private blockLength = 0;
  private byteLength = 0;
  private finished = false;

  update(chunk: ArrayBuffer | ArrayBufferView): this {
    if (this.finished) throw new Error('sha256_stream_already_finished');
    const view = chunk instanceof ArrayBuffer
      ? new Uint8Array(chunk)
      : new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    this.byteLength += view.byteLength;
    let offset = 0;
    if (this.blockLength > 0) {
      const needed = 64 - this.blockLength;
      const taken = Math.min(needed, view.byteLength);
      this.block.set(view.subarray(0, taken), this.blockLength);
      this.blockLength += taken;
      offset = taken;
      if (this.blockLength === 64) {
        this.compress(this.block);
        this.blockLength = 0;
      }
    }
    while (view.byteLength - offset >= 64) {
      this.compress(view.subarray(offset, offset + 64));
      offset += 64;
    }
    if (view.byteLength > offset) {
      this.block.set(view.subarray(offset), this.blockLength);
      this.blockLength += view.byteLength - offset;
    }
    return this;
  }

  digestHex(): string {
    if (this.finished) throw new Error('sha256_stream_already_finished');
    const bitLength = this.byteLength * 8;
    this.update(new Uint8Array([0x80]));
    while (this.blockLength !== 56) this.update(new Uint8Array([0]));
    const tail = new Uint8Array(8);
    const high = Math.floor(bitLength / 0x100000000);
    const low = bitLength >>> 0;
    tail[0] = high >>> 24;
    tail[1] = (high >>> 16) & 0xff;
    tail[2] = (high >>> 8) & 0xff;
    tail[3] = high & 0xff;
    tail[4] = low >>> 24;
    tail[5] = (low >>> 16) & 0xff;
    tail[6] = (low >>> 8) & 0xff;
    tail[7] = low & 0xff;
    this.update(tail);
    this.finished = true;
    let hex = '';
    for (let index = 0; index < 8; index += 1) {
      hex += this.state[index]!.toString(16).padStart(8, '0');
    }
    return hex;
  }

  private compress(block: Uint8Array): void {
    if (block.byteLength !== 64) throw new Error('sha256_stream_block_size');
    const w = new Uint32Array(64);
    for (let index = 0; index < 16; index += 1) {
      const offset = index * 4;
      w[index] = ((block[offset]! * 0x1000000) + (block[offset + 1]! * 0x10000)
        + (block[offset + 2]! * 0x100) + block[offset + 3]!) >>> 0;
    }
    for (let index = 16; index < 64; index += 1) {
      const w15 = w[index - 15]!;
      const w2 = w[index - 2]!;
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      w[index] = (w[index - 16]! + s0 + w[index - 7]! + s1) >>> 0;
    }
    let a = this.state[0]!;
    let b = this.state[1]!;
    let c = this.state[2]!;
    let d = this.state[3]!;
    let e = this.state[4]!;
    let f = this.state[5]!;
    let g = this.state[6]!;
    let h = this.state[7]!;
    for (let index = 0; index < 64; index += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + K[index]! + w[index]!) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;
      h = g; g = f; f = e;
      e = (d + temp1) >>> 0;
      d = c; c = b; b = a;
      a = (temp1 + temp2) >>> 0;
    }
    const next = new Uint32Array([
      (this.state[0]! + a) >>> 0, (this.state[1]! + b) >>> 0,
      (this.state[2]! + c) >>> 0, (this.state[3]! + d) >>> 0,
      (this.state[4]! + e) >>> 0, (this.state[5]! + f) >>> 0,
      (this.state[6]! + g) >>> 0, (this.state[7]! + h) >>> 0,
    ]);
    this.state.set(next);
  }
}

export async function sha256HexOfStream(
  body: ReadableStream<Uint8Array>,
): Promise<{ byteSize: number; sha256Hex: string }> {
  const hasher = new IncrementalSha256();
  const reader = body.getReader();
  let byteSize = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength === 0) continue;
      byteSize += value.byteLength;
      hasher.update(value);
    }
  } finally {
    reader.releaseLock();
  }
  return { byteSize, sha256Hex: hasher.digestHex() };
}
