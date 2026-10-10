import closeWithGrace from 'close-with-grace';
import { buildApp } from './app';
import { pool } from './db/client';
import { env } from './env';

const app = buildApp();

app.addHook('onClose', async () => {
  await pool.end();
});

closeWithGrace({ delay: 10_000, logger: app.log }, async ({ signal, err }) => {
  if (err) {
    app.log.fatal({ err }, 'shutting down after unexpected error');
  } else {
    app.log.info({ signal }, 'shutting down');
  }
  await app.close();
});

try {
  await app.listen({ host: env.HOST, port: env.PORT });
} catch (err) {
  app.log.fatal({ err }, 'failed to start server');
  process.exit(1);
}
