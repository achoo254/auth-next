#!/bin/bash
# Writes one chat tenant's rows as a psql script for a self-hosted install
# (ADR 0007 §7), where they belong to its primary tenant:
#   export-chat.sh <chat-env-file> <out.sql>
# Rows with the tenant's tenant_id, and the rows of tables without one
# reached through its chats, users, bots or hooks. Sessions, queues,
# caches, logs and the sync logs (outbox, *_updates) stay: clients resync
# (server_epoch goes up), people sign in again. A table this script does
# not know stops it (chat-tables.sh). Prints counts.
set -euo pipefail

ENV_FILE="${1:?usage: export-chat.sh <chat-env-file> <out.sql>}"
OUT="${2:?usage: export-chat.sh <chat-env-file> <out.sql>}"
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=chat-tables.sh
source "$HERE/chat-tables.sh"
check_chat_tables

schema="$(q "SELECT max(version_id) FROM goose_db_version")"
epoch="$(q "SELECT server_epoch FROM server_meta")"
{
	echo "-- chat schema $schema"
	echo "\\set ON_ERROR_STOP on"
	echo "BEGIN;"
	echo "SET LOCAL session_replication_role = replica;"
} >"$OUT"
for entry in "${MOVED[@]}"; do
	table="${entry%%|*}"
	where="${entry#*|}"
	columns="$(q "SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) FROM pg_attribute
		WHERE attrelid = '$table'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = ''")"
	selected="${columns/tenant_id/\'primary\' AS tenant_id}"
	echo "COPY $table ($columns) FROM stdin;" >>"$OUT"
	q "\\copy (SELECT $selected FROM $table WHERE $where) TO STDOUT" >>"$OUT"
	echo "\\." >>"$OUT"
	count="$(q "SELECT count(*) FROM $table WHERE $where")"
	echo "$table: $count"
done
echo "\\o /dev/null" >>"$OUT"
q "SELECT format('SELECT setval(%L, greatest((SELECT last_value FROM %I), %s));', sequencename, sequencename, last_value)
	FROM pg_sequences WHERE schemaname = 'public' AND last_value IS NOT NULL" >>"$OUT"
echo "\\o" >>"$OUT"
echo "UPDATE server_meta SET server_epoch = greatest(server_epoch, $epoch) + 1;" >>"$OUT"
echo "COMMIT;" >>"$OUT"
