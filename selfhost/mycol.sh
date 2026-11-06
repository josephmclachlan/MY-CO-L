#!/usr/bin/env bash
# MY/CO/L farm box helper. Run from this folder:  ./mycol.sh <command>
#
#   setup               first time only: makes .env with new secrets and keys
#   start               starts everything (and the model / sensors if set up in .env)
#   stop                stops everything (records are safe)
#   status              shows what is running and if the app answers
#   add-user EMAIL      makes a login (asks for the passcode)
#   passcode EMAIL      sets a new passcode for a login
#   migrate             applies any new database changes from ./migrations (start does this too)
#   model [NAME]        downloads the assistant model (default: OLLAMA_MODEL in .env)
#   backup              backs up all records now (also runs every night by itself)
#   restore FILE        puts a backup back (asks first; makes a safety backup before)
#   restore-test        checks the newest backup really restores, without touching live data
#   update [FILE]       gets the newest app from GitHub (or from FILE), backs up, swaps it in
#   sql                 opens the database prompt (for STAFF screen SQL)
#   install-timers      nightly backup 02:30 and a weekly restore check (Sunday 04:00), farm clock
#   logs [NAME]         shows recent messages (db, auth, rest, web, ollama, bridge)
set -euo pipefail
cd "$(dirname "$0")"
HERE=$PWD

say() { printf '\n== %s\n' "$*"; }
die() { printf '\n!! %s\n' "$*" >&2; exit 1; }

load_env() {
  [ -f .env ] || die "No .env yet. Run ./mycol.sh setup first."
  set -a; . ./.env; set +a
  BACKUP_DIR=${BACKUP_DIR:-./backups}
}

profiles() {
  local p=()
  [ -n "${OLLAMA_MODEL:-}" ] && [ "${OLLAMA_HOST_PORT:-ollama:11434}" = "ollama:11434" ] && p+=(--profile ai)
  [ -n "${GOVEE_API_KEY:-}" ] && p+=(--profile sensors)
  echo "${p[@]:-}"
}
dc() { docker compose $(profiles) "$@"; }
psql_db() { docker compose exec -T -e PGOPTIONS="-c client_min_messages=warning" db psql -v ON_ERROR_STOP=1 -U postgres -d postgres "$@"; }
psql_q() { psql_db "$@" </dev/null; }  # one SQL line; never reads the keyboard or a pipe

b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
jwt() { # jwt ROLE SECRET  -> a 10-year key for that role
  local now exp head body sig
  now=$(date +%s); exp=$((now + 315360000))
  head=$(printf '{"alg":"HS256","typ":"JWT"}' | b64url)
  body=$(printf '{"role":"%s","iss":"mycol-selfhost","iat":%s,"exp":%s}' "$1" "$now" "$exp" | b64url)
  sig=$(printf '%s.%s' "$head" "$body" | openssl dgst -sha256 -hmac "$2" -binary | b64url)
  printf '%s.%s.%s' "$head" "$body" "$sig"
}
setenv() { # setenv KEY VALUE  (in .env)
  if grep -q "^$1=" .env; then sed -i.bak "s|^$1=.*|$1=$2|" .env && rm -f .env.bak; else echo "$1=$2" >> .env; fi
}

cmd_setup() {
  command -v docker >/dev/null || die "Docker is not installed. See docs/SELF-HOST.md step 2."
  command -v openssl >/dev/null || die "openssl is missing (sudo apt install openssl)."
  if [ -f .env ] && grep -q '^JWT_SECRET=.\+' .env; then die ".env already has secrets. Setup only runs once."; fi
  [ -f .env ] || cp .env.example .env
  local secret pw
  secret=$(openssl rand -hex 32); pw=$(openssl rand -hex 24)
  setenv POSTGRES_PASSWORD "$pw"
  setenv JWT_SECRET "$secret"
  setenv ANON_KEY "$(jwt anon "$secret")"
  setenv SERVICE_KEY "$(jwt service_role "$secret")"
  chmod 600 .env
  mkdir -p data backups app
  say "Secrets made and saved in .env (keep a copy in your password manager)."
  echo "Next: put your https address in .env as SITE_URL, then run ./mycol.sh start"
}

