# shellcheck shell=bash
# The chat database of the tenant of $ENV_FILE (sourced by export-chat.sh
# and purge-tenant.sh): its connection (DATABASE_URL as libpq variables,
# never in argv or on the terminal) and its tables, as "table|rows of the
# tenant". A table missing from all three lists stops both scripts.

value() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1; }
T="$(value TENANT_ID)"
[[ "$T" =~ ^[a-z][a-z0-9]{1,30}$ ]] || { echo "chat: no TENANT_ID in $ENV_FILE" >&2; exit 1; }
eval "$(DATABASE_URL="$(value DATABASE_URL)" python3 -c '
import os, shlex, urllib.parse as u
url = u.urlsplit(os.environ["DATABASE_URL"])
for name, value in (("PGHOST", url.hostname), ("PGPORT", url.port), ("PGUSER", url.username),
		("PGPASSWORD", url.password), ("PGDATABASE", url.path.lstrip("/"))):
	if value:
		print(f"export {name}={shlex.quote(u.unquote(str(value)))}")
sslmode = u.parse_qs(url.query).get("sslmode")
if sslmode:
	print(f"export PGSSLMODE={shlex.quote(sslmode[0])}")
')"
q() { psql -X -v ON_ERROR_STOP=1 -At -c "$1"; }

USERS="SELECT id FROM users WHERE tenant_id = '$T'"
CHATS="SELECT id FROM chats WHERE tenant_id = '$T'"
BOTS="SELECT user_id FROM bots WHERE tenant_id = '$T'"
HOOKS="SELECT id FROM incoming_hooks WHERE tenant_id = '$T'"

# Moved to the install, in order: a row comes after the rows it references.
MOVED=(
	"files|tenant_id = '$T'"
	"users|tenant_id = '$T'"
	"chats|tenant_id = '$T'"
	"bots|tenant_id = '$T'"
	"private_chats|tenant_id = '$T'"
	"chat_members|chat_id IN ($CHATS)"
	"chat_read_states|chat_id IN ($CHATS)"
	"forum_topics|chat_id IN ($CHATS)"
	"messages|chat_id IN ($CHATS)"
	"message_files|chat_id IN ($CHATS)"
	"message_mentions|chat_id IN ($CHATS)"
	"message_reactions|chat_id IN ($CHATS)"
	"pinned_messages|chat_id IN ($CHATS)"
	"read_receipts|chat_id IN ($CHATS)"
	"invite_links|tenant_id = '$T'"
	"incoming_hooks|tenant_id = '$T'"
	"notify_groups|hook_id IN ($HOOKS)"
	"hook_posts|chat_id IN ($CHATS)"
	"hook_audit|tenant_id = '$T'"
	"bot_user_consent|bot_id IN ($BOTS)"
	"contacts|tenant_id = '$T'"
	"blocks|blocker_id IN ($USERS)"
	"user_hidden_messages|user_id IN ($USERS)"
	"user_state|user_id IN ($USERS)"
	"notification_settings|user_id IN ($USERS)"
	"privacy_settings|user_id IN ($USERS)"
	"account_restrictions|tenant_id = '$T'"
	"reports|tenant_id = '$T'"
	"moderation_log|tenant_id = '$T'"
	"feedback|tenant_id = '$T'"
	"ops_alerts|tenant_id = '$T'"
	"ops_alert_hooks|tenant_id = '$T'"
)

# The tenant's rows that do not move: sessions, sync logs, queues, caches,
# counters. Clients resync, people sign in again. Deleted by the purge.
LEFT=(
	"user_sessions|tenant_id = '$T'"
	"push_subscriptions|tenant_id = '$T'"
	"outbox|tenant_id = '$T'"
	"user_updates|user_id IN ($USERS)"
	"chat_updates|chat_id IN ($CHATS)"
	"send_dedupe|sender_id IN ($USERS)"
	"uploads|tenant_id = '$T'"
	"media_jobs|file_id IN (SELECT id FROM files WHERE tenant_id = '$T')"
	"data_exports|tenant_id = '$T'"
	"link_preview_photos|tenant_id = '$T'"
	"bot_updates|bot_id IN ($BOTS)"
	"bot_callbacks|bot_id IN ($BOTS)"
	"bot_delivery_counters|bot_id IN ($BOTS)"
	"bot_bulk_jobs|tenant_id = '$T'"
	"bot_inline_queries|tenant_id = '$T'"
	"hook_counters|hook_id IN ($HOOKS)"
	"hook_failures|hook_id IN ($HOOKS)"
	"hook_dead_letters|hook_id IN ($HOOKS)"
	"hook_idempotency|hook_id IN ($HOOKS)"
)

# No row of any tenant in particular.
SHARED=" tenants server_meta goose_db_version snowflake_workers outbox_cursors link_previews oidc_logout_jti "

# Stops when the database has a table none of the lists names. Needs q().
check_chat_tables() {
	local entry table tables
	local -A known=()
	for entry in "${MOVED[@]}" "${LEFT[@]}"; do known[${entry%%|*}]=1; done
	tables="$(q "SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition")"
	[ -n "$tables" ] || { echo "chat: cannot list the tables" >&2; return 1; }
	for table in $tables; do
		if [ -z "${known[$table]:-}" ] && [[ "$SHARED" != *" $table "* ]]; then
			echo "chat: table $table is in none of the lists of migrate/chat-tables.sh" >&2
			return 1
		fi
	done
}

# Counts the tenant's rows of every table, and deletes them when $1 is 1,
# in one transaction, rows that reference others first.
purge_chat_rows() {
	local entry table where count statements="" i
	local -a entries=("${LEFT[@]}")
	check_chat_tables
	for ((i = ${#MOVED[@]} - 1; i >= 0; i--)); do entries+=("${MOVED[i]}"); done
	for entry in "${entries[@]}"; do
		table="${entry%%|*}"
		where="${entry#*|}"
		count="$(q "SELECT count(*) FROM $table WHERE $where")"
		echo "$table: $count"
		statements+="DELETE FROM $table WHERE $where;"
	done
	if [ "$1" = 1 ]; then q "BEGIN; $statements COMMIT;" >/dev/null; fi
}
