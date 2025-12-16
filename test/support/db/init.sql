CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Schemas used by services for readiness checks in local/dev stacks.
CREATE SCHEMA IF NOT EXISTS platform;
CREATE SCHEMA IF NOT EXISTS cms;
CREATE SCHEMA IF NOT EXISTS docs;
CREATE SCHEMA IF NOT EXISTS telemetry;
CREATE SCHEMA IF NOT EXISTS authz;
