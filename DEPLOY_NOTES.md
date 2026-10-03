# Oracle Cloud demo deployment

A **test demo** of StreetBoardman on one Oracle Cloud Always Free VM, at $0. Demo money only: `APP_MODE=DEMO` is fixed in `docker-compose.yml`, and no Paystack keys are passed to any container. The production plan (AWS, `infra/terraform/`, [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)) is separate and not used here.

No secrets are in this file or in git.

## Server

| | |
|---|---|
| Host | Oracle Cloud Always Free, Ampere A1 (ARM64), 2 OCPU, 12 GB RAM, Ubuntu 24.04 |
| Address | `[VM_IP]`, SSH `ssh -i [SSH_KEY_PATH] ubuntu@[VM_IP]` |
| URL | `https://[DOMAIN]` (DuckDNS) |
| Open ports | 22, 80, 443 only (Oracle security list and host iptables) |
| Code | `~/streetboardman`, branch `deploy/oracle-demo`, cloned over HTTPS (public repo, no deploy key) |
| Secrets | `~/streetboardman/.env` (chmod 600, created by `ops/init-env.sh`) |
| Demo logins | `~/DEMO_ACCOUNTS.txt` (chmod 600, outside the repo) |
| Backups | `~/backups/streetboardman-YYYY-MM-DD.sql.gz`, daily at 02:00, 14 days kept |

```
internet ──443──▶ Caddy (host, Let's Encrypt) ──▶ 127.0.0.1:8080 nginx (web) ──/api──▶ api ──▶ postgres
                                                                                   worker ──┘
```

- Caddy is the only public listener. nginx is published on 127.0.0.1 only, because Docker-published ports bypass iptables. Postgres and the API are not published at all.
- `docker-compose.oracle.yml` layers the demo settings over `docker-compose.yml`. `.env` sets `COMPOSE_FILE`, so a plain `docker compose …` in `~/streetboardman` uses both files. The comments at the top of that file explain each change.

## What was installed on the VM

- Docker Engine and the Compose plugin (official convenience script). The `ubuntu` user is in the `docker` group.
- Caddy, from its official apt repository. Config is `/etc/caddy/Caddyfile`, from `ops/Caddyfile.template`.
- A 2 GB swap file, `/swapfile`.
- `unattended-upgrades` for automatic security updates.
- iptables ACCEPT rules for 80 and 443, saved with `netfilter-persistent`.
- A crontab entry: `0 2 * * * ~/streetboardman/ops/backup.sh >> ~/backups/backup.log 2>&1`

## First-time setup (in order)

```bash
git clone -b deploy/oracle-demo https://github.com/afolabiadebowale/Street-Boardman.git ~/streetboardman
cd ~/streetboardman
ops/init-env.sh [DOMAIN]                          # BEFORE the first `up` (sets the DB passwords)
docker compose up -d --build
docker compose run --rm migrate npx prisma db seed
sed "s/DEMO_DOMAIN/[DOMAIN]/" ops/Caddyfile.template | sudo tee /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

`ops/init-env.sh` generates every secret with `openssl rand` on the server and never prints them. It refuses to overwrite an existing `.env`.

## Day-to-day

| Task | Command (in `~/streetboardman`) |
|---|---|
| Deploy the latest `deploy/oracle-demo` | `ops/deploy.sh`. Pulls, rebuilds, and migrations run automatically. |
| Health, disk, memory, recent logs | `ops/status.sh` |
| Follow logs | `docker compose logs -f api` (or `worker`, `web`, `postgres`) |
| Caddy logs | `sudo journalctl -u caddy -f` |
| Back up now | `ops/backup.sh` |
| Restore a backup | `ops/restore.sh ~/backups/streetboardman-YYYY-MM-DD.sql.gz`. It asks you to type `restore`, stops api and worker, and replaces all data. |
| Copy backups off the VM | `scp -i [SSH_KEY_PATH] 'ubuntu@[VM_IP]:backups/*.sql.gz' ./` |

Container logs are capped at 3 × 10 MB per service. Everything except the one-off `migrate` job restarts by itself after a crash or a reboot.

## Accounts

- The seeded Better, Boardman and Admin logins are in `~/DEMO_ACCOUNTS.txt`. The passwords in `prisma/seed.js` (`Admin@12345` etc.) are **not** used here.
- The staff security gate is on from day one. The Admin must set up two-factor authentication (an authenticator app) at first login before any admin tool opens.
- Registration is open: anyone can create a Better account with demo money.

## Known limitations

- **Single VM.** There is no failover. If the VM or its disk dies, the app is down until it's rebuilt.
- **Backups live on the same VM** unless you copy them off. Do that regularly.
- **Oracle may reclaim idle Always Free VMs** (low CPU, network and memory use over 7 days), and A1 capacity isn't guaranteed if the VM has to be recreated.
- **Rate limits are in memory**, so they reset when the API restarts. That's fine for one instance.
- **SMS, KYC and payouts are stubs.** They work in DEMO mode only.
- **DuckDNS:** if the IP changes, update the record or the certificate renewal fails.
- **DB password timing:** `COMPOSE_APP_DB_PASSWORD` is applied only when the Postgres volume is first created. Changing it later needs `ALTER ROLE streetboardman_app PASSWORD '…'` as well.
