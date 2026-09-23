/** Mongo E11000 — a unique index rejected the write. */
export function isDuplicateKeyError(err: unknown): boolean {
  return (err as { code?: number } | null)?.code === 11000;
}
