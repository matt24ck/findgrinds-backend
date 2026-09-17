/**
 * Test database resolution. Shared by the per-file env setup and the global setup.
 *
 * Order of precedence:
 *   1. TEST_DATABASE_URL
 *   2. DATABASE_URL with the database name swapped for `findgrinds_test`
 *   3. postgresql://postgres:postgres@localhost:5432/findgrinds_test
 *
 * Whatever is chosen MUST end in `_test`: the global setup drops and recreates
 * the public schema, so this guard is what stops a mis-set env from wiping a
 * real database.
 */
export const TEST_DB_NAME = 'findgrinds_test';

export function resolveTestDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const base = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/postgres';
  const u = new URL(base);
  u.pathname = `/${TEST_DB_NAME}`;
  return u.toString();
}

export function databaseNameOf(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
}

export function assertIsTestDatabase(url: string): void {
  const name = databaseNameOf(url);
  if (!/_test$/.test(name)) {
    throw new Error(
      `Refusing to run tests against database "${name}": the test database name must end in _test ` +
        '(set TEST_DATABASE_URL).'
    );
  }
}

/** URL of the maintenance database on the same server (used to CREATE DATABASE). */
export function maintenanceUrlFor(url: string): string {
  const u = new URL(url);
  u.pathname = '/postgres';
  return u.toString();
}
