// POST /api/scan
// Replaces the original profitsnap-backend's Express POST /scan endpoint.
// multipart/form-data with:
//   - photo: the image file
//   - scanType: 'setup' | 'stock_in' | 'sales'
//   - isRetake: 'true' | 'false' — whether this photo replaces an already-
//     charged attempt in the same session (drives retake billing)
//   - scanId: the scan_log id from a PRIOR attempt in this session, only
//     present when isRetake is true (lets the retake attach to the same
//     audit trail instead of starting a fresh one)
//
// Credit charging happens here, server-side, before the Gemini call:
//   - First photo of a session -> charge SCAN_BASE_CHARGE (20 credits)
//   - Each retake after that   -> charge RETAKE_CHARGE (5 credits)
// Charging happens regardless of whether OCR succeeds, because the Gemini
// API call itself costs money the moment it's made — this matches the
// project decision that a failed scan still consumes credits (the failure
// screen explains this and offers the refund-eligibility check instead of
// silently not charging, which would just be unauditable).
//
// Every attempt is archived to Supabase Storage + the scan_log table —
// this replaces the Expo app's local expo-file-system "outbox" folder.

import { NextRequest, NextResponse } from 'next/server';
import { prepareImageForOcr } from '@/lib/ocr/imageProcessing';
import { extractRowsFromImage, ScanType } from '@/lib/ocr/geminiService';
import { createServiceClient, getRequestTenantId } from '@/lib/supabase/server';
import { chargeScanBase, chargeRetake, InsufficientCreditsError, SCAN_BASE_CHARGE, RETAKE_CHARGE } from '@/lib/credits/engine';

const VALID_SCAN_TYPES: ScanType[] = ['setup', 'stock_in', 'sales', 'credit_sale'];
const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15MB cap, well above any phone photo

export async function POST(req: NextRequest) {
  // Resolve WHO is calling before touching any tenant-scoped table. This
  // uses the service client below (service role bypasses RLS), so this
  // check is the only thing standing between one tenant and another
  // tenant's wallet/scan data — it must happen before any query.
  const tenantId = await getRequestTenantId();
  if (!tenantId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();

  try {
    const formData = await req.formData();
    const photo = formData.get('photo');
    const scanType = formData.get('scanType');
    const isRetake = formData.get('isRetake') === 'true';
    const priorScanId = formData.get('scanId');

    if (!photo || !(photo instanceof File)) {
      return NextResponse.json({ ok: false, error: 'No photo uploaded' }, { status: 400 });
    }
    if (photo.size > MAX_FILE_SIZE) {
      return NextResponse.json({ ok: false, error: 'Photo too large (max 15MB)' }, { status: 400 });
    }
    if (typeof scanType !== 'string' || !VALID_SCAN_TYPES.includes(scanType as ScanType)) {
      return NextResponse.json(
        { ok: false, error: `scanType must be one of: ${VALID_SCAN_TYPES.join(', ')}` },
        { status: 400 }
      );
    }

    // ── 1. Create (or reuse) the scan_log row first, so we have a stable
    // scanId to attach the charge + photo + OCR outcome to. ──────────────
    let scanId: string;
    if (isRetake && typeof priorScanId === 'string' && priorScanId) {
      scanId = priorScanId;
      await supabase
        .from('scan_log')
        .update({ retake_count: (await getRetakeCount(supabase, tenantId, scanId)) + 1 })
        .eq('id', scanId)
        .eq('tenant_id', tenantId);
    } else {
      const { data: inserted, error: insertErr } = await supabase
        .from('scan_log')
        .insert({ tenant_id: tenantId, scan_type: scanType, outcome: 'ocr_failed' }) // placeholder, updated below
        .select('id')
        .single();
      if (insertErr || !inserted) {
        return NextResponse.json({ ok: false, error: 'Could not start scan record' }, { status: 500 });
      }
      scanId = inserted.id;
    }

    // ── 2. Charge BEFORE calling Gemini — never let an unpaid request hit
    // the paid API. ──────────────────────────────────────────────────────
    let creditsChargedThisCall = 0;
    try {
      if (isRetake) {
        await chargeRetake(supabase, tenantId, scanId);
        creditsChargedThisCall = RETAKE_CHARGE;
      } else {
        await chargeScanBase(supabase, tenantId, scanId);
        creditsChargedThisCall = SCAN_BASE_CHARGE;
      }
    } catch (err) {
      if (err instanceof InsufficientCreditsError) {
        return NextResponse.json(
          {
            ok: false,
            error: 'insufficient_credits',
            balance: err.balance,
            required: err.required,
          },
          { status: 402 }
        );
      }
      throw err;
    }

    // Running total of credits charged across this scan's attempts —
    // read-modify-write on scan_log, fine at this traffic scale.
    const { data: scanRow } = await supabase
      .from('scan_log')
      .select('credits_charged')
      .eq('id', scanId)
      .eq('tenant_id', tenantId)
      .single();
    const totalCharged = (scanRow?.credits_charged ?? 0) + creditsChargedThisCall;

    // ── 3. Compress + run OCR ────────────────────────────────────────────
    const originalBuffer = Buffer.from(await photo.arrayBuffer());
    const compressedImage = await prepareImageForOcr(originalBuffer);
    const result = await extractRowsFromImage(compressedImage, scanType as ScanType);

    // ── 4. Archive photo + finalize scan_log row ────────────────────────
    const photoPath = await uploadScanPhoto(supabase, scanType as ScanType, scanId, compressedImage);
    await supabase
      .from('scan_log')
      .update({
        outcome: result.ok ? 'ocr_success' : 'ocr_failed',
        photo_path: photoPath,
        photo_bytes: photoPath ? compressedImage.length : null,
        row_count: result.rows?.length ?? null,
        error: result.ok ? null : result.error,
        credits_charged: totalCharged,
      })
      .eq('id', scanId)
      .eq('tenant_id', tenantId);

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error, scanId, creditsCharged: creditsChargedThisCall },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      rows: result.rows,
      scanId,
      creditsCharged: creditsChargedThisCall,
      chargeType: isRetake ? 'retake' : 'scan_charge',
    });
  } catch (err) {
    console.error('Scan error:', err);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}

async function getRetakeCount(
  supabase: ReturnType<typeof createServiceClient>,
  tenantId: string,
  scanId: string
): Promise<number> {
  const { data } = await supabase
    .from('scan_log')
    .select('retake_count')
    .eq('id', scanId)
    .eq('tenant_id', tenantId)
    .single();
  return data?.retake_count ?? 0;
}

async function uploadScanPhoto(
  supabase: ReturnType<typeof createServiceClient>,
  scanType: ScanType,
  scanId: string,
  imageBuffer: Buffer
): Promise<string | null> {
  const photoPath = `${scanType}/${scanId}_${Date.now()}.jpg`;
  const { error } = await supabase.storage.from('scans').upload(photoPath, imageBuffer, {
    contentType: 'image/jpeg',
  });
  if (error) {
    // Never swallow this silently again — this exact failure (missing
    // bucket) went undetected for the app's entire history because
    // nothing logged it. photo_path still falls back to null so a scan
    // can still complete without a photo, but now there's a trace of why.
    console.error('Scan photo upload failed:', error.message, { scanType, scanId });
    return null;
  }
  return photoPath;
}
