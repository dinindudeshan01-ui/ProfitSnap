'use client';

import { useEffect, useState, useCallback } from 'react';

interface Plan {
  id: number;
  name: string;
  description: string | null;
  price_amount: number;
  currency: string;
  billing_period: string;
  credits_included: number;
  scan_limit_per_month: number | null;
  features: string[];
  is_active: boolean;
  sort_order: number;
}

interface Addon {
  id: number;
  name: string;
  description: string | null;
  price_amount: number;
  currency: string;
  billing_type: string;
  credits_included: number;
  is_active: boolean;
  sort_order: number;
}

type PlanFormState = {
  name: string;
  description: string;
  price_amount: number;
  currency: string;
  billing_period: string;
  credits_included: number;
  scan_limit_per_month: string;
  features: string;
};

type AddonFormState = {
  name: string;
  description: string;
  price_amount: number;
  currency: string;
  billing_type: string;
  credits_included: number;
};

const emptyPlan: PlanFormState = {
  name: '',
  description: '',
  price_amount: 0,
  currency: 'LKR',
  billing_period: 'monthly',
  credits_included: 0,
  scan_limit_per_month: '',
  features: '',
};

const emptyAddon: AddonFormState = {
  name: '',
  description: '',
  price_amount: 0,
  currency: 'LKR',
  billing_type: 'one_time',
  credits_included: 0,
};

function planToForm(p: Plan): PlanFormState {
  return {
    name: p.name,
    description: p.description ?? '',
    price_amount: p.price_amount,
    currency: p.currency,
    billing_period: p.billing_period,
    credits_included: p.credits_included,
    scan_limit_per_month: p.scan_limit_per_month === null ? '' : String(p.scan_limit_per_month),
    features: (p.features || []).join(', '),
  };
}

function addonToForm(a: Addon): AddonFormState {
  return {
    name: a.name,
    description: a.description ?? '',
    price_amount: a.price_amount,
    currency: a.currency,
    billing_type: a.billing_type,
    credits_included: a.credits_included,
  };
}

