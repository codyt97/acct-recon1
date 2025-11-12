import Papa from "papaparse";
import * as XLSX from "xlsx";

export type UploadRow = {
  // what the rest of the app expects
  orderNumber?: string;
  partyName?: string; // vendor/customer
  trackingNumber?: string;
  assertedDate?: Date | null;
  // parser debugging
  _raw?: Record<string, any>;
};

// ----------------------------
// header & field normalization
// ----------------------------
const H = {
  // order numbers
  ORDER: [
    "po number",
    "so number",
    "order number",
    "order #",
    "order no",
    "orderno",
    "order",
    "po #",
    "so #",
    "no.", // OrderTime CSV export uses "No."
    "vendor invoice/so", // your PO file
    "associated so", // your SO/UPS exports
    "invoice number",
  ],

  // tracking
  TRACKING: [
    "tracking",
    "tracking number",
    "tracking no",
    "tracking no.",
    "tracking details",
    "tracking status",
    "tracking id",
    "tracking code",
    "shipment tracking",
    "ups tracking",
  ],

  // party (vendor/customer)
  PARTY: [
    "vendor",
    "vendor name",
    "customer",
    "customer name",
    "party",
    "sold to",
    "bill to",
  ],

  // dates
  DATE: [
    "date",
    "transaction date",
    "po promise date",
    "promise date",
    "ship date",
    "invoice date",
    "estimated delivery window", // range -> take first date
    "asserted date",
  ],
} as const;

function norm(s: string | undefined | null): string {
  return (s || "").toString().trim();
}

function keyify(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function pickHeader(headers: string[], candidates: readonly string[]): string[] {
  const ks = headers.map(keyify);
  const out: string[] = [];
  ks.forEach((k, idx) => {
    if (candidates.includes(k)) out.push(headers[idx]);
  });
  return out;
}

function parseDateLike(v: any): Date | null {
  if (!v) return null;

  // If we got an Excel serial date number
  if (typeof v === "number" && v > 60 && v < 60000) {
    try {
      return XLSX.SSF.parse_date_code(v)
        ? new Date(Math.round((v - 25569) * 86400 * 1000))
        : null;
    } catch {
      /* ignore */
    }
  }

  const s = norm(v);

  if (!s) return null;

  // Estimated Delivery Window like "2025-10-31 – 2025-11-03"
  const windowMatch = s.match(
    /(\d{4}[-/]\d{1,2}[-/]\d{1,2})\s*(?:–|-|to)\s*(\d{4}[-/]\d{1,2}[-/]\d{1,2})/i
  );
  if (windowMatch) {
    const d = Date.parse(windowMatch[1]);
    return isNaN(d) ? null : new Date(d);
  }

  const d = Date.parse(s);
  return isNaN(d) ? null : new Date(d);
}

function extractFirstTracking(raw: any): string | undefined {
  // Combine likely tracking fields and scan for first long-ish alphanumeric
  const pool = [
    norm(raw["Tracking"]),
    norm(raw["Tracking Number"]),
    norm(raw["Tracking NO"]),
    norm(raw["Tracking No"]),
    norm(raw["Tracking No."]),
    norm(raw["Tracking Details"]),
    norm(raw["Tracking Status"]),
    norm(raw["UPS Tracking"]),
  ]
    .filter(Boolean)
    .join(" ");

  if (!pool) return undefined;

  // A very loose matcher: alphanumeric strings ≥10 (UPS/FedEx/USPS will pass)
  const m = pool.match(/[A-Z0-9]{10,}/i);
  return m ? m[0].toUpperCase() : undefined;
}

// ----------------------------
// CSV/XLSX reading
// ----------------------------
async function readAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return await file.arrayBuffer();
}

async function readAsText(file: File): Promise<string> {
  return await file.text();
}

function csvToRows(text: string): Record<string, any>[] {
  const { data, errors } = Papa.parse<Record<string, any>>(text, {
    header: true,
    dynamicTyping: false,
    skipEmptyLines: true,
  });
  if (errors && errors.length) {
    // keep going; we’ll still try to map rows
    // (you can log errors here if desired)
  }
  return (data as any[]).filter((r) => Object.values(r).some((v) => v !== ""));
}

function xlsxToRows(buf: ArrayBuffer): Record<string, any>[] {
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { defval: "" }) as any[];
}

// ----------------------------
// Public: parseFile
// ----------------------------
export async function parseFile(file: File): Promise<UploadRow[]> {
  const name = file.name.toLowerCase();
  const rows: Record<string, any>[] = name.endsWith(".csv")
    ? csvToRows(await readAsText(file))
    : xlsxToRows(await readAsArrayBuffer(file));

  if (!rows.length) return [];

  // Collect headers
  const headers = Object.keys(rows[0]);

  const orderHeaders = pickHeader(headers, H.ORDER);
  const trackingHeaders = pickHeader(headers, H.TRACKING);
  const partyHeaders = pickHeader(headers, H.PARTY);
  const dateHeaders = pickHeader(headers, H.DATE);

  // We won’t fail just because a canonical header is missing; we’ll try to derive.
  const out: UploadRow[] = [];

  for (const r of rows) {
    const raw = { ...r };

    // 1) order number
    let orderNumber =
      // take first non-empty among mapped order headers
      orderHeaders.map((h) => norm(raw[h])).find(Boolean) || undefined;

    // special handling for OrderTime CSV "No."
    if (!orderNumber && raw["No."]) {
      orderNumber = norm(raw["No."]);
    }

    // sometimes PO files store SO/Invoice number in these fields
    if (!orderNumber && raw["Associated SO"]) {
      orderNumber = norm(raw["Associated SO"]);
    }
    if (!orderNumber && raw["Vendor Invoice/SO"]) {
      orderNumber = norm(raw["Vendor Invoice/SO"]);
    }

    // 2) tracking
    let trackingNumber =
      trackingHeaders.map((h) => norm(raw[h])).find(Boolean) || undefined;

    if (!trackingNumber) {
      trackingNumber = extractFirstTracking(raw);
    }

    if (trackingNumber) trackingNumber = trackingNumber.toUpperCase();

    // 3) party
    let partyName =
      partyHeaders.map((h) => norm(raw[h])).find(Boolean) || undefined;

    // 4) date
    let assertedDate: Date | null = null;
    for (const h of dateHeaders) {
      const d = parseDateLike(raw[h]);
      if (d) {
        assertedDate = d;
        break;
      }
    }

    // If we still have nothing for date, try common raw names explicitly
    if (!assertedDate) {
      assertedDate =
        parseDateLike(raw["PO Promise date"]) ||
        parseDateLike(raw["Promise Date"]) ||
        parseDateLike(raw["Date"]) ||
        parseDateLike(raw["Estimated Delivery Window"]) ||
        null;
    }

    // Safety: if we truly have neither order nor tracking, then this row
    // is not actionable and we skip it (or you can choose to push an empty row).
    if (!orderNumber && !trackingNumber) {
      // skip totally empty business rows
      const hasAnyValue = Object.values(raw).some((v) => norm(v));
      if (!hasAnyValue) continue;

      // If you’d rather hard-fail, throw here; but tolerating is nicer UX.
      // throw new Error("Row missing both orderNumber and trackingNumber.");
      continue;
    }

    out.push({
      orderNumber,
      partyName,
      trackingNumber,
      assertedDate,
      _raw: raw,
    });
  }

  if (!out.length) {
    // True hard fail only if no actionable rows were produced
    const foundHeaders = headers.join(" | ");
    throw new Error(
      `Missing required column(s): orderNumber or trackingNumber. Found headers: ${foundHeaders}`
    );
  }

  return out;
}
