-- Roda só na criação do volume (docker-entrypoint-initdb.d). Credenciais apenas para dev.
-- despacho      = dono das tabelas; roda as migrations.
-- despacho_app  = usado pela API; sem BYPASSRLS, então as policies de RLS valem para ele.
create role despacho_app login password 'despacho_app' nosuperuser nobypassrls;
create database despacho_test owner despacho;
\connect despacho_test
create extension if not exists postgis;
\connect despacho
create extension if not exists postgis;
