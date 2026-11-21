import express from 'express';
import { seed } from './seed.js';
import {
  HttpError,
  assignTask,
  cancelTask,
  createTask,
  getBoard,
  getEvents,
  nurseAction,
  retryTask,
  setDemoMode,
  setNurseShift,
  submitTask,
} from './service.js';

// Routes only. Every rule lives in service.js.
export function createApp(ctx) {
  const app = express();
  app.use(express.json());

  const idParam = (req) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new HttpError(400, 'That id is not valid.');
    return id;
  };

  app.get('/api/board', (req, res) => res.json(getBoard(ctx)));
  app.get('/api/tasks/:id/events', (req, res) => res.json(getEvents(ctx, idParam(req))));

  app.post('/api/tasks', (req, res) => res.status(201).json(createTask(ctx, req.body)));
  app.post('/api/tasks/:id/submit', (req, res) => res.json(submitTask(ctx, idParam(req))));
  app.post('/api/tasks/:id/retry', (req, res) => res.json(retryTask(ctx, idParam(req))));
  app.post('/api/tasks/:id/assign', (req, res) => res.json(assignTask(ctx, idParam(req), req.body)));
  app.post('/api/tasks/:id/cancel', (req, res) => res.json(cancelTask(ctx, idParam(req))));
  app.post('/api/tasks/:id/nurse', (req, res) => res.json(nurseAction(ctx, idParam(req), req.body)));

  app.patch('/api/nurses/:id', (req, res) => res.json(setNurseShift(ctx, idParam(req), req.body)));

  app.post('/api/demo/next', (req, res) => res.json(setDemoMode(ctx, req.body)));
  app.post('/api/demo/reset', (req, res) => {
    ctx.engine.clear(); // pending requests and the demo mode
    seed(ctx.db, ctx.now());
    res.json({ ok: true });
  });

  app.use('/api', (req, res) => res.status(404).json({ error: 'There is nothing at that address.' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err.status && err.status < 500) return res.status(err.status).json({ error: 'The request could not be read.' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server. Please try again.' });
  });

  return app;
}
