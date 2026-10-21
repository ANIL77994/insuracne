import { Client } from 'pg';
import * as dotenv from 'dotenv';
dotenv.config();

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:anil@localhost:5432/testdb';

async function migrate() {
  const client = new Client({ connectionString });
  await client.connect();
  console.log('Connected to PostgreSQL for roles & permissions migration...');

  try {
    await client.query('BEGIN');

    // 1. Create user_role enum type if not exists
    console.log('1. Creating user_role enum...');
    await client.query(`
      DO $$ BEGIN
        CREATE TYPE "user_role" AS ENUM (
          'AGENT',
          'POLICY_ADMINISTRATOR',
          'CLAIM_ASSESSOR',
          'CLAIM_SUPERVISOR',
          'CLAIM_MANAGER',
          'INSURER',
          'DEVELOPER',
          'SUPER_ADMIN'
        );
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    // 2. Normalize existing user roles before altering column type
    console.log('2. Normalizing existing user roles...');
    await client.query(`
      UPDATE "users"
      SET "role" = CASE
        WHEN "role" IN ('admin', 'SUPER_ADMIN') THEN 'SUPER_ADMIN'
        WHEN "role" IN ('underwriter', 'POLICY_ADMINISTRATOR') THEN 'POLICY_ADMINISTRATOR'
        WHEN "role" IN ('adjuster', 'CLAIM_ASSESSOR') THEN 'CLAIM_ASSESSOR'
        WHEN "role" IN ('supervisor', 'CLAIM_SUPERVISOR') THEN 'CLAIM_SUPERVISOR'
        WHEN "role" IN ('manager', 'CLAIM_MANAGER') THEN 'CLAIM_MANAGER'
        WHEN "role" IN ('insurer', 'INSURER') THEN 'INSURER'
        WHEN "role" IN ('developer', 'DEVELOPER') THEN 'DEVELOPER'
        ELSE 'AGENT'
      END;
    `);

    // 3. Alter role column to user_role enum
    console.log('3. Altering users.role column type to user_role enum...');
    await client.query(`
      ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;
      ALTER TABLE "users" ALTER COLUMN "role" TYPE "user_role" USING "role"::text::"user_role";
      ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'AGENT'::"user_role";
    `);

    // 4. Drop legacy permissions column if exists
    console.log('4. Dropping legacy permissions column from users...');
    await client.query(`
      ALTER TABLE "users" DROP COLUMN IF EXISTS "permissions";
    `);

    // 5. Create role_permissions table
    console.log('5. Creating role_permissions table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS "role_permissions" (
        "permission_id" UUID NOT NULL DEFAULT gen_random_uuid(),
        "workspace_id" UUID NOT NULL,
        "role" "user_role" NOT NULL,
        "feature" VARCHAR(100) NOT NULL,
        "can_view" BOOLEAN NOT NULL DEFAULT false,
        "can_create" BOOLEAN NOT NULL DEFAULT false,
        "can_update" BOOLEAN NOT NULL DEFAULT false,
        "can_delete" BOOLEAN NOT NULL DEFAULT false,
        "updated_by" UUID,
        "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("permission_id"),
        CONSTRAINT "role_permissions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("workspace_id") ON DELETE CASCADE,
        CONSTRAINT "role_permissions_workspace_id_role_feature_key" UNIQUE ("workspace_id", "role", "feature")
      );
      CREATE INDEX IF NOT EXISTS "role_permissions_workspace_id_role_idx" ON "role_permissions"("workspace_id", "role");
    `);

    // 6. Create role_claim_actions table
    console.log('6. Creating role_claim_actions table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS "role_claim_actions" (
        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
        "workspace_id" UUID NOT NULL,
        "role" "user_role" NOT NULL,
        "claim_type" VARCHAR(100) NOT NULL DEFAULT '*',
        "action" VARCHAR(50) NOT NULL,
        "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "role_claim_actions_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "role_claim_actions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("workspace_id") ON DELETE CASCADE,
        CONSTRAINT "role_claim_actions_workspace_id_role_claim_type_action_key" UNIQUE ("workspace_id", "role", "claim_type", "action")
      );
      CREATE INDEX IF NOT EXISTS "role_claim_actions_workspace_id_role_idx" ON "role_claim_actions"("workspace_id", "role");
    `);

    await client.query('COMMIT');
    console.log('✅ Roles and Permissions migration completed successfully!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', err);
    throw err;
  } finally {
    await client.end();
  }
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
