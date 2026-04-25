#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/getotps/backend}"
BACKUP_DIR="${BACKUP_DIR:-/root/backups/getotps}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
DB_NAME="${DB_NAME:-getotps}"
DB_USER="${DB_USER:-postgres}"
AWS_REGION="${AWS_REGION:-us-east-1}"

mkdir -p "$BACKUP_DIR"
ts="$(date -u +%Y%m%d-%H%M%S)"
out="$BACKUP_DIR/getotps-${ts}.sql.gz"

echo "[backup] creating database dump: $out"
PGPASSWORD="${PGPASSWORD:-${POSTGRES_PASSWORD:-}}" \
  pg_dump -U "$DB_USER" "$DB_NAME" | gzip > "$out"

if [[ -n "${S3_BUCKET:-}" ]]; then
  if [[ -z "${S3_ACCESS_KEY_ID:-}" || -z "${S3_SECRET_ACCESS_KEY:-}" ]]; then
    echo "[backup] S3_BUCKET provided but S3 credentials missing"
    exit 1
  fi

  export AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID"
  export AWS_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY"
  export AWS_DEFAULT_REGION="$AWS_REGION"

  prefix="${S3_PREFIX:-getotps/backups}"
  key="s3://${S3_BUCKET}/${prefix}/$(basename "$out")"
  echo "[backup] uploading to $key"
  aws s3 cp "$out" "$key"

  echo "[backup] pruning remote objects older than ${RETENTION_DAYS}d"
  cutoff_epoch="$(date -u -d "-${RETENTION_DAYS} days" +%s 2>/dev/null || python3 - <<'PY'
import time
print(int(time.time()) - 30*24*3600)
PY
)"
  aws s3 ls "s3://${S3_BUCKET}/${prefix}/" | while read -r d t size name; do
    [[ -z "${name:-}" ]] && continue
    obj_ts="$(date -d "${d} ${t}" +%s 2>/dev/null || echo 0)"
    if [[ "$obj_ts" -gt 0 && "$obj_ts" -lt "$cutoff_epoch" ]]; then
      aws s3 rm "s3://${S3_BUCKET}/${prefix}/${name}"
    fi
  done
fi

echo "[backup] pruning local backups older than ${RETENTION_DAYS}d"
find "$BACKUP_DIR" -type f -name "getotps-*.sql.gz" -mtime "+${RETENTION_DAYS}" -delete
echo "[backup] done"

