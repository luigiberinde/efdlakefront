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
function chicagoTodayStr() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const get = type => parts.find(p => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
function daysFromTodayChicago(dateStr) {
  if (!dateStr) return null;
  const today = chicagoTodayStr();
  const a = new Date(today + "T12:00:00");
  const b = new Date(dateStr + "T12:00:00");
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}
function postDateWarnings(dateStr) {
  const diff = daysFromTodayChicago(dateStr);
  if (diff === null) return [];
  if (diff < 0) return ["This date has already passed. Double-check before posting, because it may expire soon."];
  if (diff === 0) return ["This shift is today. Double-check that the date is correct before posting."];
  if (diff > 30) return ["This shift is more than 30 days away. Double-check that the date is correct before posting."];
  return [];
}

function fmtVectorTime(t) {
  if (!t) return "";
  return new Date(t.replace(" ", "T")).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
function vectorShiftLabel(s) {
  if (!s) return "Unknown Vector shift";
  const bits = [];
  if (s.shift_start && s.shift_end) bits.push(`${fmtVectorTime(s.shift_start)}–${fmtVectorTime(s.shift_end)}`);
  if (s.assignment_name) bits.push(s.assignment_name);
  if (s.shift_length) bits.push(`${s.shift_length} hrs`);
  return bits.join(" · ") || `Vector shift ${s.shift_id}`;
}
function arr(v) { return Array.isArray(v) ? v : []; }

// ── Styles ──────────────────────────────────────────────────
const F={width:"100%",padding:"8px 12px",fontSize:16,borderRadius:12,border:"0.5px solid #c7ccd4",background:"#fff",color:"#172033",boxSizing:"border-box"};
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

function LabeledInput({ label, hint, value, onChange, placeholder, type = "text", ...props }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ fontSize: 13, fontWeight: 700, color: "#5e6675", display: "block", marginBottom: 4 }}>{label}{hint && <span style={{ fontWeight: 500, color: "#8a92a0" }}> — {hint}</span>}</label>
      <input style={F} type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} {...props} />
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

function WarningBox({ children }) {
  return (
    <div style={{ borderRadius: 12, padding: "10px 12px", marginBottom: 12, fontSize: 13, background: "#FFF9E8", border: "0.5px solid #D9B451", color: "#8A5A00", lineHeight: 1.5 }}>
      {children}
    </div>
  );
}

function OTChip() {
  return <span style={{ display: "inline-block", fontSize: 10, fontWeight: 800, padding: "1px 8px", borderRadius: 10, background: "#FCEBEB", color: "#8A1F1F", letterSpacing: "0.5px" }}>OT</span>;
}

function HoursRow({ label, current, projected, ot, note }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(96px,118px) 1fr 1fr 34px", gap: 6, alignItems: "center", fontSize: 12, padding: "4px 0" }}>
      <span style={{ color: "#8a92a0", fontWeight: 600 }}>{label}</span>
      {note
        ? <span style={{ gridColumn: "2 / 5", color: "#8a92a0" }}>{note}</span>
        : <>
            <span>{current ?? "—"}</span>
            <span style={{ fontWeight: 700 }}>{projected ?? "—"}</span>
            <span>{ot ? <OTChip /> : null}</span>
          </>}
    </div>
  );
}

function HoursTable({ children }) {
  return (
    <div style={{ width: "100%", background: "#fff", border: "0.5px solid #e0e3e8", borderRadius: 10, padding: "6px 10px", marginTop: 8 }}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(96px,118px) 1fr 1fr 34px", gap: 6, fontSize: 10, fontWeight: 800, color: "#8a92a0", textTransform: "uppercase", letterSpacing: "0.5px", padding: "2px 0 4px", borderBottom: "0.5px solid #eef0f3" }}>
        <span>Vector hours</span><span>Current</span><span>Projected</span><span />
      </div>
      {children}
    </div>
  );
}

const STATUS_CHIP = {
  open: ["#E6F1FB", "#0C447C"],
  taken: ["#EAF3DE", "#27500A"],
  expired: ["#EFEFF2", "#555B66"],
  pending: ["#FFF2B8", "#8A5A00"],
  approved: ["#EAF3DE", "#27500A"],
  declined: ["#EFEFF2", "#555B66"],
};
function StatusChip({ status }) {
  const [bg, color] = STATUS_CHIP[status] || ["#f6f7f9", "#5e6675"];
  return <span style={B(bg, color)}>{status}</span>;
}

// Remembered name/email so people stop retyping their identity on every post/application.
function loadIdentity() {
  try { return JSON.parse(localStorage.getItem("lss-identity") || "null") || { name: "", email: "" }; }
  catch { return { name: "", email: "" }; }
}
function saveIdentity(name, email) {
  try { localStorage.setItem("lss-identity", JSON.stringify({ name: String(name || "").trim(), email: String(email || "").trim().toLowerCase() })); } catch {}
}
function normEmail(value) { return String(value || "").trim().toLowerCase(); }
function emailMatches(a, b) { return normEmail(a) === normEmail(b); }

function canonicalAppName(app) { return app?.applicant_vector_full_name || app?.applicant_name || "Unknown applicant"; }
function canonicalPosterName(shift) { return shift?.poster_vector_full_name || shift?.poster_name || "Unknown poster"; }
function canonicalSwapName(shift) { return shift?.swap_partner_vector_full_name || shift?.swap_partner_name || "Swap partner"; }
function canonicalPreferredName(shift) { return shift?.preferred_vector_full_name || shift?.preferred_name || "Preferred applicant"; }
function vectorShiftText(s) {
  if (!s) return "";
  return [s.assignment_name, s.work_type_name, ...(Array.isArray(s.group_labels) ? s.group_labels : [])].filter(Boolean).join(" ").toLowerCase();
}
function earlyLateMismatchWarning(selectedTime, vectorShift) {
  const txt = vectorShiftText(vectorShift);
  if (!txt) return null;
  const hasEarly = /\bearly\b/.test(txt);
  const hasLate = /\blate\b/.test(txt);
  if (selectedTime === "early" && hasLate && !hasEarly) return "Vector looks like this may be a Late shift, but you selected Early. Double-check before posting. You can continue if Vector labels are weird.";
  if (selectedTime === "late" && hasEarly && !hasLate) return "Vector looks like this may be an Early shift, but you selected Late. Double-check before posting. You can continue if Vector labels are weird.";
  return null;
}
function swapTimeMismatchNotice(selectedTime, vectorShift) {
  const warning = earlyLateMismatchWarning(selectedTime, vectorShift);
  if (!warning) return null;
  const actual = inferTimeFromVectorShift(vectorShift);
  return {
    warning,
    actual,
    selected: selectedTime === "late" ? "Late" : "Early",
    actualLabel: actual === "late" ? "Late" : "Early",
    vectorLabel: vectorShiftLabel(vectorShift),
  };
}
function inferTimeFromVectorShift(s) {
  const txt = vectorShiftText(s);
  const hasEarly = /\bearly\b/.test(txt);
  const hasLate = /\blate\b/.test(txt);
  if (hasLate && !hasEarly) return "late";
  return "early";
}
function inferTypeFromVectorShift(s) {
  const txt = vectorShiftText(s);
  if (/\bmanager\b|\bmgr\b/.test(txt)) return "manager";
  return "guard";
}
function vectorShiftDate(s) {
  return s?.day_date || String(s?.shift_start || s?.assignment_start || "").slice(0, 10);
}
function bulkShiftKey(s, index = "") {
  return String(s?.__bulk_key || [
    vectorShiftDate(s) || "",
    s?.shift_start || "",
    s?.shift_end || "",
    s?.assignment_id || "",
    s?.shift_id || "",
    s?.work_type_id || "",
    index,
  ].join("::"));
}

