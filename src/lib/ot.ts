import axios from "axios";

const base = process.env.OT_BASE as string;

async function authHeader() {
  const token = process.env.OT_TOKEN;
  if (!token) throw new Error("Missing OT_TOKEN");
  return { Authorization: `Bearer ${token}` };
}

export async function getOrder(mode: "PO" | "SO", orderNumber: string) {
  const url = mode === "PO" ? `${base}/purchase-orders` : `${base}/sales-orders`;
  const { data } = await axios.get(url, { params: { orderNumber }, headers: await authHeader() });
  return data; // should include partyName/vendorName/customerName
}

export async function getActivity(mode: "PO" | "SO", orderNumber: string) {
  const url = mode === "PO" ? `${base}/receipts` : `${base}/shipments`;
  const { data } = await axios.get(url, { params: { orderNumber }, headers: await authHeader() });
  return data;
}

/** NEW: find shipments/receipts by tracking number (and optional date) */
export async function findByTracking(mode: "PO" | "SO", tracking: string, dateISO?: string) {
  const url = mode === "PO" ? `${base}/receipts` : `${base}/shipments`;
  const params: Record<string, string> = { tracking };
  if (dateISO) params["date"] = dateISO; // adjust if your API expects a different key
  const { data } = await axios.get(url, { params, headers: await authHeader() });
  return data;
}

/** Map your OT response into packages [{tracking, date}] */
export function extractPackages(activity: any): { tracking: string; date?: string | null }[] {
  if (!activity) return [];
  const pkgs: { tracking: string; date?: string | null }[] = [];
  for (const doc of activity.docs ?? []) {
    const date = doc.date ?? doc.shipDate ?? doc.receiptDate ?? null;
    for (const p of doc.packages ?? []) {
      const t = (p.trackingNumber ?? p.tracking ?? "").toString().toUpperCase().replace(/\s|-/g, "");
      if (t) pkgs.push({ tracking: t, date });
    }
  }
  return pkgs;
}

/** Pull a best-guess party name off the activity payload */
export function extractParty(activity: any): string | undefined {
  const first = activity?.docs?.[0];
  return first?.partyName ?? first?.vendorName ?? first?.customerName ?? undefined;
}
