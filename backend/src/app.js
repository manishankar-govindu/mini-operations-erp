import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { router } from './routes.js';
import { HttpError } from './errors.js';

export function createApp() {
  const app = express();
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (req, res) => res.json({ status: 'ok' }));
  app.use('/api', router);

  app.use((req, res) => res.status(404).json({ error: 'Endpoint not found' }));

  // Central error handler: maps domain errors and Postgres constraint violations to HTTP codes.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON body' });
    switch (err.code) {
      case '23505': return res.status(409).json({ error: 'Duplicate record' });
      case '23503': return res.status(400).json({ error: 'Referenced record does not exist' });
      case '23514': return res.status(400).json({ error: 'Value violates a business rule' });
      case '22P02': return res.status(400).json({ error: 'Invalid identifier format' });
    }
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  });
  return app;
}
