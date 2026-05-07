# Deployment

**Target:** AWS EC2 (Ubuntu 22.04)

## Prerequisites on a fresh EC2

```bash
# Copy the repo to the instance (scp, rsync, etc.), then:
cp server/.env.example server/.env   # fill in secrets
```

Everything else (Node.js, nginx, pm2, poppler-utils, certbot) is installed by `setup-deploy.sh`.

`setup-deploy.sh` is a quick one-shot setup script intended to be run directly on the EC2 instance — not from a CI pipeline or a remote machine.

## Plan

| Layer | Tool | What it does |
|---|---|---|
| Reverse proxy | Nginx | Serves compiled frontend; proxies `/api` to Express |
| Process manager | pm2 | Keeps server alive; restarts on crash and reboot |
| HTTPS | Certbot | Free TLS cert via Let's Encrypt — requires a domain |

## Exercise-scope tradeoffs

| Area | Shortcut | Production alternative |
|---|---|---|
| Database | SQLite on instance disk | Managed DB (RDS) |
| File storage | Local filesystem | Object storage (S3) |
| Process | pm2 as SSH user | Container or dedicated service account |
| Deploy | Re-run `setup-deploy.sh` manually | CI/CD pipeline |
| HTTPS | Optional — HTTP fallback if no domain | Always HTTPS |

> Setup instructions: [docs/Deployment.md](docs/Deployment.md)
