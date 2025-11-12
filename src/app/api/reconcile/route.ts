import { NextRequest } from "next/server";
import { parseFile } from "@/lib/parse";
import { getOrder, getActivity, extractPackages, findByTracking, extractParty } from "@/lib/ot";
import { decide } from "@/lib/decide";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let mode: "PO" | "SO" = "PO";
  try {
    const form = await req.formData();
    mode = ((form.get("mode") as string) ?? "PO") as "PO" | "SO";
    const file = form.get("file") as File | null;
    if (!file) {
      return new Response("Missing file (form field name must be 'file')", { status: 400 });
    }

    let rows;
    try {
      rows = await parseFile(file, mode);
    } catch (e: any) {
      console.error("[parseFile] error:", e?.message || e);
      return new Response(`Parse error: ${e?.message || e}`, { status: 400 });
    }

    const details: any[] = [];
    const counts: Record<string, number> = {};

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      try {
        let orderExists = false;
        let packages: { tracking: string; date?: string | null }[] = [];
        let partyOT: string | undefined;

        if (r.orderNumber) {
          // classic flow by order number
          const order = await getOrder(mode, r.orderNumber).catch(() => null);
          orderExists = !!order;
          partyOT = (order?.partyName ?? order?.vendorName ?? order?.customerName) as string | undefined;
          const activity = orderExists ? await getActivity(mode, r.orderNumber).catch(() => null) : null;
          packages = activity ? extractPackages(activity) : [];
        } else if (r.trackingNumber) {
          // tracking-only flow
          const tracking = r.trackingNumber.toUpperCase().replace(/\s|-/g, "");
          const activity = await findByTracking(
            mode,
            tracking,
            r.assertedDate ? r.assertedDate.toISOString().slice(0, 10) : undefined
          ).catch(() => null);
          packages = activity ? extractPackages(activity) : [];
          partyOT = extractParty(activity);
          orderExists = packages.length > 0; // if we saw any doc with this tracking, we consider it found
        } else {
          throw new Error("Row has neither orderNumber nor trackingNumber");
        }

        const ver = decide({
          mode,
          partyUpload: r.partyName,
          trackingUpload: r.trackingNumber,
          assertedDate: r.assertedDate ?? null,
          orderExists,
          packages,
          partyOT,
        });

        counts[ver.verdict] = (counts[ver.verdict] ?? 0) + 1;

        details.push({
          row: i + 1,
          mode,
          orderNumber: r.orderNumber ?? "",
          partyUpload: r.partyName ?? "",
          trackingUpload: r.trackingNumber ?? "",
          assertedDate: r.assertedDate?.toISOString()?.slice(0, 10) ?? "",
          verdict: ver.verdict,
          reason: ver.reason ?? "",
          dayDelta: ver.dayDelta ?? null,
        });
      } catch (err: any) {
        console.error(`[row ${i + 1}] error:`, err?.message || err);
        counts["ERROR"] = (counts["ERROR"] ?? 0) + 1;
        details.push({
          row: i + 1,
          mode,
          orderNumber: r.orderNumber ?? "",
          partyUpload: r.partyName ?? "",
          trackingUpload: r.trackingNumber ?? "",
          assertedDate: r.assertedDate?.toISOString()?.slice(0, 10) ?? "",
          verdict: "ERROR",
          reason: err?.message ?? "Unknown error",
        });
      }
    }

    return Response.json({ summary: counts, details });
  } catch (e: any) {
    console.error("[reconcile] fatal error:", e?.message || e);
    return new Response(`Fatal error: ${e?.message || e}`, { status: 500 });
  }
}
