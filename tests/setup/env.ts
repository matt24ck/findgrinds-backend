/**
 * Runs before every test file (jest `setupFiles`) and at the top of the global
 * setup. Must be side-effect free beyond process.env: no model imports here,
 * because src/config/database.ts reads DATABASE_URL at import time.
 */
import path from 'path';
import dotenv from 'dotenv';
import { assertIsTestDatabase, resolveTestDatabaseUrl } from './testDatabase';

// Load the developer's .env for DATABASE_URL (ignored if absent, e.g. in CI).
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = resolveTestDatabaseUrl();
assertIsTestDatabase(process.env.DATABASE_URL);

// Safety-relevant config under test.
process.env.JWT_SECRET = process.env.TEST_JWT_SECRET || 'findgrinds-test-jwt-secret-0123456789abcdef';
process.env.JWT_EXPIRES_IN = '1h';
process.env.RATE_LIMIT_ENABLED = 'false';
process.env.SCREENING_AWAIT = 'true';
process.env.SCREENING_SERVICE_URL = 'http://screening.test.invalid';
process.env.FRONTEND_URL = 'http://localhost:3000';

// Never talk to third parties from tests, whatever .env says.
delete process.env.RESEND_API_KEY;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_WEBHOOK_SECRET;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_API_KEY_FINDGRINDS;
delete process.env.DAILY_API_KEY;
delete process.env.ZOOM_CLIENT_ID;
