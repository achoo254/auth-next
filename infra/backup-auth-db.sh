#!/bin/bash
# Daily dump of the `auth` database, kept for 14 days.
# Cron (root): 30 2 * * * /var/www/hoandat-auth/infra/backup-auth-db.sh >> /var/log/hoandat-auth-backup.log 2>&1
set -euo pipefail
cd /var/www/hoandat-auth
umask 077
STAMP="$(date +%Y%m%d-%H%M%S)"
# The URI holds the password, so it goes in a private config file, not argv.
CONFIG="$(mktemp)"
trap 'rm -f "$CONFIG"' EXIT
printf 'uri: "%s"\n' "$(sed -n 's/^MONGO_URL=//p' .env)" > "$CONFIG"
mongodump --quiet --config="$CONFIG" --archive="backups/auth-$STAMP.archive.gz" --gzip
find backups -name 'auth-*.archive.gz' -mtime +14 -delete
echo "$(date -Is) backup auth-$STAMP ok"
