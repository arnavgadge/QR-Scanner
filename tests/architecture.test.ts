// Static checks that keep OCR an INPUT method, not a second registration system.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
const read = (p: string) => readFileSync(p, 'utf8');
const src = walk('src').filter((p) => /\.(ts|tsx)$/.test(p));

describe('OCR architecture', () => {
  it('the OCR service layer never touches Firestore, auth or serial verification', () => {
    for (const f of src.filter((p) => p.replace(/\\/g, '/').includes('src/services/ocr/'))) {
      const code = read(f);
      expect(code, f).not.toMatch(
        /firebase\/firestore|firebase\/auth|services\/firebase|serialRepository|serialVerification|verifyAndRegisterSerial/,
      );
    }
  });

  it('the photo UI components do not touch Firestore or call verification themselves', () => {
    const ui = ['PhotoCapture.tsx', 'PhotoPreview.tsx', 'OcrResultPanel.tsx'].map(
      (n) => `src/features/operator/${n}`,
    );
    for (const f of ui) {
      expect(read(f), f).not.toMatch(/firebase|verifyAndRegisterSerial|services\/serial\//);
    }
  });

  it('there is exactly ONE call to the verification service in the app: manual and OCR converge', () => {
    const callers = src.filter(
      (p) => /verifyAndRegisterSerial\(/.test(read(p)) && !p.includes('serialVerificationService'),
    );
    expect(callers.map((p) => p.replace(/\\/g, '/'))).toEqual([
      'src/features/operator/useScanFlow.ts',
    ]);
    const hook = read('src/features/operator/useScanFlow.ts');
    expect(hook.match(/verifyAndRegisterSerial\(/g)).toHaveLength(1);
    expect(hook).toMatch(/source = from\.step === 'ocr-result' \? 'scan' : 'manual'/);
  });

  it('no second verification entry point (no verifyOCRSerial or similar)', () => {
    for (const f of src)
      expect(read(f), f).not.toMatch(/verifyOcr|verifyOCR|registerOcr|ocrRegister/i);
  });

  it('the mock OCR is only reachable behind an inline dev-build check', () => {
    expect(read('src/services/ocr/index.ts')).toMatch(
      /import\.meta\.env\.DEV && import\.meta\.env\.VITE_OCR_PROVIDER === 'mock'/,
    );
    const importers = src.filter((p) => /mockOcr/.test(read(p)) && !p.includes('mockOcr.ts'));
    expect(importers.map((p) => p.replace(/\\/g, '/'))).toEqual(['src/services/ocr/index.ts']);
  });
});

describe('label printing architecture (Phase 8)', () => {
  const norm = (p: string) => p.replace(/\\/g, '/');
  const css = read('src/styles/print.css');

  it('print CSS only takes effect while a LABEL print is in progress (scoped to body.label-printing)', () => {
    // every rule that hides or reveals things inside @media print is scoped to .label-printing
    const printBlock = css.slice(css.indexOf('@media print'));
    for (const m of printBlock.matchAll(/([^{}]+)\{[^{}]*display:\s*(none|block)[^{}]*\}/g)) {
      expect(m[1], m[0]).toContain('label-printing');
    }
    expect(printBlock).toContain('body.label-printing > :not(.label-print-root)');
    expect(printBlock).toMatch(/body\.label-printing > \.label-print-root[^}]*display:\s*block/);
  });

  it('there is no broad global print rule and the print copy is hidden on screen', () => {
    expect(css).not.toMatch(/@media print\s*\{\s*(\*|body\s*\*|html)\s*[,{]/);
    expect(css).toMatch(/\.label-print-root\s*\{\s*display:\s*none;?\s*\}/);
  });

  it('the label is never scaled with CSS transforms (that would distort the code)', () => {
    const files = [
      'src/styles/print.css',
      ...src.filter((p) => /src\/features\/printing\/|src\/config\/label/.test(norm(p))).map(norm),
    ];
    for (const f of files) expect(read(f), f).not.toMatch(/scale\(|transform:/i);
  });

  it('print and screen use the SAME label components and data (no second label system)', () => {
    const printable = read('src/features/printing/PrintableLabel.tsx');
    expect(printable).toMatch(/BarcodeLabel[\s\S]*QRCodeLabel/);
    expect(printable).not.toMatch(/generateLabelCode|generateCode|buildLabelData|jsbarcode|qrcode/);
  });

  it('printing never touches Firestore or serial registration', () => {
    const files = src.filter((p) => /src\/(features|services)\/printing\//.test(norm(p)));
    for (const f of files) {
      expect(read(f), f).not.toMatch(
        /firebase|getDb\(|verifyAndRegisterSerial|registerOrDetectDuplicate|serialRepository/,
      );
    }
  });

  it('label dimensions come from one config (LABEL_SIZE_MM), not hard-coded in print code', () => {
    // Defaults (70 x 35 mm) live ONLY in the config, overridable by VITE_LABEL_* at build time.
    const cfg = read('src/config/label.ts');
    expect(cfg).toMatch(/LABEL_SIZE_MM[^=]*=\s*\{/);
    expect(cfg).toMatch(/VITE_LABEL_WIDTH_MM,\s*70,/);
    expect(cfg).toMatch(/VITE_LABEL_HEIGHT_MM,\s*35,/);
    for (const f of [
      'src/services/printing/printService.ts',
      'src/features/printing/LabelSurface.tsx',
    ]) {
      expect(read(f), f).not.toMatch(/\b70\s*mm|\b35\s*mm|70\b.*mm/);
    }
  });

  it('the Print button exists only inside the label preview (so only for a NEW serial with a label)', () => {
    const users = src.filter(
      (p) => /PrintControls/.test(read(p)) && !norm(p).endsWith('PrintControls.tsx'),
    );
    expect(users.map(norm)).toEqual(
      ['src/features/printing/LabelPreview.tsx', 'src/features/printing/index.ts'].filter((f) =>
        users.map(norm).includes(f),
      ),
    );
    expect(norm(users[0]!)).toBe('src/features/printing/LabelPreview.tsx');
  });
});

describe('label / code generation architecture (Phase 7)', () => {
  const norm = (p: string) => p.replace(/\\/g, '/');

  it('barcode/QR libraries are used only inside the code generator service', () => {
    const users = src.filter((p) => /from 'jsbarcode'|from 'qrcode'/.test(read(p)));
    expect(users.map(norm)).toEqual(['src/services/printing/codeGenerator.ts']);
  });

  it('label components and the printing services never touch Firestore or Firebase', () => {
    const files = src.filter((p) => /src\/(features|services)\/printing\//.test(norm(p)));
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) expect(read(f), f).not.toMatch(/firebase|getDb\(|serialRepository/);
  });

  it('code generation is separate from registration: the printing services never import serial verification', () => {
    for (const f of src.filter((p) => norm(p).startsWith('src/services/printing/'))) {
      expect(read(f), f).not.toMatch(
        /verifyAndRegisterSerial|registerOrDetectDuplicate|serialVerification/,
      );
    }
  });

  it('window.print is called from exactly ONE place: the print service (Phase 8)', () => {
    const callers = src.filter((p) => /\.print\?\.\(\)|\bwindow\.print\(/.test(read(p)));
    expect(callers.map(norm)).toEqual(['src/services/printing/printService.ts']);
    expect(read('src/services/printing/printService.ts').match(/\.print\?\.\(\)/g)).toHaveLength(1);
  });

  it('only the admin Companies panel can change a code type; the operator workflow has no such control', () => {
    // Phase 9: code type is edited through the full company admin service (create/update).
    const writers = src.filter((p) => /\b(updateCompany|createCompany)\b/.test(read(p)));
    expect(writers.map(norm).sort()).toEqual([
      'src/features/admin/CompaniesPanel.tsx',
      'src/services/companies/companyAdminService.ts',
    ]);
    for (const f of src.filter((p) => norm(p).startsWith('src/features/operator/'))) {
      expect(read(f), f).not.toMatch(
        /updateCompany|createCompany|code_type|<select[^>]*code-?type/i,
      );
    }
  });

  it('operator components read the code type only from the company configuration (never infer it)', () => {
    // (BarcodeLabel/QRCodeLabel legitimately declare their OWN type; the check is for code that CHOOSES one.)
    for (const f of src.filter((p) =>
      /src\/features\/operator\/|src\/features\/printing\/LabelPreview/.test(norm(p)),
    )) {
      expect(read(f), f).not.toMatch(/codeType\s*=\s*['"]|serial\.(startsWith|includes|match)/);
    }
  });
});

describe('admin administration architecture (Phase 9)', () => {
  const norm = (p: string) => p.replace(/\\/g, '/');

  it('only the admin UI uses the company/user write services', () => {
    const users = src.filter((p) => /\bapplyUserChange\b/.test(read(p)));
    expect(users.map(norm).sort()).toEqual([
      'src/features/admin/UsersPanel.tsx',
      'src/services/users/userAdminService.ts',
    ]);
  });

  it('admin features and services never write, edit or delete serials or scan_log', () => {
    const files = src.filter((p) =>
      /src\/(features\/admin|services\/(admin|companies|users))\//.test(norm(p)),
    );
    for (const f of files) {
      expect(read(f), f).not.toMatch(/deleteDoc|writeBatch|runTransaction/);
      expect(read(f), f).not.toMatch(/(set|update|add)Doc\([^)]*(serials|scan_log)/);
    }
  });

  it('there are no Edit/Delete Serial controls anywhere in the UI', () => {
    for (const f of src.filter((p) => /\.tsx$/.test(p))) {
      expect(read(f), f).not.toMatch(/Edit serial|Delete serial|Remove serial/i);
    }
  });

  it('components contain no Firestore queries (UI -> hooks -> services)', () => {
    for (const f of src.filter(
      (p) => /src\/(features|pages|layouts)\//.test(norm(p)) && /\.tsx$/.test(p),
    )) {
      expect(read(f), f).not.toMatch(/from 'firebase\/firestore'/);
    }
  });

  it('admin routes are guarded by RequireAdmin', () => {
    const router = read('src/app/router.tsx');
    expect(router).toMatch(/RequireAdmin/);
    for (const p of ['import', 'export', 'companies', 'users', 'history']) {
      expect(router).toContain(p);
    }
  });

  it('the operator layout only links to Scan and Recent scans (plus Admin for admins)', () => {
    const layout = read('src/layouts/OperatorLayout.tsx');
    const links = [...layout.matchAll(/<NavLink to="([^"]+)"/g)].map((m) => m[1]);
    expect(links).toEqual(['/', '/history', '/admin']);
    expect(layout).toMatch(/isAdmin\s*&&/);
  });

  it('the admin navigation exposes the six required sections', () => {
    const layout = read('src/layouts/AdminLayout.tsx');
    for (const label of [
      'Dashboard',
      'Import Excel',
      'Export Excel',
      'Companies',
      'Users',
      'Scan History',
      'VICIMUS',
      'Serial Label System',
    ]) {
      expect(layout).toContain(label);
    }
  });
});

describe('production hardening architecture (Phase 11)', () => {
  const norm = (p: string) => p.split('\\').join('/');
  it('no direct console logging outside the log helper (production logs are short, no stacks)', () => {
    for (const f of src.filter((p) => !norm(p).endsWith('src/utils/log.ts'))) {
      expect(read(f), f).not.toMatch(/console\.(log|error|warn|debug|info)\(/);
    }
  });
  it('the emulator can only be enabled through direct import.meta.env.DEV references (so it is dropped from production)', () => {
    const cfg = read('src/config/firebase.ts');
    expect(cfg).toMatch(/useEmulator[^;]*import\.meta\.env\.DEV\s*&&/s);
    const allowed = ['src/config/firebase.ts', 'src/services/firebase/client.ts'];
    for (const f of src.filter((p) => !allowed.some((a) => norm(p).endsWith(a)))) {
      expect(read(f), f).not.toMatch(/127\.0\.0\.1|:9099|:8080|demo-vicimus/);
    }
    // the only emulator endpoints live inside `if (useEmulator)` (dropped from production, see productionBundle.test)
    const client = read('src/services/firebase/client.ts');
    expect(client.indexOf('127.0.0.1')).toBeGreaterThan(client.indexOf('if (useEmulator)'));
  });
  it('there are no firebase-admin or seed imports in the browser source', () => {
    for (const f of src) expect(read(f), f).not.toMatch(/firebase-admin|seed-dev/);
  });
});
