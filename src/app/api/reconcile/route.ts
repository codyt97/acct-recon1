import { NextRequest } from "next/server";
import { parseFile } from "@/lib/parse";
import { getOrder, getActivity, extractPackages, findByTracking, extractParty } from "@/lib/ot";
import { decide } from "@/lib/decide";

export const runtime = "nodejs";

const SCORE: Record<string, number> = {
  OK: 3,
  MISMATCH: 2,
  NOT_FOUND: 1,
  ERROR: 0,
};

type Row = {
  orderNumber?: string;
  partyName?: string;
  trackingNumber?: string;
  assertedDate?: Date | null;
  sourceMode?: "PO" | "SO" | "UPS"; // where the row came from
};

async function reconcileOne(mode: "PO" | "SO", r: Row) {
  let orderExists = false;
  let packages: { tracking: string; date?: string | null }[] = [];
  let partyOT: string | undefined;

  if (r.orderNumber) {
    const order = await getOrder(mode, r.orderNumber).catch(() => null);
    orderExists = !!order;
    partyOT =
      (order?.partyName as string | undefined) ??
      (order as any)?.vendorName ??
      (order as any)?.customerName;
    const activity = orderExists ? await getActivity(mode, r.orderNumber).catch(() => null) : null;
    packages = activity ? extractPackages(activity) : [];
  } else if (r.trackingNumber) {
    const tracking = r.trackingNumber.toUpperCase().replace(/\s|-/g, "");
    const activity = await findByTracking(
      mode,
      tracking,
      r.assertedDate ? r.assertedDate.toISOString().slice(0, 10) : undefined
    ).catch(() => null);
    packages = activity ? extractPackages(activity) : [];
    partyOT = extractParty(activity);
    orderExists = packages.length > 0;
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

  return { mode, verdict: ver.verdict, reason: ver.reason ?? "", dayDelta: ver.dayDelta ?? null };
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();

    const poFile = form.get("poFile") as File | null;
    const soFile = form.get("soFile") as File | null;
    const upsFile = form.get("upsFile") as File | null;

    if (!poFile && !soFile && !upsFile) {
      return new Response("Upload at least one file: 'poFile' and/or 'soFile' and/or 'upsFile'", { status: 400 });
    }

    const rows: Row[] = [];

    const parseAndTag = async (f: File, tag: "PO" | "SO" | "UPS") => {
      const parsed = await parseFile(f);
      for (const r of parsed) rows.push({ ...r, sourceMode: tag });
    };

    if (poFile) await parseAndTag(poFile, "PO");
    if (soFile) await parseAndTag(soFile, "SO");
    if (upsFile) await parseAndTag(upsFile, "UPS");

    if (!rows.length) return new Response("No data rows found in uploads.", { status: 400 });

    const details: any[] = [];
    const counts: Record<string, number> = {};

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];

      // choose the preferred mode based on the source
      let prefer: "PO" | "SO";
      if (r.sourceMode === "PO") prefer = "PO";
      else if (r.sourceMode === "SO") prefer = "SO";
      else prefer = "SO"; // UPS: shipments; try SO first
      const other: "PO" | "SO" = prefer === "PO" ? "SO" : "PO";

      try {
        const resPref = await reconcileOne(prefer, r);
        const resOther = await reconcileOne(other, r);

        const pick =
          (SCORE[resOther.verdict] ?? 0) > (SCORE[resPref.verdict] ?? 0) ? resOther : resPref;

        counts[pick.verdict] = (counts[pick.verdict] ?? 0) + 1;

        // normalize per-column verdicts for table
        const poVerd = prefer === "PO" ? resPref.verdict : resOther.verdict;
        const soVerd = prefer === "SO" ? resPref.verdict : resOther.verdict;

        details.push({
          row: i + 1,
          sourceMode: r.sourceMode ?? "",
          chosenMode: pick.mode,
          orderNumber: r.orderNumber ?? "",
          partyUpload: r.partyName ?? "",
          trackingUpload: r.trackingNumber ?? "",
          assertedDate: r.assertedDate?.toISOString()?.slice(0, 10) ?? "",
          verdict: pick.verdict,
          reason: pick.reason,
          dayDelta: pick.dayDelta,
          poVerdict: poVerd,
          soVerdict: soVerd,
        });
      } catch (err: any) {
        counts["ERROR"] = (counts["ERROR"] ?? 0) + 1;
        details.push({
          row: i + 1,
          sourceMode: r.sourceMode ?? "",
          chosenMode: "",
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
