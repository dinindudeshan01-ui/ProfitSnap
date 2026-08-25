'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import ArcHeader from '@/components/ArcHeader';
import { colors } from '@/lib/theme';
import { SRI_LANKA_DISTRICTS } from '@/lib/districts';
import { useDialog } from '@/components/DialogProvider';
import { createClient } from '@/lib/supabase/client';
import { applyBrandColor } from '@/lib/brandColor';
import { useLang } from '@/lib/i18n/LangContext';
import { useCurrency } from '@/lib/currency/CurrencyContext';
import { setSetting } from '@/lib/db/queries';

const CURRENCIES = [
  { value: 'Rs', label: 'Rs — Sri Lankan Rupee' },
  { value: '₹', label: '₹ — Indian Rupee' },
  { value: '$', label: '$ — US Dollar' },
  { value: 'AED', label: 'AED — UAE Dirham' },
  { value: 'SAR', label: 'SAR — Saudi Riyal' },
  { value: '₩', label: '₩ — Korean Won' },
  { value: '€', label: '€ — Euro' },
  { value: '£', label: '£ — British Pound' },
];

interface Tenant {
  id: string;
  business_name: string;
  owner_name: string | null;
  brand_color: string;
  is_registered: boolean;
  registration_no: string | null;
  shop_no?: number | null;
}

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
}

interface Addon {
  id: number;
  name: string;
  description: string | null;
  price_amount: number;
  currency: string;
  billing_type: string;
  credits_included: number;
}

const PRESET_COLORS = ['#6C63FF', '#00B87C', '#FF6B35', '#0099CC', '#9B59B6', '#D4A017', '#E91E63', '#16A085'];

