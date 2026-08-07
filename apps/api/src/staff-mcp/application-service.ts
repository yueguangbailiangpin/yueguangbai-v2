import type {
  StaffMcpCurrentActor,
  StaffMcpImageContent,
  StaffMcpNextStep,
  StaffMcpResultKind,
  StaffMcpSourceReference,
  StaffMcpToolName,
} from '@ygb/contracts';

export interface StaffMcpApplicationOutput {
  kind: StaffMcpResultKind;
  data: Record<string, unknown>;
  sourceReferences: readonly StaffMcpSourceReference[];
  warnings: readonly string[];
  nextStep: StaffMcpNextStep;
  auditScope: {
    type: string;
    id: string;
  };
  imageContent?: StaffMcpImageContent;
}

export interface StaffMcpApplicationService {
  execute(
    toolName: StaffMcpToolName,
    argumentsValue: Readonly<Record<string, unknown>>,
    actor: StaffMcpCurrentActor,
  ): Promise<StaffMcpApplicationOutput>;
}

export type StaffMcpApplicationErrorCode =
  | 'NOT_FOUND'
  | 'PROVIDER_UNAVAILABLE'
  | 'INVALID_RESULT';

export class StaffMcpApplicationError extends Error {
  constructor(public readonly code: StaffMcpApplicationErrorCode) {
    super(code);
    this.name = 'StaffMcpApplicationError';
  }
}
