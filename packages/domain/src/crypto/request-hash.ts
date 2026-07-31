import { sha256Hex } from './sha256';
import { canonicalJson } from '../serialization/canonical-json';

export async function hashCanonicalJson(value: unknown): Promise<string> {
  return sha256Hex(canonicalJson(value));
}
