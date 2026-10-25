import { useCallback, useState, type FormEvent } from 'react';
import { ErrorNotice } from '../../components/common/ErrorNotice';
import { LoadingState } from '../../components/common/LoadingState';
import { Button } from '../../components/ui/Button';
import { TextField } from '../../components/ui/TextField';
import { useAsyncData } from '../../hooks/useAsyncData';
import { useI18n } from '../../hooks/useI18n';
import { useCompanies } from '../../hooks/useCompanies';
import { dataService } from '../../data';
import {
  companyIdFromName,
  validateCompanyInput,
  type CompanyErrors,
  type CompanyInput,
} from '../../services/companies/companyValidation';
import { errorText, toAppError } from '../../services/errors';
import type { Company } from '../../types';
import { LABEL_SIZE_MM } from '../../config/label';
import { codeTypeKey } from '../companies/codeTypeLabel';

import { msg, type Msg, type Text } from '../../i18n/core';
type Mode = { kind: 'closed' } | { kind: 'create' } | { kind: 'edit'; company: Company };

const EMPTY: CompanyInput = { name: '', codeType: '', serialFormat: '', active: true };

function toInput(c: Company): CompanyInput {
  return {
    name: c.name,
    codeType: c.codeType ?? '',
    serialFormat: c.serialFormat,
    active: c.active,
    ...(c.labelSize
      ? { labelWidthMm: String(c.labelSize.widthMm), labelHeightMm: String(c.labelSize.heightMm) }
      : {}),
  };
}

