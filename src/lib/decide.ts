import { normName, normTracking } from "./normalize";

export type Verdict =
  | "MATCHED"
  | "NO_MATCH_ORDER"
  | "NO_ACTIVITY"
  | "TRACKING_NOT_FOUND"
  | "PARTY_MISMATCH"
  | "DATE_OUT_OF_WINDOW"
  | "NO_TRACKING_PROVIDED";

export function decide(opts: {
  mode: "PO" | "SO";
  partyUpload?: string;
  trackingUpload?: string;
  assertedDate?: Date | null;
  orderExists: boolean;
  packages: { tracking: string; date?: string | null }[];
  partyOT?: string;
  policyWindowDays?: number;
}) {
  const window = opts.policyWindowDays ?? Number(process.env.POLICY_WINDOW_DAYS ?? 5);
  if (!opts.orderExists) return { verdict: "NO_MATCH_ORDER" as const };

  if (!opts.packages.length) return { verdict: "NO_ACTIVITY" as const };

  const tUp = normTracking(opts.trackingUpload);
  const foundPkg = tUp ? opts.packages.find((p) => p.tracking === tUp) : undefined;

  if (tUp && !foundPkg) {
    const seen = opts.packages.map((p) => p.tracking);
    return { verdict: "TRACKING_NOT_FOUND" as const, reason: `Seen: ${seen.join(", ")}` };
  }

  const pUp = normName(opts.partyUpload);
  const pOT = normName(opts.partyOT);
  if (pUp && pOT && pUp !== pOT) {
    return { verdict: "PARTY_MISMATCH" as const, reason: `Upload='${pUp}' OT='${pOT}'` };
  }

  if (opts.assertedDate && (foundPkg?.date || opts.packages[0]?.date)) {
    const d = new Date(foundPkg?.date ?? (opts.packages[0].date as string));
    const deltaDays = Math.round(Math.abs((d.getTime() - opts.assertedDate.getTime()) / 86400000));
    if (deltaDays > window) return { verdict: "DATE_OUT_OF_WINDOW" as const, dayDelta: deltaDays };
    return { verdict: tUp ? "MATCHED" as const : "NO_TRACKING_PROVIDED" as const, dayDelta: deltaDays, foundTracking: foundPkg?.tracking };
  }

  return { verdict: tUp ? "MATCHED" as const : "NO_TRACKING_PROVIDED" as const, foundTracking: foundPkg?.tracking };
}
