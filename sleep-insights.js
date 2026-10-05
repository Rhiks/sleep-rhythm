/* Sleep Rhythm morning summary. Pure calculations; no storage, network, or medical score. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SleepInsights = factory();
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var ROUNDING_TOLERANCE = 3;
  var MIN_NIGHT_MINUTES = 180; // User preference: shorter records indicate an incomplete Watch recording.
  var BASELINE_DAYS = 28;
  var MIN_BASELINE_NIGHTS = 5;
  var MIN_STAGE_COVERAGE = 80;
  var DAY_MS = 86400000;

  function numeric(v) { return typeof v === 'number' && isFinite(v); }
  function nonnegative(v) { return numeric(v) && v >= 0 ? v : null; }
  function round1(v) { return v == null ? null : Math.round(v * 10) / 10; }
  function pad2(v) { return ('0' + v).slice(-2); }
  function validDate(v) { return v && typeof v.getTime === 'function' && isFinite(v.getTime()); }
  function currentDate(now) { return validDate(now) ? new Date(now.getTime()) : new Date(); }
  function localDayKey(date) {
    if (!validDate(date)) return null;
    return String(date.getFullYear()).padStart(4, '0') + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
  }
  function keyDate(key) {
    if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
    var p = key.split('-').map(Number), d = new Date(0);
    d.setUTCFullYear(p[0], p[1] - 1, p[2]);
    d.setUTCHours(0, 0, 0, 0);
    return d.getUTCFullYear() === p[0] && d.getUTCMonth() === p[1] - 1 && d.getUTCDate() === p[2] ? d : null;
  }
  function utcDayKey(date) {
    return String(date.getUTCFullYear()).padStart(4, '0') + '-' + pad2(date.getUTCMonth() + 1) + '-' + pad2(date.getUTCDate());
  }
  function shiftDay(key, offset) {
    var d = keyDate(key);
    if (!d || !numeric(offset) || Math.floor(offset) !== offset) return null;
    d.setUTCDate(d.getUTCDate() + offset);
    return utcDayKey(d);
  }
  function dayDifference(later, earlier) {
    var a = keyDate(later), b = keyDate(earlier);
    return a && b ? Math.round((a.getTime() - b.getTime()) / DAY_MS) : null;
  }
  // HCore stores local wall-clock minutes from 18:00 of evening date d.
  // Constructing local calendar time preserves that meaning across timezone/DST boundaries.
  function nightTime(key, minute) {
    if (!keyDate(key) || !numeric(minute)) return null;
    var p = key.split('-').map(Number), whole = Math.floor(minute), d = new Date(0);
    d.setFullYear(p[0], p[1] - 1, p[2]);
    d.setHours(18, whole, Math.round((minute - whole) * 60), 0);
    return validDate(d) ? d : null;
  }
  function arrayOfNights(nights) {
    if (Array.isArray(nights)) return nights;
    if (nights && typeof nights === 'object') return Object.keys(nights).map(function (k) { return nights[k]; });
    return [];
  }
  function geometry(n) {
    n = n || {};
    var tst = nonnegative(n.tst), awake = nonnegative(n.awake);
    var on = nonnegative(n.on), off = nonnegative(n.off);
    var timing = !!keyDate(n.d) && on != null && off != null && on < 1440 && off > on && off - on <= 1440;
    var span = timing ? off - on : null;
    var overflow = span != null && tst != null && (tst > span + ROUNDING_TOLERANCE || (awake != null && tst + awake > span + ROUNDING_TOLERANCE));
    var unrecorded = !overflow && span != null && tst != null && awake != null ? Math.max(0, span - tst - awake) : null;
    var continuity = !overflow && span != null && tst != null ? Math.min(100, tst / span * 100) : null;
    var gap = unrecorded != null && (unrecorded > 30 || unrecorded / span > 0.1);
    var invalidNumeric = ['tst', 'awake', 'on', 'off'].some(function (k) { return n[k] != null && nonnegative(n[k]) == null; });
    return {
      timing: timing, span: span, tst: tst, awake: awake,
      start: timing ? nightTime(n.d, on) : null,
      end: timing ? nightTime(n.d, off) : null,
      overflow: overflow, unrecorded: unrecorded, continuity: continuity,
      largeGap: gap, invalidNumeric: invalidNumeric,
      complete: timing && tst != null && awake != null && !overflow && !gap && !invalidNumeric
    };
  }

  /**
   * Percentages are 0..100, rounded to one decimal. Their denominator is the sum
   * of known Core + Deep + REM, not TST. coverage uses staged minutes / TST.
   * Unknown stages remain null, including an old backup's deep:null.
   * valid means all three stage totals and their arithmetic are usable.
   * comparable additionally requires at least 80% stage coverage.
   * unknownMinutes is explicit unspecified sleep, or otherwise the unassigned
   * remainder of TST; a <=3 minute rounding mismatch is not treated as new data.
   */
  function stageStats(n) {
    n = n || {};
    var core = nonnegative(n.core), deep = nonnegative(n.deep), rem = nonnegative(n.rem);
    var total = nonnegative(n.tst), unspec = nonnegative(n.unspec);
    var known = [core, deep, rem].filter(function (v) { return v != null; });
    var staged = known.length ? known.reduce(function (a, b) { return a + b; }, 0) : 0;
    var allKnown = core != null && deep != null && rem != null;
    var badNumeric = ['core', 'deep', 'rem', 'unspec', 'tst'].some(function (k) { return n[k] != null && nonnegative(n[k]) == null; });
    var overflow = total != null && (staged > total + ROUNDING_TOLERANCE || staged + (unspec == null ? 0 : unspec) > total + ROUNDING_TOLERANCE);
    var g = geometry(n);
    var suppliedTiming = n.on != null || n.off != null;
    var invalidTiming = suppliedTiming && !g.timing;
    var valid = allKnown && total != null && total > 0 && staged > 0 && !badNumeric && !overflow && !g.overflow && !invalidTiming;
    var residual = total != null && !overflow ? Math.max(0, total - staged) : null;
    var unknown = unspec;
    if (unknown == null) unknown = residual;
    else if (residual != null && residual > unknown + ROUNDING_TOLERANCE) unknown = residual;
    var coverage = total != null && total > 0 && !overflow ? Math.min(100, staged / total * 100) : null;
    return {
      deepMinutes: deep, coreMinutes: core, remMinutes: rem, unknownMinutes: round1(unknown),
      stagedMinutes: round1(staged), totalMinutes: total,
      deepPct: valid ? round1(deep / staged * 100) : null,
      corePct: valid ? round1(core / staged * 100) : null,
      remPct: valid ? round1(rem / staged * 100) : null,
      coverage: round1(coverage), valid: valid,
      comparable: valid && coverage >= MIN_STAGE_COVERAGE,
      invalidTotals: badNumeric || overflow || g.overflow || invalidTiming
    };
  }

  /**
   * Select a completed non-future record with at least 180 minutes of sleep.
   * Yesterday's evening date is preferred, including at night after 18:00;
   * otherwise return the freshest completed eligible record, or null.
   * A stale fallback is never relabeled "last night" by summarize().
   */
  function latestNight(nights, now) {
    var date = currentDate(now), expected = shiftDay(localDayKey(date), -1);
    var eligible = arrayOfNights(nights).filter(function (n) {
      if (!n || nonnegative(n.tst) == null || n.tst < MIN_NIGHT_MINUTES) return false;
      var g = geometry(n);
      return g.timing && g.start <= date && g.end <= date;
    }).slice().sort(function (a, b) {
      if (a.d !== b.d) return a.d < b.d ? 1 : -1;
      return b.off - a.off;
    });
    for (var i = 0; i < eligible.length; i++) if (eligible[i].d === expected) return eligible[i];
    return eligible.length ? eligible[0] : null;
  }

  function median(values) {
    if (values.length < MIN_BASELINE_NIGHTS) return null;
    var a = values.slice().sort(function (x, y) { return x - y; }), middle = Math.floor(a.length / 2);
    return a.length % 2 ? a[middle] : (a[middle - 1] + a[middle]) / 2;
  }
  function baselineEligible(candidate, now) {
    var g = geometry(candidate), stages = stageStats(candidate);
    return g.complete && g.tst >= MIN_NIGHT_MINUTES && g.end <= now && !stages.invalidTotals;
  }
  function baselineFor(n, all, now) {
    var start = shiftDay(n && n.d, -BASELINE_DAYS), end = shiftDay(n && n.d, -1), byDate = {};
    arrayOfNights(all).forEach(function (candidate) {
      if (!candidate || !keyDate(candidate.d) || !start || candidate.d < start || candidate.d > end) return;
      var existing = byDate[candidate.d];
      // Multiple imports of a date must never turn one night into several samples.
      // Prefer a usable version, then the record with the later recorded end.
      if (!existing || (!baselineEligible(existing, now) && baselineEligible(candidate, now)) ||
        (baselineEligible(existing, now) === baselineEligible(candidate, now) && nonnegative(candidate.off) != null && candidate.off > existing.off)) byDate[candidate.d] = candidate;
    });
    var recorded = Object.keys(byDate).sort();
    var records = recorded.map(function (key) { return byDate[key]; }).filter(function (candidate) {
      return baselineEligible(candidate, now);
    });
    var values = { tst: [], deepMinutes: [], deepPct: [], awake: [], hr: [], hrv: [] };
    records.forEach(function (candidate) {
      var s = stageStats(candidate);
      values.tst.push(candidate.tst);
      values.awake.push(candidate.awake);
      if (s.comparable) { values.deepMinutes.push(s.deepMinutes); values.deepPct.push(candidate.deep / (candidate.core + candidate.deep + candidate.rem) * 100); }
      if (numeric(candidate.hr) && candidate.hr > 0) values.hr.push(candidate.hr);
      if (nonnegative(candidate.hrv) != null) values.hrv.push(candidate.hrv);
    });
    var result = {
      count: records.length, start: start, end: end,
      sampleStart: records.length ? records[0].d : null,
      sampleEnd: records.length ? records[records.length - 1].d : null,
      recordedDays: recorded.length, missingDays: BASELINE_DAYS - recorded.length,
      excludedNights: recorded.length - records.length, counts: {}
    };
    Object.keys(values).forEach(function (key) {
      result.counts[key] = values[key].length;
      result[key] = round1(median(values[key]));
    });
    result.stageCount = result.counts.deepPct;
    return result;
  }
  function minutesText(value) {
    var min = Math.round(value), hours = Math.floor(min / 60), rest = min % 60;
    return hours ? hours + '小时' + (rest ? rest + '分' : '') : min + '分钟';
  }
  function targetSleep(settings) {
    var candidates = [settings.targetSleep, settings.targetMinutes, settings.sleepTarget];
    for (var i = 0; i < candidates.length; i++) if (numeric(candidates[i]) && candidates[i] > 0 && candidates[i] <= 1440) return candidates[i];
    return 480;
  }

  var QUALITY_METHOD = '本应用的提示规则：不足3小时的记录按你的设置视为不完整并跳过；3至不足6小时提示睡得偏少，6至不足7小时提示时长略少。达到7小时、已记录清醒不超过30分钟、记录区间睡眠占比至少85%、分期覆盖至少80%且记录完整时提示睡得不错；已记录清醒超过30或60分钟分别提示睡眠一般或不太踏实。未记录时段超过30分钟或记录区间的10%时暂停好坏判断；允许最多3分钟的累计舍入误差。深睡比例仅作个人趋势参考，不参与好坏评级；以上是透明的产品提示规则，不是医学评分。';

  function qualityFor(n, g, stages, target, now) {
    var reasons = [], label, tone = 'neutral', summary, limited = false;
    var missingTiming = n.on == null || n.off == null;
    var badTiming = !missingTiming && !g.timing;
    var bad = !keyDate(n.d) || badTiming || g.invalidNumeric || g.overflow || stages.invalidTotals;
    var unfinished = g.end && g.end > now;
    var shortRecord = g.tst != null && g.tst < MIN_NIGHT_MINUTES;
    if (bad) {
      label = '记录需要核对'; tone = 'warn'; limited = true;
      summary = '记录时间或累计时长不一致，暂不判断这一晚睡得好不好。';
      if (g.overflow) reasons.push('睡眠加清醒超过记录区间，可能含重叠或重复记录。');
      if (stages.invalidTotals && !g.overflow) reasons.push('睡眠分期与总时长不一致，或存在无效数值。');
      if (badTiming || !keyDate(n.d)) reasons.push('记录日期或起止时间无效。');
      if (g.invalidNumeric) reasons.push('时长字段包含无效数值。');
    } else if (shortRecord) {
      label = '记录不完整'; tone = 'neutral'; limited = true;
      summary = '记录不足3小时，已按你的设置跳过；这段数据不足以评价整晚睡眠。';
      reasons.push('不足3小时按手表中断记录处理，不纳入最近一晚或个人基线。');
    } else if (unfinished || !g.complete) {
      label = '记录不完整'; tone = 'neutral'; limited = true;
      if (unfinished) {
        summary = '记录结束时间尚未到，暂不把这一晚当作已完成的睡眠。';
        reasons.push('当前或未来时段的记录不会冒充昨晚已完成的记录。');
      } else if (g.largeGap) {
        summary = '记录内有' + minutesText(g.unrecorded) + '未覆盖时段，暂不能可靠判断整晚质量。';
        reasons.push('未覆盖时段可能是手表停机、未佩戴或未同步，不能直接当作清醒。');
      } else {
        summary = '缺少完整的睡眠时长、清醒或起止信息，暂不作整体好坏判断。';
      }
    } else {
      limited = !stages.comparable;
      if (g.tst < 360) {
        label = '睡得偏少'; tone = 'warn';
        summary = '已记录睡眠' + minutesText(g.tst) + '，时长偏少。';
      } else if (g.tst < 420) {
        label = '时长略少'; tone = 'warn';
        summary = '已记录睡眠' + minutesText(g.tst) + '，距离7小时还差' + minutesText(420 - g.tst) + '。';
      } else if (g.awake > 60) {
        label = '睡得不太踏实'; tone = 'warn';
        summary = '时长够了，但已记录清醒' + minutesText(g.awake) + '，记录中的睡眠较断续。';
      } else if (g.awake > 30 || g.continuity < 85) {
        label = '睡眠一般'; tone = 'warn';
        summary = '时长够了，记录中的清醒或中断稍多。';
      } else if (stages.comparable) {
        label = '睡得不错'; tone = 'good';
        summary = '时长达到7小时，记录也较连贯。';
      } else {
        label = '时长够了'; tone = 'neutral';
        summary = '已记录睡眠达到7小时；分期信息有限，整体质量暂不下结论。';
      }
    }
    if (g.tst != null && !shortRecord && !bad) {
      reasons.push(g.tst < target ? '距离你的' + minutesText(target) + '目标还差' + minutesText(target - g.tst) + '。' : '已达到你的' + minutesText(target) + '睡眠目标。');
    }
    if (g.awake != null && g.continuity != null && !bad && !shortRecord) reasons.push('已记录清醒' + minutesText(g.awake) + '；记录区间内睡眠占比' + round1(g.continuity) + '%，不是临床睡眠效率。');
    if (g.unrecorded != null && g.unrecorded > ROUNDING_TOLERANCE && !g.largeGap && !shortRecord) reasons.push('另有' + minutesText(g.unrecorded) + '未记录时段，未当作清醒。');
    if (!bad && !shortRecord) {
      if (!stages.valid) reasons.push('分期信息不足，深睡比例暂不估算。');
      else if (!stages.comparable) reasons.push('分期仅覆盖已记录睡眠的' + stages.coverage + '%，暂不与个人深睡基线比较。');
      else if (stages.coverage < 100) reasons.push('分期覆盖已记录睡眠的' + stages.coverage + '%；各阶段比例以已分期睡眠为分母。');
    }
    return { label: label, tone: tone, summary: summary, reasons: reasons, limited: limited, method: QUALITY_METHOD };
  }

  /**
   * Stable public result:
   * - date is the evening key d; wakeDate comes from the recorded local end.
   * - isLastNight requires yesterday's evening key AND a completed record.
   * - isCurrentNight identifies today's evening, or an unfinished active night
   *   after midnight; staleDays counts calendar days older than last night.
   * - durationGap is max(0, target - TST); wakeOffsetMinutes is signed relative
   *   to settings.wake (minutes after midnight) on the following calendar day.
   * - continuityPct is TST / recorded span, NOT clinical sleep efficiency.
   * - baseline uses medians from the prior 28 calendar days, excludes this date,
   *   and requires 5 usable nights for EACH metric. count counts usable nights;
   *   counts provides metric-specific samples. start/end are calendar bounds.
   * - delta is signed current minus baseline; deepPct is percentage points.
   *   Low-coverage, incomplete, future, or <3h records get no comparison deltas.
   */
  function summarize(n, all, settings, now) {
    n = n || {}; settings = settings || {};
    var date = currentDate(now), today = localDayKey(date), expected = shiftDay(today, -1);
    var g = geometry(n), stages = stageStats(n), target = targetSleep(settings);
    var completed = g.timing && g.start <= date && g.end <= date;
    var activeKey = date.getHours() >= 18 ? today : expected;
    var isCurrentNight = n.d === activeKey && (n.d === today || !completed);
    var stale = keyDate(n.d) ? Math.max(0, dayDifference(expected, n.d)) : null;
    var base = baselineFor(n, all, date);
    var delta = { tst: null, deepMinutes: null, deepPct: null, awake: null, hr: null, hrv: null };
    var comparable = completed && g.complete && g.tst >= MIN_NIGHT_MINUTES && !stages.invalidTotals;
    if (comparable) {
      var current = {
        tst: g.tst, deepMinutes: stages.comparable ? stages.deepMinutes : null,
        deepPct: stages.comparable ? stages.deepPct : null, awake: g.awake,
        hr: numeric(n.hr) && n.hr > 0 ? n.hr : null, hrv: nonnegative(n.hrv)
      };
      Object.keys(delta).forEach(function (key) { if (current[key] != null && base[key] != null) delta[key] = round1(current[key] - base[key]); });
    }
    var wake = numeric(settings.wake) && settings.wake >= 0 && settings.wake < 1440 ? settings.wake : 540;
    return {
      date: keyDate(n.d) ? n.d : null,
      wakeDate: g.end ? localDayKey(g.end) : shiftDay(n.d, 1),
      isLastNight: n.d === expected && completed && !isCurrentNight,
      isCurrentNight: isCurrentNight,
      staleDays: stale,
      quality: qualityFor(n, g, stages, target, date),
      stages: stages, baseline: base, delta: delta,
      durationMinutes: g.tst, awakeMinutes: g.awake, spanMinutes: g.span,
      unrecordedMinutes: round1(g.unrecorded), continuityPct: round1(g.continuity),
      targetMinutes: target,
      durationGap: g.tst == null ? null : Math.max(0, target - g.tst),
      wakeOffsetMinutes: g.timing ? round1(n.off - (wake + 360)) : null
    };
  }

  return { localDayKey: localDayKey, shiftDay: shiftDay, stageStats: stageStats, latestNight: latestNight, summarize: summarize };
});
