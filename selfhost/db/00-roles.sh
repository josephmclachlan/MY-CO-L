#!/bin/sh
# Runs ONCE, the first time the database starts with an empty data folder.
# Makes the same roles Supabase has, so the app's migrations (supabase/migrations) run unchanged:
#   anon           a visitor who is not logged in (sees nothing: every table is owner-only)
#   authenticated  a logged-in person (row rules decide what they see)
#   service_role   the bridge and the setup script (skips row rules; never given to a browser)
#   authenticator  the login PostgREST uses; it switches to one of the three above per request
#   supabase_auth_admin  owns the auth schema (the login program's tables)
set -e
psql -v ON_ERROR_STOP=1 --username postgres --dbname postgres -v pw="$AUTH_PASSWORD" <<'SQL'
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role authenticator login noinherit password :'pw';
grant anon, authenticated, service_role to authenticator;
create role supabase_auth_admin login createrole noinherit password :'pw';
create schema auth authorization supabase_auth_admin;
alter role supabase_auth_admin set search_path = auth;
grant usage on schema auth to anon, authenticated, service_role, postgres;
grant create, connect on database postgres to supabase_auth_admin;
create extension if not exists pgcrypto;

-- Same default rights Supabase gives: tables are reachable, and the row rules (RLS) in each
-- migration decide who sees which rows.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;

-- Which app migrations have been applied (kept out of public, so the app cannot see it).
create schema selfhost;
create table selfhost.applied (name text primary key, applied_at timestamptz not null default now());
SQL
