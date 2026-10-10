import mongoose, { Schema, type Model } from 'mongoose';

/**
 * Tiny collection of monotonic counters keyed by an arbitrary string.
 * Used to mint year-stamped order numbers and invoice numbers without a
 * sequence-race on a settings doc or a per-collection `_id` hack.
 *
 * Atomicity: `findOneAndUpdate({ $inc: { seq: 1 } }, { upsert: true })` is
 * atomic per-document in MongoDB, so two concurrent `nextSeq('order:2026')`
 * calls always receive distinct values. A defensive compound unique index
 * on `{ _id, seq }` catches the unlikely edge where two upserts race the
 * initial insert (callers retry on E11000).
 *
 * Year-stamping is the caller's responsibility — pass keys like
 * `'order:2026'` so the counter resets every January.
 */

interface ICounter {
  _id: string;
  seq: number;
  updatedAt?: Date;
}

const CounterSchema = new Schema<ICounter>({
  _id: { type: String, required: true },
  seq: { type: Number, required: true, default: 0 },
  updatedAt: { type: Date, default: () => new Date() },
});

// Defensive: even though `_id` is unique by construction, the compound
// unique index on `{ _id, seq }` gives us a clear error if the upsert
// path races itself.
CounterSchema.index({ _id: 1, seq: 1 }, { unique: true });

const Counter: Model<ICounter> =
  (mongoose.models.Counter as Model<ICounter>) ||
  mongoose.model<ICounter>('Counter', CounterSchema);

/**
 * Atomically increments and returns the new seq value (1-based).
 * The very first call for a given key returns 1.
 */
export async function nextSeq(key: string): Promise<number> {
  const doc = await Counter.findOneAndUpdate(
    { _id: key },
    { $inc: { seq: 1 }, $set: { updatedAt: new Date() } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  return (doc as unknown as { seq: number }).seq;
}
