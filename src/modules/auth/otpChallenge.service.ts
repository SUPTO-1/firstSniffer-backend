import crypto from 'node:crypto';
import { env } from '../../config/env';
import { ApiError } from '../../utils/ApiError';
import { hashPassword, verifyPassword } from '../../utils/bcrypt';
import { OtpChallenge } from './otpChallenge.model';
import type { OtpChallengeDoc } from './otpChallenge.interface';

/**
 * Registration OTP lifecycle.
 *
 * THE RESEND RULE (the subtle part)
 * ---------------------------------
 * A customer may explicitly resend their OTP at most 3 times. After the
 * 3rd resend the button is blocked for 30 minutes. The initial OTP email
 * does NOT count as a resend.
 *
 * The requirement is that PARALLEL requests cannot bypass this, and that
 * logging out, refreshing, re-registering, or switching devices cannot
 * reset it. Both properties come from one decision: **the resend counter
 * lives in MongoDB, and the increment and the permission check happen in
 * the same atomic document write.**
 *
 * The naive implementation — read the counter, check it, then write
 * `counter + 1` — has a race: N concurrent requests all read `2`, all pass
 * the check, and all write `3`, so 3 requests slip through as "the 3rd
 * resend" and 3 emails go out. Worse, a 4th could write `4`.
 *
 * Instead the gate is a single `findOneAndUpdate` whose FILTER encodes the
 * allow-condition:
 *
 *     resendCount < 3   AND   (cooldownUntil is null OR cooldownUntil <= now)
 *
 * MongoDB applies a filter and an update to one document atomically, so
 * concurrent requests are serialised by the document's write lock. The
 * first three to arrive increment 0→1→2→3. The fourth finds
 * `resendCount: 3`, matches nothing, and is rejected with a 429.
 *
 * The cooldown is armed inside that same write, using an update PIPELINE
 * so the new `cooldownUntil` can depend on the value `resendCount` will
 * have AFTER the increment. Without the pipeline, arming the cooldown
 * would require a second write, leaving a window where the limit is
 * reached but the cooldown is not yet set.
 */

/** How long an OTP stays valid. */
export const OTP_TTL_MS = env.otp.ttlMs;
/** How many times a single OTP may be guessed. */
export const OTP_MAX_ATTEMPTS = env.otp.maxAttempts;
/** How many explicit resends are allowed per window. */
export const OTP_MAX_RESENDS = env.otp.maxResends;
/** How long resends are blocked after the last allowed resend. */
export const OTP_COOLDOWN_MS = env.otp.cooldownMs;

/**
 * Generate a cryptographically secure 6-digit OTP.
 *
 * `crypto.randomInt` is used rather than `Math.random()` — the latter is
 * not cryptographically secure and its output is predictable, which would
 * let an attacker who observes a few codes narrow down the next one.
 */
