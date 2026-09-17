/**
 * Age helpers. Policy: FindGrinds fails closed on age — if we cannot establish
 * that a user is an adult, we treat them as a minor. See README "Age policy".
 */

const ADULT_AGE = 18;
const MAX_PLAUSIBLE_AGE = 120;

/** Parse a YYYY-MM-DD string into a UTC date, or null if it is not a real calendar date. */
export function parseIsoDate(input: unknown): Date | null {
  if (typeof input !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return date;
}

/** Whole years between dob and today (calendar-accurate, UTC). */
export function calculateAge(dob: Date, today: Date = new Date()): number {
  let age = today.getUTCFullYear() - dob.getUTCFullYear();
  const monthDiff = today.getUTCMonth() - dob.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getUTCDate() < dob.getUTCDate())) age--;
  return age;
}

/**
 * True if the user must be treated as under 18.
 * Missing, malformed, or implausible dates of birth all return true (fail closed).
 */
export function isMinorFromDateOfBirth(dateOfBirth: string | null | undefined, today: Date = new Date()): boolean {
  const dob = parseIsoDate(dateOfBirth);
  if (!dob) return true;
  const age = calculateAge(dob, today);
  if (age < 0 || age > MAX_PLAUSIBLE_AGE) return true;
  return age < ADULT_AGE;
}

export type DateOfBirthValidation = { ok: true; value: string } | { ok: false; error: string };

/** Validate a date of birth submitted at signup. Returns the normalised YYYY-MM-DD on success. */
export function validateDateOfBirth(input: unknown, today: Date = new Date()): DateOfBirthValidation {
  if (input === undefined || input === null || input === '') {
    return { ok: false, error: 'Date of birth is required' };
  }
  const dob = parseIsoDate(input);
  if (!dob) return { ok: false, error: 'Date of birth must be a valid date in YYYY-MM-DD format' };
  const age = calculateAge(dob, today);
  if (age < 0) return { ok: false, error: 'Date of birth cannot be in the future' };
  if (age > MAX_PLAUSIBLE_AGE) return { ok: false, error: 'Date of birth is not plausible' };
  return { ok: true, value: dob.toISOString().slice(0, 10) };
}
