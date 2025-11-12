// src/app/layout.tsx
export const metadata = {
  title: "Accounting Reconciliation",
  description: "Upload CSV/XLSX and reconcile against OrderTime",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial" }}>
        <main style={{ maxWidth: 960, margin: "32px auto", padding: "0 20px" }}>
          {children}
        </main>
      </body>
    </html>
  );
}
