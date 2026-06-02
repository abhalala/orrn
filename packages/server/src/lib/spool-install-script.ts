export function buildDockerInstallScript(input: {
  subdomain: string;
  spoolDomain: string;
  image: string;
  instanceId: string;
  sharedSecret: string;
  cfTunnelToken: string;
  orrnServerUrl: string;
}) {
  const script = `#!/usr/bin/env bash
set -euo pipefail

APP_SLUG="orrn-spool-${input.subdomain}"
INSTALL_ROOT="${"${INSTALL_ROOT:-/opt/${APP_SLUG}}"}"
CONTAINER_NAME="${"${CONTAINER_NAME:-${APP_SLUG}}"}"
IMAGE="${input.image}"
PORT="${"${PORT:-8080}"}"

mkdir -p "${"${INSTALL_ROOT}"}/data" "${"${INSTALL_ROOT}"}/config"

cat > "${"${INSTALL_ROOT}"}/config/config.yaml" <<'YAML'
server:
  port: 8080
  read_timeout: 30s
  write_timeout: 30s

database:
  path: /app/data/spool.db
  archive_path: /app/data/archives
  archive_days: 30

printers:
  health_check_interval: 30s
  connection_timeout: 10s
  status_poll_interval: 5s

queue:
  max_retries: 3
  retry_delay: 10s
  worker_count: 2

logging:
  level: info
  format: json
YAML

cat > "${"${INSTALL_ROOT}"}/config/spool.env" <<'ENV'
ORRN_SPOOL_INSTANCE_ID=${input.instanceId}
ORRN_SPOOL_SUBDOMAIN=${input.subdomain}
ORRN_SPOOL_DOMAIN=${input.spoolDomain}
ORRN_SPOOL_SERVER_URL=${input.orrnServerUrl}
ORRN_SPOOL_SHARED_SECRET=${input.sharedSecret}
ORRN_SPOOL_TUNNEL_ENABLED=true
ORRN_SPOOL_TUNNEL_TOKEN=${input.cfTunnelToken}
ENV

docker pull "${"${IMAGE}"}"
docker rm -f "${"${CONTAINER_NAME}"}" >/dev/null 2>&1 || true

docker run -d \
  --name "${"${CONTAINER_NAME}"}" \
  --restart unless-stopped \
  -p "${"${PORT}"}:8080" \
  --env-file "${"${INSTALL_ROOT}"}/config/spool.env" \
  -v "${"${INSTALL_ROOT}"}/data:/app/data" \
  -v "${"${INSTALL_ROOT}"}/config/config.yaml:/app/config.yaml:ro" \
  "${"${IMAGE}"}" \
  --config /app/config.yaml

echo "orrn-spool is installing in Docker."
echo "Container: ${"${CONTAINER_NAME}"}"
echo "Data: ${"${INSTALL_ROOT}"}/data"
echo "Config: ${"${INSTALL_ROOT}"}/config/config.yaml"
echo "UI: http://localhost:${"${PORT}"}"
`;

  return script;
}
