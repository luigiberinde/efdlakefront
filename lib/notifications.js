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

function shiftLabel(type, time) {
  // We want "Early Guard", not "guard early".
  const t = titleCase(time);
  const ty = titleCase(type);
  return [t, ty].filter(Boolean).join(" ");
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

const VECTOR_NOTE = `

Please give the LCs some time to update this in Vector. Vector remains the final source for the official schedule.`;

export function buildApprovalNotifications(r) {
  const day = fmtDay(r.shift_date);

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

Contact an LC if you have any questions.${VECTOR_NOTE}

Best,
LCs`,
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

Contact an LC if you have any questions.${VECTOR_NOTE}

Best,
LCs`,
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

This shift is now your responsibility.

Contact an LC if you have any questions.${VECTOR_NOTE}

Best,
LCs`
      : `Hello ${approvedName},

You have been approved to pick up ${posterName}'s ${mainShift} shift on ${day}.

This shift is now your responsibility.

Contact an LC if you have any questions.${VECTOR_NOTE}

Best,
LCs`,
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

Contact an LC if you have any questions.${VECTOR_NOTE}

Best,
LCs`,
    });
  }

  return ns;
}

export function buildDeletionNotifications(ds, applicants) {
  const day = fmtDay(ds.date);
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

Contact an LC if you have any questions.

Best,
LCs`,
    }));
}