export default function SettingsScreen() {
  const dialogs = useDialog();
  const router = useRouter();
  const { langCode, setLang, LANGS, t } = useLang();
  const { currency: appliedCurrency, setCurrency: applyCurrencyLive } = useCurrency();
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [addons, setAddons] = useState<Addon[]>([]);
  const [currentPlanId, setCurrentPlanId] = useState<number | null>(null);
  const [trialEndsAt, setTrialEndsAt] = useState<string | null>(null);
  const [myAddonIds, setMyAddonIds] = useState<number[]>([]);
  const [pendingPlanId, setPendingPlanId] = useState<number | null>(null);
  const [pendingAddonIds, setPendingAddonIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [businessName, setBusinessName] = useState('');
  const [isRegistered, setIsRegistered] = useState(false);
  const [registrationNo, setRegistrationNo] = useState('');
  const [brandColor, setBrandColor] = useState('#6C63FF');
  const [district, setDistrict] = useState('');
  const [currencyChoice, setCurrencyChoice] = useState(appliedCurrency);
  const [savingCurrency, setSavingCurrency] = useState(false);

  useEffect(() => {
    setCurrencyChoice(appliedCurrency);
  }, [appliedCurrency]);

  const load = useCallback(async () => {
    setLoading(true);
    const [profileRes, billingRes] = await Promise.all([
      fetch('/api/tenant/profile'),
      fetch('/api/tenant/billing'),
    ]);
    const profile = await profileRes.json();
    const billing = await billingRes.json();

    if (profile.tenant) {
      setTenant(profile.tenant);
      setBusinessName(profile.tenant.business_name || '');
      setIsRegistered(profile.tenant.is_registered || false);
      setRegistrationNo(profile.tenant.registration_no || '');
      setBrandColor(profile.tenant.brand_color || '#6C63FF');
      setDistrict(profile.tenant.district || '');
    }
    setPlans(billing.plans ?? []);
    setAddons(billing.addons ?? []);
    setCurrentPlanId(billing.currentSubscription?.plan_id ?? null);
    setTrialEndsAt(billing.currentSubscription?.current_period_end ?? null);
    setMyAddonIds((billing.myAddons ?? []).map((a: { addon_id: number }) => a.addon_id));
    setPendingPlanId(billing.pendingSubscription?.plan_id ?? null);
    setPendingAddonIds((billing.pendingAddons ?? []).map((a: { addon_id: number }) => a.addon_id));
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function saveProfile() {
    setSaving(true);
    try {
      const res = await fetch('/api/tenant/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_name: businessName,
          is_registered: isRegistered,
          registration_no: isRegistered ? registrationNo : null,
          brand_color: brandColor,
          district: district || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json();
        await dialogs.alert(body.error || 'Failed to save');
        return;
      }
      // Apply immediately rather than waiting for the next page load — the
      // Settings screen itself should reflect the new brand color at once.
      applyBrandColor(brandColor);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function changePlan(planId: number, isFree: boolean) {
    if (isFree) {
      const confirmed = await dialogs.confirm('Switch to this plan?');
      if (!confirmed) return;
      setSaving(true);
      try {
        const res = await fetch('/api/tenant/billing/change-plan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plan_id: planId }),
        });
        const body = await res.json();
        if (!res.ok) {
          await dialogs.alert(body.error || 'Failed to change plan');
          return;
        }
        await load();
      } finally {
        setSaving(false);
      }
      return;
    }

    // Paid plan — try PayHere card checkout first; if it's not configured
    // yet (no merchant credentials set), fall back to the manual
    // admin-confirmation request flow so the app still works either way.
    setSaving(true);
    try {
      const checkoutRes = await fetch('/api/payments/payhere/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'plan', id: planId }),
      });
      const checkoutBody = await checkoutRes.json();

      if (checkoutRes.ok && checkoutBody.ok) {
        submitPayHereForm(checkoutBody.checkoutUrl, checkoutBody.params);
        return; // page navigates away to PayHere
      }

      // Not configured / failed to start checkout — fall back to manual.
      const confirmed = await dialogs.confirm(
        'Card payment is not available right now. Request this plan instead? Our team will confirm your payment before it activates.'
      );
      if (!confirmed) return;

      const res = await fetch('/api/tenant/billing/change-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan_id: planId }),
      });
      const body = await res.json();
      if (!res.ok) {
        await dialogs.alert(body.error || 'Failed to change plan');
        return;
      }
      if (body.pending) {
        await dialogs.alert("Request sent — we'll activate it once payment is confirmed.");
      }
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function buyAddon(addonId: number, isFree: boolean) {
    if (isFree) {
      const confirmed = await dialogs.confirm('Add this addon?');
      if (!confirmed) return;
      setSaving(true);
      try {
        const res = await fetch('/api/tenant/billing/buy-addon', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ addon_id: addonId }),
        });
        const body = await res.json();
        if (!res.ok) {
          await dialogs.alert(body.error || 'Failed to buy addon');
          return;
        }
        await load();
      } finally {
        setSaving(false);
      }
      return;
    }

    setSaving(true);
    try {
      const checkoutRes = await fetch('/api/payments/payhere/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'addon', id: addonId }),
      });
      const checkoutBody = await checkoutRes.json();

      if (checkoutRes.ok && checkoutBody.ok) {
        submitPayHereForm(checkoutBody.checkoutUrl, checkoutBody.params);
        return;
      }

      const confirmed = await dialogs.confirm(
        'Card payment is not available right now. Request this addon instead? Our team will confirm your payment before it activates.'
      );
      if (!confirmed) return;

      const res = await fetch('/api/tenant/billing/buy-addon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ addon_id: addonId }),
      });
      const body = await res.json();
      if (!res.ok) {
        await dialogs.alert(body.error || 'Failed to buy addon');
        return;
      }
      if (body.pending) {
        await dialogs.alert("Request sent — we'll activate it once payment is confirmed.");
      }
      await load();
    } finally {
      setSaving(false);
    }
  }

  // Builds and auto-submits a hidden HTML form to PayHere's checkout URL —
  // PayHere's Checkout API expects a real form POST (not fetch/JSON), so
  // this is the standard integration pattern their docs use.
  function submitPayHereForm(url: string, params: Record<string, string>) {
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = url;
    Object.entries(params).forEach(([key, value]) => {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = key;
      input.value = value;
      form.appendChild(input);
    });
    document.body.appendChild(form);
    form.submit();
  }

  async function saveCurrency(value: string) {
    setCurrencyChoice(value);
    setSavingCurrency(true);
    try {
      const supabase = createClient();
      await setSetting(supabase, 'currency', value);
      applyCurrencyLive(value);
    } catch {
      await dialogs.alert('Could not save currency — please try again');
      setCurrencyChoice(appliedCurrency);
    } finally {
      setSavingCurrency(false);
    }
  }

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/');
  }

  return (
    <div className="flex min-h-full flex-col">
      <ArcHeader title="Settings" subtitle={tenant?.business_name} color={colors.home} onBack={() => router.push('/')} />

      <div className="px-4 pt-4 space-y-4 pb-8">
        {loading ? (
          <p className="text-sub text-sm px-1">Loading…</p>
        ) : (
          <>
            {/* Business profile */}
            <section className="rounded-2xl bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-[15px] font-bold text-foreground">Business profile</h2>
                {tenant?.shop_no != null && (
                  <span className="text-xs font-semibold text-sub">Shop #{tenant.shop_no}</span>
                )}
              </div>

              <label className="block text-xs text-sub mb-1">Business name</label>
              <input
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                className="w-full rounded-xl border border-border px-3 py-2.5 text-sm mb-3 outline-none focus:border-home"
              />

              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-foreground">Registered business?</span>
                <label className="relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center">
                  <input
                    type="checkbox"
                    checked={isRegistered}
                    onChange={(e) => setIsRegistered(e.target.checked)}
                    className="peer sr-only"
                  />
                  <span
                    className="absolute inset-0 rounded-full transition-colors bg-[var(--sw-off)] peer-checked:bg-[var(--sw-on)]"
                    style={{ ['--sw-on' as string]: colors.home, ['--sw-off' as string]: colors.border }}
                  />
                  <span className="absolute left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
                </label>
              </div>

              {isRegistered && (
                <>
                  <label className="block text-xs text-sub mb-1">Registration number</label>
                  <input
                    value={registrationNo}
                    onChange={(e) => setRegistrationNo(e.target.value)}
                    placeholder="e.g. PV 00123456"
                    className="w-full rounded-xl border border-border px-3 py-2.5 text-sm mb-1 outline-none focus:border-home"
                  />
                </>
              )}

              <label className="block text-xs text-sub mb-1 mt-3">District</label>
              <select
                value={district}
                onChange={(e) => setDistrict(e.target.value)}
                className="w-full rounded-xl border border-border px-3 py-2.5 text-sm outline-none focus:border-home"
              >
                <option value="">Not set</option>
                {SRI_LANKA_DISTRICTS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>

              <label className="block text-xs text-sub mb-2 mt-3">Brand color</label>
              <div className="flex flex-wrap gap-2 mb-2">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setBrandColor(c)}
                    className="h-8 w-8 rounded-full border-2"
                    style={{ backgroundColor: c, borderColor: brandColor === c ? colors.text : 'transparent' }}
                  />
                ))}
                <input
                  type="color"
                  value={brandColor}
                  onChange={(e) => setBrandColor(e.target.value)}
                  className="h-8 w-8 rounded-full border border-border overflow-hidden p-0"
                />
              </div>

              <button
                onClick={saveProfile}
                disabled={saving}
                className="mt-3 w-full rounded-xl py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                style={{ backgroundColor: colors.home }}
              >
                {saving ? 'Saving…' : 'Save profile'}
              </button>
            </section>

            {/* Currency & Language — chosen once at Setup and previously
                had no way to change afterward. Currency is app-wide
                (via CurrencyContext); language is per-browser
                (via LangContext, stored in localStorage). */}
            <section className="rounded-2xl bg-white p-4 shadow-sm">
              <h2 className="text-[15px] font-bold text-foreground mb-3">Currency & language</h2>

              <label className="block text-xs text-sub mb-2">Currency</label>
              <div className="mb-4 flex flex-wrap gap-2">
                {CURRENCIES.map((c) => (
                  <button
                    key={c.value}
                    onClick={() => saveCurrency(c.value)}
                    disabled={savingCurrency}
                    className="rounded-xl border-[1.5px] px-3.5 py-2.5 disabled:opacity-50"
                    style={{
                      backgroundColor: currencyChoice === c.value ? colors.homeLight : 'white',
                      borderColor: currencyChoice === c.value ? colors.home : colors.border,
                    }}
                  >
                    <span
                      className="text-[13px]"
                      style={{
                        color: currencyChoice === c.value ? colors.home : colors.text,
                        fontWeight: currencyChoice === c.value ? 700 : 400,
                      }}
                    >
                      {c.value}
                    </span>
                  </button>
                ))}
              </div>

              <label className="block text-xs text-sub mb-2">Language</label>
              <div className="flex flex-wrap gap-2">
                {Object.entries(LANGS).map(([code, def]) => (
                  <button
                    key={code}
                    onClick={() => setLang(code)}
                    className="rounded-xl border-[1.5px] px-3.5 py-2.5"
                    style={{
                      backgroundColor: langCode === code ? colors.homeLight : 'white',
                      borderColor: langCode === code ? colors.home : colors.border,
                    }}
                  >
                    <span
                      className="text-[13px]"
                      style={{
                        color: langCode === code ? colors.home : colors.text,
                        fontWeight: langCode === code ? 700 : 400,
                      }}
                    >
                      {def.name}
                    </span>
                  </button>
                ))}
              </div>
            </section>

            {/* Free trial expiry warning */}
            {trialEndsAt && (() => {
              const msLeft = new Date(trialEndsAt).getTime() - Date.now();
              const daysLeft = Math.ceil(msLeft / (24 * 60 * 60 * 1000));
              if (daysLeft > 2) return null; // only nag in the last 2 days, and once expired
              const expired = msLeft <= 0;
              return (
                <section
                  className="rounded-2xl p-4 shadow-sm"
                  style={{ backgroundColor: expired ? '#FEE2E2' : '#FEF3C7' }}
                >
                  <p className="text-sm font-bold" style={{ color: expired ? '#B91C1C' : '#92400E' }}>
                    {expired
                      ? 'Your free trial has ended'
                      : `Your free trial ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`}
                  </p>
                  <p className="text-xs mt-1" style={{ color: expired ? '#B91C1C' : '#92400E' }}>
                    {expired
                      ? 'AI Snaps need an active plan to keep working. Recording sales, adding items manually, and everything offline still works free.'
                      : 'Upgrade to a paid plan to keep using AI Snaps without interruption — everything else stays free either way.'}
                  </p>
                  <button
                    onClick={() => document.getElementById('plan-billing-section')?.scrollIntoView({ behavior: 'smooth' })}
                    className="mt-2 text-xs font-semibold underline"
                    style={{ color: expired ? '#B91C1C' : '#92400E' }}
                  >
                    View plans
                  </button>
                </section>
              );
            })()}

            {/* Plan & billing */}
            <section id="plan-billing-section" className="rounded-2xl bg-white p-4 shadow-sm">
              <h2 className="text-[15px] font-bold text-foreground mb-3">{t.planBilling}</h2>
              <div className="space-y-2">
                {plans.map((p) => {
                  const active = p.id === currentPlanId;
                  const pending = p.id === pendingPlanId;
                  const isFree = Number(p.price_amount) === 0;
                  return (
                    <div
                      key={p.id}
                      className="rounded-xl border p-3"
                      style={{ borderColor: active ? colors.home : colors.border }}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-semibold text-foreground">{p.name}</p>
                          <p className="text-xs text-sub mt-0.5">
                            {p.currency} {p.price_amount}/{p.billing_period} · {p.credits_included} credits ·{' '}
                            {p.scan_limit_per_month ? `${p.scan_limit_per_month} ${t.scansPerMonth}` : t.unlimitedScans}
                          </p>
                          {p.features?.length > 0 && (
                            <p className="text-[11px] text-sub mt-1">{p.features.join(' · ')}</p>
                          )}
                        </div>
                        {active ? (
                          <span
                            className="text-[11px] font-semibold px-2.5 py-1 rounded-full"
                            style={{ backgroundColor: colors.homeLight, color: colors.home }}
                          >
                            {t.currentPlan}
                          </span>
                        ) : pending ? (
                          <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-amber-100 text-amber-700">
                            {t.awaitingPayment}
                          </span>
                        ) : (
                          <button
                            onClick={() => changePlan(p.id, isFree)}
                            disabled={saving || pendingPlanId !== null}
                            className="text-xs font-semibold px-3 py-1.5 rounded-full text-white disabled:opacity-50"
                            style={{ backgroundColor: colors.home }}
                          >
                            {isFree ? t.switchPlan : t.payNow}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
                {plans.length === 0 && <p className="text-sub text-sm">{t.noPlansAvailable}</p>}
              </div>
            </section>

            {/* Addons */}
            <section className="rounded-2xl bg-white p-4 shadow-sm">
              <h2 className="text-[15px] font-bold text-foreground mb-3">{t.addonsTitle}</h2>
              <div className="space-y-2">
                {addons.map((a) => {
                  const owned = myAddonIds.includes(a.id);
                  const pending = pendingAddonIds.includes(a.id);
                  const isFree = Number(a.price_amount) === 0;
                  return (
                    <div key={a.id} className="rounded-xl border p-3" style={{ borderColor: colors.border }}>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-semibold text-foreground">{a.name}</p>
                          <p className="text-xs text-sub mt-0.5">
                            {a.currency} {a.price_amount} ({a.billing_type}) · {a.credits_included} credits
                          </p>
                          {a.description && <p className="text-[11px] text-sub mt-1">{a.description}</p>}
                        </div>
                        {owned ? (
                          <span
                            className="text-[11px] font-semibold px-2.5 py-1 rounded-full"
                            style={{ backgroundColor: colors.productsLight, color: colors.products }}
                          >
                            {t.owned}
                          </span>
                        ) : pending ? (
                          <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-amber-100 text-amber-700">
                            {t.awaitingPayment}
                          </span>
                        ) : (
                          <button
                            onClick={() => buyAddon(a.id, isFree)}
                            disabled={saving}
                            className="text-xs font-semibold px-3 py-1.5 rounded-full text-white disabled:opacity-50"
                            style={{ backgroundColor: colors.home }}
                          >
                            {isFree ? t.addAddon : t.payNow}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
                {addons.length === 0 && <p className="text-sub text-sm">{t.noAddonsAvailable}</p>}
              </div>
            </section>

            <button
              onClick={signOut}
              className="w-full rounded-xl border py-2.5 text-sm font-semibold"
              style={{ borderColor: colors.danger, color: colors.danger }}
            >
              {t.signOut}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
