# Deploying AutoApply

AutoApply is four processes: **Temporal** (queue and workflow engine), **api** (API + UI),
**worker** (fetch, score, tailor, render) and **apply-worker** (Chromium; fills and submits),
plus **Postgres**. `compose.yaml` runs all of them; the app processes share one image.

## Recommended: one machine with Docker

Any VM works (AWS EC2, GCP, Hetzner, DigitalOcean, or a box at home).
Size: **2 vCPU, 4 GB RAM** minimum (Chromium is the heavy part), 20 GB disk.

```bash
# on the machine
git clone <your repo> autoapply && cd autoapply
cp .env.example .env        # then fill it in: AI_GATEWAY_API_KEY, GOOGLE_CLIENT_ID, SESSION_SECRET, CREDENTIALS_KEY
docker compose up -d --build   # with TEMPORAL_* for Temporal Cloud in .env
docker compose ps              # postgres "healthy"; api, worker, apply-worker "running"
```

The app is on port 3000. Workflows are visible in the Temporal Cloud UI (cloud.temporal.io), or on port
8233 with the local profile (keep that one private).

**Put HTTPS in front before exposing it.** The session cookie travels with every request, so it
must not go over plain HTTP. The simplest way is [Caddy](https://caddyserver.com), which gets a
certificate automatically. Add this to `compose.yaml` and point your domain at the machine:

```yaml
  caddy:
    image: caddy:2
    command: caddy reverse-proxy --from your.domain.com --to api:3000
    ports: ["80:80", "443:443"]
    volumes: [caddy:/data]
    restart: unless-stopped
# and under volumes:  caddy:
```

Then remove `ports: ["3000:3000"]` from `api`, so the app is reachable only through HTTPS.

**Updating:** `git pull && docker compose up -d --build`. Temporal keeps in-flight applications
across restarts.

**Backups:** state lives in three Docker volumes: `postgres` (the database), `data` (resumes,
PDFs, screenshots), and `temporal` (workflow state).

```bash
docker compose exec -T postgres pg_dump -U autoapply autoapply > autoapply.sql      # database
docker run --rm -v np_data:/d -v $PWD:/b busybox tar czf /b/data.tgz -C /d .         # files
```

Remove the `ports` line from the `postgres` service when deploying, so the database is reachable
only from the other containers.

## Heroku

Heroku runs the same image as three process types (`heroku.yml`): `web` (API + UI), `worker`,
and `applyworker`. Dynos share no disk and lose theirs on restart, so every piece of state lives
in a managed service:

| State | Service | Settings |
|---|---|---|
| Database | Postgres, e.g. [Aiven](https://aiven.io) | `DATABASE_URL`, `DATABASE_CA_CERT`, `DATABASE_SCHEMA` |
| Files (resumes, PDFs, screenshots, traces) | [Vercel Blob](https://vercel.com/docs/vercel-blob), a **private** store | `BLOB_READ_WRITE_TOKEN` |
| Workflows and queues | [Temporal Cloud](https://temporal.io/cloud) | `TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE`, `TEMPORAL_API_KEY` |

### Setup

```bash
heroku create <app>
heroku stack:set container -a <app>

heroku config:set -a <app> \
  DATABASE_URL='postgres://avnadmin:<password>@<host>:<port>/defaultdb?sslmode=require' \
  DATABASE_CA_CERT="$(cat ca.pem)" \
  DATABASE_SCHEMA=autoapply \
  BLOB_READ_WRITE_TOKEN='vercel_blob_rw_...' \
  TEMPORAL_ADDRESS='<namespace>.<account>.tmprl.cloud:7233' \
  TEMPORAL_NAMESPACE='<namespace>.<account>' \
  TEMPORAL_API_KEY='...' \
  AI_GATEWAY_API_KEY='...' \
  GOOGLE_CLIENT_ID='....apps.googleusercontent.com' \
  SESSION_SECRET="$(openssl rand -base64 32)" \
  CREDENTIALS_KEY="$(openssl rand -base64 32)"

git push heroku main
```

Then scale the dynos for your plan (see **Dyno plans**).

- `DATABASE_CA_CERT` is the CA certificate from the Aiven console (**Connection information →
  CA certificate**). With it, the server's certificate is verified; the URL's `sslmode` is
  ignored. PEM text with literal `\n` escapes also works.
- `DATABASE_SCHEMA` keeps AutoApply's tables in their own schema, for a database that other apps
  also use (such as Aiven's `defaultdb`).
- Model settings (`AI_MODEL`, `REWRITE_MODEL`, `JEV_MODEL`) default to the values in `.env.example`.
- Migrations run when each process starts. The first one to start applies them; the others wait.
- Heroku serves HTTPS, so the session cookie never travels in plain text.
- `CREDENTIALS_KEY` encrypts users' Workday passwords. Never change or lose it: saved passwords
  can't be read with another key, and users would have to enter them again.

### Google sign-in

Sign-in uses the client ID only; there is no client secret. In Google Cloud Console, under
**APIs & Services → Credentials**, open the OAuth client and add the app's address to
**Authorized JavaScript origins** (e.g. `https://<app>.herokuapp.com`, plus
`http://localhost:3000` for development). Before anyone outside the test users can sign in,
**publish** the OAuth consent screen.

The first person to sign in takes ownership of resumes and applications created before sign-in
existed.

### Dyno plans

**Eco** (a shared pool of 1000 dyno hours a month): the `web` dyno sleeps when unused, but
workers never do, so two workers alone would need about 1460 hours. Run both in one dyno instead:

```bash
heroku ps:scale web=1 workers=1 worker=0 applyworker=0 -a <app>
```

**Basic or larger**: one dyno per worker, so a busy browser never slows down scoring:

```bash
heroku ps:scale web=1 worker=1 applyworker=1 workers=0 -a <app>
```

Measured in this image under a 512 MB limit, running as a non-root user like Heroku: Chromium on
Workday pages, with full-page screenshots, peaked at **380 MB**. That figure includes the `npx`
wrapper (about 40 MB), which the dynos don't run. So the browser fits a 512 MB dyno with little
headroom. If the logs show `R14 (Memory quota exceeded)`, move the dyno that runs the browser
(`workers` or `applyworker`) to a Standard-2X dyno (1 GB).

### Limits

- Heroku ends HTTP requests after **30 seconds**. Uploading a resume waits for the model to read
  it, which usually takes well under that. A long or image-heavy PDF can exceed it; if so, the
  upload fails and can be retried.
- `HEADED=1` has no effect: the image contains only the headless browser.
