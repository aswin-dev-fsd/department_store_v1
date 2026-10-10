import { defineConfig } from 'drizzle-kit';

// `db:generate` only reads the schema files, so no connection string is needed here.
// Migrations are applied by src/migrate.ts, which loads the URL from the root .env.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  strict: true,
  verbose: true,
});
