import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

let cachedDb: NodePgDatabase | undefined;

export function createDbClient(databaseUrl: string | undefined = process.env.DATABASE_URL) {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL não definida — necessária para conectar ao Postgres.');
  }
  const pool = new Pool({ connectionString: databaseUrl });
  return drizzle(pool);
}

export function getDb(): NodePgDatabase {
  if (!cachedDb) {
    cachedDb = createDbClient();
  }
  return cachedDb;
}
