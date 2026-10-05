'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const Insights = require('../sleep-insights.js');

const NOW = new Date(2026, 9, 5, 16, 0, 0);
function night(date, change = {}) {
  return Object.assign({
    d: date, on: 300, off: 800, tst: 480,
    core: 300, deep: 80, rem: 100, unspec: 0, awake: 20,
    hr: 55, hrv: 60
  }, change);
}
function summarize(n, all = [n], settings = {}) {
  return Insights.summarize(n, all, settings, NOW);
}
function history(count, change = {}) {
  return Array.from({ length: count }, (_, i) => night(Insights.shiftDay('2026-10-04', -i - 1), change));
}

test('browser script exposes the same public API without CommonJS', () => {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../sleep-insights.js'), 'utf8'), context);
  assert.deepEqual(Object.keys(context.window.SleepInsights).sort(), Object.keys(Insights).sort());
  assert.equal(context.window.SleepInsights.shiftDay('2026-10-01', -1), '2026-09-30');
});

test('calendar helpers handle month/year/leap boundaries and reject malformed dates', () => {
  assert.equal(Insights.shiftDay('2026-10-01', -1), '2026-09-30');
  assert.equal(Insights.shiftDay('2027-01-01', -1), '2026-12-31');
  assert.equal(Insights.shiftDay('2024-03-01', -1), '2024-02-29');
  assert.equal(Insights.shiftDay('2026-03-01', -1), '2026-02-28');
  assert.equal(Insights.shiftDay('2026-02-30', 0), null);
  assert.equal(Insights.shiftDay('2026-2-03', 1), null);
  assert.equal(Insights.shiftDay('2026-10-04', 0.5), null);
  assert.equal(Insights.localDayKey(new Date('invalid')), null);
});

test('local dates and completion checks are correct in UTC, Shanghai and New York, including DST', () => {
  const modulePath = path.join(__dirname, '../sleep-insights.js');
  const script = `
    const S = require(${JSON.stringify(modulePath)});
    const n = { d:'2026-10-04', on:300, off:810, tst:480, awake:30, core:300, deep:80, rem:100, unspec:0 };
    const date = new Date('2026-10-04T20:00:00Z');
    const morning = new Date(2026,9,5,8,0,0);
    const result = S.summarize(n,[n],{},morning);
    const dst = S.summarize({ ...n, d:'2026-03-07' },[],{},new Date(2026,2,8,8,0,0));
    process.stdout.write(JSON.stringify({ local:S.localDayKey(date), last:result.isLastNight, wake:result.wakeDate, dst:dst.isLastNight, shift:S.shiftDay('2026-03-08',-1) }));
  `;
  for (const [tz, expected] of [['UTC', '2026-10-04'], ['Asia/Shanghai', '2026-10-05'], ['America/New_York', '2026-10-04']]) {
    const result = JSON.parse(execFileSync(process.execPath, ['-e', script], { env: { ...process.env, TZ: tz }, encoding: 'utf8' }));
    assert.equal(result.local, expected, tz);
    assert.equal(result.last, true, tz);
    assert.equal(result.wake, '2026-10-05', tz);
    assert.equal(result.dst, true, tz);
    assert.equal(result.shift, '2026-03-07', tz);
  }
});

test('latest night skips under-three-hour records as requested and does not relabel the fallback last night', () => {
  const previous = night('2026-10-03');
  const short = night('2026-10-04', { tst: 179, core: 99, deep: 30, rem: 50, awake: 5, off: 484 });
  const input = [previous, short];
  assert.equal(Insights.latestNight(input, NOW), previous);
  assert.deepEqual(input, [previous, short], 'selection does not mutate the array');
  const latest = summarize(previous, input);
  assert.equal(latest.isLastNight, false);
  assert.equal(latest.staleDays, 1);
  const direct = summarize(short);
  assert.equal(direct.quality.label, '记录不完整');
  assert.equal(direct.quality.limited, true);
  assert.equal(direct.delta.tst, null);
  assert.match(direct.quality.summary, /不足3小时/);
  const exactlyThreeHours = night('2026-10-04', { tst: 180, core: 100, deep: 30, rem: 50, awake: 5, off: 485 });
  assert.equal(Insights.latestNight([previous, exactlyThreeHours], NOW), exactlyThreeHours);
});

