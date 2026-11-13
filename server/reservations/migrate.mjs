import { createDatabase,migrate } from './db.mjs';
if (!process.env.RESERVATIONS_DATABASE_URL) throw new Error('RESERVATIONS_DATABASE_URL is required. Migrations never fall back to advertising storage.');
const db=createDatabase({connectionString:process.env.RESERVATIONS_DATABASE_URL});
try { await migrate(db); console.log('Reservation migrations applied.'); } finally { await db.close(); }
