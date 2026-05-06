"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase-browser";

const PS = 10;

// ── Helpers ──────────────────────────────────────────────────
function fmtDate(d) { return new Date(d+"T12:00:00").toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"}); }
function fmtDateLong(d) { return new Date(d+"T12:00:00").toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"}); }
function timeAgo(iso) { const h=Math.floor((Date.now()-new Date(iso).getTime())/36e5); return h<1?"just now":h<24?h+"h ago":Math.floor(h/24)+"d ago"; }
function workWeekBounds(dateStr) {
  const b=new Date(dateStr+"T12:00:00"), day=b.getDay(), diff=day===0?-6:1-day;
  const mon=new Date(b); mon.setDate(b.getDate()+diff); mon.setHours(0,0,0,0);
  const next=new Date(mon); next.setDate(mon.getDate()+7);
  return [mon,next];
}
function inSameWeek(base,compare) {
  const [mon,next]=workWeekBounds(base);
  const c=new Date(compare+"T12:00:00");
  return c>=mon&&c<next;
}
function tc(t) { return t==="guard"?{bg:"#FCEBEB",border:"#F09595",text:"#791F1F"}:{bg:"#FAEEDA",border:"#FAC775",text:"#633806"}; }

// ── Styles ──────────────────────────────────────────────────
const F={width:"100%",padding:"8px 12px",fontSize:14,borderRadius:12,border:"0.5px solid #c7ccd4",background:"#fff",color:"#172033",boxSizing:"border-box"};
const B=(bg,c)=>({display:"inline-block",fontSize:11,fontWeight:700,padding:"2px 10px",borderRadius:12,background:bg,color:c,textTransform:"uppercase",letterSpacing:"0.5px"});
const tabS=a=>({padding:"12px 18px",fontSize:14,fontWeight:a?700:500,color:a?"#172033":"#5e6675",background:"none",border:"none",borderBottom:a?"2px solid #172033":"2px solid transparent",cursor:"pointer",marginBottom:-1});
const pillS=a=>({padding:"8px 14px",fontSize:13,fontWeight:a?700:500,color:a?"#172033":"#5e6675",background:a?"#f6f7f9":"none",border:`0.5px solid ${a?"#e0e3e8":"transparent"}`,borderRadius:12,cursor:"pointer"});
const btnP={padding:"8px 18px",fontSize:13,fontWeight:700,borderRadius:12,cursor:"pointer",border:"none",background:"#1a2744",color:"#fff"};
const btn2={padding:"8px 18px",fontSize:13,fontWeight:700,borderRadius:12,cursor:"pointer",border:"0.5px solid #c7ccd4",background:"#fff",color:"#172033"};

// Stable UI components kept outside ShiftBoard so typing in modals does not remount inputs on every keystroke.
function InfoBlock({ badge, children, gold = false }) {
  return (
    <div style={{ borderRadius: 12, padding: "10px 12px", marginBottom: 8, fontSize: 13, background: gold?"#FFF9E8":"#f6f7f9", border: `0.5px solid ${gold?"#D9B451":"#e0e3e8"}`, lineHeight: 1.6, color: "#5e6675" }}>
      <span style={B(gold?"#FFF2B8":"#E6F1FB", gold?"#8A5A00":"#0C447C")}>{badge}</span>
      <div style={{ marginTop: 4 }}>{children}</div>
    </div>
  );
}

function Modal({ children, onClose, z = 100 }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: z, padding: 16 }} onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 18, border: "0.5px solid #e0e3e8", padding: "1.5rem", width: "100%", maxWidth: 480, maxHeight: "80vh", overflow: "auto", boxShadow: "0 18px 40px rgba(0,0,0,0.18)" }} onClick={e => e.stopPropagation()}>{children}</div>
    </div>
  );
}

function ModalActions({ onCancel, onConfirm, text, danger = false, disabled = false }) {
  return (
    <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 16 }}>
      <button onClick={onCancel} style={btn2}>Cancel</button>
      <button onClick={onConfirm} disabled={disabled} style={{ ...btnP, background: danger ? "#8A1F1F" : "#1a2744", opacity: disabled ? 0.6 : 1 }}>{text}</button>
    </div>
  );
}

function LabeledInput({ label, hint, value, onChange, placeholder, type = "text" }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ fontSize: 13, fontWeight: 700, color: "#5e6675", display: "block", marginBottom: 4 }}>{label}{hint && <span style={{ fontWeight: 500, color: "#8a92a0" }}> — {hint}</span>}</label>
      <input style={F} type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

function CheckBox({ checked, onChange, children }) {
  return (
    <div style={{ padding: "10px 12px", borderRadius: 12, background: "#f6f7f9", border: "0.5px solid #e0e3e8", marginBottom: 16 }}>
      <label style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer", fontSize: 13, lineHeight: 1.5 }}>
        <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} style={{ marginTop: 3 }} />{children}
      </label>
    </div>
  );
}

function SummaryBox({ rows }) {
  return (
    <div style={{ borderRadius: 12, border: "0.5px solid #e0e3e8", background: "#f6f7f9", padding: 12, marginBottom: 16 }}>
      {rows.map(([k, v], i) => (
        <div key={k} style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: 10, fontSize: 13, padding: "6px 0", borderBottom: i < rows.length - 1 ? "0.5px solid #e0e3e8" : "none" }}>
          <div style={{ color: "#5e6675", fontWeight: 700 }}>{k}</div>
          <div style={{ overflowWrap: "anywhere" }}>{v}</div>
        </div>
      ))}
    </div>
  );
}

function Empty({ children }) {
  return (
    <div style={{ padding: "2rem 1rem", textAlign: "center", color: "#8a92a0", background: "#fff", border: "0.5px solid #e0e3e8", borderRadius: 16, fontSize: 14 }}>
      {children}
    </div>
  );
}

