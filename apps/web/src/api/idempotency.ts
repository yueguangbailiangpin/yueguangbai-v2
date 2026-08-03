export type IdempotentOperation<T> = Readonly<{ key: string; body: T }>;

export function startOperation<T>(body: T): IdempotentOperation<T> {
  return Object.freeze({ key: crypto.randomUUID(), body });
}

export function operationHeaders<T>(operation: IdempotentOperation<T>): Readonly<Record<string, string>> {
  return Object.freeze({ 'Idempotency-Key': operation.key });
}
