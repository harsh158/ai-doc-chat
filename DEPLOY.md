# Deploying to Railway

## With PostgreSQL (recommended)

1. In your Railway project, add a **PostgreSQL** service (Database → Add PostgreSQL).
2. Link it to your app: in the app service, **Variables** → **Add variable** → choose **Reference** and pick `DATABASE_URL` from the Postgres service. Railway will set `DATABASE_URL` automatically.
3. Set these variables for your app:
   - `GROQ_API_KEY` – your Groq API key
   - `SESSION_SECRET` – a long random string (e.g. 32+ characters)

With `DATABASE_URL` set, the app will:

- Store **users** in PostgreSQL (persist across deploys).
- Store **sessions** in PostgreSQL (logins survive restarts and multiple instances).

## Without a database

If you don’t add Postgres, the app still runs but uses file-based users and in-memory sessions. On Railway the filesystem is ephemeral, so user accounts and sessions are lost on every deploy/restart.

## Install dependencies

```bash
npm install
```

Run locally with Postgres by setting `DATABASE_URL` in `.env` (e.g. from a local PostgreSQL or a Railway Postgres URL).
