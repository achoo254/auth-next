#!/bin/bash
# Creates (or updates the password of) the `auth` user, limited to readWrite on
# the `auth` database, using the password inside .env's MONGO_URL. Needs a
# MongoDB user that can manage users; its password is read from stdin so it
# never appears in argv, history or logs:
#   bash infra/create-mongo-user.sh <admin-user> < password-file
set -euo pipefail
cd /var/www/hoandat-auth
ADMIN_USER="${1:?admin user name}"
IFS= read -r ADMIN_PASSWORD
AUTH_PASSWORD="$(sed -n 's#^MONGO_URL=mongodb://auth:\([^@]*\)@.*#\1#p' .env)"
[ -n "$AUTH_PASSWORD" ] || { echo "MONGO_URL in .env has no auth password" >&2; exit 1; }

# Credentials travel through the environment, never argv (visible in ps).
export ADMIN_USER ADMIN_PASSWORD AUTH_PASSWORD
mongosh --quiet --norc "mongodb://127.0.0.1:27017/admin" --eval '
if (!db.getSiblingDB("admin").auth(process.env.ADMIN_USER, process.env.ADMIN_PASSWORD).ok) {
	throw new Error("admin authentication failed");
}
const target = db.getSiblingDB("auth");
const password = process.env.AUTH_PASSWORD;
const roles = [{ role: "readWrite", db: "auth" }];
if (target.getUser("auth")) {
	target.updateUser("auth", { pwd: password, roles });
	print("updated user auth");
} else {
	target.createUser({ user: "auth", pwd: password, roles });
	print("created user auth");
}'
