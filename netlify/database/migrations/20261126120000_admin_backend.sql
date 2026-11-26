-- Admin backend: Better Auth (login + TOTP 2FA + rate limits) and the landing-page content store.
-- Better Auth part generated with `node scripts/auth-schema.mjs` (better-auth 1.7.28).

create table "user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" boolean not null, "image" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null, "twoFactorEnabled" boolean, "role" text);

create table "session" ("id" text not null primary key, "expiresAt" timestamptz not null, "token" text not null unique, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null, "ipAddress" text, "userAgent" text, "userId" text not null references "user" ("id") on delete cascade);

create table "account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz, "scope" text, "password" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null);

create table "verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" timestamptz not null, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null);

create table "twoFactor" ("id" text not null primary key, "secret" text not null, "backupCodes" text not null, "userId" text not null references "user" ("id") on delete cascade, "verified" boolean, "failedVerificationCount" integer, "lockedUntil" timestamptz);

create table "rateLimit" ("id" text not null primary key, "key" text not null unique, "count" integer not null, "lastRequest" bigint not null);

create index "session_userId_idx" on "session" ("userId");
create index "account_userId_idx" on "account" ("userId");
create index "verification_identifier_idx" on "verification" ("identifier");
create index "twoFactor_secret_idx" on "twoFactor" ("secret");
create index "twoFactor_userId_idx" on "twoFactor" ("userId");

-- Content. JSON is stored as text (not jsonb) so the key order of cms.json, which is the field
-- order in the editor, is kept exactly.
create table site_content (
  site_id text primary key,
  draft text not null,
  draft_rev integer not null default 1,
  draft_updated_at timestamptz not null default now(),
  draft_updated_by text not null,
  published_version integer not null
);

create table site_versions (
  site_id text not null,
  version integer not null,
  data text not null,
  published_at timestamptz not null default now(),
  published_by text not null,
  note text,
  primary key (site_id, version)
);

-- Uploaded images (re-encoded to WebP), served publicly under /images/cms/….
create table media (
  site_id text not null,
  path text not null,
  mime text not null,
  size integer not null,
  sha256 text not null,
  width integer,
  height integer,
  data bytea not null,
  created_at timestamptz not null default now(),
  created_by text not null,
  primary key (site_id, path)
);

create table audit (
  id bigserial primary key,
  at timestamptz not null default now(),
  user_id text,
  user_email text,
  action text not null,
  site_id text,
  ip text,
  detail text
);
create index audit_at_idx on audit (at desc);