cmd_migrate() {
  load_env
  [ -d migrations ] || die "No migrations folder. Run ./mycol.sh update first."
  # The login program must have made its own tables first (auth.users).
  for i in $(seq 1 60); do
    psql_q -tAc "select to_regclass('auth.users') is not null" 2>/dev/null | grep -q t && break
    [ "$i" = 60 ] && die "The login service did not set up its tables. Try: ./mycol.sh logs auth"
    sleep 2
  done
  local users n=0
  users=$(psql_q -tAc "select count(*) from auth.users")
  local applied
  applied=$(psql_q -tAc "select name from selfhost.applied")
  for f in migrations/*.sql; do
    local name; name=$(basename "$f")
    grep -qx "$name" <<<"$applied" && continue
    if [[ "$name" > "0002" ]]; then
      [ "$users" -gt 0 ] || die "Make your login first (./mycol.sh add-user you@example.com), then run ./mycol.sh migrate. 0002 locks every table to the logins that exist when it runs."
    fi
    say "Applying $name"
    { echo "begin;"; cat "$f"; echo; echo "insert into selfhost.applied(name) values ('$name');"; echo "commit;"; } | psql_db -q >/dev/null
    n=$((n + 1))
  done
  psql_q -qc "notify pgrst, 'reload schema';" >/dev/null
  say "$n new database change(s) applied."
}

wait_web() {
  for i in $(seq 1 60); do
    curl -fsS -o /dev/null http://127.0.0.1:8080/auth/v1/health 2>/dev/null && return 0
    sleep 2
  done
  die "The app did not answer on port 8080. Try: ./mycol.sh logs"
}

cmd_start() {
  load_env
  [ -f app/index.html ] || die "No app files yet. Run ./mycol.sh update first (or unpack the app download into ./app)."
  dc up -d --remove-orphans
  wait_web
  local users; users=$(psql_q -tAc "select count(*) from auth.users" 2>/dev/null || echo 0)
  if [ "$users" -gt 0 ]; then cmd_migrate; else say "No login yet: run ./mycol.sh add-user you@example.com (then ./mycol.sh migrate)"; fi
  say "MY/CO/L is running. Open $SITE_URL"
}

cmd_stop() { load_env; dc down; }

cmd_status() {
  load_env
  dc ps --format 'table {{.Service}}\t{{.Status}}'
  curl -fsS -o /dev/null http://127.0.0.1:8080/ 2>/dev/null && echo "app: OK" || echo "app: NOT ANSWERING"
  curl -fsS -o /dev/null http://127.0.0.1:8080/auth/v1/health 2>/dev/null && echo "login: OK" || echo "login: NOT ANSWERING"
  curl -fsS -o /dev/null http://127.0.0.1:8080/llm/api/tags 2>/dev/null && echo "model: OK" || echo "model: off"
  local last; last=$(ls -1t "$BACKUP_DIR"/mycol-*.dump 2>/dev/null | head -1 || true)
  echo "newest backup: ${last:-NONE}"
}

cmd_add_user() {
  load_env
  local email=${1:-}; [ -n "$email" ] || die "Usage: ./mycol.sh add-user you@example.com"
  local pass pass2
  read -rsp "Passcode for $email (8+ characters): " pass; echo
  read -rsp "Same passcode again: " pass2; echo
  [ "$pass" = "$pass2" ] || die "The two passcodes differ."
  [ ${#pass} -ge 8 ] || die "Use at least 8 characters."
  local body; body=$(printf '{"email":"%s","password":"%s","email_confirm":true}' "$email" "${pass//\"/\\\"}")
  curl -fsS -X POST http://127.0.0.1:8080/auth/v1/admin/users \
    -H "Authorization: Bearer $SERVICE_KEY" -H "Content-Type: application/json" -d "$body" >/dev/null \
    || die "Could not make the login (is it already there? ./mycol.sh logs auth)"
  say "Login made for $email."
  local first; first=$(psql_q -tAc "select count(*) from selfhost.applied")
  if [ "$first" -gt 0 ]; then
    echo "The database is already set up. For an OWNER login run ./mycol.sh sql and type:"
    echo "  insert into public.allowed_users (user_id) select id from auth.users where email = '$email';"
    echo "For a STAFF login use the SQL on the app's STAFF screen instead."
  fi
}

cmd_passcode() {
  load_env
  local email=${1:-}; [ -n "$email" ] || die "Usage: ./mycol.sh passcode you@example.com"
  local id; id=$(psql_q -tAc "select id from auth.users where email = lower('${email//\'/}')")
  [ -n "$id" ] || die "No login for $email."
  local pass pass2
  read -rsp "New passcode for $email (8+ characters): " pass; echo
  read -rsp "Same passcode again: " pass2; echo
  [ "$pass" = "$pass2" ] || die "The two passcodes differ."
  [ ${#pass} -ge 8 ] || die "Use at least 8 characters."
  curl -fsS -X PUT "http://127.0.0.1:8080/auth/v1/admin/users/$id" \
    -H "Authorization: Bearer $SERVICE_KEY" -H "Content-Type: application/json" \
    -d "$(printf '{"password":"%s"}' "${pass//\"/\\\"}")" >/dev/null || die "Could not change it (./mycol.sh logs auth)."
  say "New passcode set for $email."
}

cmd_model() {
  load_env
  local m=${1:-${OLLAMA_MODEL:-}}; [ -n "$m" ] || die "Usage: ./mycol.sh model qwen2.5:7b"
  docker compose --profile ai up -d ollama
  docker compose exec ollama ollama pull "$m"
  setenv OLLAMA_MODEL "$m"
  say "Model $m ready. In the app: ASK > ENGINE > OLLAMA, address /llm, model $m, SAVE, RUN TEST QUESTIONS."
}

cmd_backup() {
  load_env
  mkdir -p "$BACKUP_DIR"
  local stamp file; stamp=$(date +%Y-%m-%d_%H%M%S); file="$BACKUP_DIR/mycol-$stamp.dump"
  [ -e "$file" ] && file="$BACKUP_DIR/mycol-$stamp-$$.dump"
  docker compose exec -T db pg_dump -U postgres -d postgres -Fc --schema=public --schema=auth --schema=selfhost > "$file.part"
  [ -s "$file.part" ] || die "Backup came out empty."
  mv "$file.part" "$file"
  ( cd "$BACKUP_DIR" && sha256sum "$(basename "$file")" > "$(basename "$file").sha256" )
  say "Backup saved: $file ($(du -h "$file" | cut -f1))"
  # Keep: every backup from the last KEEP_DAILY days, one per week for KEEP_WEEKLY weeks, one per month for KEEP_MONTHLY months.
  local keep_d=${KEEP_DAILY:-14} keep_w=${KEEP_WEEKLY:-8} keep_m=${KEEP_MONTHLY:-12} seen_w="" seen_m="" now
  now=$(date +%s)
  for f in $(ls -1t "$BACKUP_DIR"/mycol-*.dump); do
    local d day age wk mo
    d=$(basename "$f" | sed -E 's/mycol-([0-9-]{10}).*/\1/')
    day=$(date -d "$d" +%s 2>/dev/null || echo "$now")
    age=$(( (now - day) / 86400 )); wk=$(date -d "$d" +%G-%V); mo=${d:0:7}
    if [ "$age" -lt "$keep_d" ]; then continue; fi
    if [ "$age" -lt $((keep_w * 7)) ] && ! grep -qw "$wk" <<<"$seen_w"; then seen_w="$seen_w $wk"; continue; fi
    if [ "$age" -lt $((keep_m * 31)) ] && ! grep -qw "$mo" <<<"$seen_m"; then seen_m="$seen_m $mo"; continue; fi
    rm -f "$f" "$f.sha256"
  done
  if [ -n "${USB_DIR:-}" ]; then
    if mountpoint -q "$USB_DIR" 2>/dev/null || [ -d "$USB_DIR/mycol" ]; then
      mkdir -p "$USB_DIR/mycol" && rsync -a --delete "$BACKUP_DIR"/ "$USB_DIR/mycol/" && echo "copied to USB: $USB_DIR/mycol"
    else echo "!! USB drive not plugged in at $USB_DIR: no USB copy tonight"; fi
  fi
  if [ -n "${OFFSITE:-}" ]; then
    rclone copy "$file" "$OFFSITE" && rclone copy "$file.sha256" "$OFFSITE" && echo "copied off-site: $OFFSITE" \
      || echo "!! off-site copy failed (no internet?). It will go with the next backup."
    rclone copy "$BACKUP_DIR" "$OFFSITE" --max-age 7d >/dev/null 2>&1 || true
  fi
}

