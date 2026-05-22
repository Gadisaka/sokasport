#!/usr/bin/env bash
# Run on the VPS from the repo root after Docker is installed.
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose -f docker-compose.prod.yml up -d --build
echo "If this is the first deploy (empty Mongo), apply Prisma schema with:"
echo "  docker compose -f docker-compose.prod.yml exec backend npx prisma db push"
