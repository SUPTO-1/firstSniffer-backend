import mongoose from 'mongoose';
import { env } from './env';

/**
 * Singleton MongoDB connection.
 * Reconnects automatically (handled by Mongoose) and exits the process on
 * unrecoverable initial connection failure so the orchestrator can restart.
 */
let connecting: Promise<typeof mongoose> | null = null;

export async function connectDatabase(): Promise<typeof mongoose> {
  if (mongoose.connection.readyState === 1) {
    return mongoose;
  }
  if (connecting) return connecting;

  mongoose.set('strictQuery', true);

  mongoose.connection.on('connected', () => {
    // eslint-disable-next-line no-console
    console.log('[mongo] connected');
  });
  mongoose.connection.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.error('[mongo] connection error:', err.message);
  });
  mongoose.connection.on('disconnected', () => {
    // eslint-disable-next-line no-console
    console.warn('[mongo] disconnected');
  });
  mongoose.connection.on('reconnected', () => {
    // eslint-disable-next-line no-console
    console.log('[mongo] reconnected');
  });

  connecting = mongoose
    .connect(env.mongoUri, {
      serverSelectionTimeoutMS: 10_000,
      maxPoolSize: 10,
      autoIndex: env.nodeEnv !== 'production',
    })
    .then((m) => m)
    .catch((err) => {
      connecting = null;
      // eslint-disable-next-line no-console
      console.error('[mongo] initial connection failed:', err.message);
      throw err;
    });

  return connecting;
}

export async function disconnectDatabase(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}
