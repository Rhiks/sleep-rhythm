/* Morning dashboard, morning-7. Local state only; no health data uploads. */
(function (root) {
  'use strict';
  var I = root.SleepInsights;
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function finite(n) { return typeof n === 'number' && isFinite(n); }
  function dur(n) { if (!finite(n)) return '—'; n = Math.round(Math.abs(n)); return (n >= 60 ? Math.floor(n / 60) + '小时' : '') + (n % 60 || n < 60 ? n % 60 + '分' : ''); }
  function durationValue(n) { if (!finite(n)) return '—'; n = Math.round(n); return Math.floor(n / 60) + '<small>小时</small>' + ('0' + n % 60).slice(-2) + '<small>分</small>'; }
  function clock(n) { if (!finite(n)) return '—'; n = ((Math.round(n) + 1080) % 1440 + 1440) % 1440; return ('0' + Math.floor(n / 60)).slice(-2) + ':' + ('0' + n % 60).slice(-2); }
  function dateLabel(d) { var p = String(d || '').split('-'); return p.length === 3 ? +p[1] + '月' + +p[2] + '日' : '—'; }
  function pct(n) { return finite(n) ? n.toFixed(1) + '%' : '—'; }
  function signed(n, digits) { return finite(n) ? (n > 0 ? '+' : '') + n.toFixed(digits || 0) : '—'; }
  function mean(a) { a = a.filter(finite); return a.length ? a.reduce(function (s, v) { return s + v; }, 0) / a.length : null; }
  function metric(name, value, note, cls) { return '<div class="morning-metric ' + (cls || '') + '"><span class="metric-label">' + esc(name) + '</span><div class="metric-value">' + value + '</div><span class="metric-note">' + esc(note) + '</span></div>'; }
  function eligible(nights, now) { return nights.filter(function (n) { return n && I.latestNight([n], now); }).sort(function (a, b) { return a.d.localeCompare(b.d); }); }
  function settingsFor(state, date) { return Object.assign({}, state.settings || {}, { feeling: state.feelings && state.feelings[date] }); }

  function deepExplanation(s) {
    var st = s.stages, b = s.baseline, d = s.delta, signals = s.quality.signals || {}, text;
    if (!st.valid) return '这一晚没有可用的完整分期，不估算深睡比例；睡眠时长与已有HRV仍可查看。';
    if (!st.comparable) return '分期覆盖 ' + pct(st.coverage) + '，深睡比例只代表已分期部分，不按整晚深睡比例评价。';
    if (!finite(d.deepPct)) return '深睡 ' + dur(st.deepMinutes) + '，占已分期睡眠 ' + pct(st.deepPct) + '。此前28天至少需5晚可比较分期，才判断相对变化。';
    text = '深睡 ' + pct(st.deepPct) + '，较个人基线 ' + signed(d.deepPct, 1) + ' 个百分点；共 ' + dur(st.deepMinutes) + '，较平时 ' + signed(d.deepMinutes) + ' 分钟。';
    if (d.deepPct < 0 && d.deepMinutes > 0) text += '分钟数更多和比例更低可以同时发生，但分钟增加不代表整体恢复更好。';
    else if (d.deepPct > 0 && d.deepMinutes < 0) text += '比例升高但分钟减少，不能只凭比例升高判断睡得更好。';
    if (signals.deepLow && signals.hrvLow) text += '这晚深睡比例和HRV同时低于自己的近期水平，已计入上方恢复提示。';
    else if (signals.deepLow) text += '比例下降已计入恢复提示，不会被时长达标抵消。';
    else if (signals.hrvLow) text += '深睡表现不能抵消HRV下降，恢复信号仍需留意。';
    var count = b.counts && b.counts.deepPct != null ? b.counts.deepPct : b.count;
    return esc(text) + '<span class="hint">此前28天可比较 ' + count + ' 晚：深睡比例中位数 ' + pct(b.deepPct) + '，分钟数中位数 ' + dur(b.deepMinutes) + '。两者分开计算，不是通用医学及格线。</span>';
  }
  function stageSection(n, s) {
    var st = s.stages; if (!st.valid) return '';
    var parts = [['深睡', st.deepMinutes, 'deep'], ['核心 / 浅睡', st.coreMinutes, 'core'], ['REM', st.remMinutes, 'rem'], ['未分期', st.unknownMinutes, 'unspec'], ['已记录清醒', s.awakeMinutes, 'awake']];
    var total = parts.reduce(function (sum, p) { return sum + (finite(p[1]) ? p[1] : 0); }, 0), bar = '', legend = [], desc = [];
    parts.forEach(function (p) {
      if (!finite(p[1]) || p[1] <= 0) return;
      bar += '<i style="width:' + (p[1] / total * 100).toFixed(3) + '%;background:var(--' + p[2] + ')"></i>';
      legend.push('<span><i style="background:var(--' + p[2] + ')"></i>' + p[0] + ' ' + Math.round(p[1]) + '分</span>');
      desc.push(p[0] + Math.round(p[1]) + '分钟');
    });
    return '<div class="stage-section"><div class="stage-heading">各阶段时长<span>分期覆盖 ' + pct(st.coverage) + '</span></div><div class="stage-bar" role="img" aria-label="' + esc(desc.join('，')) + '">' + bar + '</div><div class="stage-legend">' + legend.join('') + '</div></div>';
  }
  function timeline(n) {
    var span = n.off - n.on, colors = ['core', 'deep', 'rem', 'awake', 'unspec'], names = ['核心睡眠', '深睡', 'REM', '已记录清醒', '未分期'], heights = [21, 32, 14, 6, 18], html = '';
    if (!finite(span) || span <= 0 || !Array.isArray(n.segs)) return '';
    n.segs.forEach(function (g) {
      if (!Array.isArray(g) || !finite(g[0]) || !finite(g[1]) || !colors[g[2]]) return;
      var a = Math.max(n.on, g[0]), b = Math.min(n.off, g[0] + g[1]); if (b <= a) return;
      html += '<i data-stage="' + g[2] + '" style="left:' + ((a - n.on) / span * 100).toFixed(3) + '%;width:' + ((b - a) / span * 100).toFixed(3) + '%;height:' + heights[g[2]] + 'px;background:var(--' + colors[g[2]] + ')" title="' + names[g[2]] + ' ' + clock(a) + '–' + clock(b) + '"></i>';
    });
    return '<div class="night-timeline"><div class="stage-heading">这一晚的睡眠过程<span>空白仅表示未记录</span></div><div class="night-track" role="img" aria-label="睡眠分期时间轴，记录从' + clock(n.on) + '到' + clock(n.off) + '">' + html + '</div><div class="night-times"><span>记录开始 ' + clock(n.on) + '</span><span>记录结束 ' + clock(n.off) + '</span></div></div>';
  }
  function feedback(n, state) {
    var feelings = {good: '精神不错', normal: '一般', tired: '仍然困倦'}, feeling = state.feelings && state.feelings[n.d];
    return '<div class="wake-feedback"><span class="prompt">醒后感受也参与判断</span><div class="row" role="group" aria-label="醒后感受">' + Object.keys(feelings).map(function (key) {
      return '<button type="button" data-feeling="' + key + '" data-feeling-date="' + esc(n.d) + '" aria-pressed="' + (feeling === key) + '">' + feelings[key] + '</button>';
    }).join('') + '</div></div>';
  }
  function details(n, s) {
    var vitals = [['REM睡眠', pct(s.stages.remPct), dur(s.stages.remMinutes) + ' · 占已分期睡眠'],
      ['已记录清醒', finite(s.awakeMinutes) ? Math.round(s.awakeMinutes) + ' 分钟' : '—', '未记录空白不算清醒'],
      ['呼吸频率', finite(n.rr) ? n.rr.toFixed(1) + ' 次/分' : '—', '手表记录的平均值'],
      ['平均血氧', finite(n.ox) ? n.ox.toFixed(1) + '%' : '—', finite(n.oxMin) ? '已记录最低 ' + n.oxMin + '%' : '暂无最低值']];
    var html = vitals.map(function (v) { return '<div class="vital"><span>' + v[0] + '</span><b>' + esc(v[1]) + '</b><span>' + esc(v[2]) + '</span></div>'; }).join('');
    var warnings = (s.quality.warnings || []).map(function (w) { return '<p>' + esc(w) + '</p>'; }).join('');
    var deepDenominator = s.stages.valid && s.stages.coverage < 99.5 ? '<p>已确认深睡占已记录总睡眠 ' + pct(s.stages.confirmedDeepPct) + '；未分期部分的深睡未知，不将其当作零，也不把上方已分期比例冒充精确的全晚比例。</p>' : '';
    return '<details class="morning-details"><summary>REM、清醒、数据覆盖与判断依据</summary><div class="vitals">' + html + '</div>' + warnings + deepDenominator + '<p>' + s.quality.reasons.map(esc).join(' ') + '</p><p>' + esc(s.quality.method) + '</p><p>基线区间：' + esc(s.baseline.start) + ' 至 ' + esc(s.baseline.end) + '。时长 ' + s.baseline.counts.tst + ' 晚，深睡 ' + s.baseline.counts.deepPct + ' 晚，HRV ' + s.baseline.counts.hrv + ' 晚，心率 ' + s.baseline.counts.hr + ' 晚；缺失不是0，同日期不重复计数。</p><p>手表分期是估计。深睡比例和HRV都参与提示，但不能单独诊断疾病或证明睡眠好坏。持续长睡仍困倦时，应寻求睡眠门诊评估，不靠追加助眠补剂处理。<a href="https://www.nhlbi.nih.gov/health/sleep/stages-of-sleep" target="_blank" rel="noopener noreferrer">睡眠阶段说明</a> · <a href="https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/heartratevariabilitysdnn" target="_blank" rel="noopener noreferrer">SDNN定义</a></p><p class="hint">版本 morning-7 · 数据缺口与恢复表现分开判断</p></details>';
  }
  function renderWeek(state, nights, selected, now) {
    var box = document.getElementById('morningWeek'); if (!box) return;
    var end = I.shiftDay(I.localDayKey(now), -1), valid = eligible(nights, now), by = {}, items = [];
    valid.forEach(function (n) { by[n.d] = n; });
    if (selected && selected < I.shiftDay(end, -6)) end = selected;
    for (var i = 6; i >= 0; i--) {
      var key = I.shiftDay(end, -i), n = by[key], raw = (state.nights || {})[key], text = key.slice(5).replace('-', '/');
      if (n) {
        var st = I.stageStats(n);
        items.push('<button class="week-night" data-select-night="' + key + '" aria-label="查看' + dateLabel(key) + '晚，睡眠' + dur(n.tst) + '" aria-pressed="' + (selected === key) + '"><span class="day">' + text + '</span><span class="hours">' + (n.tst / 60).toFixed(1) + '小时</span><span class="deep-share">深睡 ' + (st.valid ? pct(st.deepPct) : '—') + '</span><span class="mini-track" aria-hidden="true"><i style="width:' + Math.min(100, n.tst / 720 * 100).toFixed(1) + '%"></i></span></button>');
      } else items.push('<button class="week-night" disabled aria-label="' + dateLabel(key) + (raw && raw.tst < 180 ? '，不足3小时已跳过' : '，无已完成记录') + '"><span class="day">' + text + '</span><span class="hours">—</span><span class="deep-share">' + (raw && raw.tst < 180 ? '已跳过' : '无记录') + '</span><span class="mini-track" aria-hidden="true"></span></button>');
    }
    var start = I.shiftDay(end, -6), recent = valid.filter(function (n) { return n.d >= start && n.d <= end; });
    var avg = mean(recent.map(function (n) { return n.tst; })), deep = mean(recent.map(function (n) { var st = I.stageStats(n); return st.comparable ? st.deepMinutes : null; }));
    box.innerHTML = '<div class="week-head"><h2>近 7 晚，一起看</h2><span>' + recent.length + ' 晚可用记录</span></div><div class="week-strip">' + items.join('') + '</div><p class="week-foot">' + (recent.length ? '平均已记录睡眠 ' + dur(avg) + (finite(deep) ? ' · 平均深睡 ' + Math.round(deep) + ' 分钟' : '') + '。' : '这7个日历夜还没有可用记录。') + '点日期查看；不足3小时跳过，有缺口的长记录保留。</p>';
  }
  function render(state, requested, now) {
    now = now || new Date();
    var nights = Object.keys(state.nights || {}).sort().map(function (k) { return state.nights[k]; }), all = eligible(nights, now), latest = I.latestNight(nights, now);
    var expected = I.shiftDay(I.localDayKey(now), -1), n = requested && all.find(function (x) { return x.d === requested; }) || latest;
    var nav = document.getElementById('nightNav'), box = document.getElementById('today'), freshness = document.getElementById('morningFreshness');
    if (!n) {
      nav.innerHTML = ''; freshness.innerHTML = '';
      box.innerHTML = '<h3 class="morning-verdict">还没有可用的整晚记录</h3><p class="morning-summary">不足3小时的片段已按你的规则跳过，尚未结束的记录暂不评价。导入已完成的记录后，会显示质量提示、深睡比例和HRV。</p>';
      renderWeek(state, nights, null, now); return null;
    }
    var s = I.summarize(n, nights, settingsFor(state, n.d), now), st = s.stages, index = all.findIndex(function (x) { return x.d === n.d; });
    document.getElementById('h-today').textContent = s.isCurrentNight ? '今晚已记录' : n.d === expected ? '昨夜睡眠' : '这一晚睡眠';
    nav.innerHTML = '<button type="button" data-select-night="' + (index > 0 ? all[index - 1].d : '') + '" aria-label="前一晚"' + (index === 0 ? ' disabled' : '') + '>‹</button><select id="nightSelect" aria-label="选择查看的夜晚">' + all.slice().reverse().map(function (x) { return '<option value="' + x.d + '"' + (x.d === n.d ? ' selected' : '') + '>' + dateLabel(x.d) + '晚' + (x.d === expected ? ' · 昨夜' : '') + '</option>'; }).join('') + '</select><button type="button" data-select-night="' + (index < all.length - 1 ? all[index + 1].d : '') + '" aria-label="后一晚"' + (index === all.length - 1 ? ' disabled' : '') + '>›</button>';
    var old = !latest || latest.d !== expected, raw = (state.nights || {})[expected], note = '';
    if (old) note = raw && raw.tst < 180 ? '昨夜记录不足 3 小时，已按手表中断片段跳过。下方是最近一晚可用记录。' : '昨夜尚无可用的已完成记录。下方显示实际日期，更新后再看昨夜。';
    else if (n.d !== expected) note = '正在查看历史记录，日期按入夜当天标记。';
    freshness.innerHTML = note ? '<div class="freshness-note"><span>' + note + '</span><button type="button" ' + (old ? 'data-morning-import' : 'data-select-night="latest"') + '>' + (old ? '更新数据' : '回到昨夜') + '</button></div>' : '';
    var title = s.quality.label, summary = s.quality.summary, tone = s.quality.tone;
    // Never replace a recovery warning with a reassuring duration/wake-time headline.
    if (s.isCurrentNight) { title = '今晚已有睡眠记录'; summary = '目前记录睡眠 ' + dur(s.durationMinutes) + '，这一晚还未结束，暂不对整晚质量下结论。'; tone = 'neutral'; }
    var goal = s.durationGap > 0 ? '距 ' + dur(s.targetMinutes) + ' 目标还差 ' + dur(s.durationGap) : '达到 ' + dur(s.targetMinutes) + ' 目标，不等于恢复良好';
    var deepNote = st.valid ? dur(st.deepMinutes) + ' · 占已分期睡眠' : '暂无可用分期';
    if (finite(s.delta.deepPct)) deepNote += ' · 较平时 ' + signed(s.delta.deepPct, 1) + ' 个百分点';
    var hrvNote = finite(s.delta.hrv) ? '平时 ' + s.baseline.hrv + ' ms · ' + signed(s.quality.signals.hrvChangePct, 1) + '%' : 'SDNN · 暂无可比较基线';
    var hrNote = finite(s.delta.hr) ? '平时 ' + s.baseline.hr + ' · ' + signed(s.delta.hr, 1) + ' 次/分' : '每分钟 · 暂无可比较基线';
    var meta = (s.isCurrentNight ? '今晚已记录' : n.d === expected ? '昨夜' : '历史记录') + ' · ' + dateLabel(n.d) + '晚 → ' + dateLabel(s.wakeDate || I.shiftDay(n.d, 1));
    var coverageNote = s.unrecordedMinutes > 3 ? '<p class="morning-summary" data-recording-gap>另有 <strong>' + dur(s.unrecordedMinutes) + '</strong> 未记录，已记录部分照常分析；不计作清醒。</p>' : '';
    var wakeNote = finite(s.wakeOffsetMinutes) && s.wakeOffsetMinutes > 90 ? '<p class="hint">记录结束比起床目标晚 ' + dur(s.wakeOffsetMinutes) + '；起床偏晚与恢复表现分开看。</p>' : '';
    box.innerHTML = '<div class="morning-meta"><span>' + esc(meta) + '</span><span class="status-pill ' + (tone === 'good' ? 'good' : tone === 'warn' ? 'warn' : '') + '">' + (s.quality.scope === 'recorded' ? '已记录部分' : s.quality.limited ? '部分指标有限' : '基于手表记录') + '</span></div><h3 class="morning-verdict">' + esc(title) + '</h3><p class="morning-summary">' + esc(summary) + '</p>' + coverageNote + '<div class="morning-metrics">' + metric('已记录睡眠', durationValue(s.durationMinutes), goal, 'duration') + metric('深睡比例', pct(st.deepPct), deepNote, 'deep') + metric('睡眠 HRV', finite(n.hrv) && n.hrv > 0 ? Math.round(n.hrv) + '<small>ms</small>' : '—', hrvNote) + metric('睡眠心率', finite(n.hr) && n.hr > 0 ? n.hr.toFixed(1) + '<small>次/分</small>' : '—', hrNote) + '</div>' + feedback(n, state) + '<div class="deep-explainer">' + deepExplanation(s) + '</div>' + stageSection(n, s) + timeline(n) + wakeNote + details(n, s);
    renderWeek(state, nights, n.d, now); return n.d;
  }
  root.SleepMorning = { render: render };
})(typeof window !== 'undefined' ? window : this);
