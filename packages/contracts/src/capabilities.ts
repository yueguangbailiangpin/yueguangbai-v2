export interface BusinessActionCapabilityDto {
  allowed: boolean;
  reason: string | null;
}

export type BusinessActionsDto<TAction extends string = string> =
  Readonly<Record<TAction, BusinessActionCapabilityDto>>;
