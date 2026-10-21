import { db, pool } from './connection';
import bcrypt from 'bcryptjs';

async function seed() {
  console.log('🌱 Seeding database...');
  try {
    // 1. Seed Default Workspace
    const workspaceRes = await db.query(`
      INSERT INTO workspaces (name, domain, plan_type, api_key, api_secret, status)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (api_key) DO UPDATE SET updated_at = NOW()
      RETURNING workspace_id;
    `, ['Acme Insurance Corp', 'acme-insurance.com', 'enterprise', 'demo_api_key_12345', 'demo_api_secret_67890', 'active']);

    const workspaceId = workspaceRes.rows[0].workspace_id;
    console.log(`✅ Default workspace created: ${workspaceId}`);

    // 2. Seed Admin & Demo Users
    const passwordHash = await bcrypt.hash('Admin@123456', 10);
    const userRes = await db.query(`
      INSERT INTO users (workspace_id, email, password_hash, first_name, last_name, role, permissions, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (workspace_id, email) DO UPDATE SET password_hash = EXCLUDED.password_hash
      RETURNING user_id, email;
    `, [workspaceId, 'admin@insurance.com', passwordHash, 'System', 'Admin', 'admin', JSON.stringify(['all']), true]);

    console.log(`✅ Default admin user created: admin@insurance.com / Admin@123456`);

    // 3. Seed Demo Products
    await db.query(`
      INSERT INTO products (workspace_id, name, description, category, coverage_types, pricing_model, is_active)
      VALUES 
        ($1, 'Auto Protect Pro', 'Comprehensive motor vehicle insurance with telematics discount', 'Auto', '["Liability", "Collision", "Comprehensive"]', 'risk_based', true),
        ($1, 'HomeShield Policy', 'Property and casualty protection for residential homeowners', 'Property', '["Structure", "Contents", "Liability"]', 'tiered', true),
        ($1, 'Cyber Guard Enterprise', 'Commercial cyber liability and data breach coverage', 'Commercial', '["Ransomware", "Data Breach", "Business Interruption"]', 'dynamic', true)
      ON CONFLICT DO NOTHING;
    `, [workspaceId]);

    console.log('✅ Demo insurance products seeded.');
    console.log('🎉 Seeding completed successfully!');
  } catch (error) {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

seed();
