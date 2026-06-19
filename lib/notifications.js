function fmtDay(d) {
  return new Date(d + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function cleanEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail(email));
}

function titleCase(value) {
  return String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function roleLabel(type) {
  if (type === "gate_attendant") return "Gate Attendant";
  if (type === "office_staff") return "Office Staff";
  return titleCase(type);
}

function adminNameForPortal(portal) {
  return portal === "beach" ? "Admin" : "LC";
}

function adminPluralForPortal(portal) {
  return portal === "beach" ? "Admins" : "LCs";
}

function vectorNoteForPortal(portal) {
  const admins = adminPluralForPortal(portal);
  return `

Please give the ${admins} some time to update this in Vector. Vector remains the final source for the official schedule.`;
}

function shiftLabel(type, time) {
  // We want "Early Guard", not "guard early".
  const t = titleCase(time);
  const ty = roleLabel(type);
  return [t, ty].filter(Boolean).join(" ");
}

function fmtShortTime(t) {
  if (!t) return null;
  const raw = String(t).slice(0, 5);
  const [h, m] = raw.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return raw;
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = ((h + 11) % 12) + 1;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

function onCallApprovalBlock(r) {
  if (!r.on_call_signup_id || !r.on_call_approval_mode || r.on_call_approval_mode === "normal") return "";
  if (r.on_call_approval_mode === "lc_custom") {
    const range = r.on_call_lc_custom_start || r.on_call_lc_custom_end
      ? `
Custom approved time window: ${fmtShortTime(r.on_call_lc_custom_start) || "?"}–${fmtShortTime(r.on_call_lc_custom_end) || "?"}.`
      : "";
    const instr = r.on_call_lc_instructions ? `
LC instructions: ${r.on_call_lc_instructions}` : "";
    return `

Important On-Call approval details:${range}${instr}`;
  }
  const type = r.on_call_resolution_type;
  if (type === "all_day_if_approved") {
    return `

Important On-Call approval details:
You were also marked On-Call for this date and have been approved as All-Day / double if approved. Follow LC instructions and Vector once updated.`;
  }
  if (type === "come_in_earlier") {
    return `

Important On-Call approval details:
You said you could come in earlier before the Late shift. Approved come-in time: ${fmtShortTime(r.on_call_custom_start) || "?"}.`;
  }
  if (type === "stay_after_early" || type === "stay_later_after_late") {
    return `

Important On-Call approval details:
You said you could stay later after the Early shift. Approved stay-until time: ${fmtShortTime(r.on_call_custom_end || r.on_call_custom_start) || "?"}.`;
  }
  return "";
}

function addNotification(list, notification) {
  const recipientEmail = cleanEmail(notification.recipient_email);
  if (!isValidEmail(recipientEmail)) return;

  list.push({
    ...notification,
    recipient_email: recipientEmail,
    recipient_name: String(notification.recipient_name || "there").trim() || "there",
  });
}

export function buildApprovalNotifications(r) {
  const day = fmtDay(r.shift_date);
  const adminName = adminNameForPortal(r.portal);
  const adminPlural = adminPluralForPortal(r.portal);
  const vectorNote = vectorNoteForPortal(r.portal);

  const approvedName =
    r.approved_vector_full_name ||
    r.applicant_vector_full_name ||
    r.approved_name;

  const posterName =
    r.poster_vector_full_name ||
    r.poster_name;

  const swapPartnerName =
    r.swap_partner_vector_full_name ||
    r.swap_partner_name;

  const mainShift = shiftLabel(r.shift_type, r.shift_time);
  const swapShift = shiftLabel(r.swap_partner_type, r.swap_partner_time);

  const isSwapApproval =
    Boolean(r.is_swap) &&
    cleanEmail(r.approved_email) === cleanEmail(r.swap_partner_email);

  const isLcOverride =
    r.vector_source === "lc_override" ||
    r.is_lc_override === true;

  const applicantOnCallBlock = onCallApprovalBlock(r);

  const ns = [];

  if (isSwapApproval) {
    const swapDay = fmtDay(r.swap_partner_date);

    addNotification(ns, {
      type: "swap_approval",
      recipient_email: r.poster_email,
      recipient_name: posterName,
      subject: `Swap approved: ${day}, ${mainShift}`,
      body: `Hello ${posterName},

Your shift swap with ${swapPartnerName} has been approved.

You are now responsible for ${swapPartnerName}'s ${swapShift} shift on ${swapDay}.

${swapPartnerName} is now responsible for your ${mainShift} shift on ${day}.

Contact an ${adminName} if you have any questions.${vectorNote}

Best,
${adminPlural}`,
    });

    addNotification(ns, {
      type: "swap_approval",
      recipient_email: r.approved_email,
      recipient_name: approvedName,
      subject: `Swap approved: ${day}, ${mainShift}`,
      body: `Hello ${approvedName},

Your shift swap with ${posterName} has been approved.

You are now responsible for ${posterName}'s ${mainShift} shift on ${day}.

${posterName} is now responsible for your ${swapShift} shift on ${swapDay}.

Contact an ${adminName} if you have any questions.${vectorNote}

Best,
${adminPlural}`,
    });

    return ns;
  }

  // Normal pickup or LC-created open shift: always notify the approved applicant.
  // Keep notification type as "approval" because the DB check only allows:
  // approval, swap_approval, deletion.
  addNotification(ns, {
    type: "approval",
    recipient_email: r.approved_email,
    recipient_name: approvedName,
    subject: `Shift application approved: ${day}, ${mainShift}`,
    body: isLcOverride
      ? `Hello ${approvedName},

You have been approved to pick up the open ${mainShift} shift on ${day}.

This shift is now your responsibility.${applicantOnCallBlock}

Contact an ${adminName} if you have any questions.${vectorNote}

Best,
${adminPlural}`
      : `Hello ${approvedName},

You have been approved to pick up ${posterName}'s ${mainShift} shift on ${day}.

This shift is now your responsibility.${applicantOnCallBlock}

Contact an ${adminName} if you have any questions.${vectorNote}

Best,
${adminPlural}`,
  });

  // LC-created open shifts do not have a real poster to notify.
  if (!isLcOverride) {
    addNotification(ns, {
      type: "approval",
      recipient_email: r.poster_email,
      recipient_name: posterName,
      subject: `Your shift was picked up: ${day}, ${mainShift}`,
      body: `Hello ${posterName},

Your ${mainShift} shift on ${day} has been picked up by ${approvedName}.

Contact an ${adminName} if you have any questions.${vectorNote}

Best,
${adminPlural}`,
    });
  }

  return ns;
}

export function buildDeletionNotifications(ds, applicants) {
  const day = fmtDay(ds.date);
  const adminName = adminNameForPortal(ds.portal);
  const adminPlural = adminPluralForPortal(ds.portal);
  const label = shiftLabel(ds.type, ds.time);

  return (applicants || [])
    .filter((a) => isValidEmail(a.email))
    .map((a) => ({
      type: "deletion",
      recipient_email: cleanEmail(a.email),
      recipient_name: a.name,
      subject: `Shift removed: ${day}, ${label}`,
      body: `Hello ${a.name},

The ${label} shift on ${day} has been removed from the shift swap board.

Contact an ${adminName} if you have any questions.

Best,
${adminPlural}`,
    }));
}


function onCallStandaloneDetails(r) {
  if (r.on_call_approval_mode === "lc_custom") {
    const bits = [];
    if (r.on_call_lc_custom_start) bits.push(`come in at ${fmtShortTime(r.on_call_lc_custom_start)}`);
    if (r.on_call_lc_custom_end) bits.push(`stay until ${fmtShortTime(r.on_call_lc_custom_end)}`);
    if (r.on_call_lc_instructions) bits.push(r.on_call_lc_instructions);
    return bits.join("; ") || "Follow LC instructions for the exact times.";
  }
  const x = r.extra_availability_type;
  if (r.availability_type === "both" || x === "all_day_if_approved") return "You are approved All-Day / double if approved. Follow LC instructions and Vector once updated.";
  if (r.availability_type === "early") return "You are approved for the Early shift window.";
  if (r.availability_type === "late") return "You are approved for the Late shift window.";
  if (r.availability_type === "custom" || x === "custom") return `You are approved for ${fmtShortTime(r.custom_start) || "?"}–${fmtShortTime(r.custom_end) || "?"}.`;
  if (x === "come_in_earlier") return `You are approved to come in early at ${fmtShortTime(r.custom_start) || "?"}.`;
  if (x === "stay_after_early" || x === "stay_later_after_late") return `You are approved to stay later after your Early shift until ${fmtShortTime(r.custom_end || r.custom_start) || "?"}.`;
  return "You are approved from the On-Call list. Follow LC instructions and Vector once updated.";
}

export function buildOnCallApprovalNotification(r) {
  const day = fmtDay(r.date);
  const name = r.vector_full_name || r.name_entered || "there";
  const details = onCallStandaloneDetails(r);
  const adminName = adminNameForPortal("lakefront");
  const adminPlural = adminPluralForPortal("lakefront");
  const vectorNote = vectorNoteForPortal("lakefront");
  const instr = r.on_call_approval_mode === "lc_custom" && r.on_call_lc_instructions ? `

LC instructions: ${r.on_call_lc_instructions}` : "";
  return {
    type: "approval",
    recipient_email: r.email,
    recipient_name: name,
    subject: `On-Call approved: ${day}`,
    body: `Hello ${name},

You have been approved from the On-Call list for ${day}.

${details}${instr}

Contact an ${adminName} if you have any questions.${vectorNote}

Best,
${adminPlural}`,
  };
}
