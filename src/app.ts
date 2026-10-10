import express, { type Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import { env, isProd } from './config/env';
import apiRouter from './routes';
import { errorHandler } from './middleware/errorHandler';
import { notFoundHandler } from './middleware/notFound';

export function createApp(): Application {
  const app = express();

  // Behind a proxy (e.g. nginx, Heroku) — needed for correct client IPs.
  app.set('trust proxy', 1);

  app.use(
    helmet({
      // We allow the frontend to embed nothing, but disable CSP at the
      // middleware level so the API is purely data (no HTML).
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    })
  );

  app.use(
    cors({
      origin: env.frontendUrl,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    })
  );

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  if (!isProd) {
    app.use(morgan('dev'));
  } else {
    app.use(morgan('combined'));
  }

  // Root + API
  app.get('/', (_req, res) => {
    res.json({
      success: true,
      message: 'First Sniffer API',
      data: {
        name: 'firstsniffer-backend',
        version: '0.1.0',
        docs: '/api/health',
      },
    });
  });
  app.use('/api', apiRouter);

  // 404 + error handlers — must be last.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
