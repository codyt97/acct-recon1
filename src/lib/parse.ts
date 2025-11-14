// src/lib/parse.ts
import Papa from "papaparse";
import * as XLSX from "xlsx";

export type UploadRow = {
  orderNumber?: string;
  partyName?: string;
  trackingNumber?: string;
  assertedDate?: Date | null;
  amount?: number;           // <= added: parsed money for freight/shipping
  _raw?: Record<string, any>;
};

// ----------------------------
// Config: header synonyms
// ----------------------------

const H = {
  ORDER: [
    "po number","po #","po no","po no.",
    "so number","so #","so no","so no.",
    "order number","order #","order no","order no.","order",
    "no.","no",
    "document number","document no","document no.",
    "vendor invoice/so","associated so",
    "invoice number","invoice #","invoice no","invoice no.",
    // ShipDocs
    "ship doc","ship doc #","ship doc no","ship doc no.","shipdoc",
    "shipment number","shipment #","shipment no","shipment no."
  ],

  TRACKING: [
    "tracking","tracking number","tracking #","tracking no","tracking no.",
    "tracking id","tracking code","tracking details","tracking status",
    "shipment tracking","ups tracking","carrier tracking"
  ],

  PARTY: [
    "vendor","vendor name","supplier","supplier name",
    "customer","customer name","party","sold to","bill to","account name"
  ],

  DATE: [
    "date","transaction date","po promise date","promise date",
    "ship date","shipment date","invoice date","asserted date",
    "estimated delivery window","delivery window"
  ],

  // NEW: any likely freight/shipping money column
  AMOUNT: [
    "freight","freight in","freight-in","freight out","freight-out",
    "total freight","freight amount","shipping","shipping cost",
    "shipping charge","shipping charges","total shipping","delivery charge",
    "transportation","postage","carrier charge","carrier charges",
    "ups charges","ups charge","shipment charge"
  ]
} as const;

// ----------------------------
// Utilities
// ----------------------------

function norm(v: unknown): string {
  return (v ?? "").toString().trim();
}

function keyify(s: string): string {
  return s.toLowerCase().replace(/[\s_]+/g, " ").trim();
}

function pickHeaders(headers: string[], candidates: readonly string[]): string[] {
  const map = new Map(headers.map((h) => [keyify(h), h]));
  const out: string[] = [];
  for (const c of candidates) {
    const real = map.get(c);
    if (real) out.push(real);
  }
  return out;
}

function parseDateLike(v: unknown): Date | null {
  if (v == null || v === "") return null;

  // Excel serial numbers
  if (typeof v === "number" && v > 60 && v < 60000) {
    try {
      const ms = Math.round((v - 25569) * 86400 * 1000);
      return new Date(ms);
    } catch {}
  }

  const s = norm(v);
  if (!s) return null;

  const m = s.match(
    /(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4})\s*(?:–|-|to)\s*(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/i
  );
  if (m) {
    const d0 = Date.parse(m[1]);
    return isNaN(d0) ? null : new Date(d0);
  }

  const d = Date.parse(s);
  return isNaN(d) ? null : new Date(d);
}

// currency/number like $1,234.56 or (123.45) or -123.45
function parseMoney(v: unknown): number | undefined {
  if (v == null || v === "") return undefined;
  if (typeof v === "number" && isFinite(v)) return v;

  const s = norm(v);
  if (!s) return undefined;

  const neg = /^\(.*\)$/.test(s); // parentheses negative
  const cleaned = s
    .replace(/[\$,]/g, "")
    .replace(/[^\d.\-]/g, "")
    .trim();

  const n = Number(cleaned);
  if (!isFinite(n)) return undefined;
  return neg ? -Math.abs(n) : n;
}

function extractFirstTracking(raw: Record<string, any>): string | undefined {
  const pool = [
    "Tracking","Tracking Number","Tracking No","Tracking NO","Tracking No.",
    "Tracking #","Tracking Details","Tracking Status","UPS Tracking",
    "Carrier Tracking","Shipment Tracking",
  ].map((k) => norm(raw[k])).filter(Boolean).join(" ");

  if (!pool) return undefined;
  const m = pool.match(/[A-Z0-9]{10,}/i);
  return m ? m[0].toUpperCase() : undefined;
}

// ----------------------------
// Readers
// ----------------------------

async function readAsText(file: File): Promise<string> { return await file.text(); }
async function readAsArrayBuffer(file: File): Promise<ArrayBuffer> { return await file.arrayBuffer(); }