test('latest selection ignores unfinished/future records and prefers last night over a current-evening record', () => {
  const old = night('2026-10-02');
  const last = night('2026-10-04');
  const unfinished = night('2026-10-04', { off: 1400, tst: 1000, core: 800, deep: 100, rem: 100, awake: 100 });
  const future = night('2026-10-05');
  assert.equal(Insights.latestNight([future, old, unfinished], NOW), old);
  assert.equal(Insights.latestNight([future, last, old], NOW), last);
  assert.equal(Insights.latestNight([future, unfinished], NOW), null);
  const evening = night('2026-10-05', { on: 0, off: 200, tst: 180, awake: 20, core: 100, deep: 30, rem: 50 });
  const eveningNow = new Date(2026, 9, 5, 23, 0, 0);
  assert.equal(Insights.latestNight([evening, last], eveningNow), last);
  assert.equal(Insights.summarize(evening, [], {}, eveningNow).isCurrentNight, true);
  const atNight = Insights.summarize(last, [], {}, new Date(2026, 9, 5, 1, 0, 0));
  assert.equal(atNight.isCurrentNight, true);
  assert.equal(atNight.isLastNight, false);
  assert.equal(atNight.quality.label, '记录不完整');
});

test('stale data reports its actual wake date and calendar staleness', () => {
  const result = summarize(night('2026-09-30'));
  assert.equal(result.date, '2026-09-30');
  assert.equal(result.wakeDate, '2026-10-01');
  assert.equal(result.isLastNight, false);
  assert.equal(result.isCurrentNight, false);
  assert.equal(result.staleDays, 4);
});

test('missing Deep/REM stay unknown while measured zero deep sleep is a real zero', () => {
  const missing = summarize(night('2026-10-04', { core: 0, deep: null, rem: null, unspec: 480 }));
  assert.equal(missing.stages.deepMinutes, null);
  assert.equal(missing.stages.remMinutes, null);
  assert.equal(missing.stages.deepPct, null);
  assert.equal(missing.stages.valid, false);
  assert.equal(missing.stages.unknownMinutes, 480);
  assert.equal(missing.quality.label, '时长够了');
  assert.equal(missing.quality.limited, true);
  const zero = summarize(night('2026-10-04', { core: 380, deep: 0, rem: 100 }));
  assert.equal(zero.stages.valid, true);
  assert.equal(zero.stages.deepMinutes, 0);
  assert.equal(zero.stages.deepPct, 0);
  const allCore = Insights.stageStats(night('2026-10-04', { core: 480, deep: 0, rem: 0 }));
  assert.equal(allCore.valid, true);
  assert.equal(allCore.corePct, 100);
});

test('stage percentages use staged sleep, and low coverage blocks reassuring comparisons', () => {
  const n = night('2026-10-04', { core: 240, deep: 60, rem: 60, unspec: 120 });
  const result = summarize(n, [...history(8), n]);
  assert.equal(result.stages.stagedMinutes, 360);
  assert.equal(result.stages.totalMinutes, 480);
  assert.equal(result.stages.deepPct, 16.7);
  assert.equal(result.stages.coverage, 75);
  assert.equal(result.stages.unknownMinutes, 120);
  assert.equal(result.stages.valid, true);
  assert.equal(result.stages.comparable, false);
  assert.equal(result.delta.deepPct, null);
  assert.equal(result.delta.deepMinutes, null);
  assert.equal(result.delta.tst, 0, 'usable duration can still be compared');
  assert.equal(result.quality.label, '时长够了');
  assert.equal(result.quality.limited, true);
});

