#!/usr/bin/env node
/**
 * Assign organizationId to facilities and related tables in D1.
 *
 * Usage:
 *   node scripts/assignOrganizationToClinics.mjs --db MASTERS_D1 --organization organization:nakano-med
 *
 * Options:
 *   --db <binding>             wrangler.toml の D1 バインド名（必須）
 *   --organization <id>        付与したい organizationId（必須）
 *   --where <condition>        facilities 用の WHERE 句（例: \"name LIKE '%中野%'\"）
 *   --preview                  preview DB (default true). add --no-preview for local file.
 *   --dry-run                  SQL を表示するだけで実行しない
 */

import { spawn } from 'node:child_process';

function usage() {
  console.log(`assignOrganizationToClinics

Usage:
  node scripts/assignOrganizationToClinics.mjs --db <binding> --organization <id> [options]

Options:
  --db <binding>           wrangler.toml の D1 バインド名（必須）
  --organization <id>      付与する organizationId（例: organization:nakano-med）
  --where <sql>            facilities への追加条件（例: \"name LIKE '%中野%'\"）
  --no-remote              ローカルプレビュー DB を対象にする（既定は --remote）
  --dry-run                SQL を表示するのみ
  --help                   このメッセージを表示
`);
}

function parseArgs(argv) {
  const options = {
    dbBinding: '',
    organizationId: '',
    whereClause: '',
    useRemote: true,
    dryRun: false,
    help: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--db':
        options.dbBinding = argv[++i] || '';
        break;
      case '--organization':
        options.organizationId = argv[++i] || '';
        break;
      case '--where':
        options.whereClause = argv[++i] || '';
        break;
      case '--no-remote':
        options.useRemote = false;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        console.warn(`Unknown argument: ${arg}`);
        break;
    }
  }
  return options;
}

function escapeLiteral(value) {
  return String(value).replace(/'/g, "''");
}

function runWrangler(dbBinding, sql, useRemote) {
  return new Promise((resolve, reject) => {
    const args = ['d1', 'execute', dbBinding, '--command', sql];
    if (useRemote) args.splice(3, 0, '--remote');
    const proc = spawn('wrangler', args, { stdio: 'inherit' });
    proc.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`wrangler exited with code ${code}`));
      } else {
        resolve();
      }
    });
  });
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help || !options.dbBinding || !options.organizationId) {
    usage();
    if (!options.help) process.exitCode = 1;
    return;
  }

  const orgLiteral = escapeLiteral(options.organizationId);
  const whereClause = options.whereClause ? ` AND (${options.whereClause})` : '';

  const sqlStatements = [
    `UPDATE facilities
      SET organization_id = '${orgLiteral}'
      WHERE (organization_id IS NULL OR organization_id = '')
      ${whereClause};`,
    `UPDATE facility_services
      SET organization_id = '${orgLiteral}'
      WHERE (organization_id IS NULL OR organization_id = '')
        AND facility_id IN (SELECT id FROM facilities WHERE organization_id = '${orgLiteral}');`,
    `UPDATE facility_tests
      SET organization_id = '${orgLiteral}'
      WHERE (organization_id IS NULL OR organization_id = '')
        AND facility_id IN (SELECT id FROM facilities WHERE organization_id = '${orgLiteral}');`,
    `UPDATE facility_qualifications
      SET organization_id = '${orgLiteral}'
      WHERE (organization_id IS NULL OR organization_id = '')
        AND facility_id IN (SELECT id FROM facilities WHERE organization_id = '${orgLiteral}');`,
    `UPDATE facility_staff_lookup
      SET organization_id = '${orgLiteral}'
      WHERE (organization_id IS NULL OR organization_id = '')
        AND facility_id IN (SELECT id FROM facilities WHERE organization_id = '${orgLiteral}');`,
  ];

  if (options.dryRun) {
    console.log('[dry-run] Statements:');
    sqlStatements.forEach((stmt) => {
      console.log(`${stmt}\n---`);
    });
    return;
  }

  console.log(`[info] Assigning organization_id='${options.organizationId}' (where='${options.whereClause || 'organization_id IS NULL'}')`);
  for (const statement of sqlStatements) {
    await runWrangler(options.dbBinding, statement, options.useRemote);
  }
  console.log('[info] Completed organization assignment.');
}

main().catch((err) => {
  console.error(`[error] ${err.message}`);
  process.exitCode = 1;
});
