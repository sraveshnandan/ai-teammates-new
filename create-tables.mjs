import { Pool } from 'pg';
import { loadEnvFile } from 'process';

loadEnvFile('.env.local');

const pool = new Pool({ connectionString: process.env.DATABASE_URL_UNPOOLED });

async function columnExists(table, column) {
  const result = await pool.query(`
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = $1 AND column_name = $2 AND table_schema = 'public'
  `, [table, column]);
  return result.rows.length > 0;
}

async function main() {
  try {
    // First, check what tables exist
    const tables = await pool.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
    console.log('Existing tables:', tables.rows.map(r => r.table_name));
    
    // Check bots table columns
    const botsCols = await pool.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'bots' AND table_schema = 'public'
    `);
    console.log('Bots columns:', botsCols.rows.map(r => r.column_name));
    
    // Rename columns in bots table if needed
    if (await columnExists('bots', 'userid')) {
      await pool.query(`ALTER TABLE bots RENAME COLUMN userid TO user_id;`);
      console.log('Renamed bots.userid to user_id');
    }
    if (await columnExists('bots', 'sandboxid')) {
      await pool.query(`ALTER TABLE bots RENAME COLUMN sandboxid TO sandbox_id;`);
      console.log('Renamed bots.sandboxid to sandbox_id');
    }
    
    // Create index on user_id
    await pool.query(`CREATE INDEX IF NOT EXISTS bots_user_id_idx ON bots(user_id);`);
    console.log('Created index on bots.user_id');
    
    // Create missing tables
    // Create chat_kind enum
    await pool.query(`
      DO $$ BEGIN
        CREATE TYPE chat_kind AS ENUM ('direct', 'group');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    
    // Create chats table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS chats (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        kind chat_kind NOT NULL DEFAULT 'direct',
        name TEXT,
        last_message_preview TEXT,
        last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS chats_user_id_idx ON chats(user_id);`);
    console.log('Created chats table');
    
    // Create chat_members table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS chat_members (
        chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
        bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
        joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (chat_id, bot_id)
      );
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS chat_members_bot_id_idx ON chat_members(bot_id);`);
    console.log('Created chat_members table');
    
    // Create usage_kind enum
    await pool.query(`
      DO $$ BEGIN
        CREATE TYPE usage_kind AS ENUM ('ai', 'sandbox');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    
    // Create usage_entries table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS usage_entries (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        kind usage_kind NOT NULL,
        amount INTEGER NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS usage_entries_user_id_created_at_idx ON usage_entries(user_id, created_at);`);
    console.log('Created usage_entries table');
    
    console.log('All migrations completed successfully');
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

main();