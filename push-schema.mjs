import pg from 'pg';
const { Client } = pg;

const client = new Client({
  connectionString: "postgresql://neondb_owner:npg_L0kOPMnDcBs7@ep-bold-surf-b3iotyl9.c-4.ap-southeast-1.aws.neon.tech/neondb?channel_binding=require&sslmode=require",
  ssl: { rejectUnauthorized: false }
});

async function main() {
  await client.connect();
  await client.query('TRUNCATE TABLE usage_entries CASCADE;');
  console.log('Truncated usage_entries');
  
  // Create chat_transcripts table
  await client.query(`
    CREATE TABLE IF NOT EXISTS chat_transcripts (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
      chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      messages TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await client.query('CREATE INDEX IF NOT EXISTS chat_transcripts_chat_id_idx ON chat_transcripts(chat_id);');
  console.log('Created chat_transcripts table');
  
  await client.end();
}

main().catch(console.error);
