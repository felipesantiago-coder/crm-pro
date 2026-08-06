#!/usr/bin/env node
/**
 * Query all JS error events from tracking_events table.
 * Usage: node scripts/query-js-errors.mjs
 * 
 * Requires DATABASE_URL pointing to the Neon PostgreSQL database.
 * Format: postgresql://neondb_owner:[PASSWORD]@ep-[PROJECT].aws.neon.tech/neondb?sslmode=require
 */
import pg from 'pg';

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL not set. Export it before running:');
  console.error('   export DATABASE_URL="postgresql://neondb_owner:PASSWORD@ep-PROJECT.sa-east-1.aws.neon.tech/neondb?sslmode=require"');
  console.error('   node scripts/query-js-errors.mjs');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('neon.tech') ? { rejectUnauthorized: false } : false,
});

async function main() {
  console.log('=== JS Error Events from tracking_events (2026-08-06) ===\n');

  // Query ALL JS error events for the date, returning every column
  const query = `
    SELECT
      "id",
      "visitorId",
      "sessionId",
      "siteId",
      "eventType",
      "eventName",
      "pageUrl",
      "referrer",
      "utmSource",
      "utmMedium",
      "utmCampaign",
      "utmContent",
      "utmTerm",
      "metadata",
      "createdAt"
    FROM "tracking_events"
    WHERE "eventType" = 'js_error'
      AND "createdAt" >= '2026-08-06T00:00:00.000Z'
      AND "createdAt" <  '2026-08-07T00:00:00.000Z'
    ORDER BY "createdAt" ASC
  `;

  try {
    const result = await pool.query(query);
    console.log(`Found ${result.rows.length} JS error event(s) for 2026-08-06\n`);
    console.log('=' .repeat(80));

    if (result.rows.length === 0) {
      console.log('No JS error events found for this date.');
      
      // Also check total JS errors across all dates
      const countQuery = `SELECT COUNT(*)::int as total FROM "tracking_events" WHERE "eventType" = 'js_error'`;
      const countResult = await pool.query(countQuery);
      console.log(`\nTotal JS error events in entire table: ${countResult.rows[0].total}`);
      
      // Show the date range of all JS errors
      const rangeQuery = `SELECT MIN("createdAt") as first, MAX("createdAt") as last FROM "tracking_events" WHERE "eventType" = 'js_error'`;
      const rangeResult = await pool.query(rangeQuery);
      if (rangeResult.rows[0].first) {
        console.log(`Date range: ${rangeResult.rows[0].first} → ${rangeResult.rows[0].last}`);
      }
      
      // Try broader date range
      console.log('\n--- Checking broader date range (2026-08-01 to 2026-08-10) ---');
      const broadQuery = `
        SELECT COUNT(*)::int as total FROM "tracking_events" 
        WHERE "eventType" = 'js_error' 
          AND "createdAt" >= '2026-08-01T00:00:00.000Z' 
          AND "createdAt" <  '2026-08-10T00:00:00.000Z'
      `;
      const broadResult = await pool.query(broadQuery);
      console.log(`JS errors in Aug 1-10 range: ${broadResult.rows[0].total}`);
    }

    // Print each row with full details
    for (let i = 0; i < result.rows.length; i++) {
      const row = result.rows[i];
      const meta = row.metadata || {};
      
      console.log(`\n${'─'.repeat(80)}`);
      console.log(`EVENT #${i + 1}`);
      console.log(`${'─'.repeat(80)}`);
      console.log(`  ID:             ${row.id}`);
      console.log(`  Created At:     ${row.createdAt}`);
      console.log(`  Visitor ID:     ${row.visitorId}`);
      console.log(`  Session ID:     ${row.sessionId}`);
      console.log(`  Site ID:        ${row.siteId}`);
      console.log(`  Event Type:     ${row.eventType}`);
      console.log(`  Event Name:     ${row.eventName || '(none)'}`);
      console.log(`  Page URL:       ${row.pageUrl || '(none)'}`);
      console.log(`  Referrer:       ${row.referrer || '(none)'}`);
      console.log(`  UTM Source:     ${row.utmSource || '(none)'}`);
      console.log(`  UTM Medium:     ${row.utmMedium || '(none)'}`);
      console.log(`  UTM Campaign:   ${row.utmCampaign || '(none)'}`);
      console.log(`  UTM Content:    ${row.utmContent || '(none)'}`);
      console.log(`  UTM Term:       ${row.utmTerm || '(none)'}`);
      console.log(`  Metadata (JSON):`);
      console.log(`    Error Message:  ${meta.message || '(none)'}`);
      console.log(`    Filename:       ${meta.filename || '(none)'}`);
      console.log(`    Line Number:    ${meta.lineno || '(none)'}`);
      console.log(`    Column Number:  ${meta.colno || '(none)'}`);
      console.log(`    Screen:         ${meta.screen || '(none)'}`);
      console.log(`    Timezone:       ${meta.timezone || '(none)'}`);
      console.log(`    Language:       ${meta.language || '(none)'}`);
      console.log(`    Connection:     ${meta.connection || '(none)'}`);
      console.log(`    Client TS:      ${meta.client_ts || '(none)'}`);
      console.log(`    Lead ID:        ${meta.lead_id || '(none)'}`);
      console.log(`  Full Metadata:  ${JSON.stringify(meta, null, 4)}`);
    }

    console.log(`\n${'='.repeat(80)}`);
    console.log(`Total: ${result.rows.length} JS error event(s)\n`);

  } catch (err) {
    console.error('❌ Query error:', err.message);
    if (err.code) console.error('   Error code:', err.code);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
