"use client";
import { useState } from "react";

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!file) return;
    setBusy(true);
    setErr(null);
    setResult(null);
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch("/api/reconcile", { method: "POST", body: fd });
    if (!r.ok) {
      const text = await r.text();
      setErr(`${r.status} ${r.statusText}: ${text}`);
      setBusy(false);
      return;
    }
    const j = await r.json();
    setResult(j);
    setBusy(false);
  }

  return (
    <div
      style={{
        // Give the page a much wider canvas so every column can fit
        width: "min(1600px, 96vw)",
        margin: "40px auto",
        padding: 20,
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial",
      }}
    >
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>Accounting Reconciliation (PO/SO Auto)</h1>
      <p style={{ marginTop: 6 }}>
        Upload a CSV/XLSX with headers like <code>tracking</code>, <code>transaction date</code>,{" "}
        <code>vendor/customer</code>, or <code>poNumber/invoiceNumber/soNumber</code>. We’ll check
        <b> both</b> PO and SO automatically.
      </p>

      <div
        style={{
          marginTop: 12,
          padding: 20,
          border: "1px dashed #bbb",
          borderRadius: 12,
          background: "#fafafa",
        }}
      >
        <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </div>

      <button
        onClick={submit}
        disabled={!file || busy}
        style={{
          marginTop: 12,
          padding: "10px 16px",
          borderRadius: 8,
          border: "1px solid #ddd",
          background: busy ? "#e3e3e3" : "#fff",
          cursor: !file || busy ? "not-allowed" : "pointer",
        }}
      >
        {busy ? "Reconciling..." : "Reconcile"}
      </button>

      {err && (
        <pre style={{ marginTop: 16, color: "#b00020", whiteSpace: "pre-wrap" }}>{err}</pre>
      )}

      {result && (
        <div style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600 }}>Summary</h2>
          <pre
            style={{
              background: "#f7f7f7",
              padding: 12,
              borderRadius: 8,
              maxWidth: "100%",
              overflowX: "auto",
            }}
          >
            {JSON.stringify(result.summary, null, 2)}
          </pre>

          <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 16 }}>Details</h2>

          {/* Wider table container; allow overflow if viewport is smaller */}
          <div style={{ width: "100%", overflowX: "auto" }}>
            <table
              style={{
                // Make the table itself wide enough to show all columns comfortably
                minWidth: 1400, // bump this up if you add more columns
                borderCollapse: "collapse",
                fontSize: 14,
                tableLayout: "auto",
              }}
            >
              <thead>
                <tr>
                  {[
                    "Order",
                    "Party",
                    "Tracking",
                    "AssertedDate",
                    "Verdict",
                    "Reason",
                    "Δdays",
                    "PO",
                    "SO",
                  ].map((h) => (
                    <th
                      key={h}
                      style={{
                        textAlign: "left",
                        padding: "10px 12px",
                        borderBottom: "1px solid #ddd",
                        whiteSpace: "nowrap",
                        fontWeight: 700,
                        background: "#fcfcfc",
                        position: "sticky",
                        top: 0,
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.details.map((r: any) => (
                  <tr key={r.row}>
                    <td style={cell}>{r.orderNumber}</td>
                    <td style={cell}>{r.partyUpload}</td>
                    <td style={cellMono}>{r.trackingUpload}</td>
                    <td style={cell}>{r.assertedDate}</td>
                    <td style={{ ...cell, fontWeight: 600 }}>{r.verdict}</td>
                    <td style={{ ...cell, maxWidth: 420, whiteSpace: "normal", wordBreak: "break-word" }}>
                      {r.reason}
                    </td>
                    <td style={{ ...cell, textAlign: "right", width: 60 }}>{r.dayDelta ?? ""}</td>
                    <td style={cell}>{r.poVerdict ?? ""}</td>
                    <td style={cell}>{r.soVerdict ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

const cell: React.CSSProperties = {
  padding: "10px 12px",
  borderBottom: "1px solid #eee",
  whiteSpace: "nowrap",
};

const cellMono: React.CSSProperties = {
  ...cell,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
};