export function generateOtp(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

/** Normalise an address for storage and lookup. */
export function normalizeEmail(email: string): string {
  return String(email ?? '').trim().toLowerCase();
}

/**
 * The result of a resend attempt.
 *
 * `blocked` carries the remaining cooldown so the controller can set a
 * `Retry-After` header and the frontend can show a live countdown.
 */
export type ResendOutcome =
  | { ok: true; challenge: OtpChallengeDoc }
  | { ok: false; retryAfterSeconds: number; cooldownUntil: Date };

/**
 * Read the current resend state for an address, without mutating it.
 *
 * Used to answer "is this address blocked right now?" without consuming
 * a resend.
 */
export async function getResendState(
  email: string
): Promise<{ resendCount: number; cooldownUntil: Date | null }> {
  const doc = (await OtpChallenge.findOne({ email: normalizeEmail(email) })
    .select('resendCount cooldownUntil')
    .lean()
    .exec()) as { resendCount?: number; cooldownUntil?: Date | null } | null;
  return {
    resendCount: doc?.resendCount ?? 0,
    cooldownUntil: doc?.cooldownUntil ?? null,
  };
}

/**
 * Issue the INITIAL OTP for a registration.
 *
 * Deliberately does NOT touch `resendCount` or `cooldownUntil`:
 *
 *  - The initial email is not a resend, so the counter must stay where it
 *    is. If the customer already burned their 3 resends and then
 *    re-registers, they are still blocked — a registration retry must not
 *    buy a fresh window.
 *  - `cooldownUntil` is likewise left alone, so an active cooldown
 *    survives a registration retry.
 *
 * The previous OTP is invalidated by overwriting `otpHash` — only one code
 * is ever valid for an address at a time.
 */
export async function issueInitialOtp(
  email: string
): Promise<{ otp: string; expiresAt: Date }> {
  const address = normalizeEmail(email);
  const otp = generateOtp();
  const otpHash = await hashPassword(otp);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  await OtpChallenge.findOneAndUpdate(
    { email: address },
    {
      $set: {
        otpHash,
        otpExpiresAt: expiresAt,
        // A fresh code starts with a fresh attempt budget.
        attempts: 0,
        maxAttempts: OTP_MAX_ATTEMPTS,
        lastSentAt: new Date(),
        verifiedAt: null,
      },
      // `resendCount` and `cooldownUntil` are intentionally absent —
      // registration must never reset the resend limiter.
      $setOnInsert: { email: address },
    },
    { upsert: true, new: true }
  ).exec();

  return { otp, expiresAt };
}

/**
 * Resend the OTP, subject to the 3-resend / 30-minute-cooldown policy.
 *
 * Returns `{ ok: false, retryAfterSeconds, cooldownUntil }` when the
 * customer is blocked; the caller turns that into a 429.
 */
export async function resendOtp(
  email: string,
  newOtpHash: string,
  newExpiresAt: Date
): Promise<ResendOutcome> {
  const address = normalizeEmail(email);
  const now = new Date();

  /**
   * The single atomic gate.
   *
   * The FILTER is the permission check; the PIPELINE is the mutation.
   * Because MongoDB evaluates the filter and applies the update to the
   * matched document as one atomic operation, concurrent callers cannot
   * interleave: the loser of the race finds the counter already at 3 and
   * matches zero documents.
   *
   * THE FILTER'S SHAPE (and why it is an $or of two CLAUSES)
   * -------------------------------------------------------
   * The rule being enforced is:
   *
   *   "You may resend while you have budget left AND no cooldown is
   *    in force. Once the cooldown expires, a fresh window of 3 opens."
   *
   * That is a disjunction of two complete situations, so the filter
   * must be:
   *
   *     (no cooldown AND count < limit)   OR   (cooldown expired)
   *
   * The tempting alternative — a flat `count < limit AND (cooldown is
   * null OR cooldown <= now)` — is WRONG, and the failure is subtle
   * enough to be worth spelling out.
   *
   * After the 3rd resend the counter is exactly 3 and the cooldown is
   * armed. The flat filter therefore evaluates `3 < 3` → FALSE and
   * matches NOTHING. That looks correct — the customer is blocked —
   * but it also means the document can NEVER be matched again, because
   * the counter is only ever lowered by the cooldown-expiry branch of
   * the pipeline, and that branch is only ever reached for a document
   * the filter already matched. The two are circular: the reset can
   * only happen for a document that the reset is needed to unblock.
   *
   * The symptom is that the cooldown expires, the button is still
   * shown as blocked, and the customer is locked out permanently.
   *
   * With the disjunction above, the expired-cooldown clause matches on
   * its own — the count is irrelevant there because the pipeline is
   * about to RESET it to 1 (the first resend of the new window).
   *
   * Concurrency is unaffected: the first expired-cooldown request to
   * arrive matches, resets the counter to 1 and leaves the cooldown in
   * the past. A second concurrent request ALSO still matches the
   * expired clause (the cooldown is still in the past) and would
   * reset the counter to 1 again — but it cannot cause an extra
   * email beyond what the limiter permits, because the counter never
   * exceeds 1 and the 3-per-window budget is measured from the reset.
   * The pipeline's `cooldownExpired` computation is evaluated against
   * the document state at the time of THAT write, and the write is
   * serialised by the document lock.
   */
  const updated = await OtpChallenge.findOneAndUpdate(
    {
      email: address,
      $or: [
        {
          // Situation 1: budget remains AND no cooldown is in force.
          resendCount: { $lt: OTP_MAX_RESENDS },
          cooldownUntil: null,
        },
        {
          // Situation 2: the cooldown has elapsed — a fresh window
          // of 3 opens, regardless of what the counter currently is.
          cooldownUntil: { $lte: now },
        },
      ],
    },
    [
      {
        $set: {
          /**
           * Whether the cooldown has EXPIRED — i.e. there WAS a cooldown
           * and it is now in the past.
           *
           * The `$type` check is the load-bearing part. Two tempting
           * alternatives are WRONG:
           *
           *   - `{ $lte: ['$cooldownUntil', now] }` — in MongoDB's BSON
           *     comparison order `null` sorts BEFORE any Date, so a null
           *     cooldown compares as `<= now` and is TRUE. That would
           *     treat "no cooldown at all" as "an expired cooldown" and
           *     reset the counter to 0 on every resend — the limit would
           *     never be reached.
           *
           *   - `{ $ne: ['$cooldownUntil', null] }` — in an aggregation
           *     expression a literal `null` operand is treated as
           *     MISSING, and `$ne` against a missing operand returns
           *     TRUE. Same wrong answer, different reason.
           *
           * `$type` reports the field's actual BSON type: `'date'` when
           * a cooldown is armed, `'null'` when it is not. Only then does
           * the `<= now` comparison apply. This is the only formulation
           * that distinguishes "no cooldown" from "expired cooldown".
           */
          cooldownExpired: {
            $and: [
              { $eq: [{ $type: '$cooldownUntil' }, 'date'] },
              { $lte: ['$cooldownUntil', now] },
            ],
          },
          /**
           * The current cooldown value, normalised to `null` when absent.
           * Used to carry the existing value forward when the new
           * resend does not arm a cooldown.
           */
          currentCooldown: {
            $ifNull: ['$cooldownUntil', null],
          },
        },
      },
      {
        $set: {
          /**
           * The resend count AFTER this request is applied.
           *
           * This is the single source of truth for both the counter and
           * the cooldown check — computing it once removes any chance of
           * the two drifting apart.
           *
           * Semantics:
           *   - No cooldown in force → increment the running count.
           *   - Cooldown present but EXPIRED → this request is the FIRST
           *     resend of a fresh window, so the count becomes 1.
           *
           * (Note the second case yields 1, not 0: the request being
           * processed IS a resend, so it consumes one of the new
           * window's three.)
           *
           * `$let` binds the computed count to a pipeline variable so
           * that BOTH the stored counter and the cooldown comparison read
           * the exact same value. A plain `'$nextResendCount'` reference
           * in a later stage is NOT reliable — a bare string in a `$set`
           * is parsed as a literal by some MongoDB versions, which throws
           * "FieldPath must not end with a '.'" or silently writes the
           * wrong value.
           *
           * THE BARE-STRING TRAP
           * --------------------
           * `'$cooldownExpired'` and `'$currentCooldown'` are BARE STRINGS
           * inside a `$cond`. MongoDB accepts that in most situations,
           * but the classic-update parser can still claim them: it sees
           * a string beginning with `$` and tries to read it as a FIELD
           * PATH, which fails with
           *
           *     Invalid $set :: caused by :: FieldPath must not end with a '.'
           *
           * The failure is not deterministic — it depends on the shape of
           * the document and on which branch of the filter matched, which
           * makes it maddening to reproduce. The reliable fix is to make
           * the reference UNAMBIGUOUSLY an expression by wrapping it in
           * an operator that takes an array of operands:
           *
           *     '$cooldownExpired'   →   { $ifNull: ['$cooldownExpired', false] }
           *     '$currentCooldown'   →   { $ifNull: ['$currentCooldown', null] }
           *
           * Inside an operator's operand array, a leading `$` is always
           * read as a field reference and never as a classic-update path.
           */
          resendCount: {
            $let: {
              vars: {
                next: {
                  $cond: [
                    { $ifNull: ['$cooldownExpired', false] },
                    1,
                    { $add: ['$resendCount', 1] },
                  ],
                },
              },
              in: '$$next',
            },
          },
          /**
           * The new OTP hash.
           *
           * WRAPPED IN `$literal` — AND THIS IS NOT OPTIONAL.
           *
           * A bcrypt hash is a STRING THAT BEGINS WITH A DOLLAR SIGN:
           *
           *     $2a$12$Kixxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
           *
           * Mongoose's update caster scans the values inside a pipeline
           * `$set` for a leading `$`. When it finds one, it assumes the
           * value is a MongoDB OPERATOR (like `$inc` or `$literal`)
           * rather than a literal string, and — because `$2a` is not a
           * recognised operator — it SILENTLY DROPS THE FIELD.
           *
           * The symptom is deceptively subtle: the resend reports
           * success, the counter increments, the cooldown arms, and the
           * email goes out — but the stored document has NO `otpHash` at
           * all. Every subsequent verification then fails with "that
           * verification code is not correct", and the customer can
           * never complete signup. The hash simply evaporates.
           *
           * `{ $literal: ... }` tells the aggregation expression
           * evaluator to treat the value as a plain string, with no
           * interpretation. This is the only safe way to store a
           * `$`-prefixed string from inside an update pipeline.
           *
           * The same trap catches any other `$`-prefixed value written
           * through a pipeline — hence `markOtpVerified` below, which
           * clears the hash with a classic update rather than a pipeline.
           */
          otpHash: { $literal: newOtpHash },
          otpExpiresAt: newExpiresAt,
          attempts: 0,
          maxAttempts: OTP_MAX_ATTEMPTS,
          lastSentAt: now,
          verifiedAt: null,
          /**
           * Arm the cooldown on the resend that reaches the limit, in this
           * same atomic write — there is never a window where the limit is
           * reached but the cooldown is not yet set.
           *
           * The count used here is recomputed with the identical
           * expression as the counter above, so the two can never
           * disagree about which resend armed the cooldown.
           *
           * THREE BRANCHES, NOT TWO
           * ----------------------
           * The expired-cooldown case must CLEAR the cooldown, not carry
           * the stale (past) date forward.
           *
           * Carrying it forward would leave `cooldownUntil` pointing at a
           * moment in the past. The filter's second clause — "the
           * cooldown has elapsed" — would then keep matching on EVERY
           * subsequent resend, and the counter would be reset to 1 each
           * time. The customer would be permanently limited to a single
           * resend per window instead of three, with no error and no
           * cooldown to explain why.
           *
           * Clearing it to `null` puts the document back into the
           * ordinary state: no cooldown in force, counter free to climb
           * from 1 towards 3, and the cooldown re-armed only when the
           * third resend lands.
           */
          cooldownUntil: {
            $cond: [
              // The cooldown has expired → the fresh window starts with
              // no cooldown in force.
              { $ifNull: ['$cooldownExpired', false] },
              null,
              {
                $cond: [
                  {
                    $gte: [
                      {
                        $cond: [
                          { $ifNull: ['$cooldownExpired', false] },
                          1,
                          { $add: ['$resendCount', 1] },
                        ],
                      },
                      OTP_MAX_RESENDS,
                    ],
                  },
                  // This resend reached the limit → arm the cooldown.
                  { $add: [now, OTP_COOLDOWN_MS] },
                  // Not the limit yet → no cooldown, unless one was
                  // already armed (impossible in this branch, but the
                  // carry-forward keeps the expression total).
                  { $ifNull: ['$currentCooldown', null] },
                ],
              },
            ],
          },
        },
      },
      {
        /**
         * The scratch values were only there to compute the expressions
         * above — they must not survive into the stored document.
         *
         * Each `$unset` is its own stage taking a single field name.
         * An ARRAY of names is accepted by MongoDB itself, but Mongoose's
         * update casting mangles it into an invalid field path, so the
         * stages are kept separate.
         */
        $unset: 'currentCooldown',
      },
      {
        $unset: 'cooldownExpired',
      },
    ],
    { new: true }
  ).exec();

  if (updated) {
    return { ok: true, challenge: updated as unknown as OtpChallengeDoc };
  }

  /**
   * The gate did not match — the customer is blocked.
   *
   * Read the current state purely to report how long is left. The read
   * cannot be used to bypass anything: it only computes `Retry-After`.
   */
  const state = await getResendState(address);
  const cooldownUntil =
    state.cooldownUntil && state.cooldownUntil > now
      ? state.cooldownUntil
      : new Date(now.getTime() + OTP_COOLDOWN_MS);
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((cooldownUntil.getTime() - now.getTime()) / 1000)
  );

  return { ok: false, retryAfterSeconds, cooldownUntil };
}

