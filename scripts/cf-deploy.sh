#!/usr/bin/env bash
# Despliega dist/ a Cloudflare Pages sin usar la caché no escribible de node_modules.
set -euo pipefail
export WRANGLER_HOME="${WRANGLER_HOME:-/tmp/wrangler-home}"
export XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-/tmp/wrangler-config}"
export XDG_CACHE_HOME="${XDG_CACHE_HOME:-/tmp/wrangler-cache}"
export NPM_CONFIG_CACHE="${NPM_CONFIG_CACHE:-/tmp/npm-cache}"
export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-1073dbb67e1a93496143d5be3eade19b}"
mkdir -p "$WRANGLER_HOME" "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME" "$NPM_CONFIG_CACHE"
PROJECT="${CF_PAGES_PROJECT:-eppcheck}"
# No imprimir secretos. wrangler lee CLOUDFLARE_API_TOKEN del entorno.
exec npx --yes wrangler@4 pages deploy dist --project-name="$PROJECT" --commit-dirty=true
