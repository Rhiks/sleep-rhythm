/* Sleep Rhythm morning-7. Pure calculations; no storage, network, or medical score. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SleepInsights = factory();
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  var TOLERANCE = 3, MIN_NIGHT = 180, BASE_DAYS = 28, MIN_BASE = 5, MIN_COVERAGE = 80;
  function numeric(v) { return typeof v === 'number' && isFinite(v); }
  function nonnegative(v) { return numeric(v) && v >= 0 ? v : null; }
  function positive(v) { return numeric(v) && v > 0 ? v : null; }
  function round1(v) { return v == null ? null : Math.round(v * 10) / 10; }
  function pad2(v) { return ('0' + v).slice(-2); }
  function validDate(v) { return v && typeof v.getTime === 'function' && isFinite(v.getTime()); }
  function currentDate(now) { return validDate(now) ? new Date(now.getTime()) : new Date(); }
  function localDayKey(d) {
    return validDate(d) ? String(d.getFullYear()).padStart(4, '0') + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) : null;
  }
  function keyDate(key) {
    if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
    var p = key.split('-').map(Number), d = new Date(0);
    d.setUTCFullYear(p[0], p[1] - 1, p[2]); d.setUTCHours(0, 0, 0, 0);
    return d.getUTCFullYear() === p[0] && d.getUTCMonth() === p[1] - 1 && d.getUTCDate() === p[2] ? d : null;
  }
  function shiftDay(key, offset) {
    var d = keyDate(key);
    if (!d || !numeric(offset) || Math.floor(offset) !== offset) return null;
    d.setUTCDate(d.getUTCDate() + offset);
    return String(d.getUTCFullYear()).padStart(4, '0') + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }
  function dayDifference(a, b) { a = keyDate(a); b = keyDate(b); return a && b ? Math.round((a - b) / 86400000) : null; }
  // Stored times are local wall-clock minutes from 18:00 of the evening date.
  function nightTime(key, minute) {
    if (!keyDate(key) || !numeric(minute)) return null;
    var p = key.split('-').map(Number), whole = Math.floor(minute), d = new Date(0);
    d.setFullYear(p[0], p[1] - 1, p[2]); d.setHours(18, whole, Math.round((minute - whole) * 60), 0);
    return validDate(d) ? d : null;
  }
  function arrayOfNights(n) { return Array.isArray(n) ? n : n && typeof n === 'object' ? Object.keys(n).map(function (k) { return n[k]; }) : []; }
  function geometry(n) {
    n = n || {};
    var tst = nonnegative(n.tst), awake = nonnegative(n.awake), on = nonnegative(n.on), off = nonnegative(n.off);
    var timing = !!keyDate(n.d) && on != null && off != null && on < 1440 && off > on && off - on <= 1440;
    var span = timing ? off - on : null;
    var overflow = span != null && tst != null && (tst > span + TOLERANCE || (awake != null && tst + awake > span + TOLERANCE));
    var unrecorded = !overflow && span != null && tst != null && awake != null ? Math.max(0, span - tst - awake) : null;
    var invalidNumeric = ['tst', 'awake', 'on', 'off'].some(function (k) { return n[k] != null && nonnegative(n[k]) == null; });
    return {
      timing: timing, span: span, tst: tst, awake: awake,
      start: timing ? nightTime(n.d, on) : null, end: timing ? nightTime(n.d, off) : null,
      overflow: overflow, unrecorded: unrecorded, invalidNumeric: invalidNumeric,
      // A gap limits coverage, NEVER the visibility of recorded sleep or baseline comparisons.
      largeGap: unrecorded != null && unrecorded / span > 0.1,
      usable: timing && tst != null && !overflow && !invalidNumeric,
      continuity: !overflow && span && tst != null ? Math.min(100, tst / span * 100) : null,
      recordedContinuity: !overflow && tst != null && awake != null && tst + awake > 0 ? tst / (tst + awake) * 100 : null
    };
  }
  function stageStats(n) {
    n = n || {};
    var core = nonnegative(n.core), deep = nonnegative(n.deep), rem = nonnegative(n.rem), total = nonnegative(n.tst), unspec = nonnegative(n.unspec);
    var known = [core, deep, rem].filter(function (v) { return v != null; });
    var staged = known.reduce(function (a, b) { return a + b; }, 0), allKnown = known.length === 3;
    var badNumeric = ['core', 'deep', 'rem', 'unspec', 'tst'].some(function (k) { return n[k] != null && nonnegative(n[k]) == null; });
    var overflow = total != null && (staged > total + TOLERANCE || staged + (unspec || 0) > total + TOLERANCE);
    var g = geometry(n), invalidTiming = (n.on != null || n.off != null) && !g.timing;
    var invalid = badNumeric || overflow || g.overflow || invalidTiming;
    var valid = allKnown && total != null && total > 0 && staged > 0 && !invalid;
    var residual = total != null && !overflow ? Math.max(0, total - staged) : null;
    var unknown = unspec == null ? residual : residual != null && residual > unspec + TOLERANCE ? residual : unspec;
    var coverage = total != null && total > 0 && !overflow ? Math.min(100, staged / total * 100) : null;
    return {
      deepMinutes: deep, coreMinutes: core, remMinutes: rem, unknownMinutes: round1(unknown),
      stagedMinutes: round1(staged), totalMinutes: total,
      deepPct: valid ? round1(deep / staged * 100) : null,
      corePct: valid ? round1(core / staged * 100) : null, remPct: valid ? round1(rem / staged * 100) : null,
      confirmedDeepPct: valid ? round1(deep / total * 100) : null,
      coverage: round1(coverage), valid: valid, comparable: valid && coverage >= MIN_COVERAGE, invalidTotals: invalid
    };
  }
  function latestNight(nights, now) {
    var date = currentDate(now), expected = shiftDay(localDayKey(date), -1);
    var list = arrayOfNights(nights).filter(function (n) {
      if (!n || nonnegative(n.tst) == null || n.tst < MIN_NIGHT) return false;
      var g = geometry(n); return g.timing && g.start <= date && g.end <= date;
    }).slice().sort(function (a, b) { return a.d !== b.d ? (a.d < b.d ? 1 : -1) : b.off - a.off; });
    for (var i = 0; i < list.length; i++) if (list[i].d === expected) return list[i];
    return list[0] || null;
  }
  function median(values) {
    if (values.length < MIN_BASE) return null;
    var a = values.slice().sort(function (x, y) { return x - y; }), m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }
  function baselineEligible(n, now) {
    var g = geometry(n);
    return g.usable && g.tst >= MIN_NIGHT && g.end <= now && !stageStats(n).invalidTotals;
  }
  function baselineFor(n, all, now) {
    var start = shiftDay(n.d, -BASE_DAYS), end = shiftDay(n.d, -1), byDate = {};
    arrayOfNights(all).forEach(function (c) {
      if (!c || !keyDate(c.d) || !start || c.d < start || c.d > end) return;
      var old = byDate[c.d];
      if (!old || (!baselineEligible(old, now) && baselineEligible(c, now)) ||
        (baselineEligible(old, now) === baselineEligible(c, now) && nonnegative(c.off) != null && c.off > old.off)) byDate[c.d] = c;
    });
    var recorded = Object.keys(byDate).sort(), records = recorded.map(function (k) { return byDate[k]; }).filter(function (c) { return baselineEligible(c, now); });
    var values = { tst: [], deepMinutes: [], deepPct: [], awake: [], hr: [], hrv: [] };
    records.forEach(function (c) {
      var s = stageStats(c); values.tst.push(c.tst);
      if (nonnegative(c.awake) != null) values.awake.push(c.awake);
      if (s.comparable) { values.deepMinutes.push(s.deepMinutes); values.deepPct.push(c.deep / (c.core + c.deep + c.rem) * 100); }
      if (positive(c.hr) != null) values.hr.push(c.hr);
      if (positive(c.hrv) != null) values.hrv.push(c.hrv);
    });
    var result = { count: records.length, start: start, end: end, sampleStart: records.length ? records[0].d : null,
      sampleEnd: records.length ? records[records.length - 1].d : null, recordedDays: recorded.length,
      missingDays: BASE_DAYS - recorded.length, excludedNights: recorded.length - records.length, counts: {} };
    Object.keys(values).forEach(function (k) { result.counts[k] = values[k].length; result[k] = round1(median(values[k])); });
    result.stageCount = result.counts.deepPct; return result;
  }
  function minutesText(v) { var m = Math.round(v), h = Math.floor(m / 60); return h ? h + '小时' + (m % 60 ? m % 60 + '分' : '') : m + '分钟'; }
  function targetSleep(s) {
    var a = [s.targetSleep, s.targetMinutes, s.sleepTarget];
    for (var i = 0; i < a.length; i++) if (numeric(a[i]) && a[i] > 0 && a[i] <= 1440) return a[i];
    return 480;
  }
  var METHOD = '产品提示规则（不是医学评分）：不足3小时按你的设置跳过；达到3小时的已完成记录保留显示，未记录时段只影响置信度，不算清醒、不归零、不触发30分钟屏蔽。基线为此前28个日历日、每项至少5晚的中位数，排除当晚、未来和无效值；深睡比较还要求分期覆盖至少80%。深睡比例低于个人基线至少max(2个百分点,基线的15%)、HRV低于个人基线20%、睡眠心率高于基线5次/分是关注信号；HRV下降35%或心率升高10次/分标为明显偏离。深睡分钟少于基线15分钟作补充。总睡眠超过10小时且比个人基线长90分钟（无基线时超过10小时）只提示偏长，不额外加分。已记录清醒超过30分钟或已记录时段内睡眠占比低于85%提示断续。所有数值切点都是可审查的产品阈值，不是临床诊断界值；高HRV或深睡分钟多不能抵消其他不利信号。醒后仍困倦会影响结论。';
  function qualityFor(n, g, st, base, delta, settings, target, now) {
    var reasons = [], warnings = [], label = '时长够了', tone = 'neutral', summary = '', limited = false;
    var bad = !keyDate(n.d) || ((n.on != null && n.off != null) && !g.timing) || g.invalidNumeric || g.overflow || st.invalidTotals;
    var short = g.tst != null && g.tst < MIN_NIGHT, unfinished = g.end && g.end > now;
    var hrvChange = positive(n.hrv) != null && positive(base.hrv) != null && delta.hrv != null ? round1((n.hrv / base.hrv - 1) * 100) : null;
    var flags = {
      hrvChangePct: hrvChange, hrvLow: hrvChange != null && hrvChange <= -20,
      hrvVeryLow: hrvChange != null && hrvChange <= -35,
      deepLow: delta.deepPct != null && delta.deepPct <= -Math.max(2, base.deepPct * .15),
      deepMinutesLow: delta.deepMinutes != null && delta.deepMinutes <= -15,
      hrHigh: delta.hr != null && delta.hr >= 5, hrVeryHigh: delta.hr != null && delta.hr >= 10,
      longSleep: g.tst > 600 && (base.tst == null || g.tst >= base.tst + 90),
      tired: settings.feeling === 'tired', feelingGood: settings.feeling === 'good',
      fragmented: g.awake > 30 || (g.recordedContinuity != null && g.recordedContinuity < 85)
    };
    if (bad) {
      label = '记录需要核对'; tone = 'warn'; limited = true;
      summary = '记录时间或累计时长不一致；保留已记录数值，暂不作整体评价。';
      reasons.push('检查时间、重叠记录和分期合计；允许最多3分钟舍入误差。');
    } else if (short) {
      label = '记录不完整'; limited = true;
      summary = '记录不足3小时，已按你的设置跳过，不纳入整晚评价或基线。';
    } else if (unfinished || !g.usable) {
      label = '记录不完整'; limited = true;
      summary = unfinished ? '记录结束时间尚未到，暂不把这一晚当作已完成的睡眠。' : '缺少有效的时长或起止信息；已有指标仍显示，暂不作整体评价。';
    } else {
      var adverse = flags.hrvLow || flags.deepLow || flags.deepMinutesLow || flags.hrHigh;
      limited = g.unrecorded > TOLERANCE || g.awake == null || !st.comparable || delta.deepPct == null || delta.hrv == null || delta.hr == null;
      if (flags.deepLow) reasons.push('深睡比例' + st.deepPct + '%，比个人基线' + base.deepPct + '%低' + round1(-delta.deepPct) + '个百分点。');
      if (flags.deepMinutesLow) reasons.push('深睡' + minutesText(st.deepMinutes) + '，比个人基线少' + Math.round(-delta.deepMinutes) + '分钟。');
      if (flags.hrvLow) reasons.push('睡眠HRV为' + n.hrv + ' ms，个人基线' + base.hrv + ' ms，下降' + Math.round(-hrvChange) + '%。');
      if (flags.hrHigh) reasons.push('睡眠心率比个人基线高' + delta.hr + '次/分。');
      if (flags.tired) reasons.push('你记录了醒后仍然困倦，不能用时长达标抵消这种感受。');
      if (flags.fragmented) reasons.push('已记录清醒' + minutesText(g.awake) + '，已记录时段的连续性偏弱。');
      if (g.tst < 360) {
        label = '睡得偏少'; tone = 'warn'; summary = '已记录睡眠' + minutesText(g.tst) + '，时长偏少。';
      } else if (g.tst < 420) {
        label = '时长略少'; tone = 'warn'; summary = '已记录睡眠' + minutesText(g.tst) + '，不足7小时。';
      } else if (flags.tired) {
        label = flags.longSleep ? '睡得久，仍未解乏' : '睡后仍然困倦'; tone = 'warn';
        summary = '时长已经够了，但你醒后仍然困倦，不能评价为睡得好。';
      } else if (adverse) {
        label = flags.longSleep ? '睡得久，恢复信号偏弱' : '恢复信号偏弱'; tone = 'warn';
        if (flags.deepLow && flags.hrvLow) summary = '深睡比例和HRV都低于自己的近期水平，时长充足不能抵消这些信号。';
        else if (flags.hrvLow) summary = 'HRV' + (flags.hrvVeryLow ? '明显' : '') + '低于自己的近期水平，提示恢复状态可能不如平时；不是疾病诊断。';
        else if (flags.hrHigh) summary = '睡眠心率高于自己的近期水平，先结合醒后感受与连续几晚变化观察。';
        else summary = '深睡表现低于自己的近期水平，不能只因为睡眠时长够了就判为睡得好。';
        if (flags.feelingGood) summary += '你记录的体感不错，但指标偏离仍单独保留。';
      } else if (flags.fragmented) {
        label = g.awake > 60 ? '睡得不太踏实' : '睡眠一般'; tone = 'warn';
        summary = '时长够了，但已记录清醒偏多；未记录空白没有算作清醒。';
      } else if (flags.longSleep) {
        label = '睡得偏长，留意是否解乏';
        summary = '已记录睡眠' + minutesText(g.tst) + '，比平时长；多睡的时间不额外加分，需结合醒后状态。';
      } else if (g.awake != null && st.comparable && delta.deepPct != null && delta.hrv != null && delta.hr != null) {
        label = g.largeGap ? '已记录部分较平稳' : '整体表现较平稳'; tone = g.largeGap ? 'neutral' : 'good';
        summary = '已记录时长和连续性尚可，深睡、HRV与心率未触发明显变差提示；是否解乏仍看醒后感受。';
      } else {
        label = '时长够了'; summary = '时长达标，但恢复指标或个人基线不足，不直接判断睡得好。';
      }
      if (g.unrecorded > TOLERANCE) warnings.push('已记录睡眠' + minutesText(g.tst) + '，另有' + minutesText(g.unrecorded) + '未记录；继续分析已记录部分，缺口不算清醒。');
      if (g.largeGap) warnings.push('空白超过记录区间的10%，结果仅描述已记录部分，整晚置信度降低。');
      if (!st.valid) warnings.push('缺少可用分期，不把深睡缺失当作0。');
      else if (!st.comparable) warnings.push('分期覆盖' + st.coverage + '%，比例只代表已分期部分，不作深睡基线判断。');
      else if (st.coverage < 99.5) warnings.push('分期覆盖' + st.coverage + '%；深睡比例的分母是已分期睡眠，不包含未分期或空白。');
      if (delta.hrv == null) warnings.push('HRV或其个人基线不足，不能据此确认恢复良好。');
      if (g.awake == null) warnings.push('缺少清醒时长，不把缺失当成0分钟。');
      if (g.tst < target) reasons.push('距离你的' + minutesText(target) + '目标还差' + minutesText(target - g.tst) + '。');
      else reasons.push('已达到你的' + minutesText(target) + '时长目标；达标不等于恢复良好。');
      if (g.recordedContinuity != null) reasons.push('已记录时段内睡眠占比' + round1(g.recordedContinuity) + '%，分母仅为已记录睡眠加清醒，不是临床睡眠效率。');
      if (hrvChange != null) reasons.push('HRV使用同口径的睡眠SDNN摘要与个人基线比较；单晚结果不能证明疾病，旧备份没有样本数量信息。');
    }
    return { label: label, tone: tone, summary: summary, reasons: reasons, warnings: warnings,
      limited: limited, method: METHOD, signals: flags, scope: g.unrecorded > TOLERANCE ? 'recorded' : 'night' };
  }
  function summarize(n, all, settings, now) {
    n = n || {}; settings = settings || {};
    var date = currentDate(now), today = localDayKey(date), expected = shiftDay(today, -1);
    var g = geometry(n), st = stageStats(n), target = targetSleep(settings), base = baselineFor(n, all, date);
    var completed = g.timing && g.start <= date && g.end <= date;
    var activeKey = date.getHours() >= 18 ? today : expected;
    var isCurrent = n.d === activeKey && (n.d === today || !completed);
    var delta = { tst: null, deepMinutes: null, deepPct: null, awake: null, hr: null, hrv: null };
    if (completed && g.usable && g.tst >= MIN_NIGHT && !st.invalidTotals) {
      var cur = { tst: g.tst, deepMinutes: st.comparable ? st.deepMinutes : null, deepPct: st.comparable ? st.deepPct : null,
        awake: g.awake, hr: positive(n.hr), hrv: positive(n.hrv) };
      Object.keys(delta).forEach(function (k) { if (cur[k] != null && base[k] != null) delta[k] = round1(cur[k] - base[k]); });
    }
    var wake = numeric(settings.wake) && settings.wake >= 0 && settings.wake < 1440 ? settings.wake : 540;
    return { date: keyDate(n.d) ? n.d : null, wakeDate: g.end ? localDayKey(g.end) : shiftDay(n.d, 1),
      isLastNight: n.d === expected && completed && !isCurrent, isCurrentNight: isCurrent,
      staleDays: keyDate(n.d) ? Math.max(0, dayDifference(expected, n.d)) : null,
      quality: qualityFor(n, g, st, base, delta, settings, target, date), stages: st, baseline: base, delta: delta,
      durationMinutes: g.tst, awakeMinutes: g.awake, spanMinutes: g.span,
      unrecordedMinutes: round1(g.unrecorded), continuityPct: round1(g.continuity), recordedContinuityPct: round1(g.recordedContinuity),
      targetMinutes: target, durationGap: g.tst == null ? null : Math.max(0, target - g.tst),
      wakeOffsetMinutes: g.timing ? round1(n.off - (wake + 360)) : null };
  }
  return { localDayKey: localDayKey, shiftDay: shiftDay, stageStats: stageStats, latestNight: latestNight, summarize: summarize };
});
