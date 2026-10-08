import { useCallback, useState, type FormEvent } from 'react';
import { ErrorNotice } from '../../components/common/ErrorNotice';
import { LoadingState } from '../../components/common/LoadingState';
import { Button } from '../../components/ui/Button';
import { TextField } from '../../components/ui/TextField';
import { useAsyncData } from '../../hooks/useAsyncData';
import { useCompanies } from '../../hooks/useCompanies';
import {
  createCompany,
  getAllCompanies,
  updateCompany,
} from '../../services/companies/companyAdminService';
import {
  companyIdFromName,
  validateCompanyInput,
  type CompanyErrors,
  type CompanyInput,
} from '../../services/companies/companyValidation';
import { toAppError } from '../../services/errors';
import { currentAdmin } from '../../services/users/currentAdmin';
import type { Company } from '../../types';
import { formatDateTime } from '../../utils/format';
import { CODE_TYPE_NOT_CONFIGURED, codeTypeLabel } from '../companies/codeTypeLabel';

type Mode = { kind: 'closed' } | { kind: 'create' } | { kind: 'edit'; company: Company };

const EMPTY: CompanyInput = { name: '', codeType: '', serialFormat: '', active: true };

function toInput(c: Company): CompanyInput {
  return {
    name: c.name,
    codeType: c.codeType ?? '',
    serialFormat: c.serialFormat,
    active: c.active,
  };
}

