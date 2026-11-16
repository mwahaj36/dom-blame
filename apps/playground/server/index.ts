import { createPlaygroundApp } from './app';
import { createPlaygroundDb } from './db';

const port = Number(process.env.PORT || 4310);
const db = createPlaygroundDb();
const app = createPlaygroundApp(db);

app.listen(port, '127.0.0.1', () => {
  console.log(`[playground] API + SQLite listening at http://127.0.0.1:${port}`);
});
