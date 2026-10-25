// Phase 9 pure logic: company validation, user-change protection, date ranges, history indexes.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  companyIdFromName,
  validateCompanyInput,
  type CompanyInput,
} from '../src/services/companies/companyValidation';
import { checkUserChange } from '../src/services/users/userAdminService';
import { inclusiveRange, localDayRange, parseDateInput } from '../src/services/admin/dateRanges';
import {
  equalityFieldsUsed,
  HISTORY_EQUALITY_FIELDS,
} from '../src/services/admin/scanHistoryService';
import type { User } from '../src/types';

const ok: CompanyInput = { name: 'Acme', codeType: 'qr', serialFormat: 'AC#####', active: true };

describe('company validation', () => {
  it('accepts a valid company', () => expect(validateCompanyInput(ok)).toEqual({}));
  it('requires name, code type and serial format', () => {
    const e = validateCompanyInput({ name: ' ', codeType: '', serialFormat: '', active: true });
    expect(Object.keys(e).sort()).toEqual(['codeType', 'name', 'serialFormat']);
  });
  it('limits length and rejects spaces or slashes in the format', () => {
    expect(validateCompanyInput({ ...ok, name: 'x'.repeat(81) }).name).toBeTruthy();
    expect(validateCompanyInput({ ...ok, serialFormat: 'A B' }).serialFormat).toBeTruthy();
    expect(validateCompanyInput({ ...ok, serialFormat: 'A/B' }).serialFormat).toBeTruthy();
    expect(
      validateCompanyInput({ ...ok, serialFormat: 'A'.repeat(101) }).serialFormat,
    ).toBeTruthy();
  });
  it('allows only A-Z, 0-9 and # in the serial format (what operators can type)', () => {
    for (const good of ['13WAA#########', '27BXX#######', 'ABC', '123', '#'])
      expect(
        validateCompanyInput({ ...ok, serialFormat: good }).serialFormat,
        good,
      ).toBeUndefined();
    for (const bad of ['13-WAA###', '13waa###', 'AB_#', 'A.B', 'É1##', '१३WAA', 'AB*'])
      expect(validateCompanyInput({ ...ok, serialFormat: bad }).serialFormat, bad).toEqual({
        key: 'companies.formatInvalid',
      });
  });
  it('derives a stable id from the name', () => {
    expect(companyIdFromName(' Acme Co. ')).toBe('acme-co');
    expect(companyIdFromName('***')).toBe('');
  });
});

const u = (uid: string, role: User['role'], active = true): User =>
  ({ uid, name: uid, email: `${uid}@x`, role, active, createdAt: null }) as unknown as User;

describe('user change protection', () => {
  const admin1 = u('a1', 'admin');
  const admin2 = u('a2', 'admin');
  const op = u('o1', 'operator');
  it('blocks changing your own account', () => {
    const r = checkUserChange({
      actorUid: 'a1',
      target: admin1,
      change: { active: false },
      users: [admin1, admin2],
    });
    expect(r.ok).toBe(false);
  });
  it('blocks removing the last active admin (stale list)', () => {
    const r = checkUserChange({
      actorUid: 'x',
      target: admin1,
      change: { role: 'operator' },
      users: [admin1, op],
    });
    expect(r).toMatchObject({ ok: false });
    expect(JSON.stringify(r)).toMatch(/last active administrator/);
  });
  it('allows demoting an admin when another active admin remains', () => {
    expect(
      checkUserChange({
        actorUid: 'a2',
        target: admin1,
        change: { role: 'operator' },
        users: [admin1, admin2],
      }).ok,
    ).toBe(true);
  });
  it('does not count an inactive admin as remaining', () => {
    const off = u('a3', 'admin', false);
    expect(
      checkUserChange({
        actorUid: 'x',
        target: admin1,
        change: { active: false },
        users: [admin1, off],
      }).ok,
    ).toBe(false);
  });
  it('allows changing operators, rejects no-ops', () => {
    expect(
      checkUserChange({
        actorUid: 'a1',
        target: op,
        change: { active: false },
        users: [admin1, op],
      }).ok,
    ).toBe(true);
    expect(
      checkUserChange({
        actorUid: 'a1',
        target: op,
        change: { role: 'operator' },
        users: [admin1, op],
      }).ok,
    ).toBe(false);
  });
});

describe('date ranges (local time, explicit)', () => {
  it('local day is [midnight, next midnight)', () => {
    const { start, end } = localDayRange(new Date(2026, 9, 3, 15, 30));
    expect(start).toEqual(new Date(2026, 9, 3));
    expect(end).toEqual(new Date(2026, 9, 4));
  });
  it('parses date inputs and rejects invalid ones', () => {
    expect(parseDateInput('2026-02-28')).toEqual(new Date(2026, 1, 28));
    expect(parseDateInput('2026-02-30')).toBeNull();
    expect(parseDateInput('garbage')).toBeNull();
    expect(parseDateInput('')).toBeNull();
  });
  it('inclusive range makes the end day exclusive-next-midnight', () => {
    expect(inclusiveRange('2026-10-01', '2026-10-03')).toEqual({
      from: new Date(2026, 9, 1),
      to: new Date(2026, 9, 4),
    });
    expect(inclusiveRange('', '')).toEqual({});
  });
});

describe('scan history composite indexes', () => {
  const indexes = JSON.parse(readFileSync('firestore.indexes.json', 'utf8')).indexes as {
    collectionGroup: string;
    fields: { fieldPath: string; order?: string }[];
  }[];
  const scanLog = indexes.filter((i) => i.collectionGroup === 'scan_log');
  const subsets = (arr: readonly string[]): string[][] =>
    arr.reduce<string[][]>((acc, x) => [...acc, ...acc.map((s) => [...s, x])], [[]]);

  it('every filter combination with an equality filter has a matching index', () => {
    for (const eq of subsets(HISTORY_EQUALITY_FIELDS).filter((s) => s.length > 0)) {
      const found = scanLog.some(
        (i) =>
          i.fields.length === eq.length + 1 &&
          eq.every((f, n) => i.fields[n]?.fieldPath === f) &&
          i.fields[eq.length]?.fieldPath === 'timestamp' &&
          i.fields[eq.length]?.order === 'DESCENDING',
      );
      expect(found, `index for [${eq.join(', ')}]`).toBe(true);
    }
  });
  it('equalityFieldsUsed follows the index field order', () => {
    expect(
      equalityFieldsUsed({ scannedBy: 'u', result: 'new', source: 'scan', companyId: 'c' }),
    ).toEqual([...HISTORY_EQUALITY_FIELDS]);
    expect(equalityFieldsUsed({})).toEqual([]);
  });
});
