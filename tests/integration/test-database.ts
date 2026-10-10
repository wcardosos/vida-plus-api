try {
  process.loadEnvFile();
} catch {}

const baseUrl = new URL(process.env.DATABASE_URL!);

export const adminDatabaseUrl = baseUrl.toString();

export const testDatabaseName = `${baseUrl.pathname.slice(1)}_test`;

export const testDatabaseUrl = Object.assign(new URL(baseUrl), { pathname: `/${testDatabaseName}` }).toString();
