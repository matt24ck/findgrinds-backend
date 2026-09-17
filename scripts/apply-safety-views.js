#!/usr/bin/env node
/**
 * Apply (or refresh) the safety_ops metric views.
 *
 *   npm run analytics:views                  # uses DATABASE_URL from .env
 *   DATABASE_URL=postgres://... node scripts/apply-safety-views.js
 *
 * Idempotent: every statement is CREATE SCHEMA IF NOT EXISTS / CREATE OR REPLACE VIEW.
 * Requires the application tables to exist (start the API once so Sequelize syncs them).
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const SQL_FILE = path.join(__dirname, '..', 'analytics', 'sql', 'safety_ops_views.sql');

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }
  const sql = fs.readFileSync(SQL_FILE, 'utf8');
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    const { rows } = await client.query(
      `SELECT table_name FROM information_schema.views WHERE table_schema = 'safety_ops' ORDER BY 1`
    );
    console.log(`Applied ${rows.length} views in schema safety_ops on ${new URL(url).pathname.slice(1)}:`);
    for (const { table_name } of rows) {
      const { rows: c } = await client.query(`SELECT count(*)::int AS n FROM safety_ops."${table_name}"`);
      console.log(`  safety_ops.${table_name.padEnd(26)} ${String(c[0].n).padStart(6)} rows`);
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Failed to apply safety_ops views:', err.message);
  process.exit(1);
});
