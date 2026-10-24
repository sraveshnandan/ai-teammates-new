import pg from 'pg';
const { Client } = pg;

const client = new Client({
  connectionString: process.env.DATABASE_URL_UNPOOLED,
});

async function main() {
  await client.connect();
  await client.query('TRUNCATE TABLE usage_entries CASCADE;');
  console.log('Truncated usage_entries');
  await client.end();
}

main().catch(console.error);