cmd_restore() {
  load_env
  local file=${1:-}; [ -f "$file" ] || die "Usage: ./mycol.sh restore backups/mycol-YYYY-MM-DD_HHMMSS.dump"
  read -rp "This REPLACES all live records with $file. Type RESTORE to go on: " ok
  [ "$ok" = "RESTORE" ] || die "Stopped. Nothing changed."
  cmd_backup
  docker compose stop rest auth bridge 2>/dev/null || docker compose stop rest auth
  psql_q -qc "drop schema if exists public cascade; drop schema if exists auth cascade; drop schema if exists selfhost cascade;" >/dev/null
  docker compose exec -T db pg_restore -U postgres -d postgres --exit-on-error < "$file" \
    || die "Restore failed part way. Run ./mycol.sh restore with the safety backup just made (newest in $BACKUP_DIR)."
  psql_q -qc "notify pgrst, 'reload schema';" >/dev/null
  docker compose start auth rest
  say "Restored from $file. Open the app and check a few records."
}

cmd_restore_test() {
  load_env
  local file; file=$(ls -1t "$BACKUP_DIR"/mycol-*.dump 2>/dev/null | head -1 || true)
  [ -n "$file" ] || die "No backups yet."
  ( cd "$BACKUP_DIR" && sha256sum -c "$(basename "$file").sha256" >/dev/null ) || die "Backup $file is damaged (checksum differs)."
  psql_q -qc "drop database if exists restore_test;" -c "create database restore_test;" >/dev/null
  docker compose exec -T db pg_restore -U postgres -d restore_test --no-owner < "$file" >/dev/null 2>&1 || true
  docker compose exec -T db psql -U postgres -d restore_test </dev/null -tAc \
    "select 'lots '||(select count(*) from public.block_lots)||', harvests '||(select count(*) from public.harvests)||', history lines '||(select count(*) from public.edit_log)" \
    || die "The backup did not restore. Keep the older ones and ask for help."
  psql_q -qc "drop database restore_test;" >/dev/null
  say "Newest backup $file restores fine."
}

