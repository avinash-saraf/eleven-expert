# Ubuntu deployment

Run the frontend, backend, Postgres, and a Cloudflare Tunnel on the Ubuntu server.
One tunnel can publish both hostnames:

| Public hostname | Origin inside Docker | Purpose |
| --- | --- | --- |
| `meets.sellmate.kz` | `http://frontend:80` | Built React app served by Nginx |
| `api-meets.sellmate.kz` | `http://backend:3000` | REST API, Recall WebSockets, output page, webhooks |

The browser calls `https://api-meets.sellmate.kz` directly. Backend CORS permits
`https://meets.sellmate.kz`. The existing local Compose file and database port 5401
are unchanged; production Postgres uses internal port 5432 with no published port.

## 1. Prepare Ubuntu and upload the project

Install Docker Engine and the Compose plugin using the
[official Ubuntu instructions](https://docs.docker.com/engine/install/ubuntu/).
Enable Docker at boot with `sudo systemctl enable --now docker`.
Use `sudo docker` below if your SSH user cannot access Docker.

Upload the entire project folder, including both `backend` and `frontend/web`.
For example, run this from the project root on your laptop after replacing
`USER@SERVER` with your SSH target:

```bash
ssh USER@SERVER 'mkdir -p ~/eleven-expert'
rsync -az --exclude=node_modules --exclude=dist --exclude=.git \
  --exclude='.env*' --exclude=production.env --exclude='*.sql' --exclude='*.dump' \
  ./ USER@SERVER:~/eleven-expert/
```

## 2. Configure the server

On Ubuntu:

```bash
cd ~/eleven-expert
cp -n deploy/production.env.example deploy/production.env
chmod 600 deploy/production.env
openssl rand -hex 32
nano deploy/production.env
```

Set the generated database password and your working Recall, Google login group,
Anthropic, and ElevenLabs settings. Preserve your actual Recall region and any
model/voice overrides. Copy webhook secrets if webhooks are configured.
Leave `DATABASE_URL` out: Compose constructs it using `postgres:5432`.
Keep provider credentials in `deploy/production.env`; the frontend only receives
the public `VITE_API_BASE_URL`. Vite embeds that URL at build time, so changing it
requires a frontend rebuild, not just a container restart.

This deployment creates a **new server database**. To retain your laptop's saved
workflows, use the optional database transfer below before the first full startup.

## 3. Build and start the app

From the project root on Ubuntu:

```bash
docker compose --env-file deploy/production.env -f deploy/compose.yml config --quiet
docker compose --env-file deploy/production.env -f deploy/compose.yml up -d --build
docker compose --env-file deploy/production.env -f deploy/compose.yml ps -a
curl -f http://127.0.0.1:3300/
curl -f http://127.0.0.1:8080/healthz
```

The migration container applies the existing Prisma migrations and exits with
code 0. NestJS starts only after Postgres is healthy and migrations succeed.
Ports 3300 and 8080 bind only to server loopback; change them in the environment
file if occupied. No inbound application ports need opening for the tunnel.

## 4. Connect Cloudflare and move the hostnames

Create a remotely managed tunnel for this server in Cloudflare's dashboard,
following its [tunnel setup guide](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel/).
Copy its connector token into `CLOUDFLARE_TUNNEL_TOKEN` in `production.env`.
Start the included connector:

```bash
docker compose --env-file deploy/production.env -f deploy/compose.yml --profile tunnel up -d
```

Add the two published application routes from the table. Use service type HTTP
and origin addresses `frontend:80` and `backend:3000`. Leave the route Path empty
so all API paths, `/recall/media/`, `/recall/output/`, and `/webhooks/recall` work.
Keep WebSockets enabled for the zone; Recall needs them in both directions.
The API routes must be accessible to Recall without an interactive login page.

For `api-meets.sellmate.kz`, move its existing published route/DNS record from the
laptop tunnel to the server tunnel after the local server checks pass. Cloudflare
may require removing the existing conflicting DNS record before adding the new
route. Do not run laptop and server connectors for the same tunnel with different
origins: requests may reach either machine. Stop the laptop connector after the
server hostname works. The Recall WebSocket URL and webhook URL stay unchanged.

If you already run `cloudflared` as a service on Ubuntu, omit the `tunnel` profile
and add both hostnames to that tunnel instead. Its origins are
`http://localhost:8080` and `http://localhost:3300`, since it runs outside Docker.

Open `https://meets.sellmate.kz`, log in, and start a fresh session. Verify that
Recall connects and Ari speaks with your laptop tunnel stopped. Workflows persist
in the server's Postgres volume; existing browser login tokens from the laptop
database require signing in again unless you transfer that database.

## Updates and logs

Upload changed source, then rebuild on Ubuntu:

```bash
docker compose --env-file deploy/production.env -f deploy/compose.yml --profile tunnel up -d --build
docker compose --env-file deploy/production.env -f deploy/compose.yml logs --tail=100 -f backend cloudflared
```

Use `up -d` after backend environment changes; it recreates changed containers.
Containers restart automatically after a server reboot when Docker is enabled.
Keep one backend instance: live AI state is currently in memory, so backend
restarts interrupt active sessions. Update between calls. Do not use `down -v`
unless you intend to delete the database volume.

## Optional: transfer existing workflows

Finish active calls first. On the laptop, from `backend`:

```bash
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges' > /tmp/eleven-expert.sql
scp /tmp/eleven-expert.sql USER@SERVER:/tmp/eleven-expert.sql
```

On Ubuntu, from the project root, restore **only into a new, empty database**
before starting the migration/backend containers:

```bash
docker compose --env-file deploy/production.env -f deploy/compose.yml up -d --wait postgres
docker compose --env-file deploy/production.env -f deploy/compose.yml exec -T postgres sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < /tmp/eleven-expert.sql
```

Then continue with step 3. The dump includes the existing Prisma migration history,
workflows, learned knowledge, and users. No database transfer is performed by the
deployment files themselves.
