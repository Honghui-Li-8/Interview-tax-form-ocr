#!/usr/bin/env bash
set -e

trap 'kill 0' EXIT

echo "Starting backend on http://localhost:3001 ..."
cd server && npm run dev &

echo "Starting frontend on http://localhost:5173 ..."
cd web && npm run dev &

wait
