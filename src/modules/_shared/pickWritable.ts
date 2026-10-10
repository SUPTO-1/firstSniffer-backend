/**
 * Returns a copy of `input` containing only the keys present in `keys`.
 * Used by update services to whitelist the fields a controller can write,
 * preventing callers from injecting `_id` / `__v` / `createdAt` through `req.body`.
 */
export function pickWritable<K extends string>(
  input: Record<string, unknown>,
  keys: readonly K[]
): Partial<Record<K, unknown>> {
  const out: Partial<Record<K, unknown>> = {};
  for (const k of keys) {
    const v = input[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}