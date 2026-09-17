// Eval environment: real Anthropic key from .env (or CI secret), nothing else real.
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
process.env.NODE_ENV = 'test';
// searchService is mocked, so no database is touched; keep the URL harmless anyway.
process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/findgrinds_evals_unused';
delete process.env.RESEND_API_KEY;
delete process.env.STRIPE_SECRET_KEY;
