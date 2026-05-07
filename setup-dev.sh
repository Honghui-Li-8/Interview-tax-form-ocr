#!/usr/bin/env bash
set -e

# Check for Node.js
if ! command -v node &>/dev/null; then
  echo "Node.js is not installed. Install it from https://nodejs.org (v20+ recommended) then re-run."
  exit 1
fi

NODE_MAJOR="$(node -e 'process.stdout.write(process.versions.node.split(".")[0])')"
if [[ "$NODE_MAJOR" -lt 18 ]]; then
  echo "Node.js v$NODE_MAJOR detected. v18 or higher is required."
  exit 1
fi

echo "Installing server dependencies..."
cd server
npm install
[ -f .env ] || cp .env.example .env
cd ..

echo "Installing web dependencies..."
cd web
npm install
[ -f .env ] || cp .env.example .env
cd ..

echo "Done. Run ./run-dev.sh to start both servers."
