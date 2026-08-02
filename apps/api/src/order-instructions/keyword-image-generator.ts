import type {
  KeywordImageGenerationOutput,
  KeywordImageGenerator,
} from '@ygb/contracts';
import { sha256Hex, validateKeywordPng } from '@ygb/domain';
import { OrderInstructionError } from './shared';

export interface TrustedKeywordGeneratorBinding {
  fetch(request: Request): Promise<Response>;
}

export class ServiceBindingKeywordImageGenerator
implements KeywordImageGenerator {
  constructor(
    private readonly binding: TrustedKeywordGeneratorBinding | null,
    private readonly sharedSecret: string,
  ) {}

  async generate(input: {
    keywordText: string;
    position: number;
    renderProfile: string;
    idempotencyDigest: string;
  }): Promise<KeywordImageGenerationOutput> {
    if (!this.binding || this.sharedSecret.length < 24) {
      throw new OrderInstructionError('DEPENDENCY_UNAVAILABLE', 503);
    }
    const response = await this.binding.fetch(new Request(
      'https://keyword-generator.internal/v1/render',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Authorization': this.sharedSecret,
          'Idempotency-Key': input.idempotencyDigest,
        },
        body: JSON.stringify({
          keyword: input.keywordText,
          position: input.position,
          render_profile: input.renderProfile,
        }),
      },
    ));
    if (!response.ok
      || response.headers.get('Content-Type')?.split(';')[0] !== 'image/png') {
      throw new OrderInstructionError('DEPENDENCY_UNAVAILABLE', 503);
    }
    const pngBytes = new Uint8Array(await response.arrayBuffer());
    const scan = validateKeywordPng(pngBytes);
    const sha256 = await sha256Hex(pngBytes);
    const generatorVersion = response.headers.get('X-Generator-Version');
    if (!generatorVersion || generatorVersion.length > 100) {
      throw new OrderInstructionError('DEPENDENCY_UNAVAILABLE', 503);
    }
    return {
      pngBytes,
      mime: 'image/png',
      width: scan.width,
      height: scan.height,
      sha256,
      generatorVersion,
      metadataScanResult: {
        clean: true,
        forbiddenChunkTypes: scan.forbiddenChunkTypes,
      },
    };
  }
}