function csvToRows(text: string): Record<string, any>[] {
  const { data } = Papa.parse<Record<string, any>>(text, {
    header: true, dynamicTyping: false, skipEmptyLines: true,
  });
  return (data as any[]).filter((r) => r && Object.values(r).some((v) => v !== ""));
}

function xlsxToRows(buf: ArrayBuffer): Record<string, any>[] {
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { defval: "" }) as any[];
}

// ----------------------------
// Public API
// ----------------------------

export async function parseFile(file: File): Promise<UploadRow[]> {
  const name = file.name.toLowerCase();
  const rows: Record<string, any>[] = name.endsWith(".csv")
    ? csvToRows(await readAsText(file))
    : xlsxToRows(await readAsArrayBuffer(file));

  if (!rows.length) return [];

  const headers = Object.keys(rows[0]);

  const orderHeaders = pickHeaders(headers, H.ORDER);
  const trackingHeaders = pickHeaders(headers, H.TRACKING);
  const partyHeaders = pickHeaders(headers, H.PARTY);
  const dateHeaders = pickHeaders(headers, H.DATE);
  const amountHeaders = pickHeaders(headers, H.AMOUNT); // NEW

  const out: UploadRow[] = [];

  for (const r of rows) {
    const raw = { ...r };

    // ORDER
    let orderNumber: string | undefined =
      orderHeaders.map((h) => norm(raw[h])).find(Boolean) || undefined;

    if (!orderNumber && raw["No."]) orderNumber = norm(raw["No."]);
    if (!orderNumber && raw["No"]) orderNumber = norm(raw["No"]);
    if (!orderNumber && raw["Associated SO"]) orderNumber = norm(raw["Associated SO"]);
    if (!orderNumber && raw["Vendor Invoice/SO"]) orderNumber = norm(raw["Vendor Invoice/SO"]);
    if (!orderNumber && raw["Ship Doc No"]) orderNumber = norm(raw["Ship Doc No"]);
    if (!orderNumber && raw["Ship Doc No."]) orderNumber = norm(raw["Ship Doc No."]);
    if (!orderNumber && raw["ShipDoc"]) orderNumber = norm(raw["ShipDoc"]);
    if (!orderNumber && raw["Shipment Number"]) orderNumber = norm(raw["Shipment Number"]);
    if (!orderNumber && raw["Shipment No"]) orderNumber = norm(raw["Shipment No"]);
    if (!orderNumber && raw["Shipment No."]) orderNumber = norm(raw["Shipment No."]);
    if (orderNumber) orderNumber = orderNumber.replace(/\s+/g, " ").trim();

    // TRACKING
    let trackingNumber: string | undefined =
      trackingHeaders.map((h) => norm(raw[h])).find(Boolean) || undefined;
    if (!trackingNumber) trackingNumber = extractFirstTracking(raw);
    if (trackingNumber) trackingNumber = trackingNumber.toUpperCase();

    // PARTY
    let partyName: string | undefined =
      partyHeaders.map((h) => norm(raw[h])).find(Boolean) || undefined;

    // DATE
    let assertedDate: Date | null = null;
    for (const h of dateHeaders) {
      const d = parseDateLike(raw[h]);
      if (d) { assertedDate = d; break; }
    }
    if (!assertedDate) {
      assertedDate =
        parseDateLike(raw["PO Promise date"]) ||
        parseDateLike(raw["Promise Date"]) ||
        parseDateLike(raw["Ship Date"]) ||
        parseDateLike(raw["Shipment Date"]) ||
        parseDateLike(raw["Date"]) ||
        parseDateLike(raw["Estimated Delivery Window"]) ||
        null;
    }

    // AMOUNT (money)
    let amount: number | undefined;
    for (const h of amountHeaders) {
      const n = parseMoney(raw[h]);
      if (typeof n === "number") { amount = n; break; }
    }

    // Skip rows with nothing actionable at all
    if (!orderNumber && !trackingNumber && amount == null) {
      const hasAnyValue = Object.values(raw).some((v) => norm(v));
      if (!hasAnyValue) continue;
      continue;
    }

    out.push({
      orderNumber,
      partyName,
      trackingNumber,
      assertedDate,
      amount,
      _raw: raw,
    });
  }

  if (!out.length) {
    const found = headers.join(" | ");
    throw new Error(
      `Missing required column(s): orderNumber or trackingNumber. Found headers: ${found}`
    );
  }

  return out;
}
