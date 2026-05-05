"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

const F = { width: "100%", padding: "10px 12px", fontSize: 14, borderRadius: 12, border: "0.5px solid #c7ccd4", background: "#fff", color: "#172033", boxSizing: "border-box", textAlign: "center" };

export default function LoginPage() {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const submit = async (e) => {
    e?.preventDefault();
    setLoading(true); setErr(false);
    const res = await fetch("/api/auth/guard", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: pw }) });
    setLoading(false);
    if (res.ok) { router.push("/"); router.refresh(); } else setErr(true);
  };

  return (
    <div style={{ fontFamily: "Inter,ui-sans-serif,system-ui,sans-serif", maxWidth: 360, margin: "0 auto", padding: "6rem 1rem", textAlign: "center", color: "#172033" }}>
      <p style={{ fontSize: 12, color: "#5e6675", letterSpacing: "1px", textTransform: "uppercase", margin: "0 0 4px" }}>City of Evanston Fire Department</p>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 2rem" }}>Lakefront Shift Swap</h1>
      <div style={{ background: "#fff", padding: 24, borderRadius: 18, border: "0.5px solid #e0e3e8", boxShadow: "0 12px 32px rgba(15,23,42,0.06)" }}>
        <p style={{ fontSize: 14, color: "#5e6675", margin: "0 0 16px" }}>Enter the Lakefront access password to continue.</p>
        <form onSubmit={submit}>
          <input type="password" placeholder="Password" value={pw} onChange={e => { setPw(e.target.value); setErr(false); }} autoFocus style={{ ...F, marginBottom: 12 }} />
          {err && <p style={{ fontSize: 13, color: "#A32D2D", margin: "0 0 12px" }}>Good try, but wrong.</p>}
          <button type="submit" disabled={loading} style={{ width: "100%", padding: "10px", fontSize: 14, fontWeight: 700, borderRadius: 12, border: "none", background: "#1a2744", color: "#fff", cursor: "pointer", opacity: loading ? 0.6 : 1 }}>{loading ? "Checking..." : "Enter"}</button>
        </form>
      </div>
      <p style={{ fontSize: 11, color: "#8a92a0", marginTop: 24 }}>Staff only. Contact an LC if you need the access code.</p>
    </div>
  );
}
