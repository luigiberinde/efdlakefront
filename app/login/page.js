"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

const F = { width: "100%", padding: "10px 12px", fontSize: 14, borderRadius: 12, border: "0.5px solid #c7ccd4", background: "#fff", color: "#172033", boxSizing: "border-box", textAlign: "center" };
const btn = { width: "100%", padding: "10px", fontSize: 14, fontWeight: 700, borderRadius: 12, border: "none", background: "#1a2744", color: "#fff", cursor: "pointer" };

function LoginCard({ portal, title, description, accent }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const submit = async (e) => {
    e?.preventDefault();
    setLoading(true);
    setErr(false);
    const res = await fetch("/api/auth/guard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pw, portal }),
    });
    setLoading(false);
    if (res.ok) { router.push("/"); router.refresh(); } else setErr(true);
  };

  return (
    <div style={{ background: "#fff", padding: 22, borderRadius: 18, border: "0.5px solid #e0e3e8", borderTop: `4px solid ${accent}`, boxShadow: "0 12px 32px rgba(15,23,42,0.06)" }}>
      <h2 style={{ fontSize: 17, fontWeight: 800, margin: "0 0 6px" }}>{title}</h2>
      <p style={{ fontSize: 13, color: "#5e6675", margin: "0 0 16px", lineHeight: 1.5 }}>{description}</p>
      <form onSubmit={submit}>
        <input type="password" placeholder="Password" value={pw} onChange={e => { setPw(e.target.value); setErr(false); }} autoFocus={portal === "lakefront"} style={{ ...F, marginBottom: 12 }} />
        {err && <p style={{ fontSize: 13, color: "#A32D2D", margin: "0 0 12px" }}>Good try, but wrong.</p>}
        <button type="submit" disabled={loading} style={{ ...btn, opacity: loading ? 0.6 : 1 }}>{loading ? "Checking..." : "Enter"}</button>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div style={{ fontFamily: "Inter,ui-sans-serif,system-ui,sans-serif", maxWidth: 760, margin: "0 auto", padding: "5rem 1rem", textAlign: "center", color: "#172033" }}>
      <p style={{ fontSize: 12, color: "#5e6675", letterSpacing: "1px", textTransform: "uppercase", margin: "0 0 4px" }}>City of Evanston Fire Department</p>
      <h1 style={{ fontSize: 24, fontWeight: 800, margin: "0 0 2rem" }}>Lakefront Shift Swap</h1>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16, textAlign: "center" }}>
        <LoginCard portal="lakefront" title="Guards / Managers" description="Use the normal Lakefront access password." accent="#1a2744" />
        <LoginCard portal="beach" title="Gate Attendants / Office Staff" description="Use the Beach Staff access password." accent="#1D9E75" />
      </div>
      <p style={{ fontSize: 11, color: "#8a92a0", marginTop: 24 }}>Staff only. If you are in the wrong version, log out from the top of the board and re-enter the correct access password.</p>
    </div>
  );
}
