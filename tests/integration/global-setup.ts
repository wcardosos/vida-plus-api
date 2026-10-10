import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client } from 'pg';
import { adminDatabaseUrl, testDatabaseName, testDatabaseUrl } from './test-database';

export default async function setup() {
  const admin = new Client({ connectionString: adminDatabaseUrl });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${testDatabaseName}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${testDatabaseName}"`);
  } finally {
    await admin.end();
  }

  const client = new Client({ connectionString: testDatabaseUrl });
  await client.connect();
  try {
    await migrate(drizzle({ client }), { migrationsFolder: 'src/db/migrations' });
  } finally {
    await client.end();
  }
}
