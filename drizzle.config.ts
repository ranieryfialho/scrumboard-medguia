import { defineConfig } from 'drizzle-kit';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL não definida — drizzle-kit precisa dela para gerar/aplicar migrations.');
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url: databaseUrl,
  },
  // `crm_migrator` só tem CREATE no schema `public` (não no database — ver
  // infra/postgres/init/01-databases-and-roles.sql), então o journal de
  // controle do drizzle-kit fica em `public` em vez do schema `drizzle`
  // default, que exigiria criar um schema novo.
  migrations: {
    schema: 'public',
  },
});
