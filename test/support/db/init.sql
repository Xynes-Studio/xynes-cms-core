CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Schemas used by services for readiness checks in local/dev stacks.
CREATE SCHEMA IF NOT EXISTS platform;
CREATE SCHEMA IF NOT EXISTS cms;
CREATE SCHEMA IF NOT EXISTS docs;
CREATE SCHEMA IF NOT EXISTS telemetry;
CREATE SCHEMA IF NOT EXISTS authz;
CREATE SCHEMA IF NOT EXISTS identity;

-- Disposable-test fixture owned by this test environment, not by cms-core's
-- runtime migrations. Integration tests may SELECT this dedicated identity;
-- application code must continue treating identity.users as read-only.
CREATE TABLE IF NOT EXISTS identity.users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  display_name text,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO identity.users (id, email, display_name)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'cms-integration@local.invalid',
  'CMS Integration Test'
)
ON CONFLICT (id) DO NOTHING;
