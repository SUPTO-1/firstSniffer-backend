import { createApp } from './app';
import { connectDatabase, disconnectDatabase } from './config/database';
import { env } from './config/env';
import { runSeeders } from './seed';

async function bootstrap(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(`[server] booting in ${env.nodeEnv} mode`);

  await connectDatabase();
  await runSeeders();

  const app = createApp();
  const server = app.listen(env.port, () => {
    // eslint-disable-next-line no-console
    console.log(`[server] listening on http://localhost:${env.port}`);
    // eslint-disable-next-line no-console
    console.log(`[server] CORS origin: ${env.frontendUrl}`);
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    // eslint-disable-next-line no-console
    console.log(`[server] received ${signal}, shutting down…`);
    server.close(async () => {
      try {
        await disconnectDatabase();
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[server] error during db disconnect', e);
      }
      process.exit(0);
    });
    // Force-exit after 10s if connections hang.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    // eslint-disable-next-line no-console
    console.error('[server] unhandledRejection:', reason);
  });
  process.on('uncaughtException', (err) => {
    // eslint-disable-next-line no-console
    console.error('[server] uncaughtException:', err);
  });
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[server] failed to start:', err);
  process.exit(1);
});