test('rounded backup totals tolerate up to three minutes without manufacturing an invalid night', () => {
  const n = night('2026-10-04', { on: 420, off: 1039, tst: 608, core: 322, deep: 91, rem: 195, awake: 12 });
  const result = summarize(n);
  assert.equal(result.durationMinutes, 608);
  assert.equal(result.spanMinutes, 619);
  assert.equal(result.unrecordedMinutes, 0);
  assert.equal(result.stages.valid, true);
  assert.equal(result.stages.deepPct, 15);
  assert.equal(result.quality.label, '睡得不错');
  assert.equal(result.quality.limited, false);
  const withinTolerance = summarize(night('2026-10-04', { core: 303, off: 797 }));
  assert.equal(withinTolerance.stages.valid, true);
  assert.equal(withinTolerance.quality.label, '睡得不错');
  assert.ok(withinTolerance.stages.coverage <= 100);
});

test('impossible overlapping totals and invalid timing cannot produce reassuring quality or percentages', () => {
  for (const n of [
    night('2026-10-04', { off: 795 }),
    night('2026-10-04', { deep: 100 }),
    night('2026-10-04', { off: 200 }),
    night('2026-10-04', { tst: -1 }),
    night('2026-10-04', { deep: -1 }),
    night('2026-10-04', { rem: '100' })
  ]) {
    const result = summarize(n);
    assert.equal(result.quality.label, '记录需要核对', JSON.stringify(n));
    assert.equal(result.quality.limited, true);
    assert.equal(result.stages.deepPct, null);
    assert.equal(result.delta.tst, null);
  }
});

test('unrecorded gaps are distinct from recorded wake and n.gap/n.split never establish wakefulness', () => {
  const complete = summarize(night('2026-10-04', { gap: 180, split: 1 }));
  assert.equal(complete.awakeMinutes, 20);
  assert.equal(complete.unrecordedMinutes, 0);
  assert.equal(complete.quality.label, '睡得不错');
  const missing = summarize(night('2026-10-04', { off: 851 }));
  assert.equal(missing.awakeMinutes, 20);
  assert.equal(missing.unrecordedMinutes, 51);
  assert.equal(missing.quality.label, '记录不完整');
  assert.equal(missing.quality.limited, true);
  assert.match(missing.quality.reasons.join(' '), /不能直接当作清醒/);
  const proportionGap = summarize(night('2026-10-04', { tst: 180, core: 100, deep: 30, rem: 50, awake: 5, off: 506 }));
  assert.equal(proportionGap.unrecordedMinutes, 21);
  assert.equal(proportionGap.quality.label, '记录不完整', 'a <30 minute gap still matters if it exceeds 10%');
});

test('clinical-duration and continuity hints are transparent and do not punish long sleep or low deep sleep', () => {
  const fixtures = [
    [300, 20, '睡得偏少'], [390, 20, '时长略少'],
    [420, 20, '睡得不错'], [480, 45, '睡眠一般'],
    [480, 70, '睡得不太踏实'], [660, 20, '睡得不错']
  ];
  for (const [tst, awake, label] of fixtures) {
    const result = summarize(night('2026-10-04', { tst, awake, off: 300 + tst + awake, core: tst - 100, deep: 0, rem: 100 }));
    assert.equal(result.quality.label, label, `${tst} min sleep / ${awake} min awake`);
    assert.match(result.quality.method, /不是医学评分/);
    assert.match(result.quality.method, /深睡比例.*不参与好坏评级/);
    assert.equal(Object.prototype.hasOwnProperty.call(result.quality, 'score'), false);
  }
});

