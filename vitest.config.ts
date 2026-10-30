import { defineConfig } from 'vitest/config';
import dotenv from 'dotenv';

// Load `.env` so `MONGODB_URI` is available to the harness — it prefers the
// already-running dev mongod (rewritten to a throwaway test db) over booting
// a second in-memory server.
dotenv.config();

export default defineConfig({
  test: {
    // Mongo-backed integration tests. Scoped tightly to `src/test/` — a broad
    // glob drags `node_modules` and the seed corpus into the transform.
    environment: 'node',
    include: ['src/test/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    // mongodb-memory-server may spawn a mongod per fork; more workers than
    // this thrashes memory on CI-sized machines.
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
    fileParallelism: false,
  },
});