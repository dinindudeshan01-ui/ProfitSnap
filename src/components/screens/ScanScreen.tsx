'use client';

import { useState, useRef, useCallback, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft, Trash2, Heart, Check, RotateCcw, Wallet, ThumbsUp,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { getAllProducts, addProduct, applyStockIn } from '@/lib/db/queries';
import { todayStr, ScanType, ScanRow } from '@/lib/types';
import { useLang } from '@/lib/i18n/LangContext';
import { useToast } from '@/components/Toast';
import { colors } from '@/lib/theme';
import { SCAN_BASE_CHARGE, RETAKE_CHARGE } from '@/lib/credits/format';
import LoadingOrbit from '@/components/LoadingOrbit';
import OrbitInline from '@/components/OrbitInline';
import PressableButton from '@/components/PressableButton';
import BottomSheet from '@/components/BottomSheet';
import { useOnline } from '@/lib/useOnline';

const ISSUE_REASONS: { value: string; label: string }[] = [
  { value: 'wrong_cost', label: 'Wrong cost/price' },
  { value: 'wrong_qty', label: 'Wrong quantity' },
  { value: 'wrong_name', label: 'Wrong item name' },
  { value: 'missing_row', label: 'Missing a row' },
  { value: 'duplicate_row', label: 'Duplicate row' },
  { value: 'other', label: 'Other' },
];

type Stage = 'checkingBalance' | 'insufficientCredits' | 'camera' | 'reviewPhoto' | 'uploading' | 'failed' | 'reviewRows' | 'feedback';

const FIELDS: Record<ScanType, string[]> = {
  setup: ['code', 'name', 'qty', 'cost', 'sell'],
  stock_in: ['code', 'name', 'qty', 'cost', 'sell'],
  sales: ['code', 'name', 'qty'],
  credit_sale: ['customer_name', 'customer_phone', 'description', 'amount'],
};
const EMPTY_ROW: Record<ScanType, ScanRow> = {
  setup: { code: '', name: '', qty: '', cost: '', sell: '' },
  stock_in: { code: '', name: '', qty: '', cost: '', sell: '' },
  sales: { code: '', name: '', qty: '' },
  credit_sale: { name: '', customer_name: '', customer_phone: '', description: '', amount: '' },
};


function normalizeRow(row: Record<string, unknown>, fields: string[]): ScanRow {
  const out: Record<string, string> = { name: '' };
  for (const f of fields) {
    const v = row[f];
    out[f] = v === undefined || v === null ? '' : String(v);
  }
  return out as unknown as ScanRow;
}

function ScanScreenInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useLang();
  const showToast = useToast();
  const supabase = createClient();
  const online = useOnline();

  const scanType = (searchParams.get('type') as ScanType) || 'stock_in';
  const onCompleteRedirect = searchParams.get('onCompleteRedirect') || '/';
  const fields = FIELDS[scanType];

  const guideText: Record<ScanType, string> = {
    setup: t.guideSetupStock,
    stock_in: t.guideSetupStock,
    sales: t.guideSales,
    credit_sale: t.guideCreditSale2,
  };

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [stage, setStage] = useState<Stage>('checkingBalance');
  const [balance, setBalance] = useState<number | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [taking, setTaking] = useState(false);
  const [rows, setRows] = useState<ScanRow[]>([]);
  const [retryStage, setRetryStage] = useState(0);
  const [comment, setComment] = useState('');
  const [contactEmail, setContactEmail] = useState('');

  // Credit-tracking state for THIS scan session. scanId is assigned by the
  // server on the first OCR call and reused for every retake of the same
  // session, so the whole attempt chain shares one audit trail.
  const [scanId, setScanId] = useState<string | null>(null);
  const [hasBeenSentToOcr, setHasBeenSentToOcr] = useState(false); // false until the FIRST /api/scan call
  const [creditsSpentThisSession, setCreditsSpentThisSession] = useState(0);
  const [savedRowCount, setSavedRowCount] = useState(0);
  const [feedbackComment, setFeedbackComment] = useState('');
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackResult, setFeedbackResult] = useState<{ refunded?: number; queued?: boolean } | null>(null);
  const [savingImport, setSavingImport] = useState(false);
  // Same reasoning as reportInFlightRef above — closes the double-tap
  // race window that state-based disabling alone doesn't fully cover, on
  // the primary (higher-traffic) Save path.
  const savingImportRef = useRef(false);
  const [submittingEscalation, setSubmittingEscalation] = useState(false);

  // ── "Report an issue" — available on the review-rows screen, before
  // saving, for cases where OCR technically succeeded but the extracted
  // data itself looks wrong (e.g. cost came back as 0). Separate from the
  // post-save feedback prompt below, which only exists after Save is hit.
  const [reportSheetOpen, setReportSheetOpen] = useState(false);
  const [reportReason, setReportReason] = useState<string | null>(null);
  const [reportComment, setReportComment] = useState('');
  const [reportSubmitting, setReportSubmitting] = useState(false);
  // A ref, not just the reportSubmitting state above — state updates
  // don't apply synchronously, so two taps landing within the same
  // event-loop tick (a fast double-tap, or a stuck touch event firing
  // twice) could both read reportSubmitting as still false and both
  // call the API. A ref set synchronously at the very top of the
  // handler closes that window completely, independent of render timing.
  const reportInFlightRef = useRef(false);
  const [reportSent, setReportSent] = useState(false);

  // ── Balance check before allowing the camera to even open ───────────────
  useEffect(() => {
    fetch('/api/credits/balance')
      .then((r) => r.json())
      .then((data) => {
        if (!data.ok) throw new Error(data.error || 'Could not check balance');
        setBalance(data.balance);
        setStage(data.balance < SCAN_BASE_CHARGE ? 'insufficientCredits' : 'camera');
      })
      .catch(() => {
        // Fail open to camera rather than blocking the user entirely on a
        // network hiccup — the server still enforces the real check before
        // any Gemini call, so this client-side gate is a UX nicety, not the
        // security boundary.
        setStage('camera');
      });
  }, []);

  // ── Camera setup ──────────────────────────────────────────────────────
  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraReady(true);
      setCameraError('');
    } catch {
      setCameraError('Camera access is needed to scan your sheet');
      setCameraReady(false);
    }
  }, []);

  useEffect(() => {
    if (stage === 'camera') startCamera();
    return () => {
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
    };
  }, [stage, startCamera]);

  function takePhoto() {
    if (!videoRef.current || !canvasRef.current || taking) return;
    setTaking(true);
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
      setPhotoDataUrl(dataUrl);
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
      setStage('reviewPhoto');
    }
    setTaking(false);
  }

  // Retaking BEFORE the first OCR call is free — nothing has been charged
  // yet, since charging only happens server-side at the moment of the
  // Gemini call. Retaking AFTER at least one OCR call has been made is
  // what's billable (handled inside confirmPhotoAndScan via isRetake).
  function retakePhoto() {
    setPhotoDataUrl(null);
    setStage('camera');
    setRetryStage(0);
    setRows([]);
  }

  // ── Confirm photo -> run OCR ─────────────────────────────────────────
  async function confirmPhotoAndScan() {
    if (!photoDataUrl) return;
    if (!online) {
      showToast("You're offline — reconnect before scanning. Nothing was charged.");
      return;
    }
    setStage('uploading');

    const isRetake = hasBeenSentToOcr; // true only from the 2nd OCR call onward in this session

    try {
      const blob = await (await fetch(photoDataUrl)).blob();
      const formData = new FormData();
      formData.append('photo', blob, 'scan.jpg');
      formData.append('scanType', scanType);
      formData.append('isRetake', String(isRetake));
      if (isRetake && scanId) formData.append('scanId', scanId);

      const response = await fetch('/api/scan', { method: 'POST', body: formData });
      const data = await response.json();

      if (response.status === 402) {
        // Ran out of credits mid-session (e.g. balance dropped between the
        // initial check and now). Server is the real enforcement point —
        // this is just surfacing it.
        setStage('insufficientCredits');
        return;
      }

      setHasBeenSentToOcr(true);
      if (data.scanId) setScanId(data.scanId);
      if (typeof data.creditsCharged === 'number') {
        setCreditsSpentThisSession((prev) => prev + data.creditsCharged);
      }

      if (response.ok && data.ok && data.rows && data.rows.length > 0) {
        setRows(data.rows.map((r: Record<string, unknown>) => normalizeRow(r, fields)));
        setRetryStage(0);
        setStage('reviewRows');
      } else {
        setRetryStage((s) => Math.min(s + 1, 2));
        setStage('failed');
      }
    } catch {
      setRetryStage((s) => Math.min(s + 1, 2));
      setStage('failed');
    }
  }

  function updateRow(idx: number, field: string, value: string) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  }
  function removeRow(idx: number) {
    setRows((prev) => prev.filter((_, i) => i !== idx));
  }
  function addBlankRow() {
    setRows((prev) => [...prev, { ...EMPTY_ROW[scanType] }]);
  }

  async function submitEscalation() {
    setSubmittingEscalation(true);
    try {
      await fetch('/api/scan/escalate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scanType, scanId, comment: comment.trim(), contactEmail: contactEmail.trim() }),
      });
    } catch {
      // best-effort, never block the user
    } finally {
      setSubmittingEscalation(false);
    }
    showToast(t.scanEscalationSent || "Sent to our team — we'll follow up soon");
    router.push(onCompleteRedirect);
  }

  async function submitReportIssue() {
    if (!scanId || !reportReason) return;
    if (reportInFlightRef.current) return; // already running — see ref comment above
    reportInFlightRef.current = true;
    setReportSubmitting(true);
    try {
      const res = await fetch('/api/scan/report-issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scanId, scanType, reason: reportReason, comment: reportComment.trim() }),
      });
      if (!res.ok) throw new Error('report failed');

      setReportSent(true);
      setReportSheetOpen(false);

      // The report only logs a flag for admin review (and opens a
      // pending refund request) — it never used to also save, which was
      // wrong: the AI did real extraction work, and whatever's currently
      // in the review list (edited or not) should still be committed
      // regardless of whether something about it got reported. If the AI
      // genuinely got something wrong, admin has the exact before/after
      // diff (scan_line_items) plus the Quick Fix editor on the refund
      // review screen to correct it or refund afterward — that's what
      // that tooling is for, not a reason to throw away a good save.
      if (!online) {
        showToast("Report sent. You're offline though — reconnect to save these rows to your inventory.");
        return;
      }
      const { successCount, failedRows, lastError } = await saveRowsToInventory();
      setSavedRowCount(successCount);
      if (failedRows.length > 0) {
        setRows(failedRows);
      }
      if (successCount === 0 && failedRows.length > 0) {
        showToast(`Report sent, but saving failed: ${lastError ?? 'unknown error'}. You can retry saving below.`);
        setReportSent(false); // let them retry Save without re-reporting
        return;
      }

      setStage('feedback');
    } catch {
      // Genuine send failure (not just "user reported a problem") — stay
      // on the review screen so they can retry or still save/edit rows
      // manually instead of being stuck.
      showToast('Could not send the report — you can still save or edit rows');
      setReportSheetOpen(false);
    } finally {
      // Always resets, regardless of which path above returned — the
      // ref-guard above only protects the window while a request is
      // genuinely in flight, never permanently locks the button.
      reportInFlightRef.current = false;
      setReportSubmitting(false);
    }
  }

  // Shared by confirmImport (normal Save) and submitReportIssue (Report
  // an issue) — reporting a problem should NEVER skip actually saving
  // what the AI extracted. The AI did real work; whatever's in the
  // review list (edited or not) is what gets committed either way. A
  // report is a flag for admin attention, not a reason to throw away a
  // correct extraction — if the AI genuinely got something wrong, admin
  // has the exact before/after diff (scan_line_items) and the Quick Fix
  // editor to correct or refund it after the fact, which is what that
  // tooling exists for.
  async function saveRowsToInventory(): Promise<{ successCount: number; failedRows: typeof rows; lastError: string | null }> {
    const failedRows: typeof rows = [];
    let successCount = 0;
    let lastError: string | null = null;
    const lineItems: {
      product_id: number | null;
      action: 'stock_in' | 'sale' | 'product_created' | 'price_update';
      product_name: string;
      qty: number | null;
      before_stock: number | null;
      after_stock: number | null;
      before_avg_cost: number | null;
      after_avg_cost: number | null;
      before_sell_price: number | null;
      after_sell_price: number | null;
    }[] = [];

    if (scanType === 'credit_sale') {
      const today = todayStr();
      for (const row of rows) {
        const customerName = row.customer_name?.trim();
        const amount = parseFloat(String(row.amount)) || 0;
        if (!customerName || amount <= 0) continue;
        const phone = row.customer_phone?.trim() || null;
        try {
          // Dedup by phone within this tenant — same customer buying on
          // credit again reuses their existing row rather than forking a
          // new one, per the unique index on (tenant_id, phone).
          let customerId: number | null = null;
          if (phone) {
            const { data: existing } = await supabase
              .from('customers')
              .select('id')
              .eq('phone', phone)
              .maybeSingle();
            if (existing) customerId = existing.id;
          }
          if (!customerId) {
            const { data: created, error: custErr } = await supabase
              .from('customers')
              .insert({ name: customerName, phone })
              .select('id')
              .single();
            if (custErr) throw custErr;
            customerId = created.id;
          }
          const { error: creditErr } = await supabase.from('credit_sales').insert({
            customer_id: customerId,
            description: row.description?.trim() || null,
            amount,
            date: today,
            scan_id: scanId || null,
          });
          if (creditErr) throw creditErr;
          successCount++;
        } catch (rowErr) {
          failedRows.push(row);
          lastError = rowErr instanceof Error ? rowErr.message : 'Failed to save this row';
        }
      }
    } else if (scanType === 'sales') {
      const products = await getAllProducts(supabase);
      const today = todayStr();
      for (const row of rows) {
        if (!row.name?.trim() && !row.code?.trim()) continue;
        const match = products.find(
          (p) =>
            (row.code && p.code && p.code.toLowerCase() === row.code.toLowerCase()) ||
            (row.name && p.name.toLowerCase() === row.name.trim().toLowerCase())
        );
        if (!match) continue;
        const qty = parseFloat(String(row.qty)) || 0;
        if (qty <= 0) continue;
        try {
          const { error: insertErr } = await supabase.from('sales').insert({
            pid: match.id,
            qty,
            sell_price: match.sell_price,
            avg_cost: match.avg_cost,
            date: today,
          });
          if (insertErr) throw insertErr;
          const newStock = Math.max(0, match.stock - qty);
          const { error: stockErr } = await supabase.from('products').update({ stock: newStock }).eq('id', match.id);
          if (stockErr) throw stockErr;
          successCount++;
          lineItems.push({
            product_id: match.id,
            action: 'sale',
            product_name: match.name,
            qty,
            before_stock: match.stock,
            after_stock: newStock,
            before_avg_cost: null,
            after_avg_cost: null,
            before_sell_price: null,
            after_sell_price: null,
          });
        } catch (rowErr) {
          failedRows.push(row);
          lastError = rowErr instanceof Error ? rowErr.message : 'Failed to save this row';
        }
      }
    } else {
      const products = await getAllProducts(supabase);
      for (const row of rows) {
        if (!row.name?.trim()) continue;
        const match = products.find(
          (p) =>
            (row.code && p.code && p.code.toLowerCase() === row.code.toLowerCase()) ||
            p.name.toLowerCase() === row.name.trim().toLowerCase()
        );
        const qty = parseFloat(String(row.qty)) || 0;
        const cost = parseFloat(String(row.cost)) || 0;
        const sell = parseFloat(String(row.sell)) || 0;

        try {
          if (match) {
            const beforeStock = match.stock;
            const beforeAvgCost = match.avg_cost;
            const beforeSellPrice = match.sell_price;
            let afterStock = beforeStock;
            let afterAvgCost = beforeAvgCost;
            if (qty > 0) {
              const result = await applyStockIn(supabase, match.id, qty, cost);
              afterStock = result.previousStock + qty;
              const totalQty = result.previousStock + qty;
              afterAvgCost = totalQty > 0 ? (result.previousStock * result.previousAvgCost + qty * cost) / totalQty : cost;
            }
            let afterSellPrice = beforeSellPrice;
            if (sell > 0) {
              const { error: priceErr } = await supabase.from('products').update({ sell_price: sell }).eq('id', match.id);
              if (priceErr) throw priceErr;
              afterSellPrice = sell;
            }
            successCount++;
            lineItems.push({
              product_id: match.id,
              action: qty > 0 ? 'stock_in' : 'price_update',
              product_name: match.name,
              qty: qty > 0 ? qty : null,
              before_stock: beforeStock,
              after_stock: afterStock,
              before_avg_cost: beforeAvgCost,
              after_avg_cost: afterAvgCost,
              before_sell_price: beforeSellPrice,
              after_sell_price: afterSellPrice,
            });
          } else {
            const createdId = await addProduct(supabase, {
              code: row.code?.trim() || '',
              name: row.name.trim(),
              unit: 'pcs',
              avg_cost: cost,
              sell_price: sell,
              stock: qty,
              created: todayStr(),
            });
            successCount++;
            lineItems.push({
              product_id: createdId,
              action: 'product_created',
              product_name: row.name.trim(),
              qty,
              before_stock: null,
              after_stock: qty,
              before_avg_cost: null,
              after_avg_cost: cost,
              before_sell_price: null,
              after_sell_price: sell,
            });
          }
        } catch (rowErr) {
          failedRows.push(row);
          lastError = rowErr instanceof Error ? rowErr.message : 'Failed to save this row';
        }
      }
    }

    if (scanId && lineItems.length > 0) {
      // Best-effort — if this write fails, the actual inventory changes
      // above have still happened and aren't rolled back; the person
      // just loses the detailed audit trail for this one scan, not
      // their data.
      try {
        await supabase.from('scan_line_items').insert(lineItems.map((li) => ({ ...li, scan_id: scanId })));
      } catch (err) {
        console.error('Failed to record scan_line_items:', err);
      }
    }

    // Mark this scan as having actually updated inventory — this is the
    // fact that makes refund eligibility provable rather than a guess.
    // Awaited and retried once (see prior fix notes) rather than
    // fire-and-forget.
    if (scanId && successCount > 0) {
      const markCommitted = async (): Promise<boolean> => {
        try {
          const res = await fetch('/api/scan/commit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ scanId, rowCount: successCount }),
          });
          return res.ok;
        } catch {
          return false;
        }
      };
      const committed = (await markCommitted()) || (await markCommitted());
      if (!committed) {
        console.error('Commit marking failed after retry — scan_log.rows_committed may be inaccurate for scanId', scanId);
      }
    }

    return { successCount, failedRows, lastError };
  }

  async function confirmImport() {
    if (!online) {
      showToast("You're offline — reconnect before saving. Your reviewed rows are still here.");
      return;
    }
    if (savingImportRef.current) return; // already running — see ref comment above
    savingImportRef.current = true;
    setSavingImport(true);
    try {
      const { successCount, failedRows, lastError } = await saveRowsToInventory();
      setSavedRowCount(successCount);

      if (failedRows.length > 0) {
        // Leave only the failed rows in the review list — successful ones
        // are already saved and shouldn't be re-submitted (would
        // double-count them). The user can fix and retry what's left, or
        // back out entirely; either way nothing here is silent.
        setRows(failedRows);
        showToast(
          successCount > 0
            ? `Saved ${successCount} — ${failedRows.length} failed, please review and retry`
            : `Could not save any rows: ${lastError ?? 'unknown error'}`
        );
      } else {
        showToast(
          scanType === 'sales'
            ? `${successCount} sale${successCount === 1 ? '' : 's'} recorded`
            : scanType === 'credit_sale'
            ? `${successCount} credit sale${successCount === 1 ? '' : 's'} saved`
            : `${successCount} item${successCount === 1 ? '' : 's'} updated`
        );
      }

      // Only move on to the post-save feedback stage once something
      // actually saved — if every row failed, staying here with the
      // failed rows visible is more useful than a feedback prompt about
      // items that were never saved.
      if (successCount > 0) {
        if (scanId) {
          setStage('feedback');
        } else {
          router.push(onCompleteRedirect);
        }
      }
    } finally {
      savingImportRef.current = false;
      setSavingImport(false);
    }
  }

  async function submitFeedback(feedback: 'correct' | 'incorrect') {
    if (!scanId) {
      router.push(onCompleteRedirect);
      return;
    }
    setFeedbackSubmitting(true);
    try {
      const res = await fetch('/api/scan/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scanId, feedback, comment: feedbackComment.trim() }),
      });
      const data = await res.json();
      if (data.ok && data.refund) {
        if (data.refund.status === 'auto_approved') {
          setFeedbackResult({ refunded: data.refund.creditsRefunded });
        } else if (data.refund.status === 'pending') {
          setFeedbackResult({ queued: true });
        }
      } else if (feedback === 'correct') {
        router.push(onCompleteRedirect);
      }
    } catch (err) {
      console.error('Feedback submit failed:', err);
      if (feedback === 'correct') router.push(onCompleteRedirect);
    } finally {
      setFeedbackSubmitting(false);
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // RENDER STAGES
  // ─────────────────────────────────────────────────────────────────────

  if (stage === 'checkingBalance') {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-[#0A0A0A]">
        <LoadingOrbit size={56} color={colors.home} label="Checking your balance…" light />
      </div>
    );
  }

  if (stage === 'insufficientCredits') {
    return (
      <div className="flex h-full flex-col bg-[#0A0A0A]">
        <div className="flex items-center justify-between px-4 pb-2.5 pt-4">
          <button onClick={() => router.back()} className="text-sm font-semibold" style={{ color: colors.stock }}>
            Cancel
          </button>
          <span className="text-[15px] font-bold text-white">Not enough credits</span>
          <div className="w-[50px]" />
        </div>
        <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
          <div
            className="mb-4 flex h-16 w-16 items-center justify-center rounded-full"
            style={{ backgroundColor: 'rgba(212,160,23,0.18)' }}
          >
            <Wallet size={28} color={colors.credits} />
          </div>
          <h2 className="mb-2 text-lg font-bold text-white">You&apos;re out of credits</h2>
          <p className="mb-1 text-sm leading-relaxed text-white/70">
            Scanning a sheet costs {SCAN_BASE_CHARGE} credits.
            {balance !== null ? ` You currently have ${balance}.` : ''}
          </p>
          <PressableButton
            onClick={() => router.push('/credits')}
            className="mt-5 w-full rounded-2xl py-4 text-[15px] font-bold text-white"
            style={{ backgroundColor: colors.credits }}
          >
            Add credits
          </PressableButton>
          <button onClick={() => router.back()} className="mt-3 text-[13px] text-white/60">
            Go back
          </button>
        </div>
      </div>
    );
  }

  if (stage === 'camera') {
    return (
      <div className="relative flex h-full flex-col bg-[#0A0A0A]">
        {cameraError ? (
          <div className="flex flex-1 flex-col items-center justify-center px-8">
            <p className="text-center text-sm leading-relaxed text-white">{cameraError}</p>
            <PressableButton
              onClick={startCamera}
              className="mt-5 rounded-xl px-7 py-3.5 text-[15px] font-bold text-white"
              style={{ backgroundColor: colors.stock }}
            >
              Grant permission
            </PressableButton>
            <button onClick={() => router.back()} className="mt-4 text-[13px] text-white/60">
              Go back
            </button>
          </div>
        ) : (
          <>
            <video ref={videoRef} className="absolute inset-0 h-full w-full object-cover" muted playsInline />
            <canvas ref={canvasRef} className="hidden" />

            <div className="relative z-10 flex items-center justify-between bg-black/55 px-4 pb-2.5 pt-4">
              <button
                onClick={() => router.back()}
                className="flex h-[38px] w-[38px] items-center justify-center rounded-full bg-white/20"
              >
                <ArrowLeft size={18} color="white" />
              </button>
              <span className="text-[15px] font-bold text-white">{t.scanSheetTitle}</span>
              <div className="w-[38px] text-right text-[11px] font-semibold text-white/70">
                {hasBeenSentToOcr ? `+${RETAKE_CHARGE}cr` : `${SCAN_BASE_CHARGE}cr`}
              </div>
            </div>

            <div className="absolute bottom-[130px] left-6 right-6 rounded-xl bg-black/65 p-3.5">
              <p className="text-center text-[13px] font-semibold leading-tight text-white">
                {guideText[scanType]}
              </p>
              <p className="mt-1 text-center text-[11px] text-white/60">
                {t.scanTips}
              </p>
            </div>

            <div className="absolute inset-x-0 bottom-0 flex justify-center pb-6">
              <button
                onClick={takePhoto}
                disabled={!cameraReady || taking}
                className="press-feedback flex h-[76px] w-[76px] items-center justify-center rounded-full border-4 border-white/50 bg-white/15 disabled:opacity-50"
              >
                {taking ? (
                  <OrbitInline size={26} color="#ffffff" />
                ) : (
                  <div className="h-14 w-14 rounded-full bg-white" />
                )}
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  if (stage === 'reviewPhoto') {
    return (
      <div className="relative flex h-full flex-col bg-[#0A0A0A]">
        {photoDataUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoDataUrl} alt="Captured sheet" className="absolute inset-0 h-full w-full object-contain" />
        )}
        <div className="relative z-10 flex items-center justify-center bg-black/70 px-4 py-4">
          <span className="text-[15px] font-bold text-white">Does this look readable?</span>
        </div>
        <div className="absolute inset-x-0 bottom-0 flex justify-around bg-black/55 pt-5 pb-6">
          <button onClick={retakePhoto} className="flex flex-col items-center gap-1.5 rounded-2xl bg-white/15 px-7 py-3.5">
            <RotateCcw size={22} color="white" />
            <span className="text-[13px] font-bold text-white">Retake</span>
          </button>
          <button
            onClick={confirmPhotoAndScan}
            disabled={!online}
            className="flex flex-col items-center gap-1.5 rounded-2xl px-7 py-3.5 disabled:opacity-40"
            style={{ backgroundColor: colors.stock }}
          >
            <Check size={26} color="white" strokeWidth={3} />
            <span className="text-[13px] font-bold text-white">Looks good</span>
            <span className="text-[10px] font-semibold text-white/75">
              {hasBeenSentToOcr ? `+${RETAKE_CHARGE} credits` : `${SCAN_BASE_CHARGE} credits`}
            </span>
          </button>
        </div>
      </div>
    );
  }

  if (stage === 'uploading') {
    return (
      <div className="relative flex h-full flex-col bg-[#0A0A0A]">
        {photoDataUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoDataUrl} alt="Captured sheet" className="absolute inset-0 h-full w-full object-cover" />
        )}
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/72">
          <LoadingOrbit
            size={64}
            color={colors.home}
            label="Reading your sheet…"
            sublabel="This takes a few seconds"
            light
          />
        </div>
      </div>
    );
  }

  if (stage === 'failed' && retryStage === 1) {
    return (
      <div className="flex h-full flex-col bg-[#0A0A0A]">
        <div className="flex items-center justify-between px-4 pb-2.5 pt-4">
          <button onClick={() => router.back()} className="text-sm font-semibold" style={{ color: colors.stock }}>
            Cancel
          </button>
          <span className="text-[15px] font-bold text-white">Couldn&apos;t read sheet</span>
          <div className="w-[50px]" />
        </div>
        {photoDataUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoDataUrl} alt="Captured sheet" className="h-[110px] w-full object-cover" />
        )}
        <div className="flex flex-1 flex-col items-center justify-center px-8">
          <h2 className="mb-2.5 text-center text-lg font-bold text-white">Hmm, not quite…</h2>
          <p className="mb-1.5 text-center text-sm leading-relaxed text-white/75">
            We&apos;re unable to recognize your image, but hold on — our staff can personally handle this for you.
            Want to try one more photo first?
          </p>
          <p className="mb-1.5 text-center text-[11px] text-white/45">
            This attempt used {creditsSpentThisSession} credits. A retake costs +{RETAKE_CHARGE} more.
          </p>
          <button
            onClick={retakePhoto}
            className="mt-5 w-full rounded-2xl py-4 text-[15px] font-bold text-white"
            style={{ backgroundColor: colors.stock }}
          >
            Retake photo (+{RETAKE_CHARGE} credits)
          </button>
          <button onClick={addBlankRow} className="mt-2 py-3.5 text-[13px] text-white/60">
            Enter items manually instead
          </button>
        </div>
        {rows.length > 0 && (
          <div className="px-4 pb-6 pt-3">
            <button
              onClick={() => setStage('reviewRows')}
              className="w-full rounded-2xl py-4 text-base font-bold text-white"
              style={{ backgroundColor: colors.stock }}
            >
              Continue with {rows.length} item{rows.length === 1 ? '' : 's'}
            </button>
          </div>
        )}
      </div>
    );
  }

  if (stage === 'failed' && retryStage === 2) {
    return (
      <div className="flex h-full flex-col bg-[#0A0A0A]">
        <div className="flex items-center justify-between px-4 pb-2.5 pt-4">
          <button onClick={() => router.back()} className="text-sm font-semibold" style={{ color: colors.stock }}>
            Cancel
          </button>
          <span className="text-[15px] font-bold text-white">We&apos;re sorry</span>
          <div className="w-[50px]" />
        </div>
        <div className="flex-1 overflow-y-auto px-6 pb-10">
          <div className="my-5 flex justify-center">
            <Heart size={36} fill={colors.danger} color={colors.danger} strokeWidth={0} opacity={0.85} />
          </div>
          <h2 className="mb-2.5 text-center text-lg font-bold text-white">We&apos;re really sorry for the frustration</h2>
          <p className="mb-1.5 text-center text-sm leading-relaxed text-white/75">
            We did what we could — could you please look after what we left behind? You can edit the items
            yourself below, or tell us what went wrong and our team will follow up.
          </p>
          <p className="mb-1.5 text-center text-[11px] text-white/45">
            This scan used {creditsSpentThisSession} credits total. If you don&apos;t enter the items yourself,
            you can request a refund afterwards from your Credits page.
          </p>

          <label className="mb-2 mt-[18px] block text-[13px] font-semibold text-white/85">
            Could you describe what&apos;s unclear? (optional)
          </label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="e.g. lighting was bad, handwriting unclear…"
            className="min-h-[52px] w-full rounded-xl border border-white/15 bg-white/[0.08] p-3 text-sm text-white outline-none placeholder:text-white/35"
          />

          <label className="mb-2 mt-[18px] block text-[13px] font-semibold text-white/85">
            Want us to follow up by email? (optional)
          </label>
          <input
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
            placeholder="your@email.com"
            type="email"
            className="w-full rounded-xl border border-white/15 bg-white/[0.08] p-3 text-sm text-white outline-none placeholder:text-white/35"
          />

          <PressableButton
            onClick={submitEscalation}
            loading={submittingEscalation}
            className="mt-5 w-full rounded-2xl py-4 text-[15px] font-bold text-white"
            style={{ backgroundColor: colors.stock }}
          >
            Send to our team
          </PressableButton>
          <button
            onClick={() => {
              addBlankRow();
              setStage('reviewRows');
            }}
            className="mt-2 w-full py-3.5 text-center text-[13px] text-white/60"
          >
            + Enter items myself
          </button>
          <button onClick={retakePhoto} className="w-full py-3.5 text-center text-[13px] text-white/60">
            Try one more photo
          </button>
        </div>
      </div>
    );
  }

  if (stage === 'reviewRows') {
    // Detect the exact failure mode that's caused every real complaint so
    // far: OCR returning cost/sell as 0 on an otherwise-successful scan.
    // This is an objective, checkable fact sitting right in the data —
    // no reason to wait for the user to notice it, report it, and for an
    // admin to manually confirm it later. Catching it here, before Save,
    // is a fraction of the cost (zero extra Gemini calls, zero admin
    // time) of catching it after the fact.
    const zeroFieldRows = fields.includes('cost')
      ? rows
          .map((row, idx) => {
            const costIsZero = !row.cost || parseFloat(String(row.cost)) === 0;
            const sellIsZero = fields.includes('sell') && (!row.sell || parseFloat(String(row.sell)) === 0);
            return costIsZero || sellIsZero ? { idx, costIsZero, sellIsZero } : null;
          })
          .filter((x): x is { idx: number; costIsZero: boolean; sellIsZero: boolean } => x !== null)
      : [];
    const riskyIndexSet = new Set(zeroFieldRows.map((r) => r.idx));

    return (
      <div className="flex h-full flex-col bg-[#0A0A0A]">
        <div className="flex items-center justify-between px-4 pb-2.5 pt-4">
          <button onClick={retakePhoto} className="text-sm font-semibold" style={{ color: colors.stock }}>
            Retake
          </button>
          <span className="text-[15px] font-bold text-white">
            {rows.length} item{rows.length === 1 ? '' : 's'} found
          </span>
          <div className="w-[50px] text-right text-[11px] font-semibold text-white/50">
            {creditsSpentThisSession}cr
          </div>
        </div>

        <div className="flex justify-end px-4 pb-1">
          <button
            onClick={() => setReportSheetOpen(true)}
            disabled={reportSent}
            className="text-[12px] font-semibold text-white/50 underline disabled:no-underline disabled:text-white/25"
          >
            {reportSent ? 'Issue reported ✓' : 'Something look wrong? Report an issue'}
          </button>
        </div>

        {zeroFieldRows.length > 0 && (
          <div className="mx-4 mb-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5">
            <p className="text-[13px] font-semibold text-amber-400">
              ⚠ {zeroFieldRows.length} item{zeroFieldRows.length === 1 ? '' : 's'} came back with a $0{' '}
              {zeroFieldRows.some((r) => r.costIsZero) && zeroFieldRows.some((r) => r.sellIsZero)
                ? 'cost or price'
                : zeroFieldRows.some((r) => r.costIsZero)
                ? 'cost'
                : 'price'}
            </p>
            <p className="text-[11px] text-amber-400/70 mt-0.5">
              Highlighted below — worth a quick check before saving, since this usually means the OCR
              missed that number rather than the item genuinely being free.
            </p>
          </div>
        )}

        {photoDataUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoDataUrl} alt="Captured sheet" className="h-[110px] w-full object-cover" />
        )}

        <div className="flex-1 overflow-y-auto px-4 pt-3">
          {scanType === 'credit_sale' ? (
            rows.map((row, idx) => {
              const amountIsZero = !row.amount || parseFloat(String(row.amount)) === 0;
              const isRisky = riskyIndexSet.has(idx);
              return (
                <div
                  key={idx}
                  className={`mb-2.5 rounded-xl bg-white p-3 ${isRisky ? 'ring-2 ring-amber-400' : ''}`}
                >
                  <div className="mb-2 flex items-center gap-2">
                    <input
                      className="min-w-0 flex-1 rounded-md bg-bg px-2.5 py-2 text-sm font-medium text-foreground outline-none"
                      value={row.customer_name || ''}
                      onChange={(e) => updateRow(idx, 'customer_name', e.target.value)}
                      placeholder={t.customerName}
                    />
                    <button onClick={() => removeRow(idx)} className="shrink-0 p-1">
                      <Trash2 size={16} color={colors.danger} />
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    <div>
                      <label className="mb-0.5 block text-[9px] font-bold uppercase text-sub">
                        {t.customerPhone}
                      </label>
                      <input
                        className="w-full rounded-md bg-bg px-2 py-1.5 text-xs text-foreground outline-none"
                        value={row.customer_phone || ''}
                        onChange={(e) => updateRow(idx, 'customer_phone', e.target.value)}
                        placeholder="—"
                        inputMode="tel"
                      />
                    </div>
                    <div>
                      <label className="mb-0.5 block text-[9px] font-bold uppercase text-sub">Item</label>
                      <input
                        className="w-full rounded-md bg-bg px-2 py-1.5 text-xs text-foreground outline-none"
                        value={row.description || ''}
                        onChange={(e) => updateRow(idx, 'description', e.target.value)}
                        placeholder="—"
                      />
                    </div>
                    <div>
                      <label
                        className={`mb-0.5 block text-[9px] font-bold uppercase ${amountIsZero ? 'text-amber-500' : 'text-sub'}`}
                      >
                        {t.amountOwed} {amountIsZero && '⚠'}
                      </label>
                      <input
                        className={`w-full rounded-md px-2 py-1.5 text-xs outline-none ${
                          amountIsZero ? 'bg-amber-50 text-amber-700 font-semibold' : 'bg-bg text-foreground'
                        }`}
                        value={String(row.amount ?? '')}
                        onChange={(e) => updateRow(idx, 'amount', e.target.value)}
                        placeholder="0"
                        inputMode="decimal"
                      />
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
          rows.map((row, idx) => {
            const costIsZero = fields.includes('cost') && (!row.cost || parseFloat(String(row.cost)) === 0);
            const sellIsZero = fields.includes('sell') && (!row.sell || parseFloat(String(row.sell)) === 0);
            const isRisky = riskyIndexSet.has(idx);
            return (
            <div
              key={idx}
              className={`mb-2.5 rounded-xl bg-white p-3 ${isRisky ? 'ring-2 ring-amber-400' : ''}`}
            >
              <div className="mb-2 flex items-center gap-2">
                <input
                  className="min-w-0 flex-1 rounded-md bg-bg px-2.5 py-2 text-sm font-medium text-foreground outline-none"
                  value={row.name}
                  onChange={(e) => updateRow(idx, 'name', e.target.value)}
                  placeholder="Item name"
                />
                <button onClick={() => removeRow(idx)} className="shrink-0 p-1">
                  <Trash2 size={16} color={colors.danger} />
                </button>
              </div>

              <div className={`grid gap-1.5 ${fields.length <= 2 ? 'grid-cols-2' : fields.length === 3 ? 'grid-cols-3' : 'grid-cols-4'}`}>
                {fields.includes('code') && (
                  <div>
                    <label className="mb-0.5 block text-[9px] font-bold uppercase text-sub">Code</label>
                    <input
                      className="w-full rounded-md bg-bg px-2 py-1.5 text-xs text-foreground outline-none"
                      value={row.code || ''}
                      onChange={(e) => updateRow(idx, 'code', e.target.value)}
                      placeholder="—"
                    />
                  </div>
                )}
                <div>
                  <label className="mb-0.5 block text-[9px] font-bold uppercase text-sub">Qty</label>
                  <input
                    className="w-full rounded-md bg-bg px-2 py-1.5 text-xs text-foreground outline-none"
                    value={String(row.qty ?? '')}
                    onChange={(e) => updateRow(idx, 'qty', e.target.value)}
                    placeholder="0"
                    inputMode="decimal"
                  />
                </div>
                {fields.includes('cost') && (
                  <div>
                    <label
                      className={`mb-0.5 block text-[9px] font-bold uppercase ${costIsZero ? 'text-amber-500' : 'text-sub'}`}
                    >
                      Cost {costIsZero && '⚠'}
                    </label>
                    <input
                      className={`w-full rounded-md px-2 py-1.5 text-xs outline-none ${
                        costIsZero ? 'bg-amber-50 text-amber-700 font-semibold' : 'bg-bg text-foreground'
                      }`}
                      value={String(row.cost ?? '')}
                      onChange={(e) => updateRow(idx, 'cost', e.target.value)}
                      placeholder="0"
                      inputMode="decimal"
                    />
                  </div>
                )}
                {fields.includes('sell') && (
                  <div>
                    <label
                      className={`mb-0.5 block text-[9px] font-bold uppercase ${sellIsZero ? 'text-amber-500' : 'text-sub'}`}
                    >
                      Sell {sellIsZero && '⚠'}
                    </label>
                    <input
                      className={`w-full rounded-md px-2 py-1.5 text-xs outline-none ${
                        sellIsZero ? 'bg-amber-50 text-amber-700 font-semibold' : 'bg-bg text-foreground'
                      }`}
                      value={String(row.sell ?? '')}
                      onChange={(e) => updateRow(idx, 'sell', e.target.value)}
                      placeholder="0"
                      inputMode="decimal"
                    />
                  </div>
                )}
              </div>
            </div>
            );
          })
          )}

          <button
            onClick={addBlankRow}
            className="mt-1.5 w-full rounded-xl border border-dashed border-white/20 py-3.5 text-[13px] font-semibold text-white/60"
          >
            + Add row
          </button>
        </div>

        <div className="bg-[#0A0A0A] px-4 pb-6 pt-3">
          <PressableButton
            onClick={confirmImport}
            disabled={rows.length === 0 || !online}
            loading={savingImport}
            className="w-full rounded-2xl py-4 text-base font-bold text-white disabled:opacity-40"
            style={{ backgroundColor: scanType === 'credit_sale' ? colors.creditSale : colors.stock }}
          >
            {scanType === 'sales'
              ? `Record ${rows.length} sale${rows.length === 1 ? '' : 's'}`
              : scanType === 'credit_sale'
              ? `${t.saveCreditSale} (${rows.length})`
              : `Save ${rows.length} item${rows.length === 1 ? '' : 's'}`}
          </PressableButton>
        </div>

        <BottomSheet visible={reportSheetOpen} onClose={() => setReportSheetOpen(false)}>
          <h2 className="mb-1 text-base font-bold text-foreground">What went wrong?</h2>
          <p className="mb-4 text-sm text-sub">
            This won&apos;t stop you from editing the rows or saving — it just lets our team know.
          </p>
          <div className="mb-4 flex flex-wrap gap-2">
            {ISSUE_REASONS.map((r) => (
              <button
                key={r.value}
                onClick={() => setReportReason(r.value)}
                className={`rounded-full border px-3.5 py-2 text-[13px] font-semibold ${
                  reportReason === r.value
                    ? 'border-transparent text-white'
                    : 'border-border text-foreground'
                }`}
                style={reportReason === r.value ? { backgroundColor: colors.stock } : undefined}
              >
                {r.label}
              </button>
            ))}
          </div>
          <textarea
            value={reportComment}
            onChange={(e) => setReportComment(e.target.value)}
            placeholder="Anything else worth mentioning? (optional)"
            className="mb-4 min-h-[70px] w-full rounded-xl border border-border bg-bg p-3 text-sm text-foreground outline-none placeholder:text-sub"
          />
          <PressableButton
            onClick={submitReportIssue}
            disabled={!reportReason}
            loading={reportSubmitting}
            className="w-full rounded-2xl py-4 text-[15px] font-bold text-white disabled:opacity-40"
            style={{ backgroundColor: colors.stock }}
          >
            Send report
          </PressableButton>
        </BottomSheet>
      </div>
    );
  }

  if (stage === 'feedback') {
    if (feedbackResult) {
      const refunded = feedbackResult.refunded;
      return (
        <div className="flex h-full flex-col items-center justify-center bg-[#0A0A0A] px-8 text-center">
          <div
            className="mb-4 flex h-16 w-16 items-center justify-center rounded-full"
            style={{ backgroundColor: refunded ? 'rgba(0,184,124,0.18)' : 'rgba(212,160,23,0.18)' }}
          >
            <Check size={28} color={refunded ? colors.products : colors.credits} />
          </div>
          <h2 className="mb-2 text-lg font-bold text-white">
            {refunded ? `${refunded} credits refunded` : 'Thanks — sent to our team'}
          </h2>
          <p className="mb-1 text-sm leading-relaxed text-white/70">
            {refunded
              ? "Since your inventory wasn't updated from this scan, we refunded the charge automatically."
              : "Since your inventory was updated, our team will review and approve a refund if it's warranted."}
          </p>
          <PressableButton
            onClick={() => router.push(onCompleteRedirect)}
            className="mt-5 w-full rounded-2xl py-4 text-[15px] font-bold text-white"
            style={{ backgroundColor: colors.stock }}
          >
            Done
          </PressableButton>
        </div>
      );
    }

    // The person already told us something was wrong via "Report an
    // issue" on the review screen, before ever tapping Save — asking
    // "did you get the correct measurement?" right after that is not
    // just redundant, it looks like their report was ignored. Skip
    // straight to an acknowledgment instead of re-asking.
    if (reportSent) {
      return (
        <div className="flex h-full flex-col items-center justify-center bg-[#0A0A0A] px-8 text-center">
          <div
            className="mb-4 flex h-16 w-16 items-center justify-center rounded-full"
            style={{ backgroundColor: 'rgba(212,160,23,0.18)' }}
          >
            <Check size={28} color={colors.credits} />
          </div>
          <h2 className="mb-2 text-lg font-bold text-white">Got your report</h2>
          <p className="mb-1 text-sm leading-relaxed text-white/70">
            {savedRowCount} item{savedRowCount === 1 ? '' : 's'} saved to your inventory. We've also logged
            what you flagged — our team will check it and follow up if a refund or fix is needed.
          </p>
          <PressableButton
            onClick={() => router.push(onCompleteRedirect)}
            className="mt-5 w-full rounded-2xl py-4 text-[15px] font-bold text-white"
            style={{ backgroundColor: colors.stock }}
          >
            Done
          </PressableButton>
        </div>
      );
    }

    return (
      <div className="flex h-full flex-col bg-[#0A0A0A]">
        <div className="flex items-center justify-center px-4 pb-2.5 pt-4">
          <span className="text-[15px] font-bold text-white">Quick check</span>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center px-7 text-center">
          <h2 className="mb-2 text-lg font-bold leading-snug text-white">
            Did you get the correct inventory measurement through the Snap&amp;Go system?
          </h2>
          <p className="mb-6 text-sm text-white/60">
            {savedRowCount} item{savedRowCount === 1 ? '' : 's'} saved to your inventory just now.
          </p>

          <div className="flex w-full gap-3">
            <PressableButton
              onClick={() => submitFeedback('correct')}
              loading={feedbackSubmitting}
              className="flex flex-1 flex-col items-center gap-1.5 rounded-2xl py-4"
              style={{ backgroundColor: colors.productsLight }}
            >
              <ThumbsUp size={22} color={colors.products} />
              <span className="text-[13px] font-bold" style={{ color: colors.products }}>
                Yes, correct
              </span>
            </PressableButton>
          </div>

          <button
            onClick={() => setFeedbackComment((c) => (c === '' ? ' ' : c))}
            className="mt-4 text-[12px] text-white/40 underline"
          >
            Something looked wrong instead?
          </button>

          {feedbackComment !== '' && (
            <div className="mt-4 w-full">
              <textarea
                value={feedbackComment}
                onChange={(e) => setFeedbackComment(e.target.value)}
                placeholder="What looked off? (optional, but helps us fix it)"
                className="min-h-[80px] w-full rounded-xl border border-white/15 bg-white/[0.08] p-3 text-sm text-white outline-none placeholder:text-white/35"
              />
              <PressableButton
                onClick={() => submitFeedback('incorrect')}
                loading={feedbackSubmitting}
                className="mt-3 w-full rounded-2xl py-3.5 text-[14px] font-bold text-white"
                style={{ backgroundColor: colors.danger }}
              >
                Report incorrect &amp; check for refund
              </PressableButton>
            </div>
          )}

          {/* Upload images as proof — the photo for this scan is already
              archived server-side at scan_log.photo_path, so the user's
              upload IS the proof; nothing further is required here. */}
          <p className="mt-5 text-[11px] text-white/35">
            Your photo for this scan is saved as proof, in case you need to request a refund later.
          </p>
        </div>
      </div>
    );
  }

  return null;
}

export default function ScanScreen() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full flex-col items-center justify-center bg-[#0A0A0A]">
          <LoadingOrbit size={48} color={colors.home} light />
        </div>
      }
    >
      <ScanScreenInner />
    </Suspense>
  );
}
