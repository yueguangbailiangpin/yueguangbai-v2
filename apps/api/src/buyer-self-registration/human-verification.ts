export interface HumanVerificationInput {
  token: string;
  networkSource: string | null;
  deviceId: string | null;
  requestId: string;
}

export interface HumanVerificationVerifier {
  verify(input: HumanVerificationInput): Promise<boolean>;
}

export async function verifyHumanBoundary(
  verifier: HumanVerificationVerifier | undefined,
  input: HumanVerificationInput,
  required: boolean,
): Promise<boolean> {
  if (!required) return true;
  if (!verifier || input.token.length < 1) return false;
  try {
    return await verifier.verify(input);
  } catch {
    return false;
  }
}
