function fmtDay(d) {
  return new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

export function buildApprovalNotifications(r) {
  const day = fmtDay(r.shift_date);
  const isSwapApproval = r.is_swap && r.approved_email === r.swap_partner_email;
  const ns = [];

  if (isSwapApproval) {
    const swapDay = fmtDay(r.swap_partner_date);
    ns.push({
      type: "swap_approval", recipient_email: r.poster_email, recipient_name: r.poster_name,
      subject: `Swap approved: ${day}, ${r.shift_type} ${r.shift_time}`,
      body: `Hello ${r.poster_name},\n\nYour shift swap with ${r.swap_partner_name} has been approved.\n\nYou are now responsible for ${r.swap_partner_name}'s ${r.swap_partner_type} ${r.swap_partner_time} shift on ${swapDay}.\n\n${r.swap_partner_name} is now responsible for your ${r.shift_type} ${r.shift_time} shift on ${day}.\n\nContact an LC if you have any questions.\n\nBest,\nLCs`,
    });
    ns.push({
      type: "swap_approval", recipient_email: r.approved_email, recipient_name: r.approved_name,
      subject: `Swap approved: ${day}, ${r.shift_type} ${r.shift_time}`,
      body: `Hello ${r.approved_name},\n\nYour shift swap with ${r.poster_name} has been approved.\n\nYou are now responsible for ${r.poster_name}'s ${r.shift_type} ${r.shift_time} shift on ${day}.\n\n${r.poster_name} is now responsible for your ${r.swap_partner_type} ${r.swap_partner_time} shift on ${swapDay}.\n\nContact an LC if you have any questions.\n\nBest,\nLCs`,
    });
  } else {
    ns.push({
      type: "approval", recipient_email: r.approved_email, recipient_name: r.approved_name,
      subject: `Shift application approved: ${day}, ${r.shift_type} ${r.shift_time}`,
      body: `Hello ${r.approved_name},\n\nYou have been approved to pick up ${r.poster_name}'s ${r.shift_type} ${r.shift_time} shift on ${day}.\n\nThis shift is now your responsibility.\n\nContact an LC if you have any questions.\n\nBest,\nLCs`,
    });
    ns.push({
      type: "approval", recipient_email: r.poster_email, recipient_name: r.poster_name,
      subject: `Your shift was picked up: ${day}, ${r.shift_type} ${r.shift_time}`,
      body: `Hello ${r.poster_name},\n\nYour ${r.shift_type} ${r.shift_time} shift on ${day} has been picked up by ${r.approved_name}.\n\nContact an LC if you have any questions.\n\nBest,\nLCs`,
    });
  }
  return ns;
}

export function buildDeletionNotifications(ds, applicants) {
  const day = fmtDay(ds.date);
  return (applicants || []).map(a => ({
    type: "deletion", recipient_email: a.email, recipient_name: a.name,
    subject: `Shift removed: ${day}, ${ds.type} ${ds.time}`,
    body: `Hello ${a.name},\n\nThe ${ds.type} ${ds.time} shift on ${day} posted by ${ds.poster_name} has been removed from the shift swap board.\n\nContact an LC if you have any questions.\n\nBest,\nLCs`,
  }));
}