cmd_update() {
  load_env
  local tmp; tmp=$(mktemp -d)
  if [ -n "${1:-}" ]; then
    # A download you copied here yourself (USB stick, or saved from the GitHub Releases page).
    [ -f "$1" ] || die "No file $1"
    cp "$1" "$tmp/mycol.tar.gz"
  else
    [ -n "${GITHUB_TOKEN:-}" ] || die "Put a read-only GitHub token in .env as GITHUB_TOKEN (docs/SELF-HOST.md), or run ./mycol.sh update mycol-selfhost.tar.gz with a file you downloaded."
    local api="https://api.github.com/repos/${GITHUB_REPO}/releases/tags/selfhost-latest" asset
    asset=$(curl -fsS -H "Authorization: Bearer $GITHUB_TOKEN" "$api" | grep -o '"url": *"[^"]*/releases/assets/[0-9]*"' | head -1 | sed 's/.*"\(http[^"]*\)"/\1/')
    [ -n "$asset" ] || die "No self-host download on GitHub yet (it is made each time a change is merged)."
    curl -fsSL -H "Authorization: Bearer $GITHUB_TOKEN" -H "Accept: application/octet-stream" "$asset" -o "$tmp/mycol.tar.gz"
  fi
  tar -xzf "$tmp/mycol.tar.gz" -C "$tmp"
  [ -f "$tmp/mycol-selfhost/app/index.html" ] || die "The download looks wrong. Nothing changed."
  [ -f app/index.html ] && [ -n "$(docker compose ps -q db 2>/dev/null)" ] && cmd_backup
  rm -rf app.old && { [ -d app ] && mv app app.old || true; }
  mv "$tmp/mycol-selfhost/app" app
  rm -rf migrations && mv "$tmp/mycol-selfhost/migrations" migrations
  for f in docker-compose.yml Caddyfile mycol.sh .env.example db/00-roles.sh bridge/bridge.mjs; do
    # copy then rename, so this running script is swapped whole, never half-written
    [ -f "$tmp/mycol-selfhost/selfhost/$f" ] && mkdir -p "$(dirname "$f")" && cp -p "$tmp/mycol-selfhost/selfhost/$f" "$f.new" && mv -f "$f.new" "$f"
  done
  cp "$tmp/mycol-selfhost/VERSION" VERSION 2>/dev/null || true
  rm -rf "$tmp"
  say "App updated to $(cat VERSION 2>/dev/null || echo 'newest'). The old one is kept in ./app.old."
  if [ -n "$(docker compose ps -q db 2>/dev/null)" ]; then dc up -d --remove-orphans; cmd_migrate; fi
}

cmd_install_timers() {
  local me; me="$HERE/mycol.sh"
  ( crontab -l 2>/dev/null | grep -v 'mycol.sh' || true
    echo "30 2 * * * $me backup >> $HERE/backups/backup.log 2>&1"
    echo "0 4 * * 0 $me restore-test >> $HERE/backups/backup.log 2>&1"
  ) | crontab -
  mkdir -p "$HERE/backups"
  say "Nightly backup and weekly restore check are on. This computer's clock zone: $(cat /etc/timezone 2>/dev/null || date +%Z)"
}

cmd_sql() { load_env; docker compose exec db psql -U postgres -d postgres; }
cmd_logs() { load_env; dc logs --tail 80 ${1:-}; }

case "${1:-help}" in
  setup) cmd_setup ;;
  start) cmd_start ;;
  stop) cmd_stop ;;
  status) cmd_status ;;
  add-user) shift; cmd_add_user "$@" ;;
  passcode) shift; cmd_passcode "$@" ;;
  migrate) cmd_migrate ;;
  model) shift; cmd_model "$@" ;;
  backup) cmd_backup ;;
  restore) shift; cmd_restore "$@" ;;
  restore-test) cmd_restore_test ;;
  update) shift; cmd_update "$@" ;;
  sql) cmd_sql ;;
  install-timers) cmd_install_timers ;;
  logs) shift; cmd_logs "$@" ;;
  *) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//' ;;
esac
