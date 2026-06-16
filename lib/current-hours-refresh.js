import { getVectorWeekHoursForPerson, normalizeEmail, weekStartMonday, addDays, getScheduleRows, validatePersonDate } from "@/lib/vector-core";

export function shiftLengthForCurrentHours(shift) {
  const stored = Number(shift?.poster_vector_shift_length || shift?.lc_override_shift_length || 0);
  if (shift?.vector_source === "lc_override") return stored;

  const vectorBucket = bucketFromStoredVectorFields(shift, "poster");
  if (vectorBucket) return correctedShiftLengthForStoredBucket(stored, vectorBucket);

  // If the app has no Vector text proving Early/Late, do not silently
  // standardize from the user-entered bucket. Refresh/check routes will try
  // to confirm from live Vector first. This prevents stale rows from being
  // "fixed" merely because somebody once clicked Late.
  return stored;
}

function durationHoursFromTimes(start, end) {
  if (!start || !end) return 0;
  const a = new Date(String(start).replace(" ", "T"));
  const b = new Date(String(end).replace(" ", "T"));
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  const hours = (b.getTime() - a.getTime()) / 36e5;
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24) return 0;
  return Math.round(hours * 100) / 100;
}

export function liveShiftLength(row) {
  // Prefer the actual live Vector start/end duration. After assignment-time fixes,
  // some schedule rows may keep stale length fields even though the displayed
  // Vector times are now correct. Start/end is the least stale source.
  return Number(
    durationHoursFromTimes(row?.shift_start, row?.shift_end) ||
    row?.shift_length ||
    row?.shift_real_length ||
    0
  );
}

export function standardShiftLengthForBucket(time) {
  const bucket = String(time || "").trim().toLowerCase();
  if (bucket === "early") return 6;
  if (bucket === "late") return 6.5;
  return 0;
}

export function correctedShiftLengthForStoredBucket(length, time) {
  const current = Number(length || 0);
  const standard = standardShiftLengthForBucket(time);
  if (!standard) return current;

  // Lakefront shifts are now standardized in Vector: Early = 6, Late = 6.5.
  // The whole point of this cleanup is to eliminate stale 7-hour records that
  // survived after Vector shift/assignment repairs. Only correct when the
  // stored value is missing or clearly not the standardized bucket length.
  if (!current || Math.abs(current - standard) > 0.01) return standard;
  return current;
}

