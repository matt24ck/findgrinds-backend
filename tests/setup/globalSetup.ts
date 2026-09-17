/**
 * Jest global setup: make sure the test database exists and has a fresh schema.
 * Runs once per `jest` invocation, before any test file.
 */
import './env';
import { Client } from 'pg';
import { assertIsTestDatabase, databaseNameOf, maintenanceUrlFor } from './testDatabase';

export default async function globalSetup(): Promise<void> {
  const url = process.env.DATABASE_URL as string;
  assertIsTestDatabase(url);
  const dbName = databaseNameOf(url);

  // 1. Create the database if it does not exist.
  const admin = new Client({ connectionString: maintenanceUrlFor(url) });
  await admin.connect();
  try {
    const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (exists.rowCount === 0) {
      await admin.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
      console.log(`[tests] created database ${dbName}`);
    }
  } finally {
    await admin.end();
  }

  // 2. Fresh schema, then let the models create their tables.
  const db = new Client({ connectionString: url });
  await db.connect();
  try {
    await db.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  } finally {
    await db.end();
  }

  // Imported lazily so DATABASE_URL is already pointing at the test database.
  const { sequelize } = await import('../../src/config/database');
  await import('./models');
  await sequelize.sync({ force: true });
  await sequelize.close();
}
