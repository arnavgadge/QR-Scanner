// Generates firestore.indexes.json: the composite indexes the admin scan-history filters need.
// Filter fields (any non-empty subset, always with the timestamp range + newest-first order):
//   result, company_id, source, scanned_by      ->  (equality fields..., timestamp DESC)
// The emulator does not enforce indexes, but a production Firestore does: deploy this file with
//   npx firebase deploy --only firestore:indexes --project <project-id>
// A history query with no equality filter uses the automatic single-field timestamp index.
import { writeFileSync } from 'node:fs';

const FIELDS = ['result', 'company_id', 'source', 'scanned_by'];
const indexes = [];
for (let mask = 1; mask < 1 << FIELDS.length; mask++) {
  const eq = FIELDS.filter((_, i) => mask & (1 << i));
  indexes.push({
    collectionGroup: 'scan_log',
    queryScope: 'COLLECTION',
    fields: [
      ...eq.map((fieldPath) => ({ fieldPath, order: 'ASCENDING' })),
      { fieldPath: 'timestamp', order: 'DESCENDING' },
    ],
  });
}
writeFileSync(
  'firestore.indexes.json',
  JSON.stringify({ indexes, fieldOverrides: [] }, null, 2) + '\n',
);
console.log(`Wrote firestore.indexes.json with ${indexes.length} composite indexes.`);