test('baseline is the prior 28 calendar days, excludes current, old and short dates, and deduplicates nights', () => {
  const current = night('2026-10-04', { hr: 65 });
  const first = night('2026-09-06'); // Exactly current date minus 28 days.
  const outside = night('2026-09-05', { hr: 200 });
  const h = history(4);
  const short = night('2026-09-20', { tst: 120, core: 60, deep: 20, rem: 40, off: 440 });
  const all = [outside, current, h[2], first, h[0], short, h[3], h[1], h[0], night('2026-10-05')];
  const result = summarize(current, all);
  assert.equal(result.baseline.start, '2026-09-06');
  assert.equal(result.baseline.end, '2026-10-03');
  assert.equal(result.baseline.count, 5);
  assert.equal(result.baseline.stageCount, 5);
  assert.equal(result.baseline.recordedDays, 6);
  assert.equal(result.baseline.missingDays, 22);
  assert.equal(result.baseline.excludedNights, 1);
  assert.equal(result.baseline.tst, 480);
  assert.equal(result.baseline.hr, 55);
  assert.equal(result.delta.hr, 10);
});

test('each baseline metric requires at least five comparable non-null measurements', () => {
  const current = night('2026-10-04');
  const h = history(6);
  h[0].hr = null;
  h[1].hr = null;
  h[0].hrv = null;
  h[0].deep = null;
  h[1].deep = null;
  const result = summarize(current, [current, ...h]);
  assert.equal(result.baseline.count, 6);
  assert.equal(result.baseline.tst, 480);
  assert.equal(result.baseline.hr, null);
  assert.equal(result.baseline.counts.hr, 4);
  assert.equal(result.baseline.hrv, 60);
  assert.equal(result.baseline.counts.hrv, 5);
  assert.equal(result.baseline.deepMinutes, null);
  assert.equal(result.baseline.deepPct, null);
  assert.equal(result.baseline.stageCount, 4);
  assert.equal(result.delta.hr, null);
  assert.equal(result.delta.hrv, 0);
  assert.equal(result.delta.deepMinutes, null);
  const tooFew = summarize(current, history(4));
  assert.equal(tooFew.baseline.count, 4);
  for (const key of ['tst', 'deepMinutes', 'deepPct', 'awake', 'hr', 'hrv']) assert.equal(tooFew.baseline[key], null);
});

test('baseline excludes incomplete/invalid nights, while stage coverage affects only stage comparisons', () => {
  const current = night('2026-10-04');
  const h = history(8);
  h[0].off += 80; // Unknown recording gap.
  h[1].off -= 60; // Impossible total.
  h[2].core = 240; h[2].deep = 60; h[2].rem = 60; h[2].unspec = 120;
  const result = summarize(current, h);
  assert.equal(result.baseline.count, 6);
  assert.equal(result.baseline.stageCount, 5);
  assert.equal(result.baseline.counts.tst, 6);
  assert.equal(result.baseline.deepMinutes, 80);
  assert.equal(result.baseline.excludedNights, 2);
});

test('target gap and wake offset have stable units; missing measures are never converted to zero', () => {
  const n = night('2026-10-04');
  const result = summarize(n, [], { targetSleep: 540, wake: 420 });
  assert.equal(result.targetMinutes, 540);
  assert.equal(result.durationGap, 60);
  assert.equal(result.wakeOffsetMinutes, 20);
  assert.equal(summarize(n, [], { targetSleep: null }).targetMinutes, 480);
  assert.equal(summarize(n, [], { targetSleep: 420 }).durationGap, 0);
  const missing = summarize(night('2026-10-04', { awake: null, hr: null, hrv: null }));
  assert.equal(missing.awakeMinutes, null);
  assert.equal(missing.unrecordedMinutes, null);
  assert.equal(missing.quality.label, '记录不完整');
  const resultKeys = Object.keys(result).sort();
  assert.deepEqual(resultKeys, [
    'date', 'wakeDate', 'isLastNight', 'isCurrentNight', 'staleDays', 'quality', 'stages', 'baseline', 'delta',
    'durationMinutes', 'awakeMinutes', 'spanMinutes', 'unrecordedMinutes', 'continuityPct',
    'targetMinutes', 'durationGap', 'wakeOffsetMinutes'
  ].sort());
});
