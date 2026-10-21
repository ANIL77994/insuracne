import { initializeDatabase, pool } from './connection';

async function migrate() {
  console.log('🚀 Running database migrations...');
  try {
    await initializeDatabase();
    console.log('✅ Migrations completed successfully.');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
