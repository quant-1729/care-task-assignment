import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { openDb } from './db.js';
import { createEngine } from './engine.js';
import { isEmpty, seed } from './seed.js';
import { recoverFromRestart } from './service.js';
import { startSweeper } from './sweeper.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT) || 3001;
const file = process.env.DB_FILE || path.join(here, '..', 'data', 'app.db');

const db = openDb(file);
const ctx = { db, now: () => Date.now(), engine: createEngine() };

if (isEmpty(db)) seed(db, ctx.now());

// Requests that were pending when the server stopped are lost: flag them.
const lost = recoverFromRestart(ctx);
if (lost) console.log(`Restart recovery: ${lost} pending request(s) flagged for the head nurse.`);

const stopSweeper = startSweeper(ctx);
const server = createApp(ctx).listen(port, () => console.log(`Server listening on http://localhost:${port}`));

function shutdown() {
  stopSweeper();
  ctx.engine.clear();
  server.close(() => {
    db.close();
    process.exit(0);
  });
  server.closeAllConnections?.();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