function storedVectorShiftLabel(row, prefix = "poster") {
  if (!row) return "Vector shift not attached";
  const assignment = row[`${prefix}_vector_assignment_name`];
  const workType = row[`${prefix}_vector_work_type_name`];
  const labels = arr(row[`${prefix}_vector_group_labels`]).join(", ");
  const start = row[`${prefix}_vector_shift_start`];
  const end = row[`${prefix}_vector_shift_end`];
  const length = row[`${prefix}_vector_shift_length`];
  const id = row[`${prefix}_vector_shift_id`];
  const bits = [];
  if (start && end) bits.push(`${fmtVectorTime(start)}–${fmtVectorTime(end)}`);
  if (assignment) bits.push(assignment);
  if (workType) bits.push(workType);
  if (labels) bits.push(labels);
  if (length != null) bits.push(`${length} hrs`);
  if (id) bits.push(`ID ${id}`);
  return bits.filter(Boolean).join(" · ") || "Vector shift not attached";
}
function shortVectorShiftLabel(row, prefix = "poster") {
  const assignment = row?.[`${prefix}_vector_assignment_name`];
  const workType = row?.[`${prefix}_vector_work_type_name`];
  const start = row?.[`${prefix}_vector_shift_start`];
  const end = row?.[`${prefix}_vector_shift_end`];
  const fallback = `${row?.[`${prefix === "poster" ? "type" : "swap_partner_type"}`] || "shift"} ${row?.[`${prefix === "poster" ? "time" : "swap_partner_time"}`] || ""}`.trim();
  return [start && end ? `${fmtVectorTime(start)}–${fmtVectorTime(end)}` : "", assignment || workType || fallback].filter(Boolean).join(" · ");
}
function dateInRange(date, start, end) {
  if (!date || !start || !end) return false;
  return String(date) >= String(start) && String(date) <= String(end);
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
  const [approvalPreflight, setApprovalPreflight] = useState(null);
  const [approvalPreflightLoading, setApprovalPreflightLoading] = useState(false);
  const [currentVectorHoursByApp, setCurrentVectorHoursByApp] = useState({});
  const [currentVectorHoursLoading, setCurrentVectorHoursLoading] = useState({});
  const [deleteShiftId, setDeleteShiftId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [applyActionPrompt, setApplyActionPrompt] = useState(null);
  const [deleteApplicationPrompt, setDeleteApplicationPrompt] = useState(null);
  const [deletingApplicationId, setDeletingApplicationId] = useState(null);

  // My activity lookup
  const [showMineModal, setShowMineModal] = useState(false);
  const [mineEmail, setMineEmail] = useState("");
  const [mineLoading, setMineLoading] = useState(false);
  const [mine, setMine] = useState(null);
  const [mineBusyId, setMineBusyId] = useState(null);


  // Notify-me + bulk-post UX
  const emptyNotifyForm = { name: "", email: "", type: "any", time: "any", startDate: "", endDate: "" };
  const [showNotifyModal, setShowNotifyModal] = useState(false);
  const [nf, setNf] = useState(emptyNotifyForm);
  const [nfEmailOk, setNfEmailOk] = useState(false);
  const [nfErr, setNfErr] = useState("");
  const [notifyLoading, setNotifyLoading] = useState(false);

  const newBulkRow = () => ({ tempId: `${Date.now()}-${Math.random().toString(16).slice(2)}`, type: "guard", time: "early", date: "", note: "", selectedVectorShiftId: "" });
  const [showBulkPostModal, setShowBulkPostModal] = useState(false);
  const [bulkName, setBulkName] = useState("");
  const [bulkEmail, setBulkEmail] = useState("");
  const [bulkEmailOk, setBulkEmailOk] = useState(false);
  const [bulkRows, setBulkRows] = useState([newBulkRow()]);
  const [bulkResults, setBulkResults] = useState({});
  const [bulkStage, setBulkStage] = useState("edit");
  const [bulkErr, setBulkErr] = useState("");
  const [bulkLoading, setBulkLoading] = useState(false);
  const [lcSearch, setLcSearch] = useState("");
  const [refreshShiftHoursLoading, setRefreshShiftHoursLoading] = useState(false);
  const [refreshShiftHoursSummary, setRefreshShiftHoursSummary] = useState(null);
  const [manualMatchSelections, setManualMatchSelections] = useState({});
  const [manualMatchBusy, setManualMatchBusy] = useState(null);

  // Post form
  const emptyPostForm = {name:"",email:"",type:"guard",time:"early",date:"",note:"",isSwap:false,swapName:"",swapEmail:"",swapType:"guard",swapTime:"early",swapDate:"",hasPreferred:false,prefName:"",prefEmail:"",prefReason:"",lcOverride:false,lcShiftLength:"",lcShiftStart:"",lcShiftEnd:"",selectedVectorShiftId:"",selectedSwapVectorShiftId:""};
  const [pf, setPf] = useState(emptyPostForm);
  const [pfEmailOk, setPfEmailOk] = useState(false);
  const [pfErr, setPfErr] = useState("");
  const [postWarnings, setPostWarnings] = useState([]);
  const [postVectorResult, setPostVectorResult] = useState(null);
  const [singleSwapMismatchOk, setSingleSwapMismatchOk] = useState(false);

  // Step-by-step post flow + multi-post from actual Vector schedule.
  const [postStep, setPostStep] = useState("identity"); // identity | mode | single | multi
  const [singleVectorShifts, setSingleVectorShifts] = useState([]);
  const [singleSelectedKey, setSingleSelectedKey] = useState("");
  const [singleVectorLoading, setSingleVectorLoading] = useState(false);
  const [singleVectorErr, setSingleVectorErr] = useState("");
  const [multiMode, setMultiMode] = useState(false);
  const [multiStartDate, setMultiStartDate] = useState(chicagoTodayStr());
  const [multiEndDate, setMultiEndDate] = useState(() => {
    const d = new Date(chicagoTodayStr() + "T12:00:00");
    d.setDate(d.getDate() + 30);
    return d.toISOString().slice(0, 10);
  });
  const [multiLoading, setMultiLoading] = useState(false);
  const [multiErr, setMultiErr] = useState("");
  const [multiShifts, setMultiShifts] = useState([]);
  const [multiSelected, setMultiSelected] = useState({});
  const [multiStage, setMultiStage] = useState("pick"); // pick | configure | review
  const [multiConfigIndex, setMultiConfigIndex] = useState(0);
  const [multiDryRunResults, setMultiDryRunResults] = useState([]);

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
  const restoreScrollSoon = useCallback((y) => {
    if (typeof window === "undefined" || typeof y !== "number") return;
    requestAnimationFrame(() => window.scrollTo({ top: y, left: 0, behavior: "auto" }));
    setTimeout(() => window.scrollTo({ top: y, left: 0, behavior: "auto" }), 80);
  }, []);

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
      id, poster_name, poster_email, poster_vector_full_name, type, time, date,
      is_swap, swap_partner_name, swap_partner_email, swap_partner_type, swap_partner_time, swap_partner_date,
      has_preferred, preferred_name, preferred_email
    `).eq("status","open").eq("date",base.date).eq("type",base.type).eq("time",base.time).neq("id",shiftId);
    return data || [];
  }, [sb, shifts]);

  // ── Post shift ────────────────────────────────────────
  const openPostModal = () => {
    const id = loadIdentity();
    setPf({ ...emptyPostForm, name: id.name, email: id.email });
    setPfEmailOk(false);
    setPfErr("");
    setPostWarnings([]);
    setPostVectorResult(null);
    setSingleSwapMismatchOk(false);
    setSingleSwapMismatchOk(false);
    setPostStep("identity");
    setSingleVectorShifts([]);
    setSingleSelectedKey("");
    setSingleVectorErr("");
    setSingleVectorLoading(false);
    setMultiMode(false);
    setMultiErr("");
    setMultiShifts([]);
    setMultiSelected({});
    setMultiStage("pick");
    setMultiConfigIndex(0);
    setMultiDryRunResults([]);
    setMultiStartDate(chicagoTodayStr());
    const d = new Date(chicagoTodayStr() + "T12:00:00");
    d.setDate(d.getDate() + 30);
    setMultiEndDate(d.toISOString().slice(0, 10));
    setShowPostModal(true);
  };

  const openNotifyModal = () => { const id = loadIdentity(); setNf({ ...emptyNotifyForm, name: id.name, email: id.email }); setNfEmailOk(false); setNfErr(""); setShowNotifyModal(true); };
  const openBulkPostModal = () => { const id = loadIdentity(); setBulkName(id.name); setBulkEmail(id.email); setBulkEmailOk(false); setBulkRows([newBulkRow()]); setBulkResults({}); setBulkStage("edit"); setBulkErr(""); setShowBulkPostModal(true); };

  const validatePost = async () => {
    const e = pf.email.trim().toLowerCase();
    setPostWarnings([]);
    setPostVectorResult(null);
    setSingleSwapMismatchOk(false);
    if (!pf.name.trim()||!e||!pf.date) { setPfErr("Fill in all fields."); return false; }
    if (!pfEmailOk) { setPfErr("Confirm that you used the correct email address."); return false; }
    if (daysFromTodayChicago(pf.date) < 0) { setPfErr("You cannot post a shift before today's date."); return false; }
    if (!pf.lcOverride && !pf.selectedVectorShiftId) { setPfErr("Load your Vector shifts for that date and select the exact shift you want to post."); return false; }
    if (pf.isSwap && pf.hasPreferred) { setPfErr("Choose either a swap request or a preferred applicant, not both."); return false; }
    if (pf.isSwap && (!pf.swapName.trim()||!pf.swapEmail.trim()||!pf.swapDate)) { setPfErr("Fill in all swap partner details."); return false; }
    if (pf.isSwap && daysFromTodayChicago(pf.swapDate) < 0) { setPfErr("The swap partner's shift date cannot be before today's date."); return false; }
    if (pf.hasPreferred && (!pf.prefName.trim()||!pf.prefEmail.trim()||!pf.prefReason.trim())) { setPfErr("Fill in the preferred applicant name, email, and reason."); return false; }
    if (pf.lcOverride && !lcAuth) { setPfErr("Only LCs can post without Vector confirmation."); return false; }
    if (pf.lcOverride && (!pf.lcShiftLength || Number(pf.lcShiftLength) <= 0)) { setPfErr("Enter the shift length for this LC-created open shift."); return false; }

    const warnings = [...postDateWarnings(pf.date)];
    const { count: sameDayCount } = await sb.from("shifts").select("id",{count:"exact",head:true}).eq("status","open").eq("poster_email",e).eq("date",pf.date);
    if ((sameDayCount || 0) > 0) warnings.push("You already have another open shift posted on this date. That may be fine, but double-check before posting.");

    setActionLoading(true);
    try {
      const res = await fetch("/api/post-shift", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ ...pf, dryRun: true }) });
      const data = await res.json().catch(() => ({ success:false, error:"Server returned an invalid response." }));
      if (!res.ok || !data.success) {
        if (data.needsShiftSelection) {
          setPostVectorResult(data);
          setPfErr(data.error || "Choose the exact Vector shift.");
        } else {
          setPfErr(data.error || "Vector could not validate this post.");
          setPostVectorResult(data);
        }
        return false;
      }
      setPostVectorResult(data);
      const softWarnings = [...(warnings || []), ...(data.warnings || [])];
      const posterMismatch = earlyLateMismatchWarning(pf.time, data.selectedPosterShift);
      if (posterMismatch) softWarnings.push(posterMismatch);
      const swapMismatch = pf.isSwap ? earlyLateMismatchWarning(pf.swapTime, data.selectedSwapShift) : null;
      if (swapMismatch) softWarnings.push(`Swap partner: ${swapMismatch}`);
      setPostWarnings(softWarnings);
      setPfErr("");
      return true;
    } finally {
      setActionLoading(false);
    }
  };

  const confirmPost = async () => {
    setActionLoading(true);
    try {
      const res = await fetch("/api/post-shift", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ ...pf, dryRun: false }) });
      const data = await res.json().catch(() => ({ success:false, error:"Server returned an invalid response." }));
      if (!res.ok || !data.success) {
        showToast(data.error || "Error posting shift.");
        setPostConfirmOpen(false);
        setShowPostModal(true);
        return;
      }
      setPostConfirmOpen(false); setShowPostModal(false); setPage(1);
      saveIdentity(pf.name, pf.email);
      await refetchRef.current?.();
      showToast("Shift posted");
    } finally {
      setActionLoading(false);
    }
  };


  const verifyPosterIdentity = async () => {
    const e = normEmail(pf.email);
    if (!pf.name.trim() || !e) { setPfErr("Enter your name and email first."); return; }
    if (!pfEmailOk) { setPfErr("Confirm that this is your correct email."); return; }
    setActionLoading(true); setPfErr("");
    try {
      const today = chicagoTodayStr();
      const res = await fetch("/api/vector/person-shifts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: pf.name.trim(), email: e, startDate: today, endDate: today }),
      });
      const data = await res.json().catch(() => ({ success:false, error:"Server returned an invalid response." }));
      if (!res.ok || !data.success) {
        setPfErr(data.error || "Vector could not confirm this email.");
        return;
      }
      saveIdentity(pf.name, e);
      setPf(p => ({ ...p, email: e, name: data.vectorUser?.full_name || p.name }));
      setPostStep("mode");
    } finally { setActionLoading(false); }
  };

  const loadSingleVectorShifts = async () => {
    const e = normEmail(pf.email);
    if (!pf.name.trim() || !e) { setSingleVectorErr("Enter your name and email first."); return; }
    if (!pf.date) { setSingleVectorErr("Choose the date of the shift first."); return; }
    if (daysFromTodayChicago(pf.date) < 0) { setSingleVectorErr("You cannot post a shift before today's date."); return; }
    setSingleVectorLoading(true); setSingleVectorErr(""); setSingleVectorShifts([]); setSingleSelectedKey(""); setPostVectorResult(null);
    try {
      const res = await fetch("/api/vector/person-shifts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: pf.name.trim(), email: e, startDate: pf.date, endDate: pf.date }),
      });
      const data = await res.json().catch(() => ({ success:false, error:"Server returned an invalid response." }));
      if (!res.ok || !data.success) {
        setSingleVectorErr(data.error || "Could not load your Vector shifts for that date.");
        return;
      }
      const rows = arr(data.shifts);
      setSingleVectorShifts(rows);
      if (rows.length === 0) {
        setSingleVectorErr("Vector does not show you working on that date. You cannot post a shift you are not scheduled for.");
        setPf(p => ({ ...p, selectedVectorShiftId:"" }));
      } else if (rows.length === 1) {
        const s = rows[0];
        setSingleSelectedKey(bulkShiftKey(s, 0));
        setPf(p => ({ ...p, selectedVectorShiftId: String(s.shift_id || ""), type: inferTypeFromVectorShift(s), time: inferTimeFromVectorShift(s), date: vectorShiftDate(s) || p.date }));
      }
    } finally { setSingleVectorLoading(false); }
  };

  // ── Multi-post from Vector schedule ───────────────────
  const updateMultiRow = (key, patch) => {
    setMultiSelected(prev => ({ ...prev, [key]: { ...(prev[key] || {}), ...patch } }));
    setMultiDryRunResults([]);
  };
  const selectedMultiRows = () => multiShifts
    .map((s, idx) => ({ shift: s, key: bulkShiftKey(s, idx), cfg: multiSelected[bulkShiftKey(s, idx)] || {} }))
    .filter(row => row.cfg?.selected)
    .sort((a,b) => `${vectorShiftDate(a.shift)} ${a.shift?.shift_start || ''} ${a.key}`.localeCompare(`${vectorShiftDate(b.shift)} ${b.shift?.shift_start || ''} ${b.key}`));

  const multiRowBody = ({ shift, cfg }) => {
    const date = vectorShiftDate(shift);
    const type = inferTypeFromVectorShift(shift);
    const time = inferTimeFromVectorShift(shift);
    return {
      name: pf.name.trim(),
      email: normEmail(pf.email),
      type,
      time,
      date,
      note: cfg.note || "",
      selectedVectorShiftId: shift.shift_id,
      dryRun: false,
      hasPreferred: cfg.mode === "preferred",
      prefName: cfg.prefName || "",
      prefEmail: normEmail(cfg.prefEmail || ""),
      prefReason: cfg.prefReason || "",
      isSwap: cfg.mode === "swap",
      swapName: cfg.swapName || "",
      swapEmail: normEmail(cfg.swapEmail || ""),
      swapType: cfg.swapType || "guard",
      swapTime: cfg.swapTime || "early",
      swapDate: cfg.swapDate || "",
    };
  };

  const validateMultiConfigRow = ({ shift, cfg }) => {
    const date = vectorShiftDate(shift);
    const ownTime = inferTimeFromVectorShift(shift);
    const label = `${fmtDate(date)} · ${ownTime === "late" ? "Late" : "Early"} ${inferTypeFromVectorShift(shift) === "manager" ? "Manager" : "Guard"}`;
    if (cfg.mode === "preferred" && (!cfg.prefName?.trim() || !normEmail(cfg.prefEmail) || !cfg.prefReason?.trim())) return `${label}: fill in the preferred applicant name, email, and reason.`;
    if (cfg.mode === "swap" && (!cfg.swapName?.trim() || !normEmail(cfg.swapEmail) || !cfg.swapDate)) return `${label}: fill in the swap partner name, email, and shift date.`;
    if (cfg.mode === "swap" && daysFromTodayChicago(cfg.swapDate) < 0) return `${label}: the swap partner's shift date cannot be before today's date.`;
    return null;
  };

  const dryRunOneMultiRow = async (row) => {
    const body = { ...multiRowBody(row), dryRun: true };
    const res = await fetch("/api/post-shift", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({ success:false, error:"Server returned an invalid response." }));
    return { row, ok: !!(res.ok && data.success), data, error: data.error || "Could not validate this shift." };
  };

  const loadMultiVectorShifts = async () => {
    const e = normEmail(pf.email);
    if (!pf.name.trim() || !e) { setMultiErr("Enter your name and email first."); return; }
    if (!pfEmailOk) { setMultiErr("Confirm your email first."); return; }
    if (!multiStartDate || !multiEndDate || multiEndDate < multiStartDate) { setMultiErr("Choose a valid date range."); return; }
    if (daysFromTodayChicago(multiStartDate) < 0 || daysFromTodayChicago(multiEndDate) < 0) { setMultiErr("You cannot load or post shifts before today's date."); return; }
    setMultiLoading(true); setMultiErr(""); setMultiStage("pick"); setMultiConfigIndex(0); setMultiDryRunResults([]);
    try {
      const res = await fetch("/api/vector/person-shifts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: pf.name.trim(), email: e, startDate: multiStartDate, endDate: multiEndDate }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setMultiErr(data.error || "Could not load your Vector shifts.");
        setMultiShifts([]);
        return;
      }
      const rows = arr(data.shifts)
        .filter(s => daysFromTodayChicago(vectorShiftDate(s)) >= 0)
        .sort((a,b) => `${vectorShiftDate(a)} ${a.shift_start || ''} ${a.assignment_id || ''} ${a.shift_id || ''}`.localeCompare(`${vectorShiftDate(b)} ${b.shift_start || ''} ${b.assignment_id || ''} ${b.shift_id || ''}`))
        .map((s, idx) => ({ ...s, __bulk_key: s.__bulk_key || bulkShiftKey(s, idx) }));
      setMultiShifts(rows);
      const next = {};
      rows.forEach((s, idx) => {
        const key = bulkShiftKey(s, idx);
        next[key] = multiSelected[key] || { selected: false, mode: "normal", note: "", prefName: "", prefEmail: "", prefReason: "", swapName: "", swapEmail: "", swapType: inferTypeFromVectorShift(s), swapTime: inferTimeFromVectorShift(s), swapDate: vectorShiftDate(s) };
      });
      setMultiSelected(next);
      if (rows.length === 0) setMultiErr("Vector did not show any future shifts for you in that date range.");
    } catch (err) {
      setMultiErr(err.message || "Could not load your Vector shifts.");
    } finally { setMultiLoading(false); }
  };

  const startMultiConfigure = () => {
    const selected = selectedMultiRows();
    if (selected.length === 0) { setMultiErr("Select at least one Vector shift to post."); return; }
    setMultiErr("");
    setMultiConfigIndex(0);
    setMultiDryRunResults([]);
    setMultiStage("configure");
  };

  const nextMultiConfig = async () => {
    const selected = selectedMultiRows();
    const row = selected[multiConfigIndex];
    if (!row) { setMultiStage("pick"); return; }
    const err = validateMultiConfigRow(row);
    if (err) { setMultiErr(err); return; }

    setMultiLoading(true);
    setMultiErr("");
    try {
      const result = await dryRunOneMultiRow(row);
      setMultiDryRunResults(prev => {
        const withoutThis = prev.filter(r => r.row?.key !== row.key);
        return [...withoutThis, result];
      });
      if (!result.ok) {
        setMultiErr(`${fmtDate(vectorShiftDate(row.shift))}: ${result.error}`);
        return;
      }
      if ((row.cfg?.mode || "normal") === "swap") {
        const mismatch = swapTimeMismatchNotice(row.cfg?.swapTime || "early", result.data?.selectedSwapShift);
        if (mismatch && !row.cfg?.swapMismatchConfirmed) {
          updateMultiRow(row.key, {
            swapMismatchWarning: `Vector says this swap partner's exact shift looks like ${mismatch.actualLabel}, but you marked it as ${mismatch.selected}. Exact Vector shift: ${mismatch.vectorLabel}.`,
            swapMismatchConfirmed: false,
          });
          setMultiErr("Confirm the swap partner's exact Vector shift before moving to the next selected shift.");
          return;
        }
      }
      if (multiConfigIndex < selected.length - 1) setMultiConfigIndex(i => i + 1);
      else setMultiStage("review");
    } finally {
      setMultiLoading(false);
    }
  };

  const dryRunMultiPosts = async (selected) => {
    const results = [];
    for (const row of selected) {
      const body = { ...multiRowBody(row), dryRun: true };
      const res = await fetch("/api/post-shift", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({ success:false, error:"Server returned an invalid response." }));
      results.push({ row, ok: !!(res.ok && data.success), data, error: data.error || "Could not validate this shift." });
    }
    return results;
  };

  const confirmMultiPostFromVector = async () => {
    const selected = selectedMultiRows();
    if (selected.length === 0) { setMultiErr("Select at least one Vector shift to post."); return; }
    for (const row of selected) {
      const err = validateMultiConfigRow(row);
      if (err) { setMultiErr(err); setMultiStage("configure"); setMultiConfigIndex(Math.max(0, selected.findIndex(r => r.key === row.key))); return; }
    }
    setMultiLoading(true); setMultiErr("");
    try {
      const checks = await dryRunMultiPosts(selected);
      setMultiDryRunResults(checks);
      const failedChecks = checks.filter(r => !r.ok);
      if (failedChecks.length > 0) {
        const first = failedChecks[0];
        setMultiErr(`${failedChecks.length} selected shift${failedChecks.length === 1 ? "" : "s"} need attention before posting. ${fmtDate(vectorShiftDate(first.row.shift))}: ${first.error}`);
        setMultiStage("review");
        return;
      }
      const ok = typeof window === "undefined" ? true : window.confirm(`Post ${selected.length} selected shift${selected.length === 1 ? "" : "s"}?`);
      if (!ok) return;
      let posted = 0;
      const failed = [];
      for (const row of selected) {
        const body = multiRowBody(row);
        const res = await fetch("/api/post-shift", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const data = await res.json().catch(() => ({ success:false, error:"Server returned an invalid response." }));
        if (res.ok && data.success) posted += 1; else failed.push(`${fmtDate(vectorShiftDate(row.shift))} ${vectorShiftLabel(row.shift)}: ${data.error || "failed"}`);
      }
      saveIdentity(pf.name, pf.email);
      await fetchData();
      if (failed.length) {
        setMultiErr(`Posted ${posted}, but ${failed.length} failed. ${failed.slice(0, 2).join(" ")}${failed.length > 2 ? " …" : ""}`);
      } else {
        showToast(`Posted ${posted} shift${posted === 1 ? "" : "s"}`);
        setShowPostModal(false);
      }
    } finally { setMultiLoading(false); }
  };

  // ── Notify me + bulk posting ─────────────────────────
  const submitNotify = async () => {
    const e = normEmail(nf.email);
    if (!nf.name.trim() || !e || !nf.startDate || !nf.endDate) { setNfErr("Fill in name, email, and date range."); return; }
    if (!nfEmailOk) { setNfErr("Confirm that this is your correct email."); return; }
    if (nf.endDate < nf.startDate) { setNfErr("End date must be on or after start date."); return; }
    setNotifyLoading(true); setNfErr("");
    try {
      const res = await fetch("/api/watch-shifts", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ ...nf, email: e }) });
      const data = await res.json().catch(() => ({ success:false, error:"Server returned an invalid response." }));
      if (!res.ok || !data.success) { setNfErr(data.error || "Could not save notification."); return; }
      saveIdentity(nf.name, e);
      setShowNotifyModal(false);
      if (data.duplicate) {
        showToast("That notification already exists. No duplicate was added.");
      } else if (data.overlapping) {
        showToast("Notification saved. Overlapping alerts will only send one email per posted shift.");
      } else {
        showToast("Notification saved. You'll get an email when a matching shift is posted.");
      }
    } finally { setNotifyLoading(false); }
  };

  const updateBulkRow = (tempId, patch) => {
    setBulkRows(rows => rows.map(r => r.tempId === tempId ? { ...r, ...patch } : r));
    setBulkStage("edit");
  };
  const addBulkRow = () => setBulkRows(rows => [...rows, newBulkRow()]);
  const removeBulkRow = (tempId) => setBulkRows(rows => rows.length <= 1 ? rows : rows.filter(r => r.tempId !== tempId));

  const validateBulkPosts = async () => {
    const e = normEmail(bulkEmail);
    if (!bulkName.trim() || !e) { setBulkErr("Enter your name and email."); return; }
    if (!bulkEmailOk) { setBulkErr("Confirm that this is your correct email."); return; }
    const usable = bulkRows.filter(r => r.date);
    if (usable.length === 0) { setBulkErr("Add at least one dated shift."); return; }
    setBulkLoading(true); setBulkErr("");
    const nextResults = {};
    try {
      for (const row of bulkRows) {
        if (!row.date) {
          nextResults[row.tempId] = { status: "empty", error: "Add a date or remove this row." };
          continue;
        }
        const res = await fetch("/api/post-shift", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ name: bulkName.trim(), email: e, type: row.type, time: row.time, date: row.date, note: row.note || "", selectedVectorShiftId: row.selectedVectorShiftId || "", dryRun: true }) });
        const data = await res.json().catch(() => ({ success:false, error:"Server returned an invalid response." }));
        if (data.needsShiftSelection) {
          nextResults[row.tempId] = { status: "needs_selection", ...data };
        } else if (!res.ok || !data.success) {
          nextResults[row.tempId] = { status: "error", error: data.error || "Could not validate this row.", data };
        } else {
          const warnings = [...postDateWarnings(row.date), ...(data.warnings || [])];
          const mismatch = earlyLateMismatchWarning(row.time, data.selectedPosterShift);
          if (mismatch) warnings.push(mismatch);
          nextResults[row.tempId] = { status: "valid", data, warnings };
        }
      }
      setBulkResults(nextResults);
      setBulkStage("review");
    } finally { setBulkLoading(false); }
  };

  const confirmBulkPosts = async () => {
    const e = normEmail(bulkEmail);
    const validRows = bulkRows.filter(r => bulkResults[r.tempId]?.status === "valid");
    if (validRows.length === 0) { setBulkErr("No validated rows are ready to post."); return; }
    setBulkLoading(true); setBulkErr("");
    let posted = 0;
    const failed = [];
    try {
      for (const row of validRows) {
        const res = await fetch("/api/post-shift", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ name: bulkName.trim(), email: e, type: row.type, time: row.time, date: row.date, note: row.note || "", selectedVectorShiftId: row.selectedVectorShiftId || "", dryRun: false }) });
        const data = await res.json().catch(() => ({ success:false, error:"Server returned an invalid response." }));
        if (res.ok && data.success) posted += 1;
        else failed.push(`${fmtDate(row.date)} ${row.type} ${row.time}: ${data.error || "failed"}`);
      }
      saveIdentity(bulkName, e);
      await refetchRef.current?.();
      setShowBulkPostModal(false);
      showToast(failed.length ? `Posted ${posted}; ${failed.length} failed.` : `Posted ${posted} shift${posted === 1 ? "" : "s"}`);
    } finally { setBulkLoading(false); }
  };

  // ── Apply ─────────────────────────────────────────────
  const [identicalShifts, setIdenticalShifts] = useState([]);

  const openApplyModal = async (id) => {
    const ident = loadIdentity();
    setAName(ident.name); setAEmail(ident.email); setAEmailOk(false); setAHours(""); setANote(""); setAConfirmed(false); setAIdentical(false); setAIdenticalIds([]); setASpecialIds([]); setAErr(""); setApplyActionPrompt(null); setShowApplyModal(id);
    const identMatches = await getIdenticalOpen(id);
    setIdenticalShifts(identMatches);
  };

  const confirmApply = async () => {
    if (!pendingApply) return;
    setActionLoading(true);
    try {
      const res = await fetch("/api/apply-shift", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ ...pendingApply, dryRun: false }) });
      const data = await res.json().catch(() => ({ success:false, error:"Server returned an invalid response." }));
      if (!res.ok || !data.success) {
        if (handleApplyBlockedResponse(data, pendingApply.email)) { setPendingApply(null); return; }
        showToast(data.error || "Error submitting application.");
        setPendingApply(null);
        return;
      }
      setPendingApply(null); setShowApplyModal(null); setPage(1);
      saveIdentity(pendingApply.name, pendingApply.email);
      await refetchRef.current?.();
      showToast(pendingApply.shiftIds.length === 1 ? "Application submitted" : `Applications submitted to ${pendingApply.shiftIds.length} shifts`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleApplyBlockedResponse = (data, fallbackEmail = aEmail.trim().toLowerCase()) => {
    if (data?.code === "SELF_APPLICATION" && data.canDeleteShift) {
      setApplyActionPrompt({
        kind: "self_shift",
        shiftId: data.shiftId,
        email: fallbackEmail,
        shift: data.shift,
        message: data.error || "This is your own shift. Delete this posting instead?",
      });
      setAErr("");
      return true;
    }
    if (data?.code === "DUPLICATE_APPLICATION" && data.canDeleteApplication) {
      setApplyActionPrompt({
        kind: "duplicate_application",
        applicationId: data.applicationId,
        email: fallbackEmail,
        shiftId: data.shiftId,
        shift: data.shift,
        message: data.error || "You already applied for this shift. Delete your existing application instead?",
      });
      setAErr("");
      return true;
    }
    return false;
  };

  const deleteOwnShiftFromPrompt = async () => {
    if (!applyActionPrompt?.shiftId || !applyActionPrompt?.email) return;
    setActionLoading(true);
    try {
      const res = await fetch("/api/delete-own-shift", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ shiftId: applyActionPrompt.shiftId, email: applyActionPrompt.email }) });
      const data = await res.json().catch(() => ({ success:false, error:"Server returned an invalid response." }));
      if (!res.ok || !data.success) { showToast(data.error || "Could not delete this shift."); return; }
      setApplyActionPrompt(null); setPendingApply(null); setShowApplyModal(null); setPage(1);
      await refetchRef.current?.();
      showToast("Your shift posting was deleted");
    } finally {
      setActionLoading(false);
    }
  };

  const deleteApplicationFromPrompt = async () => {
    if (!applyActionPrompt?.applicationId || !applyActionPrompt?.email) return;
    setActionLoading(true);
    try {
      const res = await fetch("/api/delete-application", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ applicationId: applyActionPrompt.applicationId, email: applyActionPrompt.email }) });
      const data = await res.json().catch(() => ({ success:false, error:"Server returned an invalid response." }));
      if (!res.ok || !data.success) { showToast(data.error || "Could not delete this application."); return; }
      setApplyActionPrompt(null); setPendingApply(null); setShowApplyModal(null); setPage(1);
      await refetchRef.current?.();
      showToast("Your application was deleted");
    } finally {
      setActionLoading(false);
    }
  };

  const checkCurrentVectorHours = async (shiftId, appId) => {
    const scrollY = typeof window !== "undefined" ? window.scrollY : null;
    setCurrentVectorHoursLoading(prev => ({ ...prev, [appId]: true }));
    try {
      const res = await fetch("/api/vector/current-application-hours", {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ shiftId, appId }),
      });
      const data = await res.json().catch(() => ({ success:false, error:"Server returned an invalid response." }));
      if (!res.ok || !data.success) {
        showToast(data.error || "Could not check current Vector hours.");
        setCurrentVectorHoursByApp(prev => ({ ...prev, [appId]: data }));
        return data;
      }
      setCurrentVectorHoursByApp(prev => {
        const next = { ...prev, [appId]: data };
        (data.updatedApplications || []).forEach(u => {
          next[u.appId] = {
            success: true,
            checkedAt: data.checkedAt,
            applicationTime: u.applicationTime,
            current: u.current,
            updatedFromWeekCheck: true,
          };
        });
        return next;
      });
      const projected = data.current?.projectedAfterApproval;
      const updatedCount = data.updatedApplications?.length || 0;
      showToast(projected != null
        ? `Current Vector projected hours: ${projected}${updatedCount > 1 ? ` · updated ${updatedCount} apps this week` : ""}`
        : "Current Vector hours checked");
      return data;
    } catch (err) {
      const data = { success:false, error:"Could not check current Vector hours." };
      setCurrentVectorHoursByApp(prev => ({ ...prev, [appId]: data }));
      showToast(data.error);
      return data;
    } finally {
      setCurrentVectorHoursLoading(prev => ({ ...prev, [appId]: false }));
      restoreScrollSoon(scrollY);
    }
  };

  const refreshOpenShiftHoursFromVector = async () => {
    const ok = typeof window === "undefined" ? true : window.confirm("Refresh stored hours for all currently open Vector-confirmed shifts? This only updates Shift Swap's stored shift lengths from live Vector and does not approve, delete, or change Vector.");
    if (!ok) return;
    setRefreshShiftHoursLoading(true);
    setRefreshShiftHoursSummary(null);
    try {
      const res = await fetch("/api/vector/refresh-open-shift-hours", { method: "POST" });
      const data = await res.json().catch(() => ({ success:false, error:"Server returned an invalid response." }));
      if (!res.ok || !data.success) {
        showToast(data.error || "Could not refresh open shift hours.");
        return;
      }
      setRefreshShiftHoursSummary(data);
      await refetchRef.current?.();
      const manualCount = (data.skippedDetails || []).flatMap(d => d.skipped || []).filter(s => Array.isArray(s.candidates) && s.candidates.length).length;
      const standardizedCount = (data.standardizedFallbacks || []).length;
      showToast(`Refreshed ${data.refreshed || 0} open shift${(data.refreshed || 0) === 1 ? "" : "s"}${data.changed?.length ? ` · ${data.changed.length} length change${data.changed.length === 1 ? "" : "s"}` : ""}${standardizedCount ? ` · ${standardizedCount} standardized by Early/Late` : ""}${manualCount ? ` · ${manualCount} need manual match` : ""}${data.failed ? ` · ${data.failed} failed` : ""}`);
    } catch (err) {
      showToast("Could not refresh open shift hours.");
    } finally {
      setRefreshShiftHoursLoading(false);
    }
  };

  const manualMatchItems = useMemo(() => {
    const details = refreshShiftHoursSummary?.skippedDetails || [];
    return details.flatMap(detail => (detail.skipped || [])
      .filter(item => Array.isArray(item.candidates) && item.candidates.length)
      .map(item => ({ ...item, shiftId: detail.id, date: detail.date, key: `${detail.id}:${item.prefix}` })));
  }, [refreshShiftHoursSummary]);

  const applyManualVectorShiftMatch = async (item) => {
    const selected = manualMatchSelections[item.key];
    if (!selected) { showToast("Pick the correct Vector shift first."); return; }
    setManualMatchBusy(item.key);
    try {
      const res = await fetch("/api/vector/manual-match-shift-hours", {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ shiftId: item.shiftId, prefix: item.prefix, vectorShiftId: selected }),
      });
      const data = await res.json().catch(() => ({ success:false, error:"Server returned an invalid response." }));
      if (!res.ok || !data.success) {
        showToast(data.error || "Could not update Vector match.");
        return;
      }
      setRefreshShiftHoursSummary(prev => {
        if (!prev) return prev;
        const next = { ...prev, skippedDetails: (prev.skippedDetails || []).map(detail => {
          if (String(detail.id) !== String(item.shiftId)) return detail;
          return { ...detail, skipped: (detail.skipped || []).filter(s => s.prefix !== item.prefix) };
        })};
        next.skippedDetails = next.skippedDetails.filter(d => (d.skipped || []).length);
        return next;
      });
      await refetchRef.current?.();
      showToast(`Updated ${item.prefix === "swap_partner" ? "swap partner" : "posted"} shift match to ${data.matched?.shift_length ?? "current"} hrs.`);
    } catch (err) {
      showToast("Could not update Vector match.");
    } finally {
      setManualMatchBusy(null);
    }
  };

  const openApprovalModal = async (shiftId, appId) => {
    setPendingApproval({ shiftId, appId });
    setApprovalPreflight(null);
    setApprovalPreflightLoading(true);
    try {
      const res = await fetch("/api/vector/approval-preflight", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ shiftId, appId }) });
      const data = await res.json().catch(() => ({ success:false, error:"Server returned an invalid response." }));
      setApprovalPreflight(data);
    } catch (err) {
      setApprovalPreflight({ success:false, error:"Vector preflight failed." });
    } finally {
      setApprovalPreflightLoading(false);
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
        setPendingApproval(null); setApprovalPreflight(null);
        return;
      }
      setPendingApproval(null); setApprovalPreflight(null); setPage(1);
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
    const id = deleteShiftId;
    setDeletingId(id);
    try {
      const res = await fetch("/api/delete-shift", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ shiftId: id }) });
      const data = await res.json().catch(() => ({ success: false, error: "Server returned an invalid response." }));
      if (!res.ok || !data.success) { showToast(data.error || "Delete failed."); setDeleteShiftId(null); return; }
      setDeleteShiftId(null);
      setShifts(prev => prev.filter(s => s.id !== id));
      setTotal(t => Math.max(0, t - 1));
      fetchCounts();
      showToast("Open shift deleted");
      refetchRef.current?.();
    } finally {
      setDeletingId(null);
    }
  };

  const confirmDeleteApplication = async () => {
    if (!deleteApplicationPrompt?.applicationId) return;
    const appId = deleteApplicationPrompt.applicationId;
    setDeletingApplicationId(appId);
    try {
      const res = await fetch("/api/delete-application", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ applicationId: appId }) });
      const data = await res.json().catch(() => ({ success:false, error:"Server returned an invalid response." }));
      if (!res.ok || !data.success) { showToast(data.error || "Could not delete application."); return; }
      setDeleteApplicationPrompt(null);
      await refetchRef.current?.();
      showToast("Application deleted");
    } finally {
      setDeletingApplicationId(null);
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

  // ── My activity (lookup by email) ─────────────────────
  const openMineModal = () => {
    setMineEmail(loadIdentity().email || "");
    setMine(null);
    setShowMineModal(true);
  };

  const lookupMine = useCallback(async (emailOverride) => {
    const e = normEmail(emailOverride ?? mineEmail);
    if (!e) return;
    setMineLoading(true);
    try {
      // Be forgiving here: older rows may have emails with different capitalization or stray spaces.
      // Pull a bounded recent set and match normalized emails client-side so My Activity does not look empty for real users.
      const [postsRes, appsRes, watchesRes] = await Promise.all([
        sb.from("shifts")
          .select("*")
          .order("date", { ascending: false })
          .limit(500),
        sb.from("applications")
          .select("*, shifts(*)")
          .order("applied_at", { ascending: false })
          .limit(500),
        sb.from("shift_watch_requests")
          .select("*")
          .eq("status", "active")
          .order("created_at", { ascending: false })
          .limit(500),
      ]);

      if (postsRes.error) throw postsRes.error;
      if (appsRes.error) throw appsRes.error;
      if (watchesRes.error) throw watchesRes.error;

      const posts = (postsRes.data || [])
        .filter(s => emailMatches(s.poster_email, e))
        .slice(0, 30);
      const apps = (appsRes.data || [])
        .filter(a => emailMatches(a.applicant_email, e))
        .slice(0, 30);
      const watches = (watchesRes.data || [])
        .filter(w => emailMatches(w.email, e))
        .slice(0, 30);

      setMine({ email: e, posts, apps, watches });
      saveIdentity(loadIdentity().name, e);
    } catch (err) {
      console.error("My activity lookup error", err);
      showToast("Could not load My activity. Try again or ask an LC.");
      setMine({ email: e, posts: [], apps: [], watches: [] });
    } finally {
      setMineLoading(false);
    }
  }, [sb, mineEmail]);

  const mineDeletePost = async (shiftId) => {
    if (!mine?.email) return;
    const ok = typeof window === "undefined" ? true : window.confirm("Are you sure you want to delete this posted shift? This only deletes the Shift Swap posting, not Vector.");
    if (!ok) return;
    setMineBusyId(`shift-${shiftId}`);
    try {
      const res = await fetch("/api/delete-own-shift", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ shiftId, email: mine.email }) });
      const data = await res.json().catch(() => ({ success:false, error:"Server returned an invalid response." }));
      if (!res.ok || !data.success) { showToast(data.error || "Could not delete this shift."); return; }
      showToast("Your shift posting was deleted");
      await Promise.all([lookupMine(mine.email), refetchRef.current?.()]);
    } finally {
      setMineBusyId(null);
    }
  };

  const mineWithdrawApp = async (applicationId) => {
    if (!mine?.email) return;
    const ok = typeof window === "undefined" ? true : window.confirm("Are you sure you want to withdraw this application? You can apply again later if the shift is still open.");
    if (!ok) return;
    setMineBusyId(`app-${applicationId}`);
    try {
      const res = await fetch("/api/delete-application", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ applicationId, email: mine.email }) });
      const data = await res.json().catch(() => ({ success:false, error:"Server returned an invalid response." }));
      if (!res.ok || !data.success) { showToast(data.error || "Could not withdraw this application."); return; }
      showToast("Application withdrawn");
      await Promise.all([lookupMine(mine.email), refetchRef.current?.()]);
    } finally {
      setMineBusyId(null);
    }
  };

  const mineUnsubscribeWatch = async (watchId) => {
    if (!mine?.email) return;
    const ok = typeof window === "undefined" ? true : window.confirm("Turn off this Notify Me alert? You will stop getting emails for this saved notification.");
    if (!ok) return;
    setMineBusyId(`watch-${watchId}`);
    try {
      const res = await fetch("/api/watch-shifts", { method: "DELETE", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ watchId, email: mine.email }) });
      const data = await res.json().catch(() => ({ success:false, error:"Server returned an invalid response." }));
      if (!res.ok || !data.success) { showToast(data.error || "Could not unsubscribe from this notification."); return; }
      showToast("Notification turned off");
      await lookupMine(mine.email);
    } finally {
      setMineBusyId(null);
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
            <div style={{ fontSize: 14, fontWeight: 700 }}>{canonicalPosterName(shift)}</div>
            <div style={{ fontSize: 11, color: "#8a92a0" }}>{timeAgo(shift.posted_at)}</div>
          </div>
        </div>

        {/* LC swap display */}
        {shift.is_swap && (lcReview || lcMode) && <InfoBlock badge="swap">
          <b>{canonicalPosterName(shift)}</b> gives up <b>{shortVectorShiftLabel(shift, "poster")}</b> on {fmtDate(shift.date)}.<br/>
          <b>{canonicalSwapName(shift)}</b> gives up <b>{shortVectorShiftLabel(shift, "swap_partner")}</b> on {fmtDate(shift.swap_partner_date)}.
        </InfoBlock>}
        {/* LC preferred display */}
        {(lcReview || lcMode) && shift.has_preferred && <InfoBlock badge="preferred applicant" gold><b>{canonicalPreferredName(shift)}</b> was listed as preferred. Reason: {shift.preferred_reason}</InfoBlock>}
        {/* LC note */}
        {(lcReview || lcMode) && shift.private_lc_note && <InfoBlock badge="private LC note">{shift.private_lc_note}</InfoBlock>}
        {(lcReview || lcMode) && shift.vector_source === "lc_override" && <InfoBlock badge="LC open shift" gold>No poster Vector shift attached. Length: {shift.lc_override_shift_length || shift.poster_vector_shift_length} hrs.</InfoBlock>}
        {(lcReview || lcMode) && shift.vector_source !== "lc_override" && shift.poster_vector_shift_id && <InfoBlock badge="Vector shift">{storedVectorShiftLabel(shift, "poster")}</InfoBlock>}
        {(lcReview || lcMode) && arr(shift.vector_warnings).length > 0 && <WarningBox>{arr(shift.vector_warnings).join("; ")}</WarningBox>}
        {(lcReview || lcMode) && arr(shift.preferred_vector_warnings).length > 0 && <WarningBox>{arr(shift.preferred_vector_warnings).join("; ")}</WarningBox>}

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

        {isTaken && <div style={{ fontSize: 13, color: "#5e6675", marginTop: 8 }}>Picked up by <b style={{ color: "#172033" }}>{shift.approved_vector_full_name || shift.taken_by_name}</b></div>}
        {isExpired && <div style={{ fontSize: 13, color: "#5e6675", marginTop: 8 }}><b style={{ color: "#172033" }}>Expired</b>, no sub was picked up.</div>}

        {/* LC delete button */}
        {(lcReview || lcMode) && !closed && <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}><button disabled={deletingId === shift.id} onClick={() => setDeleteShiftId(shift.id)} style={{ ...btn2, border: "0.5px solid #D6A4A4", background: "#FFF6F6", color: "#8A1F1F", opacity: deletingId === shift.id ? 0.55 : 1 }}>{deletingId === shift.id ? "Deleting..." : "Delete open shift"}</button></div>}

        {/* LC applicant rows */}
        {lcReview && pending.length > 0 && (
          <div style={{ marginTop: 12, borderTop: "0.5px solid #e0e3e8", paddingTop: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#5e6675", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.5px" }}>Applicants</div>
            {pending.map(app => {
              const st = getStats(app.applicant_email, shift.date);
              const isSP = shift.is_swap && app.applicant_email === shift.swap_partner_email;
              const isPref = shift.has_preferred && app.applicant_email === shift.preferred_email;
              const liveHours = currentVectorHoursByApp[app.id];
              const appCurrentHours = app.applicant_vector_week_hours;
              const appProjectedHours = app.applicant_vector_projected_hours ?? app.hours_after_shift;
              const savedCurrentHours = app.applicant_vector_current_week_hours;
              const savedProjectedHours = app.applicant_vector_current_projected_hours;
              const savedCurrentCheckedAt = app.applicant_vector_current_checked_at;
              const savedCurrentOt = !!app.applicant_vector_current_would_be_ot;
              const liveCurrentHours = liveHours?.current?.vectorWeekHours;
              const liveProjectedHours = liveHours?.current?.projectedAfterApproval;
              const liveCheckedAt = liveHours?.current?.checkedAt || liveHours?.checkedAt;
              const liveOt = !!liveHours?.current?.wouldBeOT;
              const hasLiveCurrent = liveHours?.success && liveHours.current;
              const hasSavedCurrent = savedCurrentHours != null && savedProjectedHours != null;
              const effectiveCurrentHours = hasLiveCurrent ? liveCurrentHours : savedCurrentHours;
              const effectiveProjectedHours = hasLiveCurrent ? liveProjectedHours : savedProjectedHours;
              const effectiveCheckedAt = hasLiveCurrent ? liveCheckedAt : savedCurrentCheckedAt;
              const effectiveOt = hasLiveCurrent ? liveOt : savedCurrentOt;
              const isOt = hasLiveCurrent || hasSavedCurrent ? effectiveOt : (!!app.applicant_vector_would_be_ot || Number(app.hours_after_shift) > 40);
              return (
                <div key={app.id} style={{ display: "flex", flexDirection: "column", gap: 4, padding: "10px 12px", borderRadius: 12, background: "#f6f7f9", marginBottom: 8, fontSize: 13, border: isSP?"1.5px solid #85B7EB":isPref?"1.5px solid #D9B451":"0.5px solid transparent" }}>
                  <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                    <b>{canonicalAppName(app)}</b>
                    <span style={{ fontSize: 11, color: "#8a92a0" }}>{st.approvedWeek} approved this week, {st.approvedAll} all time, {Math.max(0, st.pendingWeek - 1)} other app{Math.max(0, st.pendingWeek - 1) === 1 ? "" : "s"} still pending this week</span>
                    {isSP && <span style={B("#E6F1FB","#0C447C")}>swap partner</span>}
                    {isPref && <span style={B("#FFF2B8","#8A5A00")}>preferred</span>}
                    {isOt && <OTChip />}
                    <HoursTable>
                      <HoursRow
                        label="At application"
                        current={appCurrentHours != null ? `${appCurrentHours} hrs` : "—"}
                        projected={appProjectedHours != null ? `${appProjectedHours} hrs` : "—"}
                        ot={!!app.applicant_vector_would_be_ot || Number(app.hours_after_shift) > 40}
                      />
                      {(hasLiveCurrent || hasSavedCurrent)
                        ? <HoursRow
                            label={effectiveCheckedAt ? `Checked ${timeAgo(effectiveCheckedAt)}` : "Last checked"}
                            current={effectiveCurrentHours != null ? `${effectiveCurrentHours} hrs` : "—"}
                            projected={effectiveProjectedHours != null ? `${effectiveProjectedHours} hrs` : "—"}
                            ot={effectiveOt}
                          />
                        : <HoursRow label="Last checked" note="Not checked yet — use the button below for live Vector hours." />}
                    </HoursTable>
                    {app.applicant_vector_full_name && <span style={{ width: "100%", fontSize: 11, color: "#8a92a0", marginTop: 2 }}>Matched in Vector as {app.applicant_vector_full_name}.</span>}
                    {liveHours?.updatedFromWeekCheck && <span style={{ width: "100%", fontSize: 11, color: "#5e6675", marginTop: 4 }}>Updated because another application for this person was checked in the same work week.</span>}
                    {liveHours && !liveHours.success && <span style={{ width: "100%", fontSize: 11, color: "#8A1F1F", marginTop: 4 }}>Current Vector hours check failed: {liveHours.error || "Unknown error"}</span>}
                    {arr(app.applicant_vector_warnings).length > 0 && <span style={{ width: "100%", fontSize: 11, color: "#8A1F1F", marginTop: 4 }}>Vector warning: {arr(app.applicant_vector_warnings).join("; ")}</span>}
                    {app.applicant_note && <span style={{ width: "100%", fontSize: 11, color: "#5e6675", marginTop: 4 }}>Applicant note: {app.applicant_note}</span>}
                    {st.priorApprovals.length > 0 && <span style={{ width: "100%", fontSize: 11, color: "#8A5A00", marginTop: 4 }}>Already approved for {st.priorApprovals.length} shift{st.priorApprovals.length===1?"":"s"} this week: {st.priorApprovals.map(p => `${fmtDate(p.date)} ${p.type} ${p.time} (${p.hours} hrs reported)`).join("; ")}.</span>}
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    <button disabled={!!currentVectorHoursLoading[app.id]} onClick={() => checkCurrentVectorHours(shift.id, app.id)} style={{ ...btn2, padding: "6px 12px", fontSize: 12, border: "0.5px solid #9BB7D4", background: "#F6FAFF", color: "#0C447C", opacity: currentVectorHoursLoading[app.id] ? 0.55 : 1 }}>{currentVectorHoursLoading[app.id] ? "Checking..." : "Check current hours"}</button>
                    <button disabled={deletingApplicationId === app.id} onClick={() => setDeleteApplicationPrompt({ applicationId: app.id, applicantName: canonicalAppName(app), applicantEmail: app.applicant_email, shift })} style={{ ...btn2, padding: "6px 12px", fontSize: 12, border: "0.5px solid #D6A4A4", background: "#FFF6F6", color: "#8A1F1F", opacity: deletingApplicationId === app.id ? 0.55 : 1 }}>{deletingApplicationId === app.id ? "Deleting..." : "Delete app"}</button>
                    <button onClick={() => openApprovalModal(shift.id, app.id)} style={{ ...btnP, background: "#1D9E75", padding: "6px 14px", fontSize: 12 }}>Approve</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* History resolution */}
        {lcReview && isTaken && allA.length > 0 && (
          <div style={{ marginTop: 12, borderTop: "0.5px solid #e0e3e8", paddingTop: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#5e6675", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.5px" }}>Resolution</div>
            {allA.map(a => <div key={a.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", borderRadius: 12, background: "#f6f7f9", marginBottom: 6, opacity: a.status==="declined"?0.5:1 }}><b>{canonicalAppName(a)}</b><span style={{ fontSize: 12, fontWeight: 700, color: a.status==="approved"?"#1D9E75":"#A32D2D" }}>{a.status}</span></div>)}
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
        <div style={{ fontSize: 13, color: "#5e6675" }}>{canonicalPosterName(shift)} → {shift.approved_vector_full_name || shift.taken_by_name}</div>
        {shift.is_swap && shift.taken_by_email === shift.swap_partner_email && (
          <div style={{ fontSize: 12, color: "#5e6675", marginTop: 4, lineHeight: 1.6 }}>
            <b>{canonicalPosterName(shift)}</b> gives up {shortVectorShiftLabel(shift, "poster")} ({fmtDate(shift.date)})<br/>
            <b>{shift.approved_vector_full_name || shift.taken_by_name}</b> gives up {shortVectorShiftLabel(shift, "swap_partner")} ({fmtDate(shift.swap_partner_date)})
          </div>
        )}
        {shift.is_swap && shift.taken_by_email !== shift.swap_partner_email && (
          <div style={{ fontSize: 12, color: "#5e6675", marginTop: 4 }}>Swap was requested with <b>{canonicalSwapName(shift)}</b>, but <b>{shift.approved_vector_full_name || shift.taken_by_name}</b> picked up the shift. No reciprocal shift to update.</div>
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
        <button onClick={openMineModal} style={{ ...btn2, margin: "6px 8px 6px 0" }}>My activity</button>
        <button onClick={openNotifyModal} style={{ ...btn2, margin: "6px 8px 6px 0" }}>Notify me</button>
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
        {boardTab === "open" && shifts.some(s => s.is_swap) && <p style={{ fontSize: 12, color: "#8a92a0", margin: "0 0 12px", lineHeight: 1.5 }}>Shifts tagged <b>swap</b> have a requested swap partner — but a swap is never guaranteed, and anyone can still apply.</p>}
        {renderPagination()}
        {shifts.length === 0 ? <Empty>{boardTab==="open" ? (dateFilter ? "No open shifts on this date. Clear the date filter to see everything." : "No open shifts right now — everything is covered. Need coverage? Hit \u201CPost a shift\u201D above.") : "Nothing here yet. Shifts that get picked up or expire will show up here."}</Empty>
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

        {lcTab === "review" && (() => {
          const q = lcSearch.trim().toLowerCase();
          const visible = !q ? shifts : shifts.filter(s => {
            const hay = [canonicalPosterName(s), s.poster_email, canonicalSwapName(s), s.swap_partner_email, canonicalPreferredName(s), s.preferred_email, storedVectorShiftLabel(s, "poster"), storedVectorShiftLabel(s, "swap_partner"), fmtDate(s.date), s.type, s.time, ...pendingAppsFor(s.id).flatMap(a => [canonicalAppName(a), a.applicant_email])].filter(Boolean).join(" ").toLowerCase();
            return hay.includes(q);
          });
          return <>
            {renderDateFilter()}
            <div style={{ marginBottom: 16, display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#111827" }}>Vector shift hours</div>
                <div style={{ fontSize: 11, color: "#8a92a0", marginTop: 2 }}>One-time cleanup: refresh currently open posted shift lengths from live Vector.</div>
              </div>
              <button type="button" onClick={refreshOpenShiftHoursFromVector} disabled={refreshShiftHoursLoading} style={{ ...btn2, opacity: refreshShiftHoursLoading ? 0.6 : 1 }}>{refreshShiftHoursLoading ? "Refreshing..." : "Refresh open shift hours"}</button>
            </div>
            {manualMatchItems.length > 0 && (
              <div style={{ marginBottom: 16, border: "0.5px solid #D9B451", background: "#FFF9E8", borderRadius: 14, padding: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 900, color: "#8A5A00", marginBottom: 6 }}>Needs manual Vector match</div>
                <div style={{ fontSize: 12, color: "#8A5A00", lineHeight: 1.5, marginBottom: 10 }}>These posted shifts could not be safely auto-matched because Vector found multiple possible shifts for that person/date. Pick the exact current Vector shift so the stored hours can be corrected. This only updates Shift Swap metadata, not Vector.</div>
                {manualMatchItems.map(item => (
                  <div key={item.key} style={{ borderTop: "0.5px solid rgba(138,90,0,0.22)", paddingTop: 10, marginTop: 10 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>{fmtDate(item.date)} · {item.prefix === "swap_partner" ? "Swap partner shift" : "Posted shift"} · Shift Swap ID {item.shiftId}</div>
                    <select
                      style={{ ...F, marginBottom: 8 }}
                      value={manualMatchSelections[item.key] || ""}
                      onChange={e => setManualMatchSelections(prev => ({ ...prev, [item.key]: e.target.value }))}
                    >
                      <option value="">Select the correct current Vector shift...</option>
                      {item.candidates.map(c => (
                        <option key={`${item.key}:${c.shift_id}:${c.shift_start || ""}`} value={c.shift_id}>{vectorShiftLabel(c)}</option>
                      ))}
                    </select>
                    <button type="button" style={{ ...btnP, opacity: manualMatchBusy === item.key ? 0.6 : 1 }} disabled={manualMatchBusy === item.key} onClick={() => applyManualVectorShiftMatch(item)}>{manualMatchBusy === item.key ? "Updating..." : "Update this shift match"}</button>
                  </div>
                ))}
              </div>
            )}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: "#5e6675", display: "block", marginBottom: 4 }}>Search visible LC review page</label>
              <input style={F} value={lcSearch} onChange={e => setLcSearch(e.target.value)} placeholder="Search applicant, poster, swap partner, email, or Vector shift..." />
              {lcSearch && <div style={{ fontSize: 11, color: "#8a92a0", marginTop: 4 }}>Searching the currently loaded page. Use date/page controls if needed.</div>}
            </div>
            {renderPagination()}
            {shifts.length === 0 ? <Empty>No pending applications to review. New applications appear here automatically — no refresh needed.</Empty>
              : visible.length === 0 ? <Empty>No visible LC review cards match that search.</Empty>
              : visible.map(s => <ShiftCard key={s.id} shift={s} lcReview />)}
            {renderPagination()}
          </>;
        })()}

        {lcTab === "todo" && <>
          <p style={{ fontSize: 13, color: "#5e6675", margin: "0 0 16px" }}>Update these in Vector manually, then mark as done.</p>
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <button style={pillS(todoTab==="pending")} onClick={() => setTodoTab("pending")}>Needs update ({todoCount})</button>
            <button style={pillS(todoTab==="done")} onClick={() => setTodoTab("done")}>Completed</button>
          </div>
          {renderDateFilter()}{renderPagination()}
          {shifts.length === 0 ? <Empty>{todoTab==="pending"?"All caught up — nothing is waiting on a Vector update.":"Nothing completed yet. Items you mark done will show up here."}</Empty>
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


      {/* ── NOTIFY ME MODAL ───────────────────────────── */}
      {showNotifyModal && <Modal onClose={() => setShowNotifyModal(false)} z={118}>
        <h2 style={{ fontSize: 18, margin: "0 0 4px" }}>Notify me when shifts open</h2>
        <p style={{ fontSize: 13, color: "#5e6675", margin: "0 0 16px", lineHeight: 1.5 }}>Get an email when a matching shift is posted. This does not apply for you automatically.</p>
        <LabeledInput label="Your name" value={nf.name} onChange={v => setNf(f=>({...f,name:v}))} placeholder="Albert Einstein" />
        <LabeledInput label="Your email" type="email" value={nf.email} onChange={v => { setNf(f=>({...f,email:v})); setNfEmailOk(false); }} placeholder="aeinstein@cityofevanston.org" />
        <CheckBox checked={nfEmailOk} onChange={setNfEmailOk}>I confirm this is my correct email.</CheckBox>
        <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
          <div style={{ flex: 1 }}><label style={{ fontSize: 13, fontWeight: 700, color: "#5e6675", display: "block", marginBottom: 4 }}>Role</label><select style={F} value={nf.type} onChange={e => setNf(f=>({...f,type:e.target.value}))}><option value="any">Any</option><option value="guard">Guard</option><option value="manager">Manager</option></select></div>
          <div style={{ flex: 1 }}><label style={{ fontSize: 13, fontWeight: 700, color: "#5e6675", display: "block", marginBottom: 4 }}>Time</label><select style={F} value={nf.time} onChange={e => setNf(f=>({...f,time:e.target.value}))}><option value="any">Any</option><option value="early">Early</option><option value="late">Late</option></select></div>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <LabeledInput label="Start date" type="date" value={nf.startDate} onChange={v => setNf(f=>({...f,startDate:v}))} />
          <LabeledInput label="End date" type="date" value={nf.endDate} onChange={v => setNf(f=>({...f,endDate:v}))} />
        </div>
        {nfErr && <p style={{ fontSize: 13, color: "#A32D2D", marginBottom: 12 }}>{nfErr}</p>}
        <ModalActions disabled={notifyLoading} onCancel={() => setShowNotifyModal(false)} onConfirm={submitNotify} text={notifyLoading ? "Saving..." : "Save notification"} />
      </Modal>}

      {/* ── BULK POST MODAL ───────────────────────────── */}
      {showBulkPostModal && <Modal onClose={() => setShowBulkPostModal(false)} z={119}>
        <h2 style={{ fontSize: 18, margin: "0 0 4px" }}>Post multiple shifts</h2>
        <p style={{ fontSize: 13, color: "#5e6675", margin: "0 0 16px", lineHeight: 1.5 }}>Fast mode for posting several normal shifts. For swaps or preferred applicants, use the regular single-post flow.</p>
        <LabeledInput label="Your name" value={bulkName} onChange={setBulkName} placeholder="Albert Einstein" />
        <LabeledInput label="Your email" type="email" value={bulkEmail} onChange={v => { setBulkEmail(v); setBulkEmailOk(false); }} placeholder="aeinstein@cityofevanston.org" />
        <CheckBox checked={bulkEmailOk} onChange={setBulkEmailOk}>I confirm this is my correct email.</CheckBox>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: "#5e6675", textTransform: "uppercase", letterSpacing: "0.5px" }}>Rows</div>
          <button onClick={addBulkRow} style={{ ...btn2, padding: "6px 10px", fontSize: 12 }}>Add row</button>
        </div>
        {bulkRows.map((row, idx) => {
          const result = bulkResults[row.tempId];
          return <div key={row.tempId} style={{ border: "0.5px solid #e0e3e8", borderRadius: 14, padding: 12, marginBottom: 10, background: "#f6f7f9" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 8 }}><b style={{ fontSize: 13 }}>Shift {idx + 1}</b>{bulkRows.length > 1 && <button onClick={() => removeBulkRow(row.tempId)} style={{ ...btn2, padding: "3px 8px", fontSize: 11 }}>Remove</button>}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
              <select style={F} value={row.type} onChange={e => updateBulkRow(row.tempId, { type: e.target.value })}><option value="guard">Guard</option><option value="manager">Manager</option></select>
              <select style={F} value={row.time} onChange={e => updateBulkRow(row.tempId, { time: e.target.value })}><option value="early">Early</option><option value="late">Late</option></select>
            </div>
            <input style={{ ...F, marginBottom: 8 }} type="date" value={row.date} onChange={e => updateBulkRow(row.tempId, { date: e.target.value })} />
            <input style={F} value={row.note} onChange={e => updateBulkRow(row.tempId, { note: e.target.value })} placeholder="Private LC note, optional" />
            {result?.status === "needs_selection" && <div style={{ marginTop: 8 }}><WarningBox>Vector found multiple shifts for this row. Choose the exact shift, then validate again.</WarningBox><select style={F} value={row.selectedVectorShiftId} onChange={e => updateBulkRow(row.tempId, { selectedVectorShiftId: e.target.value })}><option value="">Select a Vector shift...</option>{arr(result.shifts).map((s, idx) => <option key={bulkShiftKey(s, idx)} value={s.shift_id}>{vectorShiftLabel(s)}</option>)}</select></div>}
            {result?.status === "valid" && <div style={{ marginTop: 8, fontSize: 12, color: "#27500A" }}>Ready: {result.data?.selectedPosterShift ? vectorShiftLabel(result.data.selectedPosterShift) : "Vector confirmed"}</div>}
            {result?.warnings?.length > 0 && <div style={{ marginTop: 8 }}>{result.warnings.map(w => <WarningBox key={w}>{w}</WarningBox>)}</div>}
            {result?.status === "error" && <div style={{ marginTop: 8, fontSize: 12, color: "#8A1F1F" }}>{result.error}</div>}
            {result?.status === "empty" && <div style={{ marginTop: 8, fontSize: 12, color: "#8A1F1F" }}>{result.error}</div>}
          </div>;
        })}
        {bulkErr && <p style={{ fontSize: 13, color: "#A32D2D", marginBottom: 12 }}>{bulkErr}</p>}
        {bulkStage === "review" && <InfoBlock badge="review">{Object.values(bulkResults).filter(r => r.status === "valid").length} row(s) ready to post. Rows with errors or exact-shift selections needed will not be submitted.</InfoBlock>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
          <button onClick={() => setShowBulkPostModal(false)} style={btn2}>Cancel</button>
          <button disabled={bulkLoading} onClick={validateBulkPosts} style={btn2}>{bulkLoading ? "Checking..." : "Validate rows"}</button>
          <button disabled={bulkLoading || bulkStage !== "review" || Object.values(bulkResults).filter(r => r.status === "valid").length === 0} onClick={confirmBulkPosts} style={{ ...btnP, opacity: bulkLoading || bulkStage !== "review" || Object.values(bulkResults).filter(r => r.status === "valid").length === 0 ? 0.55 : 1 }}>{bulkLoading ? "Posting..." : "Post valid rows"}</button>
        </div>
      </Modal>}

      {/* ── POST MODAL ───────────────────────────────── */}
      {showPostModal && <Modal onClose={() => setShowPostModal(false)}>
        <h2 style={{ fontSize: 18, margin: "0 0 8px" }}>Post a shift</h2>
        <p style={{ fontSize: 13, color: "#5e6675", margin: "0 0 18px", lineHeight: 1.5 }}>First confirm who you are, then choose whether you want to post one assigned Vector shift or several.</p>

        {postStep === "identity" && <>
          <LabeledInput label="Your name (first and last)" value={pf.name} onChange={v => setPf(p=>({...p,name:v}))} placeholder="Albert Einstein" />
          <LabeledInput label="Your email" hint="use the same email every time" type="email" value={pf.email} onChange={v => { setPf(p=>({...p,email:v})); setPfEmailOk(false); }} placeholder="aeinstein@cityofevanston.org" />
          <CheckBox checked={pfEmailOk} onChange={setPfEmailOk}>I confirm this is the correct email address and that I will use this same email for future posts/applications.</CheckBox>
          {pfErr && <p style={{ fontSize: 13, color: "#A32D2D", marginBottom: 12 }}>{pfErr}</p>}
          <ModalActions disabled={actionLoading} onCancel={() => setShowPostModal(false)} onConfirm={verifyPosterIdentity} text={actionLoading ? "Checking..." : "Next"} />
        </>}

        {postStep === "mode" && <>
          <InfoBlock badge="confirmed">Vector confirmed {pf.name || "this person"}. What do you want to post?</InfoBlock>
          <div style={{ display: "grid", gap: 10, marginBottom: 16 }}>
            <button type="button" style={{ ...btn2, textAlign: "left", padding: 14 }} onClick={() => { setMultiMode(false); setPostStep("single"); setPfErr(""); }}><b>Post one shift</b><br/><span style={{ fontSize: 12, color: "#5e6675" }}>Choose a date, then select the exact Vector shift you are giving up.</span></button>
            <button type="button" style={{ ...btn2, textAlign: "left", padding: 14 }} onClick={() => { setMultiMode(true); setPostStep("multi"); setMultiErr(""); }}><b>Post multiple shifts</b><br/><span style={{ fontSize: 12, color: "#5e6675" }}>Choose a date range and check the assigned Vector shifts you want to post.</span></button>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
            <button type="button" style={btn2} onClick={() => setPostStep("identity")}>Back</button>
            <button type="button" style={btn2} onClick={() => setShowPostModal(false)}>Cancel</button>
          </div>
        </>}

        {postStep === "multi" && (() => {
          const selectedRows = selectedMultiRows();
          const currentRow = selectedRows[Math.min(multiConfigIndex, Math.max(selectedRows.length - 1, 0))];
          const currentCfg = currentRow?.cfg || {};
          const currentShift = currentRow?.shift;
          const currentKey = currentRow?.key;
          const currentType = currentShift ? inferTypeFromVectorShift(currentShift) : "guard";
          const currentTime = currentShift ? inferTimeFromVectorShift(currentShift) : "early";
          return <div style={{ padding: 16, border: "0.5px solid #85B7EB", borderRadius: 12, background: "#F5FAFF", marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#0C447C", marginBottom: 6 }}>Post multiple from Vector</div>
            <div style={{ fontSize: 12, color: "#5e6675", lineHeight: 1.5, marginBottom: 12 }}>First choose the assigned Vector shifts you want to post. Then the app will walk through them one at a time for normal/preferred/swap details.</div>

            {multiStage === "pick" && <>
              <div style={{ display: "flex", gap: 12 }}>
                <LabeledInput label="Start date" type="date" min={chicagoTodayStr()} value={multiStartDate} onChange={setMultiStartDate} />
                <LabeledInput label="End date" type="date" min={multiStartDate || chicagoTodayStr()} value={multiEndDate} onChange={setMultiEndDate} />
              </div>
              <button type="button" disabled={multiLoading} onClick={loadMultiVectorShifts} style={{ ...btn2, marginBottom: 12 }}>{multiLoading ? "Loading..." : "Load my Vector shifts"}</button>
              {multiErr && <p style={{ fontSize: 13, color: "#A32D2D", margin: "4px 0 12px" }}>{multiErr}</p>}
              {multiShifts.length > 0 && <div style={{ display: "grid", gap: 10 }}>
                {multiShifts.map((s, idx) => {
                  const key = bulkShiftKey(s, idx);
                  const cfg = multiSelected[key] || {};
                  const selected = cfg.selected === true;
                  const type = inferTypeFromVectorShift(s);
                  const time = inferTimeFromVectorShift(s);
                  return <div key={key} style={{ border: `0.5px solid ${selected ? "#85B7EB" : "#e0e3e8"}`, borderRadius: 12, background: selected ? "#fff" : "#f6f7f9", padding: 12 }}>
                    <label style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer" }}>
                      <input type="checkbox" checked={selected} onChange={e => updateMultiRow(key, { selected: e.target.checked })} style={{ marginTop: 4 }} />
                      <span style={{ flex: 1 }}>
                        <b>{fmtDate(vectorShiftDate(s))} · {time === "late" ? "Late" : "Early"} {type === "manager" ? "Manager" : "Guard"}</b><br/>
                        <span style={{ fontSize: 12, color: "#5e6675" }}>{vectorShiftLabel(s)}</span>
                      </span>
                    </label>
                  </div>;
                })}
              </div>}
              {multiShifts.length > 0 && <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginTop: 12 }}>
                <button type="button" style={btn2} onClick={() => setPostStep("mode")}>Back</button>
                <button type="button" disabled={multiLoading || selectedRows.length === 0} onClick={startMultiConfigure} style={{ ...btnP, opacity: multiLoading || selectedRows.length === 0 ? 0.55 : 1 }}>Next: configure selected ({selectedRows.length})</button>
              </div>}
            </>}

            {multiStage === "configure" && currentRow && <>
              <InfoBlock badge={`${multiConfigIndex + 1}/${selectedRows.length}`}>Configure this selected shift. The app checks this shift before moving to the next one, so errors get caught immediately.</InfoBlock>
              <div style={{ padding: 12, border: "0.5px solid #c7ccd4", borderRadius: 12, background: "#fff", marginBottom: 12 }}>
                <b>{fmtDate(vectorShiftDate(currentShift))} · {currentTime === "late" ? "Late" : "Early"} {currentType === "manager" ? "Manager" : "Guard"}</b><br/>
                <span style={{ fontSize: 12, color: "#5e6675" }}>{vectorShiftLabel(currentShift)}</span>
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#5e6675", marginBottom: 6 }}>Is this a normal post, preferred applicant, or requested swap?</div>
              <select style={{ ...F, marginBottom: 8 }} value={currentCfg.mode || "normal"} onChange={e => updateMultiRow(currentKey, { mode: e.target.value })}>
                <option value="normal">Normal post</option>
                <option value="preferred">Preferred applicant</option>
                <option value="swap">Requested swap</option>
              </select>
              <input style={{ ...F, marginBottom: 8 }} value={currentCfg.note || ""} onChange={e => updateMultiRow(currentKey, { note: e.target.value })} placeholder="Private LC note, optional" />
              {(currentCfg.mode || "normal") === "preferred" && <div style={{ display: "grid", gap: 8, marginBottom: 10 }}>
                <InfoBlock badge="preferred">Preferred applicants are advisory only. LCs can still approve someone else.</InfoBlock>
                <input style={F} value={currentCfg.prefName || ""} onChange={e => updateMultiRow(currentKey, { prefName: e.target.value })} placeholder="Preferred applicant name" />
                <input style={F} type="email" value={currentCfg.prefEmail || ""} onChange={e => updateMultiRow(currentKey, { prefEmail: e.target.value })} placeholder="Preferred applicant email" />
                <textarea style={{ ...F, minHeight: 54 }} value={currentCfg.prefReason || ""} onChange={e => updateMultiRow(currentKey, { prefReason: e.target.value })} placeholder="Reason required" />
              </div>}
              {(currentCfg.mode || "normal") === "swap" && <div style={{ display: "grid", gap: 8, marginBottom: 10 }}>
                <InfoBlock badge="swap">This is not guaranteed. Your swap partner still needs to apply with the same email you enter here.</InfoBlock>
                <input style={F} value={currentCfg.swapName || ""} onChange={e => updateMultiRow(currentKey, { swapName: e.target.value, swapMismatchWarning: "", swapMismatchConfirmed: false })} placeholder="Swap partner name" />
                <input style={F} type="email" value={currentCfg.swapEmail || ""} onChange={e => updateMultiRow(currentKey, { swapEmail: e.target.value, swapMismatchWarning: "", swapMismatchConfirmed: false })} placeholder="Swap partner email" />
                <div style={{ display: "flex", gap: 8 }}>
                  <select style={F} value={currentCfg.swapType || "guard"} onChange={e => updateMultiRow(currentKey, { swapType: e.target.value, swapMismatchWarning: "", swapMismatchConfirmed: false })}><option value="guard">Guard</option><option value="manager">Manager</option></select>
                  <select style={F} value={currentCfg.swapTime || "early"} onChange={e => updateMultiRow(currentKey, { swapTime: e.target.value, swapMismatchWarning: "", swapMismatchConfirmed: false })}><option value="early">Early</option><option value="late">Late</option></select>
                </div>
                <input style={F} type="date" min={chicagoTodayStr()} value={currentCfg.swapDate || vectorShiftDate(currentShift)} onChange={e => updateMultiRow(currentKey, { swapDate: e.target.value, swapMismatchWarning: "", swapMismatchConfirmed: false })} />
                {currentCfg.swapMismatchWarning && <WarningBox>
                  <b>Double-check this swap:</b> {currentCfg.swapMismatchWarning}
                  <div style={{ marginTop: 8 }}>
                    <label style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer", color: "#8A5A00" }}>
                      <input type="checkbox" checked={currentCfg.swapMismatchConfirmed === true} onChange={e => updateMultiRow(currentKey, { swapMismatchConfirmed: e.target.checked })} style={{ marginTop: 3 }} />
                      <span>I confirm this is the exact shift the swap partner is giving up.</span>
                    </label>
                  </div>
                </WarningBox>}
              </div>}
              {multiErr && <p style={{ fontSize: 13, color: "#A32D2D", margin: "4px 0 12px" }}>{multiErr}</p>}
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 12 }}>
                <button type="button" style={btn2} onClick={() => { setMultiErr(""); if (multiConfigIndex === 0) setMultiStage("pick"); else setMultiConfigIndex(i => i - 1); }}>Back</button>
                <button type="button" disabled={multiLoading} style={{ ...btnP, opacity: multiLoading ? 0.55 : 1 }} onClick={nextMultiConfig}>{multiLoading ? "Checking..." : multiConfigIndex < selectedRows.length - 1 ? "Check and next shift" : "Check and review selected shifts"}</button>
              </div>
            </>}

            {multiStage === "review" && <>
              <InfoBlock badge="review">Review the selected shifts below. The app will validate all of them before posting anything.</InfoBlock>
              {multiErr && <p style={{ fontSize: 13, color: "#A32D2D", margin: "4px 0 12px" }}>{multiErr}</p>}
              <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
                {selectedRows.map((row, idx) => {
                  const cfg = row.cfg || {};
                  const mode = cfg.mode || "normal";
                  const dry = multiDryRunResults.find(r => r.row?.key === row.key);
                  return <div key={`review-${row.key}`} style={{ padding: 10, border: "0.5px solid #e0e3e8", borderRadius: 10, background: "#fff" }}>
                    <b>{idx + 1}. {fmtDate(vectorShiftDate(row.shift))} · {inferTimeFromVectorShift(row.shift) === "late" ? "Late" : "Early"} {inferTypeFromVectorShift(row.shift) === "manager" ? "Manager" : "Guard"}</b><br/>
                    <span style={{ fontSize: 12, color: "#5e6675" }}>{vectorShiftLabel(row.shift)}</span><br/>
                    <span style={{ fontSize: 12, color: mode === "swap" ? "#0C447C" : mode === "preferred" ? "#8A5A00" : "#5e6675" }}>{mode === "swap" ? `Swap with ${cfg.swapName || "(missing name)"} on ${fmtDate(cfg.swapDate)}` : mode === "preferred" ? `Preferred: ${cfg.prefName || "(missing name)"}` : "Normal post"}</span>
                    {dry && !dry.ok && <div style={{ fontSize: 12, color: "#A32D2D", marginTop: 4 }}>Needs attention: {dry.error}</div>}
                    {dry && dry.ok && <div style={{ fontSize: 12, color: "#2F6F46", marginTop: 4 }}>Validated</div>}
                  </div>;
                })}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <button type="button" style={btn2} onClick={() => { setMultiErr(""); setMultiStage("configure"); setMultiConfigIndex(Math.max(0, selectedRows.length - 1)); }}>Back</button>
                <button type="button" disabled={multiLoading || selectedRows.length === 0} onClick={confirmMultiPostFromVector} style={{ ...btnP, opacity: multiLoading || selectedRows.length === 0 ? 0.55 : 1 }}>{multiLoading ? "Checking..." : `Validate and post (${selectedRows.length})`}</button>
              </div>
            </>}
          </div>;
        })()}

        {postStep === "single" && <>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <button type="button" style={btn2} onClick={() => setPostStep("mode")}>Back</button>
          <span style={{ fontSize: 12, color: "#5e6675" }}>Posting as <b>{pf.name}</b></span>
        </div>
        {!pf.lcOverride && <>
          <LabeledInput label="What date is the shift?" type="date" min={chicagoTodayStr()} value={pf.date} onChange={v => { setPf(p=>({...p,date:v,selectedVectorShiftId:""})); setSingleSelectedKey(""); setSingleVectorShifts([]); setSingleVectorErr(""); }} />
          {postDateWarnings(pf.date).filter(w => !w.includes("already passed")).map(w => <WarningBox key={w}>{w}</WarningBox>)}
          <button type="button" disabled={singleVectorLoading || !pf.date} onClick={loadSingleVectorShifts} style={{ ...btn2, marginBottom: 12 }}>{singleVectorLoading ? "Loading..." : "Load my Vector shifts for this date"}</button>
          {singleVectorErr && <p style={{ fontSize: 13, color: "#A32D2D", margin: "4px 0 12px" }}>{singleVectorErr}</p>}
          {singleVectorShifts.length > 0 && <div style={{ display: "grid", gap: 10, marginBottom: 16 }}>
            {singleVectorShifts.map((s, idx) => {
              const rowKey = bulkShiftKey(s, idx);
              const selected = singleSelectedKey === rowKey;
              const type = inferTypeFromVectorShift(s);
              const time = inferTimeFromVectorShift(s);
              return <button type="button" key={rowKey} onClick={() => { setSingleSelectedKey(rowKey); setPf(p=>({...p,selectedVectorShiftId:String(s.shift_id || ""), type, time, date: vectorShiftDate(s) || p.date})); }} style={{ ...btn2, textAlign: "left", borderColor: selected ? "#85B7EB" : "#c7ccd4", background: selected ? "#F5FAFF" : "#fff", padding: 12 }}>
                <b>{fmtDate(vectorShiftDate(s) || pf.date)} · {time === "late" ? "Late" : "Early"} {type === "manager" ? "Manager" : "Guard"}</b><br/>
                <span style={{ fontSize: 12, color: "#5e6675" }}>{vectorShiftLabel(s)}</span>
              </button>;
            })}
          </div>}
          {pf.selectedVectorShiftId && <InfoBlock badge="selected">Selected Vector shift: {singleVectorShifts.find(s => String(s.shift_id) === String(pf.selectedVectorShiftId)) ? vectorShiftLabel(singleVectorShifts.find(s => String(s.shift_id) === String(pf.selectedVectorShiftId))) : `${pf.time} ${pf.type}`}</InfoBlock>}
        </>}
        {pf.lcOverride && <>
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
          <LabeledInput label="Date" type="date" min={chicagoTodayStr()} value={pf.date} onChange={v => setPf(p=>({...p,date:v}))} />
        </>}
        {lcAuth && <CheckBox checked={pf.lcOverride} onChange={v => { setPf(p=>({...p,lcOverride:v,selectedVectorShiftId:""})); setPostVectorResult(null); }}>
          LC-created open shift, post without poster Vector confirmation.
        </CheckBox>}
        {pf.lcOverride && <div style={{ padding: 16, border: "0.5px solid #D9B451", borderRadius: 12, background: "#FFF9E8", marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#8A5A00", marginBottom: 12 }}>LC-created open shift details</div>
          <LabeledInput label="Shift length in hours" type="number" value={pf.lcShiftLength} onChange={v => setPf(p=>({...p,lcShiftLength:v}))} placeholder="Example: 6" />
          <div style={{ display: "flex", gap: 12 }}>
            <LabeledInput label="Start time, optional" value={pf.lcShiftStart} onChange={v => setPf(p=>({...p,lcShiftStart:v}))} placeholder="Example: 8:45 AM" />
            <LabeledInput label="End time, optional" value={pf.lcShiftEnd} onChange={v => setPf(p=>({...p,lcShiftEnd:v}))} placeholder="Example: 2:45 PM" />
          </div>
          <div style={{ fontSize: 12, color: "#8A5A00", lineHeight: 1.5 }}>This creates a Shift Swap posting only. It does not edit Vector.</div>
        </div>}
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

        {postVectorResult?.needsShiftSelection && postVectorResult.selectionFor === "poster" && <div style={{ padding: 16, border: "0.5px solid #85B7EB", borderRadius: 12, background: "#E6F1FB", marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#0C447C", marginBottom: 8 }}>Choose exact Vector shift</div>
          <select style={F} value={pf.selectedVectorShiftId} onChange={e => setPf(p=>({...p,selectedVectorShiftId:e.target.value}))}>
            <option value="">Select a Vector shift...</option>
            {arr(postVectorResult.shifts).map((s, idx) => <option key={bulkShiftKey(s, idx)} value={s.shift_id}>{vectorShiftLabel(s)}</option>)}
          </select>
        </div>}
        {postVectorResult?.needsShiftSelection && postVectorResult.selectionFor === "swap" && <div style={{ padding: 16, border: "0.5px solid #85B7EB", borderRadius: 12, background: "#E6F1FB", marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#0C447C", marginBottom: 8 }}>Choose exact swap partner Vector shift</div>
          <select style={F} value={pf.selectedSwapVectorShiftId} onChange={e => setPf(p=>({...p,selectedSwapVectorShiftId:e.target.value}))}>
            <option value="">Select their Vector shift...</option>
            {arr(postVectorResult.shifts).map((s, idx) => <option key={bulkShiftKey(s, idx)} value={s.shift_id}>{vectorShiftLabel(s)}</option>)}
          </select>
        </div>}
        {pfErr && <p style={{ fontSize: 13, color: "#A32D2D", marginBottom: 12 }}>{pfErr}</p>}
        </>}
        {postStep === "single" && <ModalActions disabled={actionLoading || singleVectorLoading} onCancel={() => setShowPostModal(false)} onConfirm={async () => { if (await validatePost()) setPostConfirmOpen(true); }} text="Review post" />}
      </Modal>}

      {/* Post confirmation */}
      {postConfirmOpen && (() => {
        const swapMismatch = pf.isSwap ? swapTimeMismatchNotice(pf.swapTime, postVectorResult?.selectedSwapShift) : null;
        return <Modal onClose={() => setPostConfirmOpen(false)} z={140}>
          <h2 style={{ fontSize: 18, margin: "0 0 8px" }}>Confirm shift post</h2>
          <p style={{ fontSize: 14, color: "#5e6675", margin: "0 0 16px" }}>Review this before it goes on the public board.</p>
          {postWarnings.length > 0 && <div style={{ marginBottom: 12 }}>{postWarnings.map(w => <WarningBox key={w}>{w}</WarningBox>)}</div>}
          {swapMismatch && <WarningBox>
            <b>Confirm the swap partner's exact Vector shift.</b><br/>
            You marked their shift as <b>{swapMismatch.selected}</b>, but Vector says the exact matched shift looks like <b>{swapMismatch.actualLabel}</b>.
            <div style={{ marginTop: 6 }}>Exact Vector shift: <b>{swapMismatch.vectorLabel}</b></div>
            <div style={{ marginTop: 10 }}>
              <label style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer", color: "#8A5A00" }}>
                <input type="checkbox" checked={singleSwapMismatchOk} onChange={e => setSingleSwapMismatchOk(e.target.checked)} style={{ marginTop: 3 }} />
                <span>I confirm this is the exact shift the swap partner is giving up.</span>
              </label>
            </div>
          </WarningBox>}
          <SummaryBox rows={[["Name",postVectorResult?.posterVector?.vectorUser?.full_name || pf.name],["Email",pf.email],["Shift",`${pf.date?fmtDate(pf.date):""} ${pf.type} ${pf.time}`],["Vector",pf.lcOverride?`LC-created open shift · ${pf.lcShiftLength} hrs`:postVectorResult?.selectedPosterShift?vectorShiftLabel(postVectorResult.selectedPosterShift):"Confirmed"],["Swap",pf.isSwap?postVectorResult?.swapVector?.vectorUser?.full_name ? `Yes, with ${postVectorResult.swapVector.vectorUser.full_name}` : `Yes, with ${pf.swapName}`:"No"],pf.isSwap && postVectorResult?.selectedSwapShift?["Swap partner Vector shift",vectorShiftLabel(postVectorResult.selectedSwapShift)]:null,["Preferred",pf.hasPreferred?postVectorResult?.payloadPreview?.preferred_vector_full_name ? `Yes: ${postVectorResult.payloadPreview.preferred_vector_full_name}` : `Yes: ${pf.prefName}`:"No"],pf.hasPreferred?["Reason",pf.prefReason]:null,["LC note",pf.note||"None"]].filter(Boolean)} />
          <ModalActions disabled={actionLoading || (swapMismatch && !singleSwapMismatchOk)} onCancel={() => setPostConfirmOpen(false)} onConfirm={confirmPost} text="Post shift" />
        </Modal>;
      })()}

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

        const doValidate = async () => {
          if (!aName.trim()||!email) { setAErr("Fill in your name and email."); return; }
          if (!aEmailOk) { setAErr("Confirm that you used the correct email address."); return; }
          if (shift.poster_email === email) {
            setApplyActionPrompt({
              kind: "self_shift",
              shiftId: shift.id,
              email,
              shift: { id: shift.id, poster_name: canonicalPosterName(shift), poster_email: shift.poster_email, date: shift.date, type: shift.type, time: shift.time },
              message: "This is your own shift. You cannot apply to it, but you can delete the posting instead.",
            });
            setAErr("");
            return;
          }

          const getTargetShift = (id) => id === showApplyModal ? shift : identicalShifts.find(x => x.id === id);
          const validIds = allTargetIds.filter(id => {
            const s = getTargetShift(id);
            return s && s.poster_email !== email;
          });

          const specialNeeded = validIds.filter(id => !!getSpecial(getTargetShift(id)));
          const missing = specialNeeded.filter(id => !aSpecialIds.includes(id));
          if (missing.length > 0) { setAErr("Confirm all special swap/preferred-applicant details before applying. If any are incorrect, contact an LC."); return; }

          setActionLoading(true);
          try {
            const res = await fetch("/api/apply-shift", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ shiftIds: validIds, name: aName.trim(), email, note: aNote.trim(), dryRun: true }) });
            const data = await res.json().catch(() => ({ success:false, error:"Server returned an invalid response." }));
            if (!res.ok || !data.success) {
              if (handleApplyBlockedResponse(data, email)) return;
              setAErr(data.error || "Vector blocked this application.");
              return;
            }
            setAErr("");
            setPendingApply({ shiftIds: validIds, name: aName.trim(), email, note: aNote.trim(), vectorReviews: data.reviews || [] });
          } finally {
            setActionLoading(false);
          }
        };

        return <Modal onClose={() => setShowApplyModal(null)}>
          <h2 style={{ fontSize: 18, margin: "0 0 4px" }}>Apply for shift</h2>
          <div style={{ fontSize: 13, color: "#5e6675", marginBottom: 20, display: "flex", gap: 6, flexWrap: "wrap" }}>
            <span style={B(c.bg,c.text)}>{shift.type}</span>
            <span style={B("#f6f7f9","#5e6675")}>{shift.time}</span>
            <span>{fmtDate(shift.date)} — posted by {canonicalPosterName(shift)}</span>
          </div>
          <LabeledInput label="Your name (first and last)" value={aName} onChange={setAName} placeholder="Albert Einstein" />
          <LabeledInput label="Your email" hint="use the same email every time" type="email" value={aEmail} onChange={v => { setAEmail(v); setAEmailOk(false); setASpecialIds([]); }} placeholder="aeinstein@cityofevanston.org" />
          <CheckBox checked={aEmailOk} onChange={setAEmailOk}>I confirm this is the correct email address and that I will use this same email every time.</CheckBox>
          <InfoBlock badge="Vector hours">Vector will check whether you are already scheduled on this date and calculate your Monday–Sunday weekly hours. OT is flagged for LCs but does not automatically block your application.</InfoBlock>
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
              {fmtDate(shift.date)} {shift.type} {shift.time} — posted by {canonicalPosterName(s)}
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
                  <div style={{ fontSize: 13, color: "#5e6675", lineHeight: 1.5 }}>For <b>{canonicalPosterName(s)}</b>'s {s.type} {s.time} shift on {fmtDate(s.date)}: you would take their shift, and they would take your {s.swap_partner_type} {s.swap_partner_time} shift on {fmtDate(s.swap_partner_date)}.</div>
                ) : (
                  <div style={{ fontSize: 13, color: "#5e6675", lineHeight: 1.5 }}>For <b>{canonicalPosterName(s)}</b>'s {s.type} {s.time} shift on {fmtDate(s.date)}: you were listed as the preferred applicant, but approval is not guaranteed, even if money or another arrangement was involved.</div>
                )}
                <CheckBox checked={aSpecialIds.includes(s.id)} onChange={v => setASpecialIds(prev => v ? [...new Set([...prev, s.id])] : prev.filter(x => x !== s.id))}>{isSwap ? "I confirm this swap information is correct." : "I confirm I understand I was listed as preferred, but approval is not guaranteed."}</CheckBox>
                {!aSpecialIds.includes(s.id) && <div style={{ marginTop: -8, marginBottom: 12, fontSize: 12, color: "#8A1F1F" }}>If this is not correct, do not apply. Contact an LC.</div>}
              </div>;
            })}

          <CheckBox checked={aConfirmed} onChange={setAConfirmed}>I confirm I can work this shift if selected. Vector will check whether I am already scheduled on this date.</CheckBox>
          {aErr && <p style={{ fontSize: 13, color: "#A32D2D", marginBottom: 12 }}>{aErr}</p>}
          <ModalActions disabled={actionLoading} onCancel={() => setShowApplyModal(null)} onConfirm={doValidate} text="Review application" />
        </Modal>;
      })()}

      {/* Apply confirmation */}
      {pendingApply && <Modal onClose={() => setPendingApply(null)} z={140}>
        <h2 style={{ fontSize: 18, margin: "0 0 8px" }}>Confirm application</h2>
        <p style={{ fontSize: 14, color: "#5e6675", margin: "0 0 16px" }}>Make sure this is right before submitting.</p>
        <SummaryBox rows={[["Name",pendingApply.vectorReviews?.[0]?.eligibility?.vectorUser?.full_name || pendingApply.name],["Email",pendingApply.email],["Vector hours",pendingApply.vectorReviews?.[0]?.eligibility?.week ? `${pendingApply.vectorReviews[0].eligibility.week.vectorWeekHours} current · ${pendingApply.vectorReviews[0].eligibility.week.projectedAfterApproval} projected${pendingApply.vectorReviews[0].eligibility.week.wouldBeOT?" · OT":""}` : "Checked"],["Note",pendingApply.note||"None"],["Applying to",pendingApply.shiftIds.length+" shift"+(pendingApply.shiftIds.length>1?"s":"")]]} />
        <ModalActions disabled={actionLoading} onCancel={() => setPendingApply(null)} onConfirm={confirmApply} text="Submit application" />
      </Modal>}

      {/* ── APPROVAL CONFIRMATION ─────────────────────── */}
      {pendingApproval && (() => {
        const app = apps.find(a => a.id === pendingApproval.appId);
        const shift = shifts.find(s => s.id === pendingApproval.shiftId);
        if (!app || !shift) return null;
        const st = getStats(app.applicant_email, shift.date);
        const preflightHours = approvalPreflight?.checks?.hours;
        const currentHours = preflightHours?.current;
        const applicationHours = preflightHours?.applicationTime;
        const isOt = currentHours ? !!currentHours.wouldBeOT : (!!app.applicant_vector_would_be_ot || Number(app.hours_after_shift) > 40);
        return <Modal onClose={() => setPendingApproval(null)} z={145}>
          <h2 style={{ fontSize: 18, margin: "0 0 8px", color: isOt ? "#8A1F1F" : "#172033" }}>Confirm approval</h2>
          <p style={{ fontSize: 14, color: "#5e6675", margin: "0 0 16px", lineHeight: 1.5 }}>This approves the applicant, closes the shift, and declines their other same-day applications. The shift then lands in the <b>To-do</b> tab so an LC can update Vector manually.</p>
          {isOt && <div style={{ borderRadius: 12, padding: "10px 12px", marginBottom: 12, fontSize: 13, background: "#FFF6F6", border: "0.5px solid #D6A4A4", color: "#8A1F1F" }}><b>OT warning:</b> Vector projects {currentHours?.projectedAfterApproval ?? app.applicant_vector_projected_hours ?? app.hours_after_shift} hours after this shift.</div>}
          <SummaryBox rows={[["Applicant",canonicalAppName(app)],["Email",app.applicant_email],["Posted shift",`${fmtDate(shift.date)} · ${storedVectorShiftLabel(shift, "poster")}`],shift.is_swap && emailMatches(app.applicant_email, shift.swap_partner_email) ? ["Swap partner gives up",`${fmtDate(shift.swap_partner_date)} · ${storedVectorShiftLabel(shift, "swap_partner")}`] : null,["Posted by",canonicalPosterName(shift)],["Hours at application",app.applicant_vector_week_hours != null ? `${app.applicant_vector_week_hours} current · ${app.applicant_vector_projected_hours} projected${app.applicant_vector_would_be_ot?" · OT":""}` : `${app.hours_after_shift}${app.applicant_vector_would_be_ot?" · OT":""}`],currentHours?["Hours checked now",`${currentHours.vectorWeekHours} current · ${currentHours.projectedAfterApproval} projected${currentHours.wouldBeOT?" · OT":""}`]:["Hours checked now",approvalPreflightLoading?"Checking Vector...":"Not checked yet"],app.applicant_note?["App note",app.applicant_note]:null,["Approved this week",st.priorApprovals.length?st.priorApprovals.map(p=>`${fmtDate(p.date)} ${p.type} ${p.time} (${p.hours} hrs)`).join("; "):"None"]].filter(Boolean)} />
          <div style={{ marginBottom: 12 }}>
            {approvalPreflightLoading && <InfoBlock badge="Vector preflight">Checking Vector now...</InfoBlock>}
            {approvalPreflight && !approvalPreflight.success && <WarningBox>{approvalPreflight.error || "Vector preflight failed."}</WarningBox>}
            {approvalPreflight?.success && <>
              {arr(approvalPreflight.blockers).length > 0 && <WarningBox><b>Vector blockers:</b> {arr(approvalPreflight.blockers).join("; ")}</WarningBox>}
              {arr(approvalPreflight.warnings).length > 0 && <WarningBox><b>Vector warnings:</b> {arr(approvalPreflight.warnings).join("; ")}</WarningBox>}
              {approvalPreflight.checks?.hours?.current && <InfoBlock badge="Current Vector hours">
                Hours current now: <b>{approvalPreflight.checks.hours.current.vectorWeekHours}</b> · Hours projected if approved now: <b>{approvalPreflight.checks.hours.current.projectedAfterApproval}</b>{approvalPreflight.checks.hours.current.wouldBeOT ? " · OT" : ""}.
              </InfoBlock>}
              <InfoBlock badge="Vector sync" gold>{approvalPreflight.syncDisabledReason || "Vector sync is not enabled yet."}</InfoBlock>
            </>}
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap", marginTop: 16 }}>
            <button onClick={() => setPendingApproval(null)} style={btn2}>Cancel</button>
            <button disabled style={{ ...btnP, opacity: 0.45, background: "#1a2744" }} title="Vector sync writes are not enabled yet.">Approve + Vector sync (coming later)</button>
            <button disabled={actionLoading || approvalPreflightLoading} onClick={confirmApproval} style={{ ...btnP, background: isOt ? "#8A1F1F" : "#1D9E75" }}>Approve (Shift Swap only)</button>
          </div>
        </Modal>;
      })()}

      {/* ── MY ACTIVITY ───────────────────────────────── */}
      {showMineModal && <Modal onClose={() => setShowMineModal(false)} z={120}>
        <h2 style={{ fontSize: 18, margin: "0 0 4px" }}>My activity</h2>
        <p style={{ fontSize: 13, color: "#5e6675", margin: "0 0 16px", lineHeight: 1.5 }}>Look up everything posted or applied for under your email.</p>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", marginBottom: 16 }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 13, fontWeight: 700, color: "#5e6675", display: "block", marginBottom: 4 }}>Your email</label>
            <input style={F} type="email" value={mineEmail} onChange={e => setMineEmail(e.target.value)} onKeyDown={e => { if (e.key === "Enter") lookupMine(); }} placeholder="aeinstein@cityofevanston.org" />
          </div>
          <button disabled={mineLoading || !mineEmail.trim()} onClick={() => lookupMine()} style={{ ...btnP, opacity: mineLoading || !mineEmail.trim() ? 0.6 : 1 }}>{mineLoading ? "Looking..." : "Look up"}</button>
        </div>

        {mine && <>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#5e6675", margin: "0 0 8px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Shifts you posted</div>
          {mine.posts.length === 0 && <Empty>No posted shifts under this email.</Empty>}
          {mine.posts.map(s => (
            <div key={s.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 12px", borderRadius: 12, background: "#f6f7f9", marginBottom: 6, fontSize: 13, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <b>{fmtDate(s.date)}</b>
                <span style={B(tc(s.type).bg, tc(s.type).text)}>{s.type}</span>
                <span style={B("#f6f7f9","#5e6675")}>{s.time}</span>
                {s.is_swap && <span style={B("#E6F1FB","#0C447C")}>swap</span>}
                <StatusChip status={s.status} />
                {s.status === "taken" && s.taken_by_name && <span style={{ fontSize: 11, color: "#8a92a0" }}>picked up by {s.approved_vector_full_name || s.taken_by_name}</span>}
              </div>
              {s.status === "open" && <button disabled={mineBusyId === `shift-${s.id}`} onClick={() => mineDeletePost(s.id)} style={{ ...btn2, padding: "4px 10px", fontSize: 12, border: "0.5px solid #D6A4A4", background: "#FFF6F6", color: "#8A1F1F", opacity: mineBusyId === `shift-${s.id}` ? 0.55 : 1 }}>{mineBusyId === `shift-${s.id}` ? "Deleting..." : "Delete"}</button>}
            </div>
          ))}

          <div style={{ fontSize: 12, fontWeight: 700, color: "#5e6675", margin: "16px 0 8px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Your applications</div>
          {mine.apps.length === 0 && <Empty>No applications under this email.</Empty>}
          {mine.apps.map(a => (
            <div key={a.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 12px", borderRadius: 12, background: "#f6f7f9", marginBottom: 6, fontSize: 13, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <b>{a.shifts ? fmtDate(a.shifts.date) : "Shift"}</b>
                {a.shifts && <span style={B(tc(a.shifts.type).bg, tc(a.shifts.type).text)}>{a.shifts.type}</span>}
                {a.shifts && <span style={B("#f6f7f9","#5e6675")}>{a.shifts.time}</span>}
                <StatusChip status={a.status} />
                {a.shifts?.poster_name && <span style={{ fontSize: 11, color: "#8a92a0" }}>posted by {a.shifts.poster_vector_full_name || a.shifts.poster_name}</span>}
              </div>
              {a.status === "pending" && <button disabled={mineBusyId === `app-${a.id}`} onClick={() => mineWithdrawApp(a.id)} style={{ ...btn2, padding: "4px 10px", fontSize: 12, border: "0.5px solid #D6A4A4", background: "#FFF6F6", color: "#8A1F1F", opacity: mineBusyId === `app-${a.id}` ? 0.55 : 1 }}>{mineBusyId === `app-${a.id}` ? "Withdrawing..." : "Withdraw"}</button>}
            </div>
          ))}

          <div style={{ fontSize: 12, fontWeight: 700, color: "#5e6675", margin: "16px 0 8px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Notify Me alerts</div>
          {(!mine.watches || mine.watches.length === 0) && <Empty>No active notifications under this email.</Empty>}
          {(mine.watches || []).map(w => (
            <div key={w.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 12px", borderRadius: 12, background: "#f6f7f9", marginBottom: 6, fontSize: 13, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <b>{fmtDate(w.start_date)}–{fmtDate(w.end_date)}</b>
                <span style={B(tc(w.type === "any" ? "guard" : w.type).bg, tc(w.type === "any" ? "guard" : w.type).text)}>{w.type === "any" ? "Any role" : w.type}</span>
                <span style={B("#f6f7f9","#5e6675")}>{w.time === "any" ? "Any time" : w.time}</span>
              </div>
              <button disabled={mineBusyId === `watch-${w.id}`} onClick={() => mineUnsubscribeWatch(w.id)} style={{ ...btn2, padding: "4px 10px", fontSize: 12, border: "0.5px solid #D6A4A4", background: "#FFF6F6", color: "#8A1F1F", opacity: mineBusyId === `watch-${w.id}` ? 0.55 : 1 }}>{mineBusyId === `watch-${w.id}` ? "Turning off..." : "Unsubscribe"}</button>
            </div>
          ))}
        </>}

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
          <button onClick={() => setShowMineModal(false)} style={btn2}>Close</button>
        </div>
      </Modal>}

      {/* ── SELF / DUPLICATE APPLICATION PROMPTS ──────── */}
      {applyActionPrompt && <Modal onClose={() => setApplyActionPrompt(null)} z={155}>
        <h2 style={{ fontSize: 18, margin: "0 0 8px", color: "#8A1F1F" }}>{applyActionPrompt.kind === "self_shift" ? "This is your own shift" : "You already applied"}</h2>
        <p style={{ fontSize: 14, color: "#5e6675", margin: "0 0 16px", lineHeight: 1.5 }}>{applyActionPrompt.message}</p>
        {applyActionPrompt.shift && <SummaryBox rows={[["Shift",`${fmtDate(applyActionPrompt.shift.date)} ${applyActionPrompt.shift.type} ${applyActionPrompt.shift.time}`],["Posted by",applyActionPrompt.shift.poster_name || "Unknown"]]} />}
        <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 16, flexWrap: "wrap" }}>
          <button onClick={() => setApplyActionPrompt(null)} style={btn2}>Cancel</button>
          {applyActionPrompt.kind === "self_shift" && <button disabled={actionLoading} onClick={deleteOwnShiftFromPrompt} style={{ ...btnP, background: "#8A1F1F" }}>Delete my shift posting</button>}
          {applyActionPrompt.kind === "duplicate_application" && <button disabled={actionLoading} onClick={deleteApplicationFromPrompt} style={{ ...btnP, background: "#8A1F1F" }}>Delete my application</button>}
        </div>
      </Modal>}

      {/* ── LC DELETE APPLICATION CONFIRMATION ─────────── */}
      {deleteApplicationPrompt && <Modal onClose={() => setDeleteApplicationPrompt(null)} z={152}>
        <h2 style={{ fontSize: 18, margin: "0 0 8px", color: "#8A1F1F" }}>Delete application?</h2>
        <p style={{ fontSize: 14, color: "#5e6675", margin: "0 0 16px", lineHeight: 1.5 }}>This only deletes this application. It does not delete the shift.</p>
        <SummaryBox rows={[["Applicant",deleteApplicationPrompt.applicantName],["Email",deleteApplicationPrompt.applicantEmail],["Shift",deleteApplicationPrompt.shift ? `${fmtDate(deleteApplicationPrompt.shift.date)} ${deleteApplicationPrompt.shift.type} ${deleteApplicationPrompt.shift.time}` : "Selected shift"]]} />
        <ModalActions disabled={deletingApplicationId === deleteApplicationPrompt.applicationId} onCancel={() => setDeleteApplicationPrompt(null)} onConfirm={confirmDeleteApplication} text={deletingApplicationId === deleteApplicationPrompt.applicationId ? "Deleting..." : "Delete application"} danger />
      </Modal>}

      {/* ── DELETE CONFIRMATION ───────────────────────── */}
      {deleteShiftId && (() => {
        const shift = shifts.find(s => s.id === deleteShiftId);
        if (!shift) return null;
        const ac = pendingAppsFor(shift.id).length;
        return <Modal onClose={() => setDeleteShiftId(null)} z={150}>
          <h2 style={{ fontSize: 18, margin: "0 0 8px", color: "#8A1F1F" }}>Delete open shift?</h2>
          <p style={{ fontSize: 14, color: "#5e6675", margin: "0 0 16px" }}>This will delete {canonicalPosterName(shift)}'s {shift.type} {shift.time} shift on {fmtDate(shift.date)} and remove {ac} application{ac===1?"":"s"}.</p>
          <ModalActions disabled={deletingId === deleteShiftId} onCancel={() => setDeleteShiftId(null)} onConfirm={confirmDelete} text={deletingId === deleteShiftId ? "Deleting..." : "Delete shift"} danger />
        </Modal>;
      })()}

      <footer style={{ marginTop: 40, paddingTop: 20, borderTop: "0.5px solid #e0e3e8", color: "#8a92a0", fontSize: 11, lineHeight: 1.6, textAlign: "center" }}>
        Lakefront Shift Swap maintained by Luigi Berinde. For questions, contact an LC.<br/>Internal scheduling aid only. Final schedule changes must be reflected in Vector.
      </footer>

      {toast && <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: "#1a2744", color: "#fff", padding: "10px 24px", borderRadius: 12, fontSize: 14, fontWeight: 700, zIndex: 200 }}>{toast}</div>}
      {actionLoading && <div style={{ position: "fixed", inset: 0, background: "rgba(255,255,255,0.5)", zIndex: 250, display: "flex", alignItems: "center", justifyContent: "center" }}><div style={{ background: "#1a2744", color: "#fff", padding: "12px 28px", borderRadius: 12, fontSize: 14, fontWeight: 700 }}>Saving...</div></div>}
    </div>
    </div>
  );
}