export default function ShiftBoard() {
  const sb = getSupabase();

  // ── State ─────────────────────────────────────────────
  const [shifts, setShifts] = useState([]);
  const [total, setTotal] = useState(0);
  const [apps, setApps] = useState([]);
  const [statsApps, setStatsApps] = useState([]); // cross-shift apps for LC stats
  const [openCount, setOpenCount] = useState(0);
  const [todoCount, setTodoCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const [lcAuth, setLcAuth] = useState(false);
  const [view, setView] = useState("board");
  const [boardTab, setBoardTab] = useState("open");
  const [dateFilter, setDateFilter] = useState("");
  const [page, setPage] = useState(1);
  const [lcTab, setLcTab] = useState("review");
  const [todoTab, setTodoTab] = useState("pending");
  const [historySort, setHistorySort] = useState("action");

  const [pwInput, setPwInput] = useState("");
  const [pwError, setPwError] = useState(false);
  const [toast, setToast] = useState(null);

  // Modals
  const [showPostModal, setShowPostModal] = useState(false);
  const [showApplyModal, setShowApplyModal] = useState(null);
  const [postConfirmOpen, setPostConfirmOpen] = useState(false);
  const [pendingApply, setPendingApply] = useState(null);
  const [pendingApproval, setPendingApproval] = useState(null);
  const [deleteShiftId, setDeleteShiftId] = useState(null);

  // Post form
  const [pf, setPf] = useState({name:"",email:"",type:"guard",time:"early",date:"",note:"",isSwap:false,swapName:"",swapEmail:"",swapType:"guard",swapTime:"early",swapDate:"",hasPreferred:false,prefName:"",prefEmail:"",prefReason:""});
  const [pfEmailOk, setPfEmailOk] = useState(false);
  const [pfErr, setPfErr] = useState("");

  // Apply form
  const [aName, setAName] = useState("");
  const [aEmail, setAEmail] = useState("");
  const [aEmailOk, setAEmailOk] = useState(false);
  const [aHours, setAHours] = useState("");
  const [aNote, setANote] = useState("");
  const [aConfirmed, setAConfirmed] = useState(false);
  const [aIdentical, setAIdentical] = useState(false);
  const [aIdenticalIds, setAIdenticalIds] = useState([]);
  const [aSpecialIds, setASpecialIds] = useState([]);
  const [aErr, setAErr] = useState("");

  const showToast = m => { setToast(m); setTimeout(()=>setToast(null),3000); };
  const refetchRef = useRef(null);

  // ── Check LC auth on mount ────────────────────────────
  useEffect(() => {
    fetch("/api/auth/status").then(r=>r.json()).then(d=>setLcAuth(d.lcAuth)).catch(()=>{});
    fetch("/api/expire", { method: "POST" }).catch(()=>{});
  }, []);

  // ── Data fetching ─────────────────────────────────────
  const fetchData = useCallback(async () => {
    const from = (page - 1) * PS;
    let visibleShifts = [];
    let finalTotal = 0;

    // ── LC REVIEW: use dedicated RPC function ───────────
    if (view === "manager" && lcAuth && lcTab === "review") {
      const { data: rpcResult, error } = await sb.rpc("get_lc_review_shifts", {
        p_date: dateFilter || null,
        p_limit: PS,
        p_offset: from,
      });
      if (error) { console.error("LC review RPC error:", error); setLoading(false); return; }
      visibleShifts = rpcResult?.shifts || [];
      finalTotal = rpcResult?.total || 0;

    // ── CLOSED/HISTORY SHIFT-DATE SORT: future/today first, past dates last ──
    } else if ((view === "board" && boardTab === "closed" && historySort === "date") || (view === "manager" && lcAuth && lcTab === "history" && historySort === "date")) {
      const { data: rpcResult, error } = await sb.rpc("get_closed_shifts_by_shift_date", {
        p_date: dateFilter || null,
        p_limit: PS,
        p_offset: from,
      });
      if (error) { console.error("Closed/history date-sort RPC error:", error); setLoading(false); return; }
      visibleShifts = rpcResult?.shifts || [];
      finalTotal = rpcResult?.total || 0;

    // ── ALL OTHER VIEWS: direct Supabase queries ────────
    } else {
      let query = sb.from("shifts").select("*", { count: "exact" });

      if (view === "board") {
        if (boardTab === "open") {
          query = query.eq("status", "open");
          if (dateFilter) query = query.eq("date", dateFilter);
          query = query.order("date").order("time").order("posted_at");
        } else {
          query = query.in("status", ["taken", "expired"]);
          if (dateFilter) query = query.eq("date", dateFilter);
          if (historySort === "date") query = query.order("date").order("time");
          else query = query.order("approved_at", { ascending: false, nullsFirst: false }).order("expired_at", { ascending: false, nullsFirst: false });
        }
      } else if (view === "manager" && lcAuth) {
        if (lcTab === "todo") {
          query = query.eq("status", "taken").eq("todo_complete", todoTab === "done");
          if (dateFilter) query = query.eq("date", dateFilter);
          if (todoTab === "done") query = query.order("approved_at", { ascending: false });
          else query = query.order("date").order("time");
        } else {
          // history
          query = query.in("status", ["taken", "expired"]);
          if (dateFilter) query = query.eq("date", dateFilter);
          if (historySort === "date") query = query.order("date").order("time");
          else query = query.order("approved_at", { ascending: false, nullsFirst: false }).order("expired_at", { ascending: false, nullsFirst: false });
        }
      }

      query = query.range(from, from + PS - 1);
      const { data: shiftData, count, error } = await query;
      if (error) { console.error(error); setLoading(false); return; }
      visibleShifts = shiftData || [];
      finalTotal = count || 0;
    }

    setShifts(visibleShifts);
    setTotal(finalTotal);

    // Fetch applications for visible shifts
    const ids = visibleShifts.map(s => s.id);
    if (ids.length > 0) {
      const { data: appData } = await sb.from("applications").select("*").in("shift_id", ids).order("applied_at");
      setApps(appData || []);

      // For LC review: fetch cross-shift stats for unique applicant emails
      if (view === "manager" && lcTab === "review" && lcAuth) {
        const pendingEmails = [...new Set((appData||[]).filter(a=>a.status==="pending").map(a=>a.applicant_email))];
        if (pendingEmails.length > 0) {
          const { data: crossApps } = await sb
            .from("applications")
            .select("id, shift_id, applicant_email, status, hours_after_shift, approved_at, applied_at, shifts!inner(date, type, time)")
            .in("applicant_email", pendingEmails)
            .in("status", ["approved", "pending"]);
          setStatsApps(crossApps || []);
        } else {
          setStatsApps([]);
        }
      } else {
        setStatsApps([]);
      }
    } else {
      setApps([]);
      setStatsApps([]);
    }

    setLoading(false);
  }, [sb, view, boardTab, dateFilter, page, lcTab, todoTab, historySort, lcAuth]);

  // Fetch badge counts
  const fetchCounts = useCallback(async () => {
    const { count: oc } = await sb.from("shifts").select("id", { count: "exact", head: true }).eq("status", "open");
    setOpenCount(oc || 0);
    const { count: tc } = await sb.from("shifts").select("id", { count: "exact", head: true }).eq("status", "taken").eq("todo_complete", false);
    setTodoCount(tc || 0);
  }, [sb]);

  // Run fetch on mount and dependency changes
  useEffect(() => { fetchData(); fetchCounts(); }, [fetchData, fetchCounts]);

  // Store refetch for real-time
  useEffect(() => {
    refetchRef.current = async () => {
      await Promise.all([fetchData(), fetchCounts()]);
    };
  });

  // Reset page on filter/tab changes
  useEffect(() => { setPage(1); }, [dateFilter, view, boardTab, lcTab, todoTab, historySort]);

  // ── Real-time subscriptions ───────────────────────────
  useEffect(() => {
    const channel = sb.channel("lss-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "shifts" }, () => refetchRef.current?.())
      .on("postgres_changes", { event: "*", schema: "public", table: "applications" }, () => refetchRef.current?.())
      .subscribe();
    return () => { sb.removeChannel(channel); };
  }, [sb]);

  // Refetch on window focus
  useEffect(() => {
    const handler = () => { if (!document.hidden) refetchRef.current?.(); };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, []);

  // Polling fallback so the board still feels fresh if Supabase realtime is delayed or disabled.
  useEffect(() => {
    const ms = view === "manager" && lcTab === "review" ? 10000 : view === "board" && boardTab === "open" ? 20000 : 45000;
    const id = setInterval(() => { if (!document.hidden) refetchRef.current?.(); }, ms);
    return () => clearInterval(id);
  }, [view, lcTab, boardTab]);

  // ── Applicant stats from cross-shift data ─────────────
  const getStats = useCallback((email, shiftDate) => {
    const approvedAll = statsApps.filter(a => a.applicant_email === email && a.status === "approved");
    const approvedWeek = approvedAll.filter(a => a.shifts && inSameWeek(shiftDate, a.shifts.date));
    const pendingWeek = statsApps.filter(a => a.applicant_email === email && a.status === "pending" && a.shifts && inSameWeek(shiftDate, a.shifts.date));
    const priorApprovals = approvedWeek.map(a => ({
      date: a.shifts.date, type: a.shifts.type, time: a.shifts.time, hours: Number(a.hours_after_shift),
    }));
    return { approvedWeek: approvedWeek.length, approvedAll: approvedAll.length, pendingWeek: pendingWeek.length, priorApprovals };
  }, [statsApps]);

  // ── Helpers for identical shifts ──────────────────────
  const getIdenticalOpen = useCallback(async (shiftId) => {
    const base = shifts.find(s => s.id === shiftId);
    if (!base) return [];
    const { data } = await sb.from("shifts").select(`
      id, poster_name, poster_email, type, time, date,
      is_swap, swap_partner_name, swap_partner_email, swap_partner_type, swap_partner_time, swap_partner_date,
      has_preferred, preferred_name, preferred_email
    `).eq("status","open").eq("date",base.date).eq("type",base.type).eq("time",base.time).neq("id",shiftId);
    return data || [];
  }, [sb, shifts]);

  // ── Post shift ────────────────────────────────────────
  const openPostModal = () => { setPf({name:"",email:"",type:"guard",time:"early",date:"",note:"",isSwap:false,swapName:"",swapEmail:"",swapType:"guard",swapTime:"early",swapDate:"",hasPreferred:false,prefName:"",prefEmail:"",prefReason:""}); setPfEmailOk(false); setPfErr(""); setShowPostModal(true); };

  const validatePost = async () => {
    const e = pf.email.trim().toLowerCase();
    if (!pf.name.trim()||!e||!pf.date) { setPfErr("Fill in all fields."); return false; }
    if (!pfEmailOk) { setPfErr("Confirm that you used the correct email address."); return false; }
    if (pf.isSwap && pf.hasPreferred) { setPfErr("Choose either a swap request or a preferred applicant, not both."); return false; }
    if (pf.isSwap && (!pf.swapName.trim()||!pf.swapEmail.trim()||!pf.swapDate)) { setPfErr("Fill in all swap partner details."); return false; }
    if (pf.hasPreferred && (!pf.prefName.trim()||!pf.prefEmail.trim()||!pf.prefReason.trim())) { setPfErr("Fill in the preferred applicant name, email, and reason."); return false; }
    // Check duplicate
    const { count } = await sb.from("shifts").select("id",{count:"exact",head:true}).eq("status","open").eq("poster_email",e).eq("date",pf.date).eq("type",pf.type).eq("time",pf.time);
    if (count > 0) { setPfErr("This shift was already posted under this email. Please contact an LC if you think this is an issue."); return false; }
    setPfErr(""); return true;
  };

  const confirmPost = async () => {
    setActionLoading(true);
    try {
      const e = pf.email.trim().toLowerCase();
      const { error } = await sb.from("shifts").insert({
        poster_name: pf.name.trim(), poster_email: e, type: pf.type, time: pf.time, date: pf.date,
        private_lc_note: pf.note.trim(), is_swap: pf.isSwap,
        swap_partner_name: pf.isSwap?pf.swapName.trim():null, swap_partner_email: pf.isSwap?pf.swapEmail.trim().toLowerCase():null,
        swap_partner_type: pf.isSwap?pf.swapType:null, swap_partner_time: pf.isSwap?pf.swapTime:null, swap_partner_date: pf.isSwap?pf.swapDate:null,
        has_preferred: pf.hasPreferred, preferred_name: pf.hasPreferred?pf.prefName.trim():null,
        preferred_email: pf.hasPreferred?pf.prefEmail.trim().toLowerCase():null, preferred_reason: pf.hasPreferred?pf.prefReason.trim():null,
      });
      if (error) {
        console.error("post shift error", error);
        showToast(error.message?.includes("idx_unique_open_shift") ? "This shift was already posted." : `Error posting shift: ${error.message || "unknown"}`);
        return;
      }
      setPostConfirmOpen(false); setShowPostModal(false); setPage(1);
      await refetchRef.current?.();
      showToast("Shift posted");
    } finally {
      setActionLoading(false);
    }
  };

  // ── Apply ─────────────────────────────────────────────
  const [identicalShifts, setIdenticalShifts] = useState([]);

  const openApplyModal = async (id) => {
    setAName(""); setAEmail(""); setAEmailOk(false); setAHours(""); setANote(""); setAConfirmed(false); setAIdentical(false); setAIdenticalIds([]); setASpecialIds([]); setAErr(""); setShowApplyModal(id);
    const ident = await getIdenticalOpen(id);
    setIdenticalShifts(ident);
  };

  const confirmApply = async () => {
    if (!pendingApply) return;
    setActionLoading(true);
    try {
      const rows = pendingApply.shiftIds.map(id => ({
        shift_id: id, applicant_name: pendingApply.name, applicant_email: pendingApply.email,
        hours_after_shift: pendingApply.hours, applicant_note: pendingApply.note,
      }));
      const { error } = await sb.from("applications").insert(rows);
      if (error) {
        console.error("apply error", error);
        showToast(error.message?.includes("idx_unique_pending_app") ? "You already applied." : `Error submitting: ${error.message || "unknown"}`);
        setPendingApply(null);
        return;
      }
      setPendingApply(null); setShowApplyModal(null); setPage(1);
      await refetchRef.current?.();
      showToast(rows.length === 1 ? "Application submitted" : `Applications submitted to ${rows.length} shifts`);
    } finally {
      setActionLoading(false);
    }
  };

  // ── Approve (LC only, via API) ────────────────────────
  const confirmApproval = async () => {
    if (!pendingApproval) return;
    setActionLoading(true);
    try {
      const res = await fetch("/api/approve", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ shiftId: pendingApproval.shiftId, appId: pendingApproval.appId }) });
      const data = await res.json().catch(() => ({ success: false, error: "Server returned an invalid response." }));
      if (!res.ok || !data.success) {
        console.error("approval failed", res.status, data);
        showToast(data.error || "Approval failed. Please refresh.");
        setPendingApproval(null);
        return;
      }
      setPendingApproval(null); setPage(1);
      await refetchRef.current?.();
      showToast(data.emailStatus === "not_configured" ? `Approved ${data.approved_name}. Email notifications not configured yet.` : `Approved ${data.approved_name}`);
    } catch (err) {
      console.error("approval request error", err);
      showToast("Approval failed. Please refresh.");
      setPendingApproval(null);
    } finally {
      setActionLoading(false);
    }
  };

  // ── Delete (LC only, via API) ─────────────────────────
  const confirmDelete = async () => {
    if (!deleteShiftId) return;
    setActionLoading(true);
    try {
      const res = await fetch("/api/delete-shift", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ shiftId: deleteShiftId }) });
      const data = await res.json().catch(() => ({ success: false, error: "Server returned an invalid response." }));
      if (!res.ok || !data.success) { showToast(data.error || "Delete failed."); setDeleteShiftId(null); return; }
      setDeleteShiftId(null); setPage(1);
      await refetchRef.current?.();
      showToast("Open shift deleted");
    } finally {
      setActionLoading(false);
    }
  };

  // ── Mark done (LC only, via API) ──────────────────────
  const markDone = async (id) => {
    setActionLoading(true);
    try {
      const res = await fetch("/api/mark-done", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ shiftId: id }) });
      const data = await res.json().catch(() => ({ success: false, error: "Server returned an invalid response." }));
      if (!res.ok || !data.success) { showToast(data.error || "Could not mark done."); return; }
      await refetchRef.current?.();
      showToast("Marked as done");
    } finally {
      setActionLoading(false);
    }
  };

  // ── LC login ──────────────────────────────────────────
  const doLcLogin = async () => {
    const res = await fetch("/api/auth/lc", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ password: pwInput }) });
    if (res.ok) { setLcAuth(true); setPwError(false); } else setPwError(true);
  };

  const doLcLogout = async () => {
    await fetch("/api/auth/lc/logout", { method: "POST" });
    setLcAuth(false); setView("board"); setPwInput(""); setPwError(false);
  };

  // ── Derived data from current page ────────────────────
  const pendingAppsFor = id => apps.filter(a => a.shift_id === id && a.status === "pending");
  const allAppsFor = id => apps.filter(a => a.shift_id === id);
  const pages = Math.max(1, Math.ceil(total / PS));

  const ShiftCard = ({ shift, lcReview = false, lcMode = false }) => {
    const pending = pendingAppsFor(shift.id);
    const allA = allAppsFor(shift.id);
    const isTaken = shift.status === "taken";
    const isExpired = shift.status === "expired";
    const closed = isTaken || isExpired;
    const swapApplied = shift.is_swap && pending.some(a => a.applicant_email === shift.swap_partner_email);
    const prefApplied = shift.has_preferred && pending.some(a => a.applicant_email === shift.preferred_email);
    const c = tc(shift.type);

    return (
      <div style={{ background: "#fff", borderRadius: 18, border: "0.5px solid #e0e3e8", borderLeft: `4px solid ${c.border}`, padding: "1rem 1.25rem", marginBottom: 12, opacity: closed ? 0.75 : 1, boxShadow: "0 8px 24px rgba(15,23,42,0.04)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
          <div>
            <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
              <span style={B(c.bg,c.text)}>{shift.type}</span>
              <span style={B("#f6f7f9","#5e6675")}>{shift.time}</span>
              {shift.is_swap && <span style={B("#E6F1FB","#0C447C")}>swap</span>}
              {(lcReview || lcMode) && shift.has_preferred && <span style={B("#FFF2B8","#8A5A00")}>preferred listed</span>}
              {isTaken && <span style={B("#EAF3DE","#27500A")}>taken</span>}
              {isExpired && <span style={B("#EFEFF2","#555B66")}>expired</span>}
            </div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{fmtDate(shift.date)}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 13, color: "#5e6675" }}>posted by</div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{shift.poster_name}</div>
            <div style={{ fontSize: 11, color: "#8a92a0" }}>{timeAgo(shift.posted_at)}</div>
          </div>
        </div>

        {/* Public swap display */}
        {shift.is_swap && !lcReview && !closed && <InfoBlock badge="swap requested">Swap is requested, not guaranteed. Others are still welcome to apply.</InfoBlock>}
        {/* LC swap display */}
        {shift.is_swap && (lcReview || lcMode) && <InfoBlock badge="swap">{shift.poster_name} gives up {shift.type} {shift.time} on {fmtDate(shift.date)}.<br/>{shift.swap_partner_name} gives up {shift.swap_partner_type} {shift.swap_partner_time} on {fmtDate(shift.swap_partner_date)}.</InfoBlock>}
        {/* LC preferred display */}
        {(lcReview || lcMode) && shift.has_preferred && <InfoBlock badge="preferred applicant" gold><b>{shift.preferred_name}</b> was listed as preferred. Reason: {shift.preferred_reason}</InfoBlock>}
        {/* LC note */}
        {(lcReview || lcMode) && shift.private_lc_note && <InfoBlock badge="private LC note">{shift.private_lc_note}</InfoBlock>}

        {!closed && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8, gap: 12 }}>
            <span style={{ fontSize: 13, color: "#5e6675" }}>
              {pending.length} applicant{pending.length!==1?"s":""}
              {swapApplied && <span style={{ color: "#0C447C", fontWeight: 700 }}> — requested swap partner applied</span>}
              {(lcReview || lcMode) && prefApplied && <span style={{ color: "#8A5A00", fontWeight: 700 }}> — preferred applicant applied</span>}
            </span>
            {!lcReview && <button onClick={() => openApplyModal(shift.id)} style={btn2}>Apply</button>}
          </div>
        )}

        {isTaken && <div style={{ fontSize: 13, color: "#5e6675", marginTop: 8 }}>Picked up by <b style={{ color: "#172033" }}>{shift.taken_by_name}</b></div>}
        {isExpired && <div style={{ fontSize: 13, color: "#5e6675", marginTop: 8 }}><b style={{ color: "#172033" }}>Expired</b>, no sub was picked up.</div>}

        {/* LC delete button */}
        {(lcReview || lcMode) && !closed && <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}><button onClick={() => setDeleteShiftId(shift.id)} style={{ ...btn2, border: "0.5px solid #D6A4A4", background: "#FFF6F6", color: "#8A1F1F" }}>Delete open shift</button></div>}

        {/* LC applicant rows */}
        {lcReview && pending.length > 0 && (
          <div style={{ marginTop: 12, borderTop: "0.5px solid #e0e3e8", paddingTop: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#5e6675", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.5px" }}>Applicants</div>
            {pending.map(app => {
              const st = getStats(app.applicant_email, shift.date);
              const isSP = shift.is_swap && app.applicant_email === shift.swap_partner_email;
              const isPref = shift.has_preferred && app.applicant_email === shift.preferred_email;
              const isOt = Number(app.hours_after_shift) > 40;
              return (
                <div key={app.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "8px 12px", borderRadius: 12, background: "#f6f7f9", marginBottom: 6, fontSize: 13, border: isSP?"1.5px solid #85B7EB":isPref?"1.5px solid #D9B451":"0.5px solid transparent" }}>
                  <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                    <b>{app.applicant_name}</b>
                    <span style={{ fontSize: 11, color: "#8a92a0" }}>{st.approvedWeek} approved this week, {st.approvedAll} all time, {Math.max(0, st.pendingWeek - 1)} other app{Math.max(0, st.pendingWeek - 1) === 1 ? "" : "s"} still pending this week</span>
                    {isSP && <span style={B("#E6F1FB","#0C447C")}>swap partner</span>}
                    {isPref && <span style={B("#FFF2B8","#8A5A00")}>preferred</span>}
                    <span style={B(isOt?"#FCEBEB":"#EAF3DE", isOt?"#791F1F":"#27500A")}>{app.hours_after_shift} hrs{isOt?" · OT":""}</span>
                    {app.applicant_note && <span style={{ width: "100%", fontSize: 11, color: "#5e6675", marginTop: 4 }}>Applicant note: {app.applicant_note}</span>}
                    {st.priorApprovals.length > 0 && <span style={{ width: "100%", fontSize: 11, color: "#8A5A00", marginTop: 4 }}>Already approved for {st.priorApprovals.length} shift{st.priorApprovals.length===1?"":"s"} this week: {st.priorApprovals.map(p => `${fmtDate(p.date)} ${p.type} ${p.time} (${p.hours} hrs reported)`).join("; ")}.</span>}
                  </div>
                  <button onClick={() => setPendingApproval({ shiftId: shift.id, appId: app.id })} style={{ ...btnP, background: "#1D9E75", padding: "6px 14px", fontSize: 12, flexShrink: 0 }}>Approve</button>
                </div>
              );
            })}
          </div>
        )}

        {/* History resolution */}
        {lcReview && isTaken && allA.length > 0 && (
          <div style={{ marginTop: 12, borderTop: "0.5px solid #e0e3e8", paddingTop: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#5e6675", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.5px" }}>Resolution</div>
            {allA.map(a => <div key={a.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", borderRadius: 12, background: "#f6f7f9", marginBottom: 6, opacity: a.status==="declined"?0.5:1 }}><b>{a.applicant_name}</b><span style={{ fontSize: 12, fontWeight: 700, color: a.status==="approved"?"#1D9E75":"#A32D2D" }}>{a.status}</span></div>)}
          </div>
        )}
      </div>
    );
  };

  const TodoRow = ({ shift, done = false }) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderRadius: 18, border: "0.5px solid #e0e3e8", background: "#fff", marginBottom: 8, opacity: done ? 0.6 : 1 }}>
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", gap: 6, marginBottom: 4, flexWrap: "wrap" }}>
          <span style={B(tc(shift.type).bg, tc(shift.type).text)}>{shift.type}</span>
          <span style={B("#f6f7f9","#5e6675")}>{shift.time}</span>
          {shift.is_swap && <span style={B("#E6F1FB","#0C447C")}>swap</span>}
          {done && <span style={B("#EAF3DE","#27500A")}>done</span>}
        </div>
        <div style={{ fontSize: 14, fontWeight: 700 }}>{fmtDate(shift.date)}</div>
        <div style={{ fontSize: 13, color: "#5e6675" }}>{shift.poster_name} → {shift.taken_by_name}</div>
        {shift.is_swap && shift.taken_by_email === shift.swap_partner_email && (
          <div style={{ fontSize: 12, color: "#5e6675", marginTop: 4, lineHeight: 1.6 }}>
            <b>{shift.poster_name}</b> gives up {shift.type} {shift.time} ({fmtDate(shift.date)})<br/>
            <b>{shift.taken_by_name}</b> gives up {shift.swap_partner_type} {shift.swap_partner_time} ({fmtDate(shift.swap_partner_date)})
          </div>
        )}
        {shift.is_swap && shift.taken_by_email !== shift.swap_partner_email && (
          <div style={{ fontSize: 12, color: "#5e6675", marginTop: 4 }}>Swap was requested with <b>{shift.swap_partner_name}</b>, but <b>{shift.taken_by_name}</b> picked up the shift. No reciprocal shift to update.</div>
        )}
      </div>
      {!done && <button onClick={() => markDone(shift.id)} style={btn2}>Mark done</button>}
    </div>
  );


  const renderDateFilter = () => (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 180px" }}>
          <label style={{ fontSize: 12, fontWeight: 700, color: "#5e6675", display: "block", marginBottom: 4 }}>Filter by date</label>
          <input
            style={F}
            type="date"
            value={dateFilter}
            onChange={e => { setDateFilter(e.target.value); setPage(1); }}
          />
        </div>
        {dateFilter && (
          <button onClick={() => { setDateFilter(""); setPage(1); }} style={btn2}>Clear date</button>
        )}
      </div>
    </div>
  );

  const renderPagination = () => {
    if (total <= PS) return null;
    const start = (page - 1) * PS + 1;
    const end = Math.min(page * PS, total);
    return (
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", fontSize: 12, color: "#5e6675", margin: "0 0 16px" }}>
        <span>Showing {start}–{end} of {total}</span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button disabled={page === 1} onClick={() => setPage(p => Math.max(1, p - 1))} style={{ ...btn2, opacity: page === 1 ? 0.45 : 1, padding: "6px 12px" }}>Previous</button>
          <span>Page {page} of {pages}</span>
          <button disabled={page === pages} onClick={() => setPage(p => Math.min(pages, p + 1))} style={{ ...btn2, opacity: page === pages ? 0.45 : 1, padding: "6px 12px" }}>Next</button>
        </div>
      </div>
    );
  };

  // ── Sub-components ────────────────────────────────────
  // Stable UI components are defined outside ShiftBoard to avoid remounting text inputs.

  // ── Loading ───────────────────────────────────────────
  if (loading) return (
    <div style={{ fontFamily: "Inter,ui-sans-serif,system-ui,sans-serif", maxWidth: 720, margin: "0 auto", padding: "4rem 1rem", textAlign: "center" }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Lakefront Shift Swap</h1>
      <p style={{ color: "#5e6675" }}>Loading...</p>
    </div>
  );

  // ── Main render ───────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(180deg,#f7f8fb 0%,#fff 28%)", paddingTop: 4 }}>
    <div style={{ fontFamily: "Inter,ui-sans-serif,system-ui,-apple-system,sans-serif", maxWidth: 720, margin: "0 auto", padding: "0 1rem 3rem", color: "#172033" }}>
      <header style={{ padding: "1.5rem 0 1rem", borderBottom: "2px solid #1a2744" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 4 }}>
          <p style={{ fontSize: 12, color: "#5e6675", margin: 0, letterSpacing: "1px", textTransform: "uppercase" }}>City of Evanston Fire Department</p>
          {!lcAuth ? <button onClick={() => setView("manager")} style={{ fontSize: 12, color: "#8a92a0", background: "none", border: "none", cursor: "pointer", letterSpacing: "0.8px", textTransform: "uppercase" }}>LC</button>
            : <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#0C447C", background: "#E6F1FB", padding: "4px 10px", borderRadius: 999 }}>LC mode active</span>
                <button onClick={doLcLogout} style={{ fontSize: 11, color: "#8a92a0", background: "none", border: "none", cursor: "pointer", textTransform: "uppercase" }}>Log out</button>
              </div>}
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "-0.3px" }}>Lakefront Shift Swap</h1>
      </header>

      <nav style={{ display: "flex", gap: 0, borderBottom: "0.5px solid #e0e3e8", marginBottom: "1rem", alignItems: "center" }}>
        <button style={tabS(view==="board")} onClick={() => setView("board")}>Shift board</button>
        {lcAuth && <button style={tabS(view==="manager")} onClick={() => setView("manager")}>LC view</button>}
        <div style={{ flex: 1 }} />
        <button onClick={openPostModal} style={{ ...btnP, margin: "6px 0" }}>Post a shift</button>
      </nav>

      {/* ── SHIFT BOARD ──────────────────────────────── */}
      {view === "board" && <>
        <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
          <button style={pillS(boardTab==="open")} onClick={() => setBoardTab("open")}>Open shifts ({openCount})</button>
          <button style={pillS(boardTab==="closed")} onClick={() => setBoardTab("closed")}>Recently taken / expired</button>
        </div>
        {boardTab === "closed" && (
          <div style={{ display: "flex", gap: 8, marginBottom: 16, alignItems: "center" }}>
            <span style={{ fontSize: 13, color: "#5e6675", fontWeight: 700 }}>Sort by</span>
            <button style={pillS(historySort==="action")} onClick={() => setHistorySort("action")}>Most recent LC action</button>
            <button style={pillS(historySort==="date")} onClick={() => setHistorySort("date")}>Shift date</button>
          </div>
        )}
        {renderDateFilter()}
        {renderPagination()}
        {shifts.length === 0 ? <Empty>{boardTab==="open"?"No open shifts right now.":"No recently taken or expired shifts yet."}</Empty>
          : shifts.map(s => <ShiftCard key={s.id} shift={s} lcMode={lcAuth} />)}
        {renderPagination()}
      </>}

      {/* ── LC LOGIN ─────────────────────────────────── */}
      {view === "manager" && !lcAuth && (
        <div style={{ maxWidth: 320, margin: "3rem auto", textAlign: "center", background: "#fff", padding: 24, borderRadius: 18, border: "0.5px solid #e0e3e8", boxShadow: "0 12px 32px rgba(15,23,42,0.06)" }}>
          <h2 style={{ fontSize: 18, margin: "0 0 8px" }}>LC</h2>
          <p style={{ fontSize: 13, color: "#5e6675", marginBottom: 20 }}>Enter password.</p>
          <input type="password" placeholder="Password" value={pwInput} onChange={e => { setPwInput(e.target.value); setPwError(false); }} onKeyDown={e => { if (e.key === "Enter") doLcLogin(); }} style={{ ...F, marginBottom: 12, textAlign: "center" }} />
          {pwError && <p style={{ fontSize: 13, color: "#A32D2D", marginBottom: 12 }}>Good try, but wrong.</p>}
          <button onClick={doLcLogin} style={btnP}>Enter</button>
        </div>
      )}

      {/* ── LC VIEW ──────────────────────────────────── */}
      {view === "manager" && lcAuth && <>
        <div style={{ display: "flex", borderBottom: "0.5px solid #e0e3e8", marginBottom: 20 }}>
          <button style={tabS(lcTab==="review")} onClick={() => setLcTab("review")}>Open shift review</button>
          <button style={tabS(lcTab==="todo")} onClick={() => setLcTab("todo")}>To-do ({todoCount})</button>
          <button style={tabS(lcTab==="history")} onClick={() => setLcTab("history")}>History</button>
        </div>

        {lcTab === "review" && <>
          {renderDateFilter()}{renderPagination()}
          {shifts.length === 0 ? <Empty>No applications to review right now.</Empty>
            : shifts.map(s => <ShiftCard key={s.id} shift={s} lcReview />)}
          {renderPagination()}
        </>}

        {lcTab === "todo" && <>
          <p style={{ fontSize: 13, color: "#5e6675", margin: "0 0 16px" }}>Update these in Target Solutions, then mark as done.</p>
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <button style={pillS(todoTab==="pending")} onClick={() => setTodoTab("pending")}>Needs update ({todoCount})</button>
            <button style={pillS(todoTab==="done")} onClick={() => setTodoTab("done")}>Completed</button>
          </div>
          {renderDateFilter()}{renderPagination()}
          {shifts.length === 0 ? <Empty>{todoTab==="pending"?"All caught up.":"Nothing completed yet."}</Empty>
            : shifts.map(s => <TodoRow key={s.id} shift={s} done={todoTab==="done"} />)}
          {renderPagination()}
        </>}

        {lcTab === "history" && <>
          <div style={{ display: "flex", gap: 8, marginBottom: 16, alignItems: "center" }}>
            <span style={{ fontSize: 13, color: "#5e6675", fontWeight: 700 }}>Sort by</span>
            <button style={pillS(historySort==="action")} onClick={() => setHistorySort("action")}>Most recent LC action</button>
            <button style={pillS(historySort==="date")} onClick={() => setHistorySort("date")}>Shift date</button>
          </div>
          {renderDateFilter()}{renderPagination()}
          {shifts.length === 0 ? <Empty>No history yet.</Empty>
            : shifts.map(s => <ShiftCard key={s.id} shift={s} lcReview />)}
          {renderPagination()}
        </>}
      </>}

      {/* ── POST MODAL ───────────────────────────────── */}
      {showPostModal && <Modal onClose={() => setShowPostModal(false)}>
        <h2 style={{ fontSize: 18, margin: "0 0 20px" }}>Post a shift</h2>
        <LabeledInput label="Your name (first and last)" value={pf.name} onChange={v => setPf(p=>({...p,name:v}))} placeholder="Albert Einstein" />
        <LabeledInput label="Your email" hint="use the same email every time" type="email" value={pf.email} onChange={v => { setPf(p=>({...p,email:v})); setPfEmailOk(false); }} placeholder="aeinstein@cityofevanston.org" />
        <CheckBox checked={pfEmailOk} onChange={setPfEmailOk}>I confirm this is the correct email address and that I will use this same email for future posts/applications.</CheckBox>
        <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 13, fontWeight: 700, color: "#5e6675", display: "block", marginBottom: 4 }}>Shift type</label>
            <select style={F} value={pf.type} onChange={e => setPf(p=>({...p,type:e.target.value}))}><option value="guard">Guard</option><option value="manager">Manager</option></select>
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 13, fontWeight: 700, color: "#5e6675", display: "block", marginBottom: 4 }}>Time</label>
            <select style={F} value={pf.time} onChange={e => setPf(p=>({...p,time:e.target.value}))}><option value="early">Early</option><option value="late">Late</option></select>
          </div>
        </div>
        <LabeledInput label="Date" type="date" value={pf.date} onChange={v => setPf(p=>({...p,date:v}))} />
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 13, fontWeight: 700, color: "#5e6675", display: "block", marginBottom: 4 }}>Private note for LCs, optional</label>
          <textarea style={{ ...F, minHeight: 60, resize: "vertical" }} value={pf.note} onChange={e => setPf(p=>({...p,note:e.target.value}))} placeholder="Example: May go over time if this is not picked up. Not shown publicly." />
        </div>

        {/* Preferred applicant */}
        <CheckBox checked={pf.hasPreferred} onChange={v => setPf(p=>({...p,hasPreferred:v,isSwap:v?false:p.isSwap}))}>Do you have a preferred applicant for this shift?</CheckBox>
        {pf.hasPreferred && <div style={{ padding: 16, border: "0.5px solid #D9B451", borderRadius: 12, background: "#FFF9E8", marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#8A5A00", marginBottom: 12 }}>Preferred applicant details</div>
          <LabeledInput label="Their name" value={pf.prefName} onChange={v => setPf(p=>({...p,prefName:v}))} placeholder="Albert Einstein" />
          <LabeledInput label="Their email" type="email" value={pf.prefEmail} onChange={v => setPf(p=>({...p,prefEmail:v}))} placeholder="aeinstein@cityofevanston.org" />
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 13, fontWeight: 700, color: "#5e6675", display: "block", marginBottom: 4 }}>Reason (required)</label>
            <textarea style={{ ...F, minHeight: 60, resize: "vertical" }} value={pf.prefReason} onChange={e => setPf(p=>({...p,prefReason:e.target.value}))} placeholder='Example: I paid him $50 to take my shift.' />
          </div>
          <div style={{ fontSize: 12, color: "#8A5A00", lineHeight: 1.5 }}>This is absolutely not guaranteed, even if there was a financial transaction involved. LCs can still approve another applicant.</div>
        </div>}

        {/* Swap */}
        <CheckBox checked={pf.isSwap} onChange={v => setPf(p=>({...p,isSwap:v,hasPreferred:v?false:p.hasPreferred}))}>I want to swap this shift for someone else's</CheckBox>
        {pf.isSwap && <div style={{ fontSize: 12, color: "#5e6675", margin: "-8px 0 16px 12px", lineHeight: 1.5 }}>This is not guaranteed. LCs can approve the requested swap partner or choose another applicant to simply pick up the shift. If you want the swap to even be considered, tell your swap partner to apply using the same email you enter for them below.</div>}
        {pf.isSwap && <div style={{ padding: 16, border: "0.5px solid #85B7EB", borderRadius: 12, background: "#f6f7f9", marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#0C447C", marginBottom: 12 }}>Swap partner details</div>
          <LabeledInput label="Their name" value={pf.swapName} onChange={v => setPf(p=>({...p,swapName:v}))} placeholder="Albert Einstein" />
          <LabeledInput label="Their email" type="email" value={pf.swapEmail} onChange={v => setPf(p=>({...p,swapEmail:v}))} placeholder="aeinstein@cityofevanston.org" />
          <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 13, fontWeight: 700, color: "#5e6675", display: "block", marginBottom: 4 }}>Their shift type</label>
              <select style={F} value={pf.swapType} onChange={e => setPf(p=>({...p,swapType:e.target.value}))}><option value="guard">Guard</option><option value="manager">Manager</option></select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 13, fontWeight: 700, color: "#5e6675", display: "block", marginBottom: 4 }}>Their time</label>
              <select style={F} value={pf.swapTime} onChange={e => setPf(p=>({...p,swapTime:e.target.value}))}><option value="early">Early</option><option value="late">Late</option></select>
            </div>
          </div>
          <LabeledInput label="Their shift date" type="date" value={pf.swapDate} onChange={v => setPf(p=>({...p,swapDate:v}))} />
        </div>}

        {pfErr && <p style={{ fontSize: 13, color: "#A32D2D", marginBottom: 12 }}>{pfErr}</p>}
        <ModalActions disabled={actionLoading} onCancel={() => setShowPostModal(false)} onConfirm={async () => { if (await validatePost()) setPostConfirmOpen(true); }} text="Review post" />
      </Modal>}

      {/* Post confirmation */}
      {postConfirmOpen && <Modal onClose={() => setPostConfirmOpen(false)} z={140}>
        <h2 style={{ fontSize: 18, margin: "0 0 8px" }}>Confirm shift post</h2>
        <p style={{ fontSize: 14, color: "#5e6675", margin: "0 0 16px" }}>Review this before it goes on the public board.</p>
        <SummaryBox rows={[["Name",pf.name],["Email",pf.email],["Shift",`${pf.date?fmtDate(pf.date):""} ${pf.type} ${pf.time}`],["Swap",pf.isSwap?`Yes, with ${pf.swapName}`:"No"],["Preferred",pf.hasPreferred?`Yes: ${pf.prefName}`:"No"],pf.hasPreferred?["Reason",pf.prefReason]:null,["LC note",pf.note||"None"]].filter(Boolean)} />
        <ModalActions disabled={actionLoading} onCancel={() => setPostConfirmOpen(false)} onConfirm={confirmPost} text="Post shift" />
      </Modal>}

      {/* ── APPLY MODAL ──────────────────────────────── */}
      {showApplyModal && (() => {
        const shift = shifts.find(s => s.id === showApplyModal);
        if (!shift) return null;
        const c = tc(shift.type);
        const email = aEmail.trim().toLowerCase();

        // Find special matches across all target shifts
        const allTargetIds = [showApplyModal, ...(aIdentical ? aIdenticalIds : [])];
        const getSpecial = (s) => {
          if (!s) return null;
          if (s.is_swap && s.swap_partner_email === email) return "swap";
          if (s.has_preferred && s.preferred_email === email) return "preferred";
          return null;
        };

        const doValidate = () => {
          const hrs = Number(aHours);
          if (!aName.trim()||!email) { setAErr("Fill in your name and email."); return; }
          if (!aEmailOk) { setAErr("Confirm that you used the correct email address."); return; }
          if (aHours===""||isNaN(hrs)||hrs<0) { setAErr("Enter a valid number of weekly hours."); return; }
          if (!aConfirmed) { setAErr("You must confirm you're not already scheduled during this shift."); return; }
          if (shift.poster_email === email) { setAErr("You can't apply for your own shift."); return; }

          const getTargetShift = (id) => id === showApplyModal ? shift : identicalShifts.find(x => x.id === id);
          const validIds = allTargetIds.filter(id => {
            const s = getTargetShift(id);
            return s && s.poster_email !== email;
          });

          // Check special verifications across every selected target shift, including identical shifts
          const specialNeeded = validIds.filter(id => !!getSpecial(getTargetShift(id)));
          const missing = specialNeeded.filter(id => !aSpecialIds.includes(id));
          if (missing.length > 0) { setAErr("Confirm all special swap/preferred-applicant details before applying. If any are incorrect, contact an LC."); return; }

          setAErr("");
          setPendingApply({ shiftIds: validIds, name: aName.trim(), email, hours: hrs, note: aNote.trim() });
        };

        return <Modal onClose={() => setShowApplyModal(null)}>
          <h2 style={{ fontSize: 18, margin: "0 0 4px" }}>Apply for shift</h2>
          <div style={{ fontSize: 13, color: "#5e6675", marginBottom: 20, display: "flex", gap: 6, flexWrap: "wrap" }}>
            <span style={B(c.bg,c.text)}>{shift.type}</span>
            <span style={B("#f6f7f9","#5e6675")}>{shift.time}</span>
            <span>{fmtDate(shift.date)} — posted by {shift.poster_name}</span>
          </div>
          <LabeledInput label="Your name (first and last)" value={aName} onChange={setAName} placeholder="Albert Einstein" />
          <LabeledInput label="Your email" hint="use the same email every time" type="email" value={aEmail} onChange={v => { setAEmail(v); setAEmailOk(false); setASpecialIds([]); }} placeholder="aeinstein@cityofevanston.org" />
          <CheckBox checked={aEmailOk} onChange={setAEmailOk}>I confirm this is the correct email address and that I will use this same email every time.</CheckBox>
          <LabeledInput label="If you were to get this shift, how many total hours would this bring you to for this week?" type="number" value={aHours} onChange={setAHours} placeholder="Example: 32" />
          <div style={{ fontSize: 12, color: "#8a92a0", margin: "-8px 0 16px" }}>Use the Monday–Sunday work week. Enter the total you would be at as of right now with this single shift included. Do not include any other pending shift applications unless they have already been approved. Anything over 40 will be flagged as OT for LCs.</div>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 13, fontWeight: 700, color: "#5e6675", display: "block", marginBottom: 4 }}>Note for LCs, optional</label>
            <textarea style={{ ...F, minHeight: 50, resize: "vertical" }} value={aNote} onChange={e => setANote(e.target.value)} placeholder="Example: I'm leaving for three weeks and won't be able to work afterward." />
          </div>

          {/* Identical shifts */}
          {identicalShifts.length > 0 && <CheckBox checked={aIdentical} onChange={v => { setAIdentical(v); if (!v) setAIdenticalIds([]); }}>Would you also like to apply to identical shifts on this date?</CheckBox>}
          {aIdentical && identicalShifts.length > 0 && <div style={{ padding: "0 12px 12px", marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: "#5e6675", marginBottom: 8 }}>Same date, type, and time. Your same application will be submitted to each.</div>
            {identicalShifts.map(s => <label key={s.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, padding: "6px 0", cursor: "pointer" }}>
              <input type="checkbox" checked={aIdenticalIds.includes(s.id)} onChange={e => {
                setAIdenticalIds(prev => e.target.checked ? [...prev, s.id] : prev.filter(x => x !== s.id));
                if (!e.target.checked) setASpecialIds(prev => prev.filter(x => x !== s.id));
              }} />
              {fmtDate(shift.date)} {shift.type} {shift.time} — posted by {s.poster_name}
            </label>)}
          </div>}

          {/* Special verification for primary and selected identical shifts */}
          {email && allTargetIds
            .map(id => id === showApplyModal ? shift : identicalShifts.find(x => x.id === id))
            .filter(Boolean)
            .filter(s => !!getSpecial(s))
            .map(s => {
              const special = getSpecial(s);
              const isSwap = special === "swap";
              return <div key={s.id} style={{ padding: 12, borderRadius: 12, border: `0.5px solid ${isSwap ? "#85B7EB" : "#D9B451"}`, background: isSwap ? "#E6F1FB" : "#FFF9E8", marginBottom: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: isSwap ? "#0C447C" : "#8A5A00", marginBottom: 8 }}>{isSwap ? "Swap verification" : "Preferred applicant verification"}</div>
                {isSwap ? (
                  <div style={{ fontSize: 13, color: "#5e6675", lineHeight: 1.5 }}>For <b>{s.poster_name}</b>'s {s.type} {s.time} shift on {fmtDate(s.date)}: you would take their shift, and they would take your {s.swap_partner_type} {s.swap_partner_time} shift on {fmtDate(s.swap_partner_date)}.</div>
                ) : (
                  <div style={{ fontSize: 13, color: "#5e6675", lineHeight: 1.5 }}>For <b>{s.poster_name}</b>'s {s.type} {s.time} shift on {fmtDate(s.date)}: you were listed as the preferred applicant, but approval is not guaranteed, even if money or another arrangement was involved.</div>
                )}
                <CheckBox checked={aSpecialIds.includes(s.id)} onChange={v => setASpecialIds(prev => v ? [...new Set([...prev, s.id])] : prev.filter(x => x !== s.id))}>{isSwap ? "I confirm this swap information is correct." : "I confirm I understand I was listed as preferred, but approval is not guaranteed."}</CheckBox>
                {!aSpecialIds.includes(s.id) && <div style={{ marginTop: -8, marginBottom: 12, fontSize: 12, color: "#8A1F1F" }}>If this is not correct, do not apply. Contact an LC.</div>}
              </div>;
            })}

          <CheckBox checked={aConfirmed} onChange={setAConfirmed}>I confirm I am not already scheduled during this shift and can work it if selected.</CheckBox>
          {aErr && <p style={{ fontSize: 13, color: "#A32D2D", marginBottom: 12 }}>{aErr}</p>}
          <ModalActions disabled={actionLoading} onCancel={() => setShowApplyModal(null)} onConfirm={doValidate} text="Review application" />
        </Modal>;
      })()}

      {/* Apply confirmation */}
      {pendingApply && <Modal onClose={() => setPendingApply(null)} z={140}>
        <h2 style={{ fontSize: 18, margin: "0 0 8px" }}>Confirm application</h2>
        <p style={{ fontSize: 14, color: "#5e6675", margin: "0 0 16px" }}>Make sure this is right before submitting.</p>
        <SummaryBox rows={[["Name",pendingApply.name],["Email",pendingApply.email],["Weekly hours",`${pendingApply.hours}${pendingApply.hours>40?" · OT":""}`],["Note",pendingApply.note||"None"],["Applying to",pendingApply.shiftIds.length+" shift"+(pendingApply.shiftIds.length>1?"s":"")]]} />
        <ModalActions disabled={actionLoading} onCancel={() => setPendingApply(null)} onConfirm={confirmApply} text="Submit application" />
      </Modal>}

      {/* ── APPROVAL CONFIRMATION ─────────────────────── */}
      {pendingApproval && (() => {
        const app = apps.find(a => a.id === pendingApproval.appId);
        const shift = shifts.find(s => s.id === pendingApproval.shiftId);
        if (!app || !shift) return null;
        const st = getStats(app.applicant_email, shift.date);
        const isOt = Number(app.hours_after_shift) > 40;
        return <Modal onClose={() => setPendingApproval(null)} z={145}>
          <h2 style={{ fontSize: 18, margin: "0 0 8px", color: isOt ? "#8A1F1F" : "#172033" }}>Confirm approval</h2>
          <p style={{ fontSize: 14, color: "#5e6675", margin: "0 0 16px", lineHeight: 1.5 }}>This will approve the applicant, close this shift, decline other applicants, and remove this applicant from other pending applications on the same day.</p>
          {isOt && <div style={{ borderRadius: 12, padding: "10px 12px", marginBottom: 12, fontSize: 13, background: "#FFF6F6", border: "0.5px solid #D6A4A4", color: "#8A1F1F" }}><b>OT warning:</b> This applicant reported {app.hours_after_shift} hours after this shift.</div>}
          <SummaryBox rows={[["Applicant",app.applicant_name],["Email",app.applicant_email],["Shift",`${fmtDate(shift.date)} ${shift.type} ${shift.time}`],["Posted by",shift.poster_name],["Hours",`${app.hours_after_shift}${isOt?" · OT":""}`],app.applicant_note?["App note",app.applicant_note]:null,["Approved this week",st.priorApprovals.length?st.priorApprovals.map(p=>`${fmtDate(p.date)} ${p.type} ${p.time} (${p.hours} hrs)`).join("; "):"None"]].filter(Boolean)} />
          <ModalActions disabled={actionLoading} onCancel={() => setPendingApproval(null)} onConfirm={confirmApproval} text={isOt?"Approve with OT":"Approve applicant"} danger={isOt} />
        </Modal>;
      })()}

      {/* ── DELETE CONFIRMATION ───────────────────────── */}
      {deleteShiftId && (() => {
        const shift = shifts.find(s => s.id === deleteShiftId);
        if (!shift) return null;
        const ac = pendingAppsFor(shift.id).length;
        return <Modal onClose={() => setDeleteShiftId(null)} z={150}>
          <h2 style={{ fontSize: 18, margin: "0 0 8px", color: "#8A1F1F" }}>Delete open shift?</h2>
          <p style={{ fontSize: 14, color: "#5e6675", margin: "0 0 16px" }}>This will delete {shift.poster_name}'s {shift.type} {shift.time} shift on {fmtDate(shift.date)} and remove {ac} application{ac===1?"":"s"}.</p>
          <ModalActions disabled={actionLoading} onCancel={() => setDeleteShiftId(null)} onConfirm={confirmDelete} text="Delete shift" danger />
        </Modal>;
      })()}

      <footer style={{ marginTop: 40, paddingTop: 20, borderTop: "0.5px solid #e0e3e8", color: "#8a92a0", fontSize: 11, lineHeight: 1.6, textAlign: "center" }}>
        Lakefront Shift Swap maintained by Luigi Berinde. For questions, contact an LC.<br/>Internal scheduling aid only. Final schedule changes must be reflected in Target Solutions.
      </footer>

      {toast && <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: "#1a2744", color: "#fff", padding: "10px 24px", borderRadius: 12, fontSize: 14, fontWeight: 700, zIndex: 200 }}>{toast}</div>}
      {actionLoading && <div style={{ position: "fixed", inset: 0, background: "rgba(255,255,255,0.5)", zIndex: 250, display: "flex", alignItems: "center", justifyContent: "center" }}><div style={{ background: "#1a2744", color: "#fff", padding: "12px 28px", borderRadius: 12, fontSize: 14, fontWeight: 700 }}>Saving...</div></div>}
    </div>
    </div>
  );
}