/**
 * Verify an OTP against the stored challenge.
 *
 * Enforces, server-side:
 *  - the challenge exists,
 *  - the code has not expired,
 *  - the attempt budget has not been exhausted,
 *  - the code matches.
 *
 * A wrong code increments `attempts` ATOMICALLY, so concurrent wrong
 * guesses cannot collectively exceed the limit.
 *
 * @returns the challenge document on success.
 * @throws ApiError on every failure, with a message safe to show the
 *         customer (it never reveals whether the code was close).
 */
export async function verifyOtp(
  email: string,
  otp: string
): Promise<OtpChallengeDoc> {
  const address = normalizeEmail(email);
  const code = String(otp ?? '').trim();

  /* Load WITH the hash — it is `select: false` by default. */
  const challenge = (await OtpChallenge.findOne({ email: address })
    .select('+otpHash')
    .exec()) as OtpChallengeDoc | null;

  if (!challenge) {
    throw ApiError.badRequest(
      'No verification code was requested for this email address'
    );
  }

  if (challenge.verifiedAt) {
    throw ApiError.badRequest('This email address has already been verified');
  }

  if (challenge.otpExpiresAt.getTime() <= Date.now()) {
    throw ApiError.badRequest(
      'Your verification code has expired. Please request a new one.'
    );
  }

  if (challenge.attempts >= challenge.maxAttempts) {
    throw ApiError.badRequest(
      'Too many incorrect attempts. Please request a new code.'
    );
  }

  const matches = await verifyPassword(code, challenge.otpHash);
  if (!matches) {
    /**
     * Consume one attempt atomically. Using `findOneAndUpdate` with an
     * `$inc` (rather than saving the document) means two simultaneous
     * wrong guesses each increment the counter, and the guard
     * `attempts: { $lt: maxAttempts }` stops the counter going past the
     * limit.
     */
    await OtpChallenge.findOneAndUpdate(
      { email: address, attempts: { $lt: challenge.maxAttempts } },
      { $inc: { attempts: 1 } }
    ).exec();

    throw ApiError.badRequest(
      'That verification code is not correct. Please try again.'
    );
  }

  return challenge;
}

/**
 * Mark a challenge as verified and invalidate its code.
 *
 * Clearing `otpHash` means the code cannot be replayed even if the
 * database leaks.
 */
export async function markOtpVerified(email: string): Promise<void> {
  const address = normalizeEmail(email);
  await OtpChallenge.findOneAndUpdate(
    { email: address },
    {
      $set: {
        verifiedAt: new Date(),
        otpHash: '',
        otpExpiresAt: new Date(0),
      },
    }
  ).exec();
}
