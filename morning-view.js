/* Morning dashboard. Receives local state; never sends or stores health data. */
(function (root) {
  'use strict';
  var I = root.SleepInsights;
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function finite(n) { return typeof n === 'number' && isFinite(n); }
  function dur(n) { if (!finite(n)) return '—'; n = Math.round(Math.abs(n)); return (n >= 60 ? Math.floor(n / 60) + '小时' : '') + (n % 60 || n < 60 ? n % 60 + '分' : ''); }
  function durationValue(n) { if (!finite(n)) return '—'; n = Math.round(n); return Math.floor(n / 60) + '<small>小时</small>' + ('0' + n % 60).slice(-2) + '<small>分</small>'; }
  function clock(n) { if (!finite(n)) return '—'; n = ((Math.round(n) + 1080) % 1440 + 1440) % 1440; return ('0' + Math.floor(n / 60)).slice(-2) + ':' + ('0' + n % 60).slice(-2); }
  function dateLabel(d) { var p = String(d || '').split('-'); return p.length === 3 ? +p[1] + '月' + +p[2] + '日' : '—'; }
  function pct(n) { return finite(n) ? n.toFixed(1) + '%' : '—'; }
  function mean(a) { a = a.filter(finite); return a.length ? a.reduce(function (s, v) { return s + v; }, 0) / a.length : null; }
  function metric(name, value, note, className) { return '<div class="morning-metric ' + (className || '') + '"><span class="metric-label">' + esc(name) + '</span><div class="metric-value">' + value + '</div><span class="metric-note">' + note + '</span></div>'; }
  function eligible(nights, now) { return nights.filter(function (n) { return n && I.latestNight([n], now); }).sort(function (a,b) { return a.d.localeCompare(b.d); }); }

  function deepExplanation(s) {
    var st = s.stages, b = s.baseline, d = s.delta;
    if (!st.valid) return '这一晚没有可用的完整分期，深睡比例暂不显示；已记录睡眠时长仍可查看。';
    if (!st.comparable) return '只有 ' + pct(st.coverage) + ' 的睡眠有分期，深睡比例只代表这一部分，暂不和整晚基线比较。';
    if (!finite(b.deepPct)) return '深睡 ' + dur(st.deepMinutes) + '，占已分期睡眠 ' + pct(st.deepPct) + '。积累至少 5 晚可比较记录后，会显示你自己的基线。';
    if (!finite(d.deepPct) || !finite(d.deepMinutes)) return '这一晚的记录不够完整，暂不判断深睡比平时更多或更少。上方比例只描述已记录的分期。';
    var text;
    if (d.deepPct <= -.5 && d.deepMinutes >= 5) text = '深睡比例低了一些，但实际多了 ' + Math.round(d.deepMinutes) + ' 分钟深睡。总睡眠更长，把比例摊薄了。';
    else if (d.deepPct >= .5 && d.deepMinutes <= -5) text = '深睡比例更高，但实际少了 ' + Math.round(-d.deepMinutes) + ' 分钟。总睡眠较短，不能只看比例判好坏。';
    else if (d.deepMinutes <= -15) text = '这晚的深睡分钟数少于你平时，先结合总睡眠时长和醒后感觉看；单晚下降不代表持续变差。';
    else if (d.deepMinutes >= 15) text = '这晚的深睡分钟数高于你平时。是否恢复得好，也要结合睡眠是否连贯和醒后感觉。';
    else text = '深睡分钟数与自己的近期水平接近。比例不是越高越好，连续几晚的趋势更有参考价值。';
    var count = b.counts && b.counts.deepPct != null ? b.counts.deepPct : b.count;
    return esc(text) + '<span class="hint">此前 28 天可比较 ' + count + ' 晚完整记录的中位数：' + pct(b.deepPct) + ' · ' + dur(b.deepMinutes) + '</span>';
  }

  function stageSection(n, s) {
    var st = s.stages;
    if (!st.valid) return '';
    var parts = [ ['深睡', st.deepMinutes, 'deep'], ['核心 / 浅睡', st.coreMinutes, 'core'], ['REM', st.remMinutes, 'rem'], ['未分期', st.unknownMinutes, 'unspec'], ['清醒', s.awakeMinutes, 'awake'] ];
    var total = parts.reduce(function (sum,p) { return sum + (finite(p[1]) ? p[1] : 0); },0);
    var bar = '', legend = '', desc = [];
    parts.forEach(function (p) {
      if (!finite(p[1]) || p[1] <= 0) return;
      bar += '<i style="width:' + (p[1]/total*100).toFixed(3) + '%;background:var(--' + p[2] + ')"></i>';
      legend += '<span><i style="background:var(--' + p[2] + ')"></i>' + p[0] + ' ' + Math.round(p[1]) + '分</span>';
      desc.push(p[0] + Math.round(p[1]) + '分钟');
    });
    return '<div class="stage-section"><div class="stage-heading">各阶段时长<span>分期覆盖 ' + pct(st.coverage) + '</span></div><div class="stage-bar" role="img" aria-label="' + esc(desc.join('，')) + '">' + bar + '</div><div class="stage-legend">' + legend + '</div></div>';
  }

  function timeline(n) {
    var span = n.off - n.on, colors = ['core','deep','rem','awake','unspec'], names = ['核心睡眠','深睡','REM','已记录清醒','未分期'], heights = [21,32,14,6,18], html='';
    if (!finite(span) || span<=0 || !Array.isArray(n.segs)) return '';
    n.segs.forEach(function (g) {
      if (!Array.isArray(g) || !finite(g[0]) || !finite(g[1]) || !colors[g[2]]) return;
      var a=Math.max(n.on,g[0]), b=Math.min(n.off,g[0]+g[1]); if(b<=a)return;
      html += '<i data-stage="' + g[2] + '" style="left:' + ((a-n.on)/span*100).toFixed(3) + '%;width:' + ((b-a)/span*100).toFixed(3) + '%;height:' + heights[g[2]] + 'px;background:var(--' + colors[g[2]] + ')" title="' + names[g[2]] + ' ' + clock(a) + '–' + clock(b) + '"></i>';
    });
    return '<div class="night-timeline"><div class="stage-heading">这一晚的睡眠过程<span>空白表示未记录</span></div><div class="night-track" role="img" aria-label="睡眠分期时间轴，记录从' + clock(n.on) + '到' + clock(n.off) + '">' + html + '</div><div class="night-times"><span>记录开始 ' + clock(n.on) + '</span><span>记录结束 ' + clock(n.off) + '</span></div></div>';
  }

  function details(n, s, state) {
    var vitals = [ ['睡眠心率', finite(n.hr) ? n.hr.toFixed(1) + ' 次/分' : '—', finite(s.delta.hr) ? '较平时 ' + (s.delta.hr>=0?'+':'') + s.delta.hr.toFixed(1) : '暂无可比较基线'], ['睡眠 HRV', finite(n.hrv) ? Math.round(n.hrv) + ' ms' : '—', finite(s.delta.hrv) ? '较平时 ' + (s.delta.hrv>=0?'+':'') + s.delta.hrv.toFixed(0) + ' ms' : '暂无可比较基线'], ['呼吸频率', finite(n.rr) ? n.rr.toFixed(1) + ' 次/分' : '—', '手表记录的平均值'], ['平均血氧', finite(n.ox) ? n.ox.toFixed(1) + '%' : '—', finite(n.oxMin) ? '已记录最低 ' + n.oxMin + '%' : '暂无最低值'] ];
    var vitalHTML = vitals.map(function (v) { return '<div class="vital"><span>' + v[0] + '</span><b>' + esc(v[1]) + '</b><span>' + esc(v[2]) + '</span></div>'; }).join('');
    var feelings = {good:'精神不错',normal:'一般',tired:'仍然困倦'}, feeling = state.feelings && state.feelings[n.d];
    var feedback = '<div class="wake-feedback"><span class="prompt">醒来后感觉怎么样？</span><div class="row" role="group" aria-label="醒后感受">' + Object.keys(feelings).map(function (key) { return '<button type="button" data-feeling="' + key + '" data-feeling-date="' + esc(n.d) + '" aria-pressed="' + (feeling === key) + '">' + feelings[key] + '</button>'; }).join('') + '</div></div>';
    var reasons = s.quality.reasons.map(esc).join(' ');
    var hrvHint = finite(n.hrv) && finite(s.baseline.hrv) && n.hrv < s.baseline.hrv * .8 ? '<p>这一晚 HRV 低于自己的近期水平，可以结合醒后疲劳一起观察；单次下降不直接判定恢复差或生病。</p>' : '';
    return feedback + '<details class="morning-details"><summary>心率、HRV 与判断依据</summary><div class="vitals">' + vitalHTML + '</div>' + hrvHint + '<p>' + reasons + '</p><p>' + esc(s.quality.method) + '</p><p>基线区间：' + esc(s.baseline.start) + ' 至 ' + esc(s.baseline.end) + '，共 ' + s.baseline.count + ' 晚可比较记录。缺失夜、少于 3 小时的片段不当作 0 分钟；分期比例以已分期睡眠为分母。</p><p>手表分期是估计，结合多晚趋势与醒后感受解读。<a href="https://www.nhlbi.nih.gov/health/sleep/stages-of-sleep" target="_blank" rel="noopener noreferrer">睡眠阶段说明</a> · <a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC4434546/" target="_blank" rel="noopener noreferrer">成人睡眠时长共识</a></p></details>';
  }

  function renderWeek(state, nights, selected, now) {
    var box = document.getElementById('morningWeek'); if(!box)return;
    var expected=I.shiftDay(I.localDayKey(now),-1), end=expected, valid=eligible(nights,now), validBy={}, items=[];
    valid.forEach(function(n){validBy[n.d]=n;});
    if(selected && selected< I.shiftDay(end,-6)) end=selected;
    for(var i=6;i>=0;i--){var key=I.shiftDay(end,-i), n=validBy[key], raw=state.nights[key], text=key.slice(5).replace('-','/');
      if(n){var st=I.stageStats(n);items.push('<button class="week-night" data-select-night="'+key+'" aria-label="查看'+dateLabel(key)+'晚，睡眠'+dur(n.tst)+'" aria-pressed="'+(selected===key)+'"><span class="day">'+text+'</span><span class="hours">'+(n.tst/60).toFixed(1)+'小时</span><span class="deep-share">深睡 '+(st.valid?pct(st.deepPct):'—')+'</span><span class="mini-track" aria-hidden="true"><i style="width:'+Math.min(100,n.tst/720*100).toFixed(1)+'%"></i></span></button>');}
      else items.push('<button class="week-night" disabled aria-label="'+dateLabel(key)+(raw&&raw.tst<180?'，不足3小时已跳过':'，无完整记录')+'"><span class="day">'+text+'</span><span class="hours">—</span><span class="deep-share">'+(raw&&raw.tst<180?'已跳过':'无记录')+'</span><span class="mini-track" aria-hidden="true"></span></button>');
    }
    var start=I.shiftDay(end,-6), rec=valid.filter(function(n){return n.d>=start&&n.d<=end;}), avg=mean(rec.map(function(n){return n.tst;})), deep=mean(rec.map(function(n){var st=I.stageStats(n);return st.comparable?st.deepMinutes:null;}));
    box.innerHTML='<div class="week-head"><h2>近 7 晚，一起看</h2><span>'+rec.length+' 晚有效记录</span></div><div class="week-strip">'+items.join('')+'</div><p class="week-foot">'+(rec.length?'平均睡眠 '+dur(avg)+(finite(deep)?' · 平均深睡 '+Math.round(deep)+' 分钟':'')+'。':'这 7 个日历夜还没有完整记录。')+'点日期查看；不足 3 小时已跳过。</p>';
  }

  function render(state, requested, now) {
    now=now||new Date();
    var nights=Object.keys(state.nights||{}).sort().map(function(k){return state.nights[k];}), all=eligible(nights,now), latest=I.latestNight(nights,now);
    var expected=I.shiftDay(I.localDayKey(now),-1), n=requested&&all.find(function(x){return x.d===requested;})||latest;
    var nav=document.getElementById('nightNav'), box=document.getElementById('today'), freshness=document.getElementById('morningFreshness');
    if(!n){nav.innerHTML='';freshness.innerHTML='';box.innerHTML='<h3 class="morning-verdict">昨夜记录不完整</h3><p class="morning-summary">不足 3 小时的片段已按你的规则跳过。导入完整记录后，这里会显示睡眠质量、深睡比例和时长。</p>';renderWeek(state,nights,null,now);return null;}
    var s=I.summarize(n,nights,state.settings||{},now), st=s.stages, index=all.findIndex(function(x){return x.d===n.d;});
    document.getElementById('h-today').textContent=s.isCurrentNight?'今晚已记录':n.d===expected?'昨夜睡眠':'这一晚睡眠';
    nav.innerHTML='<button type="button" data-select-night="'+(index>0?all[index-1].d:'')+'" aria-label="前一晚"'+(index===0?' disabled':'')+'>‹</button><select id="nightSelect" aria-label="选择查看的夜晚">'+all.slice().reverse().map(function(x){return '<option value="'+x.d+'"'+(x.d===n.d?' selected':'')+'>'+dateLabel(x.d)+'晚'+(x.d===expected?' · 昨夜':'')+'</option>';}).join('')+'</select><button type="button" data-select-night="'+(index<all.length-1?all[index+1].d:'')+'" aria-label="后一晚"'+(index===all.length-1?' disabled':'')+'>›</button>';
    var latestIsOld=!latest||latest.d!==expected, rawExpected=state.nights[expected], note='';
    if(latestIsOld)note=rawExpected&&rawExpected.tst<180?'昨夜记录不足 3 小时，已按手表中断片段跳过。下方是最近一晚有效记录。':'昨夜尚无完整记录。下方显示实际日期，更新后再看昨夜。';
    else if(n.d!==expected)note='正在查看历史记录，日期按入夜当天标记。';
    freshness.innerHTML=note?'<div class="freshness-note"><span>'+note+'</span><button type="button" '+(latestIsOld?'data-morning-import':'data-select-night="latest"')+'>'+(latestIsOld?'更新数据':'回到昨夜')+'</button></div>':'';
    var title=s.quality.label, summary=s.quality.summary, tone=s.quality.tone;
    if(s.quality.tone==='good'&&!s.quality.limited&&s.durationMinutes>=420&&s.wakeOffsetMinutes>90){title='睡够了，起床偏晚';summary='睡眠时长充足；记录结束比你的起床目标晚 '+dur(s.wakeOffsetMinutes)+'。这一晚的记录较连贯。';tone='neutral';}
    else if(!s.quality.limited&&s.wakeOffsetMinutes>90)summary+=' 记录结束也比起床目标晚 '+dur(s.wakeOffsetMinutes)+'。';
    if(s.isCurrentNight){title='今晚已有睡眠记录';summary='目前记录睡眠 '+dur(s.durationMinutes)+'，这一晚还未结束，暂不对整晚质量下结论。';tone='neutral';}
    var goal=s.durationGap>0?'距 '+dur(s.targetMinutes)+' 目标还差 '+dur(s.durationGap):'已达到 '+dur(s.targetMinutes)+' 目标';
    var deepNote=st.valid?dur(st.deepMinutes)+' · 占已分期睡眠':'暂无完整分期';
    var awakeNote=finite(s.continuityPct)?'记录内睡眠占比 '+pct(s.continuityPct):'暂无完整记录';
    var meta=(s.isCurrentNight?'今晚已记录':n.d===expected?'昨夜':'历史记录')+' · '+dateLabel(n.d)+'晚 → '+dateLabel(s.wakeDate||I.shiftDay(n.d,1));
    var currentNote=s.isCurrentNight?'<p class="morning-summary">这是今晚已结束的记录，不能代表整晚睡眠。</p>':'';
    box.innerHTML='<div class="morning-meta"><span>'+esc(meta)+'</span><span class="status-pill '+(tone==='good'?'good':tone==='warn'?'warn':'')+'">'+(s.quality.limited?'信息有限':'基于手表记录')+'</span></div><h3 class="morning-verdict">'+esc(title)+'</h3><p class="morning-summary">'+esc(summary)+'</p>'+currentNote+'<div class="morning-metrics">'+metric('实际睡眠',durationValue(s.durationMinutes),esc(goal),'duration')+metric('深睡比例',pct(st.deepPct),esc(deepNote),'deep')+metric('REM 睡眠',pct(st.remPct),esc(st.valid?dur(st.remMinutes)+' · 占已分期睡眠':'暂无完整分期'))+metric('已记录清醒',finite(s.awakeMinutes)?Math.round(s.awakeMinutes)+'<small>分钟</small>':'—',esc(awakeNote))+'</div><div class="deep-explainer">'+deepExplanation(s)+'</div>'+stageSection(n,s)+timeline(n)+details(n,s,state);
    renderWeek(state,nights,n.d,now);
    return n.d;
  }
  root.SleepMorning={render:render};
})(typeof window!=='undefined'?window:this);
