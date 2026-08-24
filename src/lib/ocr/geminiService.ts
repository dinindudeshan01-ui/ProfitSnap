// Gemini OCR service — ported from the original profitsnap-backend's
// src/geminiService.js, now running as a Next.js API route instead of a
// separate Express server. Logic is unchanged: strict per-scanType JSON
// schema (so the model can't ramble or invent field names), temperature 0,
// pre-compressed image input.
//
// IMPROVEMENT vs. the original: added fetchWithRetry (exponential backoff)
// — a pattern borrowed from the user-provided image_to_json_engine.tsx
// reference. The original Express backend had zero retry logic on the
// Gemini call; transient 429/5xx errors used to fail the whole scan
// immediately. We keep the original's strict responseSchema (NOT the
// reference engine's free-form "infer column names" prompt) because the
// app needs predictable {code, name, qty, cost, sell} fields to map into
// products/sales/stock_in — guessed column names would break that mapping.

export const MODEL = 'gemini-3.1-flash-lite';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export type ScanType = 'setup' | 'stock_in' | 'sales' | 'credit_sale';

interface GeminiSchema {
  type: 'ARRAY';
  items: {
    type: 'OBJECT';
    properties: Record<string, { type: 'STRING' | 'NUMBER' }>;
    required: string[];
  };
}

// Schema per scanType — keeps the model's output shape exactly matching what
// the app's confirm/edit screen expects, field for field. Ported 1:1.
const SCHEMAS: Record<ScanType, GeminiSchema> = {
  setup: {
    type: 'ARRAY',
    items: {
      type: 'OBJECT',
      properties: {
        code: { type: 'STRING' },
        name: { type: 'STRING' },
        qty: { type: 'NUMBER' },
        cost: { type: 'NUMBER' },
        sell: { type: 'NUMBER' },
      },
      required: ['name', 'qty', 'cost', 'sell'],
    },
  },
  stock_in: {
    type: 'ARRAY',
    items: {
      type: 'OBJECT',
      properties: {
        code: { type: 'STRING' },
        name: { type: 'STRING' },
        qty: { type: 'NUMBER' },
        cost: { type: 'NUMBER' },
        sell: { type: 'NUMBER' },
      },
      required: ['name', 'qty', 'cost'],
    },
  },
  sales: {
    type: 'ARRAY',
    items: {
      type: 'OBJECT',
      properties: {
        code: { type: 'STRING' },
        name: { type: 'STRING' },
        qty: { type: 'NUMBER' },
      },
      required: ['name'],
    },
  },
  credit_sale: {
    type: 'ARRAY',
    items: {
      type: 'OBJECT',
      properties: {
        customer_name: { type: 'STRING' },
        phone: { type: 'STRING' },
        description: { type: 'STRING' },
        amount: { type: 'NUMBER' },
      },
      required: ['customer_name', 'amount'],
    },
  },
};

const PROMPTS: Record<ScanType, string> = {
  setup:
    'Extract every row from this handwritten inventory sheet. Columns are: Code, Item Name, Qty, Cost, Sell. Some rows may be missing code or have unclear handwriting — make your best reading. Every row MUST include qty, cost, and sell as numbers — if a value is genuinely illegible or blank on the page, output 0 for it rather than omitting the field. Return numbers as numbers, not strings.',
  stock_in:
    'Extract every row from this handwritten stock-in sheet. Columns are: Code, Item Name, Qty, Cost, Sell (sell price is optional and may not be written). Every row MUST include qty and cost as numbers — if a value is genuinely illegible or blank on the page, output 0 for it rather than omitting the field. Return numbers as numbers, not strings.',
  sales:
    'Extract every row from this handwritten sales sheet. Columns are: Code, Item Name, Qty. Return numbers as numbers, not strings.',
  credit_sale:
    'Extract every row from this handwritten credit/udhaar sale sheet (customers who bought on credit). Columns are: Customer Name, Phone (if written), Item/Description, Amount Owed. Phone numbers may be in local Sri Lankan format (07XXXXXXXX) — transcribe digits exactly as written, do not reformat. Return amount as a number, not a string.',
};

export interface ExtractResult {
  ok: boolean;
  rows?: Record<string, unknown>[];
  error?: string;
}

// ── Retry with exponential backoff ──────────────────────────────────────
// Pattern adapted from image_to_json_engine.tsx's fetchWithRetry, applied
// here to the Gemini fetch call specifically. Only retries on transient
// failures (429 rate limit, 5xx server errors, network errors) — a 4xx
// from a bad request (e.g. malformed schema) fails fast instead of wasting
// 5 retries on something that will never succeed.
async function fetchGeminiWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 4
): Promise<Response> {
  const delays = [500, 1500, 3000, 6000];

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      // Retry on rate-limit or server error; otherwise return immediately
      // (including 4xx client errors, which won't be fixed by retrying).
      if (response.status === 429 || response.status >= 500) {
        if (attempt === maxRetries - 1) return response;
        await new Promise((r) => setTimeout(r, delays[attempt]));
        continue;
      }
      return response;
    } catch (err) {
      // Network-level failure (DNS, timeout, connection reset)
      if (attempt === maxRetries - 1) throw err;
      await new Promise((r) => setTimeout(r, delays[attempt]));
    }
  }
  throw new Error('Exhausted retries calling Gemini');
}

/**
 * Runs OCR+structuring on a single image buffer.
 * @param imageBuffer - JPEG image bytes (already compressed)
 * @param scanType - 'setup' | 'stock_in' | 'sales'
 */
export async function extractRowsFromImage(
  imageBuffer: Buffer,
  scanType: ScanType
): Promise<ExtractResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { ok: false, error: 'GEMINI_API_KEY not configured on server' };
  }

  const schema = SCHEMAS[scanType] || SCHEMAS.stock_in;
  const prompt = PROMPTS[scanType] || PROMPTS.stock_in;
  const base64Data = imageBuffer.toString('base64');

  const payload = {
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }, { inlineData: { mimeType: 'image/jpeg', data: base64Data } }],
      },
    ],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: schema,
      maxOutputTokens: 2048, // hard cap — a paper sheet has ~25 rows max, this is plenty
    },
  };

  const url = `${API_BASE}/${MODEL}:generateContent`;

  try {
    const response = await fetchGeminiWithRetry(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      return { ok: false, error: `Gemini API error ${response.status}: ${errBody.slice(0, 300)}` };
    }

    const data = await response.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!rawText) {
      return { ok: false, error: 'No content returned from Gemini' };
    }

    const rows = JSON.parse(rawText);
    if (!Array.isArray(rows)) {
      return { ok: false, error: 'Gemini did not return an array' };
    }

    return { ok: true, rows };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