function CompanyForm({
  mode,
  onDone,
  onCancel,
}: {
  mode: Exclude<Mode, { kind: 'closed' }>;
  onDone: (message: Msg) => void;
  onCancel: () => void;
}) {
  const editing = mode.kind === 'edit';
  const [values, setValues] = useState<CompanyInput>(editing ? toInput(mode.company) : EMPTY);
  const [errors, setErrors] = useState<CompanyErrors>({});
  const [formError, setFormError] = useState<Text | undefined>();
  const [saving, setSaving] = useState(false);
  const { t, text } = useI18n();
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
      if (editing) {
        await dataService.updateCompany(mode.company.id, values);
        onDone(msg('companies.saved', { name: values.name.trim() }));
      } else {
        await dataService.createCompany(values);
        onDone(msg('companies.created', { name: values.name.trim() }));
      }
    } catch (err) {
      setFormError(errorText(toAppError(err, msg('companies.saveFailed'))));
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={(e) => void submit(e)}
      noValidate
      aria-label={editing ? t('companies.editAria') : t('companies.add')}
      data-testid="company-form"
      className="space-y-4 rounded-lg border-2 border-action bg-surface p-4"
    >
      <h2 className="text-lg font-bold">
        {editing ? t('companies.editTitle', { name: mode.company.name }) : t('companies.add')}
      </h2>
      <TextField
        label={t('companies.name')}
        value={values.name}
        onChange={(e) => set('name', e.target.value)}
        error={errors.name && text(errors.name)}
        disabled={saving}
        maxLength={120}
        data-testid="company-name"
        {...(editing
          ? { hint: t('companies.keepsNameHint') }
          : values.name.trim()
            ? {
                hint: t('companies.idHint', {
                  id: companyIdFromName(values.name) || msg('companies.idHintInvalid'),
                }),
              }
            : {})}
      />
      <div>
        <label htmlFor="company-code-type" className="block text-sm font-semibold">
          {t('companies.codeType')}
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
          <option value="">{t('companies.choose')}</option>
          <option value="barcode">{t('codeType.barcodeLong')}</option>
          <option value="qr">{t('codeType.qr')}</option>
        </select>
        {errors.codeType && (
          <p role="alert" className="mt-1 text-sm font-semibold text-danger">
            {text(errors.codeType)}
          </p>
        )}
        {editing && (
          <p className="mt-1 text-sm text-ink-muted">{t('companies.codeTypeChangeNote')}</p>
        )}
      </div>
      <TextField
        label={t('companies.serialFormat')}
        value={values.serialFormat}
        onChange={(e) => set('serialFormat', e.target.value)}
        error={errors.serialFormat && text(errors.serialFormat)}
        disabled={saving}
        maxLength={120}
        data-testid="company-format"
        hint={t('companies.formatHint')}
      />
      {/* Desktop server only: each company can print on its own label stock. */}
      {dataService.capabilities.companyLabelSize && (
        <fieldset>
          <legend className="text-sm font-semibold">{t('companies.labelSize')}</legend>
          <div className="mt-1 grid grid-cols-2 gap-3">
            <TextField
              label={t('companies.labelWidth')}
              value={values.labelWidthMm ?? ''}
              onChange={(e) => set('labelWidthMm', e.target.value)}
              disabled={saving}
              inputMode="decimal"
              data-testid="company-label-width"
            />
            <TextField
              label={t('companies.labelHeight')}
              value={values.labelHeightMm ?? ''}
              onChange={(e) => set('labelHeightMm', e.target.value)}
              disabled={saving}
              inputMode="decimal"
              data-testid="company-label-height"
            />
          </div>
          <p className="mt-1 text-sm text-ink-muted">
            {t('companies.labelSizeHint', {
              width: LABEL_SIZE_MM.width,
              height: LABEL_SIZE_MM.height,
            })}
          </p>
          {errors.labelSize && (
            <p role="alert" className="mt-1 text-sm font-semibold text-danger">
              {text(errors.labelSize)}
            </p>
          )}
        </fieldset>
      )}
      <label className="flex min-h-touch items-center gap-3 font-semibold">
        <input
          type="checkbox"
          checked={values.active}
          onChange={(e) => set('active', e.target.checked)}
          disabled={saving}
          data-testid="company-active"
          className="size-6"
        />
        {t('companies.activeLabel')}
      </label>
      {formError && (
        <p role="alert" className="rounded-md bg-danger-soft p-3 font-semibold text-danger">
          {text(formError)}
        </p>
      )}
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button type="submit" disabled={saving} data-testid="company-save">
          {saving
            ? t('common.saving')
            : editing
              ? t('companies.saveChanges')
              : t('companies.create')}
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={saving}>
          {t('common.cancel')}
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
  const loader = useCallback(() => dataService.getAllCompanies(), []);
  const { state, reload, refresh } = useAsyncData(loader, 'companies.loadAllFailed');
  const { t, text, dateTime } = useI18n();
  const [mode, setMode] = useState<Mode>({ kind: 'closed' });
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: Text } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const done = (m: Msg) => {
    setMode({ kind: 'closed' });
    setMessage({ tone: 'ok', text: m });
    refresh();
    shared.reload();
  };

  const toggleActive = async (c: Company) => {
    setBusyId(c.id);
    setMessage(null);
    try {
      await dataService.updateCompany(c.id, { ...toInput(c), active: !c.active });
      setConfirming(null);
      done(msg(c.active ? 'companies.nowInactive' : 'companies.nowActive', { name: c.name }));
    } catch (e) {
      setMessage({ tone: 'error', text: errorText(toAppError(e, msg('companies.changeFailed'))) });
    } finally {
      setBusyId(null);
    }
  };

  if (state.status === 'loading') return <LoadingState label={t('companies.loading')} />;
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
            {text(message.text)}
          </p>
        )}
      </div>

      {mode.kind === 'closed' && (
        <Button onClick={() => setMode({ kind: 'create' })} data-testid="company-add">
          {t('companies.add')}
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
          {t('companies.empty')}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-left" data-testid="companies-table">
            <thead className="bg-info-soft text-sm">
              <tr>
                {[
                  t('common.company'),
                  t('companies.codeType'),
                  t('companies.serialFormat'),
                  t('common.status'),
                  t('common.lastChanged'),
                  '',
                ].map((h, i) => (
                  <th key={h || i} scope="col" className="px-3 py-2">
                    {h}
                  </th>
                ))}
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
                      <>
                        {t(codeTypeKey(c.codeType))}
                        {c.labelSize && (
                          <span className="block text-sm text-ink-muted">
                            {c.labelSize.widthMm} × {c.labelSize.heightMm} mm
                          </span>
                        )}
                      </>
                    ) : (
                      <span role="alert" className="font-semibold text-danger">
                        {t('codeType.notConfiguredLong')}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-sm">
                    {c.serialFormat || t('common.any')}
                  </td>
                  <td className="px-3 py-2">
                    <span className={c.active ? 'font-semibold text-success' : 'font-semibold'}>
                      {c.active ? t('common.active') : t('common.inactive')}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-sm">
                    {c.updatedAt ? dateTime(c.updatedAt) : '—'}
                    {c.updatedByName && (
                      <span className="block text-ink-muted">
                        {t('common.by', { name: c.updatedByName })}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {confirming === c.id ? (
                      <div className="space-y-2">
                        <p className="text-sm font-semibold">
                          {c.active
                            ? t('companies.confirmDeactivate')
                            : t('companies.confirmReactivate')}
                        </p>
                        <div className="flex gap-2">
                          <Button
                            variant={c.active ? 'danger' : 'primary'}
                            onClick={() => void toggleActive(c)}
                            disabled={busyId !== null}
                            data-testid={`company-confirm-${c.id}`}
                          >
                            {busyId === c.id ? t('common.saving') : t('common.yes')}
                          </Button>
                          <Button
                            variant="secondary"
                            onClick={() => setConfirming(null)}
                            disabled={busyId !== null}
                          >
                            {t('common.no')}
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
                          {t('common.edit')}
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => setConfirming(c.id)}
                          data-testid={`company-toggle-${c.id}`}
                        >
                          {c.active ? t('companies.deactivate') : t('companies.activate')}
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
