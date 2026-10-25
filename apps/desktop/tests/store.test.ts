// Database rules: the duplicate check and every lookup use an index (never a table scan), and the
// unique key is (company, serial).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SqliteStore } from '../src/server/store';

let store: SqliteStore;
beforeEach(() => {
  store = new SqliteStore(':memory:');
});
afterEach(() => store.close());

/** Earlier versions had no change capture (triggers for the backup copy). */
function dropChangeCapture(s: SqliteStore) {
  const triggers = s.db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'repl_%'`)
    .all() as { name: string }[];
  for (const t of triggers) s.db.exec(`DROP TRIGGER ${t.name}`);
}

const plan = (sql: string) =>
  (
    store.db
      .prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .all(...Array.from(sql.matchAll(/\?/g), () => 'x')) as { detail: string }[]
  )
    .map((r) => r.detail)
    .join(' | ');

describe('indexes', () => {
  it.each([
    [
      'duplicate check / serial lookup',
      'SELECT * FROM serials WHERE company_id = ? AND serial = ?',
    ],
    ['station credential', 'SELECT * FROM nodes WHERE token_hash = ?'],
    ['session', 'SELECT * FROM sessions WHERE token_hash = ?'],
    ['sign-in by email', 'SELECT * FROM users WHERE email = ?'],
    ['company', 'SELECT * FROM companies WHERE id = ?'],
    ['scan log row', 'SELECT * FROM scan_log WHERE id = ?'],
    [
      'serials registered today',
      'SELECT COUNT(*) FROM serials WHERE scanned_at >= ? AND scanned_at < ?',
    ],
    [
      'duplicates today',
      "SELECT COUNT(*) FROM scan_log WHERE result = 'duplicate' AND timestamp >= ? AND timestamp < ?",
    ],
    ['serials per company', 'SELECT COUNT(*) FROM serials WHERE company_id = ?'],
    ['history by company', 'SELECT * FROM scan_log WHERE company_id = ? ORDER BY id DESC LIMIT 26'],
    [
      'history by operator',
      'SELECT * FROM scan_log WHERE scanned_by = ? ORDER BY id DESC LIMIT 26',
    ],
    [
      'find serial (exact or first characters)',
      'SELECT * FROM serials WHERE serial >= ? AND serial < ?',
    ],
    [
      'recent station scans',
      "SELECT * FROM scan_log WHERE kind = 'scan' ORDER BY id DESC LIMIT 20",
    ],
    [
      'history: imports / reprints',
      'SELECT * FROM scan_log WHERE kind = ? ORDER BY id DESC LIMIT 26',
    ],
    ['import details', 'SELECT * FROM import_items WHERE import_id = ? ORDER BY row_number'],
  ])('%s uses an index (no table scan)', (_name, sql) => {
    const p = plan(sql);
    expect(p, p).toMatch(/SEARCH|USING (COVERING )?INDEX|PRIMARY KEY/);
    expect(p, p).not.toMatch(/SCAN (serials|nodes|sessions|users|companies|scan_log)(?! USING)/);
  });

  it('the registration insert is guarded by UNIQUE(company_id, serial)', async () => {
    const actor = { uid: 'u', name: 'U' };
    const station = { id: 'n', name: 'N' };
    const reg = (companyId: string) =>
      store.registerSerial({
        serial: 'S1',
        partNo: '',
        company: { id: companyId, name: companyId },
        source: 'manual',
        actor,
        station,
        now: '2026-01-01T00:00:00.000Z',
      });
    expect((await reg('a')).result).toBe('new');
    expect((await reg('a')).result).toBe('duplicate');
    expect((await reg('b')).result).toBe('new');
    expect(() =>
      store.db
        .prepare(
          "INSERT INTO serials (company_id, serial, company_name, source, scanned_at, scanned_by, scanned_by_name, node_id, node_name) VALUES ('a','S1','a','manual','x','u','U','n','N')",
        )
        .run(),
    ).toThrow(/UNIQUE/);
  });
});

describe('upgrading a database from the previous version', () => {
  it('adds the station columns, counts existing stations as set up, keeps every record', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vicimus-migrate-'));
    const file = join(dir, 'serials.db');
    try {
      const old = new SqliteStore(file);
      await old.createNode({
        id: 'n1',
        name: 'Station A',
        tokenHash: 'h',
        appVersion: '1',
        isServer: false,
        now: 'x',
      });
      await old.registerSerial({
        serial: 'S1',
        partNo: '',
        company: { id: 'c', name: 'C' },
        source: 'manual',
        actor: { uid: 'u1', name: 'Oli Operator' },
        station: { id: 'n1', name: 'Station A' },
        now: '2026-01-01T00:00:00.000Z',
      });
      // Make it look exactly like a database written by the previous version.
      dropChangeCapture(old); // earlier versions had no backup copying
      old.db.exec('ALTER TABLE nodes DROP COLUMN operator_name');
      old.db.exec('ALTER TABLE nodes DROP COLUMN configured');
      old.close();

      const upgraded = new SqliteStore(file);
      const node = await upgraded.getNodeByTokenHash('h');
      expect(node).toMatchObject({ name: 'Station A', operatorName: '', configured: true });
      const [rec] = await upgraded.findSerials([{ companyId: 'c', serial: 'S1' }]);
      expect(rec).toMatchObject({ scannedByName: 'Oli Operator', nodeName: 'Station A' });
      upgraded.close();
      // and opening it again changes nothing
      const again = new SqliteStore(file);
      expect(await again.getNodeByTokenHash('h')).toMatchObject({ configured: true });
      again.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('upgrades a database from before import details and reprints (history rows become scans)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vicimus-migrate-'));
    const file = join(dir, 'serials.db');
    try {
      const old = new SqliteStore(file);
      await old.registerSerial({
        serial: 'S1',
        partNo: 'P',
        company: { id: 'c', name: 'C' },
        source: 'manual',
        actor: { uid: 'n1', name: 'Ravi' },
        station: { id: 'n1', name: 'Station A' },
        now: '2026-01-01T00:00:00.000Z',
      });
      // The previous version's tables: no scan_log.kind, no serials.import_id, no import_items.
      dropChangeCapture(old);
      old.db.exec(`
        DROP INDEX scan_log_kind;
        CREATE TABLE scan_log_old AS SELECT id, serial, result, company_id, company_name, source,
          scanned_by, scanned_by_name, node_id, node_name, timestamp FROM scan_log;
        DROP TABLE scan_log;
        ALTER TABLE scan_log_old RENAME TO scan_log;
        ALTER TABLE serials DROP COLUMN import_id;
        DROP TABLE import_items;
      `);
      old.close();

      const upgraded = new SqliteStore(file);
      const [log] = await upgraded.recentScans(5);
      expect(log).toMatchObject({ serial: 'S1', kind: 'scan', scannedByName: 'Ravi' });
      const [found] = await upgraded.searchSerials('S1', 5);
      expect(found).toMatchObject({ serial: 'S1', partNo: 'P', nodeName: 'Station A' });
      expect(found!.importFile).toBeUndefined();
      // Imports made with the previous version have no recorded details.
      await upgraded.addImportHistory({
        filename: 'old.xlsx',
        importedBy: 'u',
        importedByName: 'U',
        importedAt: 'x',
        totalRows: 1,
        newCount: 1,
        skipped: 0,
        conflicts: 0,
        duplicates: 0,
        invalid: 0,
        status: 'completed',
        error: '',
      });
      const [entry] = await upgraded.importHistory(1);
      expect(await upgraded.importDetails(Number(entry!.id))).toEqual({
        filename: 'old.xlsx',
        recorded: false,
        items: [],
      });
      upgraded.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