function idFromHref(href) {
  const text = String(href || "");
  const match = text.match(/\/(\d+)(?:$|[/?#])/);
  return match ? Number(match[1]) : null;
}

function currentVectorRowShiftId(row) {
  return row?.shift_id ?? row?.id ?? row?.shiftId ?? row?.shiftID ?? idFromHref(row?.shift_href || row?.href) ?? null;
}

export function liveVectorPatch(prefix, row) {
  return {
    [`${prefix}_vector_user_id`]: row?.user_id ?? null,
    [`${prefix}_vector_full_name`]: row?.user_name ?? null,
    [`${prefix}_vector_shift_id`]: currentVectorRowShiftId(row),
    [`${prefix}_vector_shift_length`]: liveShiftLength(row),
    [`${prefix}_vector_shift_start`]: row?.shift_start ?? null,
    [`${prefix}_vector_shift_end`]: row?.shift_end ?? null,
    [`${prefix}_vector_assignment_id`]: row?.assignment_id ?? null,
    [`${prefix}_vector_assignment_name`]: row?.assignment_name ?? null,
    [`${prefix}_vector_work_type_name`]: row?.work_type_name ?? null,
    [`${prefix}_vector_group_labels`]: row?.group_labels ?? [],
  };
}

function liveShiftText(row) {
  return [
    row?.assignment_name,
    row?.work_type_name,
    ...(Array.isArray(row?.group_labels) ? row.group_labels : []),
  ].filter(Boolean).join(" ").toLowerCase();
}

function bucketFromVectorText(text) {
  const value = String(text || "").toLowerCase();
  const hasEarly = /(^|[^a-z])early([^a-z]|$)/.test(value);
  const hasLate = /(^|[^a-z])late([^a-z]|$)/.test(value);
  if (hasEarly && !hasLate) return "early";
  if (hasLate && !hasEarly) return "late";
  return null;
}

function bucketFromVectorRowWords(row) {
  return bucketFromVectorText(liveShiftText(row));
}

function storedVectorTextForPrefix(shift, prefix) {
  return [
    shift?.[`${prefix}_vector_assignment_name`],
    shift?.[`${prefix}_vector_work_type_name`],
    ...(Array.isArray(shift?.[`${prefix}_vector_group_labels`]) ? shift[`${prefix}_vector_group_labels`] : []),
  ].filter(Boolean).join(" ");
}

function bucketFromStoredVectorFields(shift, prefix) {
  return bucketFromVectorText(storedVectorTextForPrefix(shift, prefix));
}

function standardLengthFromConfirmedVectorBucket(bucket) {
  const clean = String(bucket || "").toLowerCase();
  if (clean === "early") return 6;
  if (clean === "late") return 6.5;
  return 0;
}

async function inferScheduledBucketByVectorWords({ date, email, name, type, time, allowNameFallback = false }) {
  if (!date || (!email && !name)) return { bucket: null, reason: "missing_person_or_date" };

  const check = await validatePersonDate({
    email,
    name,
    date: String(date).slice(0, 10),
    publicStrictEmail: Boolean(email) && !allowNameFallback,
  });

  if (!check?.allowed || !Array.isArray(check.shifts) || check.shifts.length === 0) {
    return { bucket: null, reason: check?.blockReason || "person_not_scheduled_on_date", check };
  }

  const withBuckets = check.shifts
    .map((row) => ({ row, bucket: bucketFromVectorRowWords(row), text: liveShiftText(row) }))
    .filter((item) => item.bucket);

  if (!withBuckets.length) {
    return { bucket: null, reason: "no_early_late_word_in_vector_shift", check };
  }

  const wantedTime = String(time || "").toLowerCase();
  const wantedType = String(type || "").toLowerCase();
  const matchingBucket = wantedTime ? withBuckets.filter((item) => item.bucket === wantedTime) : [];
  const matchingBucketAndType = wantedType
    ? matchingBucket.filter((item) => item.text.includes(wantedType))
    : matchingBucket;

  if (matchingBucketAndType.length === 1) {
    return { bucket: matchingBucketAndType[0].bucket, row: matchingBucketAndType[0].row, reason: "matched_vector_word_bucket_and_type", check };
  }
  if (matchingBucket.length === 1) {
    return { bucket: matchingBucket[0].bucket, row: matchingBucket[0].row, reason: "matched_vector_word_bucket", check };
  }

  const uniqueBuckets = [...new Set(withBuckets.map((item) => item.bucket))];
  if (uniqueBuckets.length === 1) {
    return { bucket: uniqueBuckets[0], row: withBuckets[0].row, reason: "only_vector_word_bucket_for_person_date", check };
  }

  return {
    bucket: null,
    reason: "multiple_vector_word_buckets_ambiguous",
    check,
    candidates: withBuckets.map((item) => ({
      bucket: item.bucket,
      shift_id: currentVectorRowShiftId(item.row),
      assignment_name: item.row?.assignment_name,
      work_type_name: item.row?.work_type_name,
      group_labels: item.row?.group_labels || [],
      shift_start: item.row?.shift_start,
      shift_end: item.row?.shift_end,
      shift_length: liveShiftLength(item.row),
    })),
  };
}

function inferTimeBucketFromStart(row) {
  const text = String(row?.shift_start || row?.assignment_start || "");
  const match = text.match(/(?:T|\s)(\d{1,2}):/);
  if (!match) return null;
  const hour = Number(match[1]);
  if (!Number.isFinite(hour)) return null;
  return hour < 12 ? "early" : "late";
}

function scoreLiveShiftAgainstStoredBucket(row, { type, time }) {
  const text = liveShiftText(row);
  const inferredTime = inferTimeBucketFromStart(row);
  const wantedType = String(type || "").toLowerCase();
  const wantedTime = String(time || "").toLowerCase();
  const typeMatch = wantedType ? text.includes(wantedType) : false;
  const timeTextMatch = wantedTime ? text.includes(wantedTime) : false;
  const timeInferredMatch = wantedTime && inferredTime ? inferredTime === wantedTime : false;
  let score = 0;
  if (timeTextMatch) score += 30;
  if (timeInferredMatch) score += 20;
  if (typeMatch) score += 10;
  return { score, typeMatch, timeMatch: Boolean(timeTextMatch || timeInferredMatch), inferredTime, text };
}

function chooseBestLiveShiftForStoredBucket(shifts, { type, time, expectedVectorShiftId, expectedAssignmentId, ignoreStoredShiftId = false }) {
  const list = Array.isArray(shifts) ? shifts.filter(Boolean) : [];
  if (!list.length) return { row: null, reason: "person_not_scheduled_on_date" };

  if (!ignoreStoredShiftId && expectedVectorShiftId) {
    const exact = list.find((r) => String(currentVectorRowShiftId(r)) === String(expectedVectorShiftId));
    if (exact) return { row: exact, reason: "matched_stored_shift_id" };
  }

  if (expectedAssignmentId) {
    const assignmentMatches = list.filter((r) => String(r.assignment_id || "") === String(expectedAssignmentId));
    if (assignmentMatches.length === 1) {
      return { row: assignmentMatches[0], reason: "matched_current_assignment_id" };
    }
  }

  if (list.length === 1) {
    return { row: list[0], reason: "only_shift_for_person_on_date" };
  }

  const scored = list
    .map((row) => ({ row, ...scoreLiveShiftAgainstStoredBucket(row, { type, time }) }))
    .sort((a, b) => b.score - a.score);

  const strictMatches = scored.filter((x) => x.timeMatch && (!type || x.typeMatch));
  if (strictMatches.length === 1) {
    return { row: strictMatches[0].row, reason: "matched_type_time_bucket" };
  }

  const timeMatches = scored.filter((x) => x.timeMatch);
  if (timeMatches.length === 1) {
    return { row: timeMatches[0].row, reason: "matched_time_bucket" };
  }

  if (scored[0]?.score > 0 && scored[0].score > (scored[1]?.score || 0)) {
    return { row: scored[0].row, reason: "matched_best_bucket_score" };
  }

  return {
    row: null,
    reason: "multiple_person_shifts_ambiguous",
    candidates: scored.map((x) => ({
      shift_id: currentVectorRowShiftId(x.row),
      user_id: x.row?.user_id ?? null,
      user_name: x.row?.user_name ?? null,
      assignment_id: x.row?.assignment_id ?? null,
      assignment_name: x.row?.assignment_name,
      work_type_name: x.row?.work_type_name,
      group_labels: x.row?.group_labels || [],
      shift_start: x.row?.shift_start,
      shift_end: x.row?.shift_end,
      shift_length: liveShiftLength(x.row),
      score: x.score,
      inferredTime: x.inferredTime,
    })),
  };
}

export async function findLiveVectorShiftForStoredPersonBucket({ date, email, name, type, time, expectedVectorShiftId, expectedAssignmentId, ignoreStoredShiftId = false, allowNameFallback = false }) {
  if (!date) return { row: null, reason: "missing_date" };
  if (!email && !name) return { row: null, reason: "missing_person_identity" };

  const check = await validatePersonDate({
    email,
    name,
    date: String(date).slice(0, 10),
    publicStrictEmail: Boolean(email) && !allowNameFallback,
  });

  if (!check?.allowed || !Array.isArray(check.shifts) || check.shifts.length === 0) {
    return {
      row: null,
      reason: check?.blockReason || "person_not_scheduled_on_date",
      check,
    };
  }

  const chosen = chooseBestLiveShiftForStoredBucket(check.shifts, { type, time, expectedVectorShiftId, expectedAssignmentId, ignoreStoredShiftId });
  return { ...chosen, check };
}

export async function findLiveVectorShiftByStoredId({ date, vectorShiftId, vectorUserId = null }) {
  if (!date || !vectorShiftId) return null;
  const day = String(date).slice(0, 10);
  const rows = await getScheduleRows(day, addDays(day, 1));
  const matches = rows.filter((r) => String(currentVectorRowShiftId(r)) === String(vectorShiftId));
  if (vectorUserId != null) {
    const userMatch = matches.find((r) => Number(r.user_id) === Number(vectorUserId));
    if (userMatch) return userMatch;
  }
  return matches[0] || null;
}

export async function refreshStoredShiftVectorLengths({ sb, shift, updateDb = true, ignoreStoredShiftId = false, allowNameFallback = false, forceStandardBucketFallback = false }) {
  if (!shift?.id) return { success: false, shift, skipped: true, reason: "missing_shift" };

  const patch = {};
  const refreshed = [];
  const skipped = [];
  const failed = [];

  let nextShift = { ...shift };
  let matchedPosterRow = null;
  let matchedSwapPartnerRow = null;

  if (shift.vector_source === "lc_override") {
    skipped.push({ prefix: "poster", reason: "lc_override" });
  } else if (shift.date) {
    try {
      let row = null;
      let reason = null;
      if (!ignoreStoredShiftId && shift.poster_vector_shift_id) {
        row = await findLiveVectorShiftByStoredId({
          date: shift.date,
          vectorShiftId: shift.poster_vector_shift_id,
          vectorUserId: shift.poster_vector_user_id,
        });
        if (row) reason = "matched_stored_shift_id";
      }

      if (!row) {
        const fallback = await findLiveVectorShiftForStoredPersonBucket({
          date: shift.date,
          email: shift.poster_vector_email || shift.poster_email,
          name: shift.poster_vector_full_name || shift.poster_name,
          type: shift.type,
          time: shift.time,
          expectedVectorShiftId: shift.poster_vector_shift_id,
          expectedAssignmentId: shift.poster_vector_assignment_id,
          ignoreStoredShiftId,
          allowNameFallback,
        });
        row = fallback.row;
        reason = fallback.reason;
        if (!row) {
          skipped.push({
            prefix: "poster",
            reason: reason || "not_found_in_live_vector",
            vectorShiftId: shift.poster_vector_shift_id || null,
            candidates: fallback.candidates || null,
          });
        }
      }

      if (row) {
        matchedPosterRow = row;
        const rowPatch = liveVectorPatch("poster", row);
        Object.assign(patch, rowPatch);
        Object.assign(nextShift, rowPatch);
        refreshed.push({
          prefix: "poster",
          method: reason,
          oldVectorShiftId: shift.poster_vector_shift_id || null,
          vectorShiftId: rowPatch.poster_vector_shift_id,
          length: rowPatch.poster_vector_shift_length,
        });
      }
    } catch (err) {
      failed.push({ prefix: "poster", reason: err.message || "vector_lookup_failed", vectorShiftId: shift.poster_vector_shift_id || null });
    }
  } else {
    skipped.push({ prefix: "poster", reason: "missing_shift_date" });
  }

  if (shift.is_swap && shift.swap_partner_date) {
    try {
      let row = null;
      let reason = null;
      if (!ignoreStoredShiftId && shift.swap_partner_vector_shift_id) {
        row = await findLiveVectorShiftByStoredId({
          date: shift.swap_partner_date,
          vectorShiftId: shift.swap_partner_vector_shift_id,
          vectorUserId: shift.swap_partner_vector_user_id,
        });
        if (row) reason = "matched_stored_shift_id";
      }

      if (!row) {
        const fallback = await findLiveVectorShiftForStoredPersonBucket({
          date: shift.swap_partner_date,
          email: shift.swap_partner_vector_email || shift.swap_partner_email,
          name: shift.swap_partner_vector_full_name || shift.swap_partner_name,
          type: shift.swap_partner_type,
          time: shift.swap_partner_time,
          expectedVectorShiftId: shift.swap_partner_vector_shift_id,
          expectedAssignmentId: shift.swap_partner_vector_assignment_id,
          ignoreStoredShiftId,
          allowNameFallback,
        });
        row = fallback.row;
        reason = fallback.reason;
        if (!row) {
          skipped.push({
            prefix: "swap_partner",
            reason: reason || "not_found_in_live_vector",
            vectorShiftId: shift.swap_partner_vector_shift_id || null,
            candidates: fallback.candidates || null,
          });
        }
      }

      if (row) {
        matchedSwapPartnerRow = row;
        const rowPatch = liveVectorPatch("swap_partner", row);
        Object.assign(patch, rowPatch);
        Object.assign(nextShift, rowPatch);
        refreshed.push({
          prefix: "swap_partner",
          method: reason,
          oldVectorShiftId: shift.swap_partner_vector_shift_id || null,
          vectorShiftId: rowPatch.swap_partner_vector_shift_id,
          length: rowPatch.swap_partner_vector_shift_length,
        });
      }
    } catch (err) {
      failed.push({ prefix: "swap_partner", reason: err.message || "vector_lookup_failed", vectorShiftId: shift.swap_partner_vector_shift_id || null });
    }
  } else if (shift.is_swap) {
    skipped.push({ prefix: "swap_partner", reason: "missing_swap_partner_date" });
  }

  if (forceStandardBucketFallback) {
    // Only standardize from Early/Late after Vector itself confirms the bucket
    // in the assignment/work-type/group-label text. Do not blindly trust the
    // user-entered shift bucket for this cleanup.
    let posterBucket = bucketFromVectorRowWords(matchedPosterRow) || bucketFromStoredVectorFields(nextShift, "poster");
    let posterBucketReason = posterBucket ? "confirmed_vector_word_bucket" : null;

    if (!posterBucket && shift.vector_source !== "lc_override") {
      const inferred = await inferScheduledBucketByVectorWords({
        date: shift.date,
        email: shift.poster_vector_email || shift.poster_email,
        name: shift.poster_vector_full_name || shift.poster_name,
        type: shift.type,
        time: shift.time,
        allowNameFallback,
      });
      posterBucket = inferred.bucket;
      posterBucketReason = inferred.reason;
      if (inferred.row && !matchedPosterRow) {
        const rowPatch = liveVectorPatch("poster", inferred.row);
        Object.assign(patch, rowPatch);
        Object.assign(nextShift, rowPatch);
        matchedPosterRow = inferred.row;
      }
      if (!posterBucket) {
        skipped.push({
          prefix: "poster",
          reason: posterBucketReason || "no_confirmed_vector_early_late_word",
          vectorShiftId: shift.poster_vector_shift_id || null,
          candidates: inferred.candidates || null,
        });
      }
    }

    const standardPosterLength = standardLengthFromConfirmedVectorBucket(posterBucket);
    const currentPosterLength = Number(nextShift.poster_vector_shift_length || nextShift.lc_override_shift_length || 0);
    if (standardPosterLength && Math.abs(currentPosterLength - standardPosterLength) > 0.01) {
      patch.poster_vector_shift_length = standardPosterLength;
      nextShift.poster_vector_shift_length = standardPosterLength;
      refreshed.push({
        prefix: "poster",
        method: `standard_vector_word_fallback_${posterBucket}`,
        reason: posterBucketReason,
        oldLength: currentPosterLength || null,
        length: standardPosterLength,
      });
    }

    if (shift.is_swap) {
      let swapBucket = bucketFromVectorRowWords(matchedSwapPartnerRow) || bucketFromStoredVectorFields(nextShift, "swap_partner");
      let swapBucketReason = swapBucket ? "confirmed_vector_word_bucket" : null;

      if (!swapBucket) {
        const inferred = await inferScheduledBucketByVectorWords({
          date: shift.swap_partner_date,
          email: shift.swap_partner_vector_email || shift.swap_partner_email,
          name: shift.swap_partner_vector_full_name || shift.swap_partner_name,
          type: shift.swap_partner_type,
          time: shift.swap_partner_time,
          allowNameFallback,
        });
        swapBucket = inferred.bucket;
        swapBucketReason = inferred.reason;
        if (inferred.row && !matchedSwapPartnerRow) {
          const rowPatch = liveVectorPatch("swap_partner", inferred.row);
          Object.assign(patch, rowPatch);
          Object.assign(nextShift, rowPatch);
          matchedSwapPartnerRow = inferred.row;
        }
        if (!swapBucket) {
          skipped.push({
            prefix: "swap_partner",
            reason: swapBucketReason || "no_confirmed_vector_early_late_word",
            vectorShiftId: shift.swap_partner_vector_shift_id || null,
            candidates: inferred.candidates || null,
          });
        }
      }

      const standardSwapLength = standardLengthFromConfirmedVectorBucket(swapBucket);
      const currentSwapLength = Number(nextShift.swap_partner_vector_shift_length || 0);
      if (standardSwapLength && Math.abs(currentSwapLength - standardSwapLength) > 0.01) {
        patch.swap_partner_vector_shift_length = standardSwapLength;
        nextShift.swap_partner_vector_shift_length = standardSwapLength;
        refreshed.push({
          prefix: "swap_partner",
          method: `standard_vector_word_fallback_${swapBucket}`,
          reason: swapBucketReason,
          oldLength: currentSwapLength || null,
          length: standardSwapLength,
        });
      }
    }
  }

  if (updateDb && Object.keys(patch).length > 0) {
    const { data, error } = await sb
      .from("shifts")
      .update(patch)
      .eq("id", shift.id)
      .select("*")
      .single();
    if (error) throw error;
    nextShift = data || nextShift;
  }

  return {
    success: failed.length === 0,
    shift: nextShift,
    changed: Object.keys(patch).length > 0,
    refreshed,
    skipped,
    failed,
  };
}


function sameShiftBucket(a, b) {
  return (
    String(a?.date || "") === String(b?.date || "") &&
    String(a?.type || "") === String(b?.type || "") &&
    String(a?.time || "") === String(b?.time || "")
  );
}

function isRequestedSwapPartner(shift, applicantEmail) {
  return Boolean(shift?.is_swap) && normalizeEmail(shift?.swap_partner_email) === normalizeEmail(applicantEmail);
}

function swapReplacementLengthFor(shift, applicantEmail) {
  const requestedSwapPartner = isRequestedSwapPartner(shift, applicantEmail);
  if (!requestedSwapPartner) return 0;

  const postedShiftBucket = { date: shift.date, type: shift.type, time: shift.time };
  const swapPartnerBucket = {
    date: shift.swap_partner_date,
    type: shift.swap_partner_type,
    time: shift.swap_partner_time,
  };

  const sameDayDifferentBucket =
    String(shift.swap_partner_date || "") === String(shift.date || "") &&
    !sameShiftBucket(postedShiftBucket, swapPartnerBucket);

  // For swap partners, approval replaces their listed offered shift when known.
  // We subtract the offered shift length whether the swap is same-day or different-day,
  // because this is a swap, not a normal pickup.
  if (!(requestedSwapPartner || sameDayDifferentBucket)) return 0;
  const stored = Number(shift.swap_partner_vector_shift_length || 0);
  const vectorBucket = bucketFromStoredVectorFields(shift, "swap_partner");
  return vectorBucket ? correctedShiftLengthForStoredBucket(stored, vectorBucket) : stored;
}

function dateInRange(date, start, endExclusive) {
  const d = String(date || "");
  return d >= start && d < endExclusive;
}

function publicAppShape(app, shift, current, checkedAt) {
  const shiftLength = shiftLengthForCurrentHours(shift);
  const swapReplacementShiftLength = swapReplacementLengthFor(shift, app.applicant_email);
  const projectedAfterApproval = Math.max(0, Number(current.vectorWeekHours || 0) - swapReplacementShiftLength) + shiftLength;
  const wouldBeOT = projectedAfterApproval > 40;
  const warnings = [
    ...(wouldBeOT ? ["Current projected Vector hours exceed 40."] : []),
    ...(swapReplacementShiftLength ? [`Projected hours subtract the listed swap shift length (${swapReplacementShiftLength} hrs).`] : []),
  ];

  return {
    appId: app.id,
    shiftId: app.shift_id,
    status: app.status,
    applicantEmail: app.applicant_email,
    shiftDate: shift.date,
    shiftType: shift.type,
    shiftTime: shift.time,
    applicationTime: {
      vectorWeekHours: app.applicant_vector_week_hours,
      projectedAfterApproval: app.applicant_vector_projected_hours ?? app.hours_after_shift,
      wouldBeOT: Boolean(app.applicant_vector_would_be_ot),
      checkedAt: app.applicant_vector_checked_at,
    },
    current: {
      vectorWeekHours: current.vectorWeekHours,
      postedShiftLength: shiftLength,
      swapReplacementShiftLength,
      projectedAfterApproval,
      wouldBeOT,
      weekStart: current.weekStart,
      weekEndExclusive: current.weekEndExclusive,
      checkedAt,
      warnings,
    },
  };
}

export async function refreshCurrentHoursForApplicantWeek({
  sb,
  applicantEmail,
  applicantName,
  shiftDate,
  includeStatuses = ["pending"],
}) {
  const normalizedEmail = normalizeEmail(applicantEmail);
  if (!normalizedEmail) throw new Error("Applicant email is required.");
  if (!shiftDate) throw new Error("Shift date is required.");

  const checkedAt = new Date().toISOString();
  const weekStart = weekStartMonday(shiftDate);
  const weekEndExclusive = addDays(weekStart, 7);

  const vectorWeek = await getVectorWeekHoursForPerson({
    email: normalizedEmail,
    name: applicantName,
    shiftDate,
    publicStrictEmail: true,
  });

  if (!vectorWeek.ok) {
    return {
      success: false,
      checkedAt,
      error: vectorWeek.message || "Could not refresh current Vector hours.",
      vectorWeek,
      updatedApplications: [],
    };
  }

  const { data: candidateApps, error: appsError } = await sb
    .from("applications")
    .select("*")
    .ilike("applicant_email", normalizedEmail)
    .in("status", includeStatuses);

  if (appsError) throw appsError;

  const shiftIds = [...new Set((candidateApps || []).map((a) => a.shift_id).filter(Boolean))];

  if (!shiftIds.length) {
    return {
      success: true,
      checkedAt,
      vectorUser: vectorWeek.vectorUser,
      currentWeekHours: vectorWeek.week.vectorWeekHours,
      weekStart,
      weekEndExclusive,
      updatedApplications: [],
    };
  }

  const { data: shifts, error: shiftsError } = await sb
    .from("shifts")
    .select("*")
    .in("id", shiftIds);

  if (shiftsError) throw shiftsError;

  const shiftsById = new Map((shifts || []).map((s) => [String(s.id), s]));
  const relevantApps = (candidateApps || []).filter((app) => {
    const shift = shiftsById.get(String(app.shift_id));
    return shift && dateInRange(shift.date, weekStart, weekEndExclusive);
  });

  for (const shift of [...new Map(relevantApps.map((app) => {
    const s = shiftsById.get(String(app.shift_id));
    return s ? [String(s.id), s] : null;
  }).filter(Boolean)).values()]) {
    try {
      const refreshed = await refreshStoredShiftVectorLengths({ sb, shift, updateDb: true, ignoreStoredShiftId: true, allowNameFallback: true, forceStandardBucketFallback: true });
      if (refreshed?.shift) shiftsById.set(String(shift.id), refreshed.shift);
    } catch (err) {
      console.warn("Could not refresh live Vector shift length before current-hours calculation", shift.id, err);
    }
  }

  const currentBase = {
    vectorWeekHours: vectorWeek.week.vectorWeekHours,
    weekStart,
    weekEndExclusive,
  };

  const updatedApplications = [];
  for (const app of relevantApps) {
    const shift = shiftsById.get(String(app.shift_id));
    const shaped = publicAppShape(app, shift, currentBase, checkedAt);
    const warnings = shaped.current.warnings;

    const { error: updateError } = await sb
      .from("applications")
      .update({
        applicant_vector_current_week_hours: shaped.current.vectorWeekHours,
        applicant_vector_current_projected_hours: shaped.current.projectedAfterApproval,
        applicant_vector_current_would_be_ot: shaped.current.wouldBeOT,
        applicant_vector_current_checked_at: checkedAt,
        applicant_vector_current_check_status: "checked",
        applicant_vector_current_warnings: warnings,
      })
      .eq("id", app.id);

    if (updateError) throw updateError;
    updatedApplications.push(shaped);
  }

  return {
    success: true,
    checkedAt,
    vectorUser: vectorWeek.vectorUser,
    currentWeekHours: vectorWeek.week.vectorWeekHours,
    weekStart,
    weekEndExclusive,
    updatedApplications,
  };
}
