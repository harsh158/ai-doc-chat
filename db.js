import pg from "pg";

const { Pool } = pg;

/**
 * Get a PostgreSQL pool if DATABASE_URL is set (e.g. on Railway).
 * Returns null otherwise so the app can fall back to file-based users and memory sessions.
 */
export function getPool() {
  const url = process.env.DATABASE_URL;
  if (!url || url.trim() === "") return null;
  return new Pool({
    connectionString: url,
    ssl: url.includes("localhost") ? false : { rejectUnauthorized: false },
  });
}

/**
 * Create tables if they don't exist. Call once at startup when using Postgres.
 */
export async function initDb(pool) {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

export async function findUserByEmail(pool, email) {
  if (!pool) return null;
  const r = await pool.query(
    "SELECT id, email, password_hash FROM users WHERE LOWER(email) = LOWER($1)",
    [email]
  );
  return r.rows[0] || null;
}

export async function createUser(pool, { id, email, passwordHash }) {
  if (!pool) return null;
  await pool.query(
    "INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)",
    [id, email.toLowerCase(), passwordHash]
  );
  return { id, email: email.toLowerCase() };
}