function CompanyForm({
  mode,
  onDone,
  onCancel,
}: {
  mode: Exclude<Mode, { kind: 'closed' }>;
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const editing = mode.kind === 'edit';
  const [values, setValues] = useState<CompanyInput>(editing ? toInput(mode.company) : EMPTY);
  const [errors, setErrors] = useState<CompanyErrors>({});
  const [formError, setFormError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof CompanyInput>(k: K, v: CompanyInput[K]) =>
    setValues((s) => ({ ...s, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const found = validateCompanyInput(values);
    setErrors(found);
    setFormError(undefined);
    if (Object.keys(found).length > 0) return;
    setSaving(true);
    try {
      const actor = await currentAdmin();
      if (editing) {
        await updateCompany(mode.company.id, values, actor);
        onDone(`${values.name.trim()} was saved.`);
      } else {
        await createCompany(values, actor);
        onDone(`${values.name.trim()} was created.`);
      }
    } catch (err) {
      setFormError(toAppError(err, 'Unable to save the company.').message);
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={(e) => void submit(e)}
      noValidate
      aria-label={editing ? 'Edit company' : 'Add company'}
      data-testid="company-form"
      className="space-y-4 rounded-lg border-2 border-action bg-surface p-4"
    >
      <h2 className="text-lg font-bold">{editing ? `Edit ${mode.company.name}` : 'Add company'}</h2>
      <TextField
        label="Company name"
        value={values.name}
        onChange={(e) => set('name', e.target.value)}
        error={errors.name}
        disabled={saving}
        maxLength={120}
        data-testid="company-name"
        {...(editing
          ? { hint: 'Records already registered keep the company name they were registered with.' }
          : values.name.trim()
            ? { hint: `ID: ${companyIdFromName(values.name) || '(invalid)'}` }
            : {})}
      />
      <div>
        <label htmlFor="company-code-type" className="block text-sm font-semibold">
          Label code type
        </label>
        <select
          id="company-code-type"
          data-testid="company-code-type"
          value={values.codeType}
          onChange={(e) => set('codeType', e.target.value as CompanyInput['codeType'])}
          disabled={saving}
          aria-invalid={errors.codeType ? true : undefined}
          className="mt-1 min-h-14 w-full rounded-md border border-line bg-surface px-3 text-lg"
        >
          <option value="">— choose —</option>
          <option value="barcode">Barcode (Code 128)</option>
          <option value="qr">QR code</option>
        </select>
        {errors.codeType && (
          <p role="alert" className="mt-1 text-sm font-semibold text-danger">
            {errors.codeType}
          </p>
        )}
        {editing && (
          <p className="mt-1 text-sm text-ink-muted">
            Changing the code type affects labels for FUTURE registrations only. Existing serial
            records are not changed.
          </p>
        )}
      </div>
      <TextField
        label="Serial format"
        value={values.serialFormat}
        onChange={(e) => set('serialFormat', e.target.value)}
        error={errors.serialFormat}
        disabled={saving}
        maxLength={120}
        data-testid="company-format"
        hint="# = one digit, any other character is literal. Example: 13WAA######### . Applies to future registrations."
      />
      <label className="flex min-h-touch items-center gap-3 font-semibold">
        <input
          type="checkbox"
          checked={values.active}
          onChange={(e) => set('active', e.target.checked)}
          disabled={saving}
          data-testid="company-active"
          className="size-6"
        />
        Active (shown to operators)
      </label>
      {formError && (
        <p role="alert" className="rounded-md bg-danger-soft p-3 font-semibold text-danger">
          {formError}
        </p>
      )}
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button type="submit" disabled={saving} data-testid="company-save">
          {saving ? 'Saving…' : editing ? 'Save changes' : 'Create company'}
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/**
 * Admin: view, create and edit companies. Companies are deactivated (active = false), never
 * deleted; editing never changes registered serials or scan history.
 */
export function CompaniesPanel() {
  const shared = useCompanies(); // the operator-facing (active) list; refreshed after a change
  const loader = useCallback(() => getAllCompanies(), []);
  const { state, reload, refresh } = useAsyncData(loader, 'Unable to load companies.');
  const [mode, setMode] = useState<Mode>({ kind: 'closed' });
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const done = (text: string) => {
    setMode({ kind: 'closed' });
    setMessage({ tone: 'ok', text });
    refresh();
    shared.reload();
  };

  const toggleActive = async (c: Company) => {
    setBusyId(c.id);
    setMessage(null);
    try {
      await updateCompany(c.id, { ...toInput(c), active: !c.active }, await currentAdmin());
      setConfirming(null);
      done(`${c.name} is now ${c.active ? 'inactive' : 'active'}.`);
    } catch (e) {
      setMessage({ tone: 'error', text: toAppError(e, 'Unable to change the company.').message });
    } finally {
      setBusyId(null);
    }
  };

  if (state.status === 'loading') return <LoadingState label="Loading companies…" />;
  if (state.status === 'error') return <ErrorNotice message={state.message} onRetry={reload} />;
  const companies = state.data;

  return (
    <div className="space-y-4">
      <div aria-live="polite">
        {message && (
          <p
            role={message.tone === 'error' ? 'alert' : 'status'}
            data-testid="company-message"
            className={`rounded-md p-3 font-semibold ${message.tone === 'ok' ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'}`}
          >
            {message.text}
          </p>
        )}
      </div>

      {mode.kind === 'closed' && (
        <Button onClick={() => setMode({ kind: 'create' })} data-testid="company-add">
          Add company
        </Button>
      )}
      {mode.kind !== 'closed' && (
        <CompanyForm
          key={mode.kind === 'edit' ? mode.company.id : 'create'}
          mode={mode}
          onDone={done}
          onCancel={() => setMode({ kind: 'closed' })}
        />
      )}

      {companies.length === 0 ? (
        <p className="text-ink-muted" data-testid="companies-empty">
          No companies yet. Use &ldquo;Add company&rdquo; to create the first one.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-left" data-testid="companies-table">
            <thead className="bg-info-soft text-sm">
              <tr>
                {['Company', 'Label code type', 'Serial format', 'Status', 'Last changed', ''].map(
                  (h, i) => (
                    <th key={h || i} scope="col" className="px-3 py-2">
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {companies.map((c) => (
                <tr
                  key={c.id}
                  data-testid={`company-row-${c.id}`}
                  className={`border-t border-line align-top ${c.active ? '' : 'bg-surface-muted text-ink-muted'}`}
                >
                  <td className="px-3 py-2">
                    <span className="font-semibold">{c.name}</span>
                    <span className="block font-mono text-xs text-ink-muted">{c.id}</span>
                  </td>
                  <td className="px-3 py-2">
                    {c.codeType ? (
                      codeTypeLabel(c.codeType)
                    ) : (
                      <span role="alert" className="font-semibold text-danger">
                        {CODE_TYPE_NOT_CONFIGURED}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-sm">{c.serialFormat || '(any)'}</td>
                  <td className="px-3 py-2">
                    <span className={c.active ? 'font-semibold text-success' : 'font-semibold'}>
                      {c.active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-sm">
                    {c.updatedAt ? formatDateTime(c.updatedAt) : '—'}
                    {c.updatedByName && (
                      <span className="block text-ink-muted">by {c.updatedByName}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {confirming === c.id ? (
                      <div className="space-y-2">
                        <p className="text-sm font-semibold">
                          {c.active
                            ? 'Deactivate? Operators will no longer see it. Existing serials and history stay.'
                            : 'Reactivate this company for operators?'}
                        </p>
                        <div className="flex gap-2">
                          <Button
                            variant={c.active ? 'danger' : 'primary'}
                            onClick={() => void toggleActive(c)}
                            disabled={busyId !== null}
                            data-testid={`company-confirm-${c.id}`}
                          >
                            {busyId === c.id ? 'Saving…' : 'Yes'}
                          </Button>
                          <Button
                            variant="secondary"
                            onClick={() => setConfirming(null)}
                            disabled={busyId !== null}
                          >
                            No
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <Button
                          variant="secondary"
                          onClick={() => {
                            setMessage(null);
                            setMode({ kind: 'edit', company: c });
                          }}
                          data-testid={`company-edit-${c.id}`}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => setConfirming(c.id)}
                          data-testid={`company-toggle-${c.id}`}
                        >
                          {c.active ? 'Deactivate' : 'Activate'}
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