export default function AdminCatalogPage() {
  const [tab, setTab] = useState<'plans' | 'addons'>('plans');
  const [plans, setPlans] = useState<Plan[]>([]);
  const [addons, setAddons] = useState<Addon[]>([]);
  const [loading, setLoading] = useState(true);
  // 'new' = create form open; a number = editing that row's id; null = no form open.
  const [formMode, setFormMode] = useState<'new' | number | null>(null);
  const [planForm, setPlanForm] = useState<PlanFormState>(emptyPlan);
  const [addonForm, setAddonForm] = useState<AddonFormState>(emptyAddon);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/admin/catalog');
    const data = await res.json();
    setPlans(data.plans ?? []);
    setAddons(data.addons ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function openCreate() {
    setPlanForm(emptyPlan);
    setAddonForm(emptyAddon);
    setFormMode('new');
    setError(null);
  }
  function openEdit(kind: 'plans' | 'addons', row: Plan | Addon) {
    if (kind === 'plans') setPlanForm(planToForm(row as Plan));
    else setAddonForm(addonToForm(row as Addon));
    setFormMode(row.id);
    setError(null);
  }
  function closeForm() {
    setFormMode(null);
    setError(null);
  }

  async function toggleActive(kind: 'plans' | 'addons', id: number, is_active: boolean) {
    await fetch(`/api/admin/catalog/${kind}/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active }),
    });
    load();
  }

  async function remove(kind: 'plans' | 'addons', id: number) {
    if (!confirm('Remove this? If it has been purchased, it will be retired instead of deleted.')) return;
    await fetch(`/api/admin/catalog/${kind}/${id}`, { method: 'DELETE' });
    load();
  }

  async function submitPlan(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload = {
        name: planForm.name,
        description: planForm.description || null,
        price_amount: planForm.price_amount,
        currency: planForm.currency,
        billing_period: planForm.billing_period,
        credits_included: planForm.credits_included,
        scan_limit_per_month: planForm.scan_limit_per_month ? Number(planForm.scan_limit_per_month) : null,
        features: planForm.features
          .split(',')
          .map((f) => f.trim())
          .filter(Boolean),
      };

      const isEdit = typeof formMode === 'number';
      const res = await fetch(isEdit ? `/api/admin/catalog/plans/${formMode}` : '/api/admin/catalog', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isEdit ? payload : { kind: 'plan', ...payload }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save plan');

      setFormMode(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save plan');
    } finally {
      setBusy(false);
    }
  }

  async function submitAddon(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const isEdit = typeof formMode === 'number';
      const res = await fetch(isEdit ? `/api/admin/catalog/addons/${formMode}` : '/api/admin/catalog', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isEdit ? addonForm : { kind: 'addon', ...addonForm }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save addon');

      setFormMode(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save addon');
    } finally {
      setBusy(false);
    }
  }

  const isEditing = typeof formMode === 'number';
  const showForm = formMode !== null;

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-white text-xl font-semibold">Plans & Addons</h1>
        <button
          onClick={() => (showForm ? closeForm() : openCreate())}
          className="text-sm px-3 py-1.5 rounded-lg bg-white text-black font-medium"
        >
          {showForm ? 'Close' : `+ New ${tab === 'plans' ? 'plan' : 'addon'}`}
        </button>
      </div>
      <p className="text-white/40 text-sm mb-6">
        These drive what customers see in Settings → Plan & Billing — nothing is hardcoded in the app.
      </p>

      <div className="flex gap-2 mb-5">
        <button
          onClick={() => {
            setTab('plans');
            closeForm();
          }}
          className={`text-sm px-3 py-1.5 rounded-lg ${tab === 'plans' ? 'bg-white/15 text-white' : 'text-white/50'}`}
        >
          Plans
        </button>
        <button
          onClick={() => {
            setTab('addons');
            closeForm();
          }}
          className={`text-sm px-3 py-1.5 rounded-lg ${tab === 'addons' ? 'bg-white/15 text-white' : 'text-white/50'}`}
        >
          Addons
        </button>
      </div>

      {showForm && tab === 'plans' && (
        <form onSubmit={submitPlan} className="rounded-xl border border-white/10 bg-white/5 p-5 mb-6 space-y-3">
          <p className="text-white/70 text-sm font-medium">{isEditing ? 'Edit plan' : 'New plan'}</p>
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name">
              <input required value={planForm.name} onChange={(e) => setPlanForm({ ...planForm, name: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Price">
              <input type="number" required value={planForm.price_amount} onChange={(e) => setPlanForm({ ...planForm, price_amount: Number(e.target.value) })} className={inputCls} />
            </Field>
            <Field label="Currency">
              <input value={planForm.currency} onChange={(e) => setPlanForm({ ...planForm, currency: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Billing period">
              <select value={planForm.billing_period} onChange={(e) => setPlanForm({ ...planForm, billing_period: e.target.value })} className={inputCls}>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
                <option value="one_time">One-time</option>
              </select>
            </Field>
            <Field label="Credits included">
              <input type="number" value={planForm.credits_included} onChange={(e) => setPlanForm({ ...planForm, credits_included: Number(e.target.value) })} className={inputCls} />
            </Field>
            <Field label="Scan limit/month (blank = unlimited)">
              <input type="number" value={planForm.scan_limit_per_month} onChange={(e) => setPlanForm({ ...planForm, scan_limit_per_month: e.target.value })} className={inputCls} />
            </Field>
          </div>
          <Field label="Description">
            <input value={planForm.description} onChange={(e) => setPlanForm({ ...planForm, description: e.target.value })} className={inputCls} />
          </Field>
          <Field label="Features (comma-separated)">
            <input value={planForm.features} onChange={(e) => setPlanForm({ ...planForm, features: e.target.value })} className={inputCls} placeholder="Unlimited scans, Priority support, 3 shops" />
          </Field>
          {planForm.price_amount === 0 && (
            <p className="text-xs text-amber-400/80">
              Price is 0 — this plan is treated as a free trial. Switching a tenant onto it starts a 7-day
              countdown (see Free trial expiry below); it is not billed and does not renew.
            </p>
          )}
          <div className="flex gap-2">
            <button disabled={busy} className="px-4 py-2 rounded-lg bg-white text-black text-sm font-medium disabled:opacity-40">
              {busy ? 'Saving…' : isEditing ? 'Save changes' : 'Create plan'}
            </button>
            {isEditing && (
              <button type="button" onClick={closeForm} className="px-4 py-2 rounded-lg bg-white/10 text-white/60 text-sm font-medium">
                Cancel
              </button>
            )}
          </div>
        </form>
      )}

      {showForm && tab === 'addons' && (
        <form onSubmit={submitAddon} className="rounded-xl border border-white/10 bg-white/5 p-5 mb-6 space-y-3">
          <p className="text-white/70 text-sm font-medium">{isEditing ? 'Edit addon' : 'New addon'}</p>
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name">
              <input required value={addonForm.name} onChange={(e) => setAddonForm({ ...addonForm, name: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Price">
              <input type="number" required value={addonForm.price_amount} onChange={(e) => setAddonForm({ ...addonForm, price_amount: Number(e.target.value) })} className={inputCls} />
            </Field>
            <Field label="Currency">
              <input value={addonForm.currency} onChange={(e) => setAddonForm({ ...addonForm, currency: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Billing type">
              <select value={addonForm.billing_type} onChange={(e) => setAddonForm({ ...addonForm, billing_type: e.target.value })} className={inputCls}>
                <option value="one_time">One-time</option>
                <option value="recurring">Recurring</option>
              </select>
            </Field>
            <Field label="Credits included">
              <input type="number" value={addonForm.credits_included} onChange={(e) => setAddonForm({ ...addonForm, credits_included: Number(e.target.value) })} className={inputCls} />
            </Field>
          </div>
          <Field label="Description">
            <input value={addonForm.description} onChange={(e) => setAddonForm({ ...addonForm, description: e.target.value })} className={inputCls} />
          </Field>
          <div className="flex gap-2">
            <button disabled={busy} className="px-4 py-2 rounded-lg bg-white text-black text-sm font-medium disabled:opacity-40">
              {busy ? 'Saving…' : isEditing ? 'Save changes' : 'Create addon'}
            </button>
            {isEditing && (
              <button type="button" onClick={closeForm} className="px-4 py-2 rounded-lg bg-white/10 text-white/60 text-sm font-medium">
                Cancel
              </button>
            )}
          </div>
        </form>
      )}

      {loading && <p className="text-white/40 text-sm">Loading…</p>}

      {tab === 'plans' && (
        <div className="space-y-2">
          {plans.map((p) => (
            <div key={p.id} className="rounded-xl border border-white/10 bg-white/5 p-4 flex items-center justify-between">
              <div>
                <p className="text-white text-sm font-medium">
                  {p.name} <span className="text-white/40">· {p.currency} {p.price_amount}/{p.billing_period}</span>
                  {p.price_amount === 0 && <span className="ml-2 text-xs text-amber-400">7-day trial</span>}
                </p>
                <p className="text-white/30 text-xs mt-0.5">
                  {p.credits_included} credits · {p.scan_limit_per_month ? `${p.scan_limit_per_month} scans/mo` : 'unlimited scans'} · {(p.features || []).join(', ')}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs px-2 py-1 rounded-full ${p.is_active ? 'bg-emerald-500/15 text-emerald-400' : 'bg-white/10 text-white/40'}`}>
                  {p.is_active ? 'active' : 'inactive'}
                </span>
                <button onClick={() => openEdit('plans', p)} className="text-xs text-white/50 hover:text-white">
                  Edit
                </button>
                <button onClick={() => toggleActive('plans', p.id, !p.is_active)} className="text-xs text-white/50 hover:text-white">
                  {p.is_active ? 'Deactivate' : 'Activate'}
                </button>
                <button onClick={() => remove('plans', p.id)} className="text-xs text-red-400 hover:text-red-300">
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'addons' && (
        <div className="space-y-2">
          {addons.map((a) => (
            <div key={a.id} className="rounded-xl border border-white/10 bg-white/5 p-4 flex items-center justify-between">
              <div>
                <p className="text-white text-sm font-medium">
                  {a.name} <span className="text-white/40">· {a.currency} {a.price_amount} ({a.billing_type})</span>
                </p>
                <p className="text-white/30 text-xs mt-0.5">{a.credits_included} credits · {a.description}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs px-2 py-1 rounded-full ${a.is_active ? 'bg-emerald-500/15 text-emerald-400' : 'bg-white/10 text-white/40'}`}>
                  {a.is_active ? 'active' : 'inactive'}
                </span>
                <button onClick={() => openEdit('addons', a)} className="text-xs text-white/50 hover:text-white">
                  Edit
                </button>
                <button onClick={() => toggleActive('addons', a.id, !a.is_active)} className="text-xs text-white/50 hover:text-white">
                  {a.is_active ? 'Deactivate' : 'Activate'}
                </button>
                <button onClick={() => remove('addons', a.id)} className="text-xs text-red-400 hover:text-red-300">
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const inputCls =
  'w-full rounded-lg bg-white/10 border border-white/10 px-3 py-2 text-white text-sm outline-none focus:border-white/30';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-white/50 text-xs mb-1">{label}</label>
      {children}
    </div>
  );
}
