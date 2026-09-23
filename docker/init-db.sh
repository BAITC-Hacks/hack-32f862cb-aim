#!/bin/sh
set -eu
psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER:-postgres}" --dbname "${POSTGRES_DB:-postgres}" -v app_password="$OPTISTOCK_DB_PASSWORD" <<'SQL'
CREATE ROLE optistock LOGIN PASSWORD :'app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE DATABASE optistock OWNER optistock;
CREATE DATABASE optistock_test OWNER optistock;
SQL
