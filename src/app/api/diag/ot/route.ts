import { NextRequest } from "next/server";
import axios from "axios";

export const runtime = "nodejs";

function buildAuth() {
  const mode = (process.env.OT_AUTH_MODE || "").toLowerCase();
  const name = (process.env.OT_API_KEY_NAME || "X-API-Key").trim();
  const key  = (process.env.OT_API_KEY || "").trim();
  const token = (process.env.OT_TOKEN || "").trim();

  if (token) return { headers: { Authorization: `Bearer ${token}` }, params: {} };
  if (mode === "header" && key) return { headers: { [name]: key }, params: {} };
  if (mode === "query"  && key) return { headers: {}, params: { [name]: key } };
  throw new Error("No OT auth configured");
}

export async function GET(req: NextRequest) {
  const base = process.env.OT_BASE;
  if (!base) return new Response("Missing OT_BASE", { status: 500 });

  const { headers, params } = buildAuth();

  // We’ll hit both endpoints with a harmless limit query.
  const urls = [`${base}/receipts`, `${base}/shipments`];
  const out: any[] = [];
  for (const url of urls) {
    try {
      const r = await axios.get(url, { headers, params: { ...params, limit: 1 } });
      out.push({ url, status: r.status, ok: true });
    } catch (e: any) {
      out.push({ url, status: e?.response?.status ?? 0, ok: false, msg: e?.message });
    }
  }
  return Response.json({ base, mode: process.env.OT_AUTH_MODE, keyName: process.env.OT_API_KEY_NAME, results: out });
}
