'use strict';
// Synthetic fixtures only. Never publish personal health exports in this repository.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {execFileSync} = require('node:child_process');
const I = require('../sleep-insights.js');
const NOW = new Date(2026,9,5,22);
function night(d='2026-10-04', extra={}) {
  return {d,on:300,off:800,tst:480,core:300,deep:80,rem:100,awake:20,unspec:0,hr:55,hrv:60,...extra};
}
function history(count=10, extra={}) {
  return Array.from({length:count},(_,i)=>night(I.shiftDay('2026-10-04',-i-1),extra));
}
function summarize(n=night(), all=history(), settings={}) {
  return I.summarize(n,[...all,n],settings,NOW);
}

test('browser and CommonJS expose the same API',()=>{
  const context={window:{}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../sleep-insights.js'),'utf8'),context);
  assert.deepEqual(Object.keys(context.window.SleepInsights).sort(),Object.keys(I).sort());
});
test('calendar helpers handle leap years and reject malformed dates',()=>{
  assert.equal(I.shiftDay('2027-01-01',-1),'2026-12-31');
  assert.equal(I.shiftDay('2024-03-01',-1),'2024-02-29');
  assert.equal(I.shiftDay('2026-03-01',-1),'2026-02-28');
  assert.equal(I.shiftDay('2026-02-30',1),null);
  assert.equal(I.shiftDay('2026-2-03',1),null);
  assert.equal(I.shiftDay('2026-10-04',.5),null);
  assert.equal(I.localDayKey(new Date('invalid')),null);
});
test('local dates and completion work across timezones and DST',()=>{
  const modulePath=path.join(__dirname,'../sleep-insights.js');
  const script=`const I=require(${JSON.stringify(modulePath)}),n=${JSON.stringify(night())};const s=I.summarize(n,[],{},new Date(2026,9,5,8));const dst=I.summarize({...n,d:'2026-03-07'},[],{},new Date(2026,2,8,8));process.stdout.write(JSON.stringify([s.isLastNight,s.wakeDate,dst.isLastNight,I.shiftDay('2026-03-08',-1)]));`;
  for(const tz of ['UTC','Asia/Tokyo','Asia/Shanghai','America/New_York']) {
    const got=JSON.parse(execFileSync(process.execPath,['-e',script],{env:{...process.env,TZ:tz},encoding:'utf8'}));
    assert.deepEqual(got,[true,'2026-10-05',true,'2026-03-07'],tz);
  }
});
test('under 3h skipped but exactly 3h eligible, with no mutation',()=>{
  const old=night('2026-10-03');
  const short=night(undefined,{tst:179,core:99,deep:30,rem:50,awake:5,off:484});
  const all=[old,short], before=JSON.stringify(all);
  assert.equal(I.latestNight(all,NOW),old);
  assert.equal(JSON.stringify(all),before);
  assert.equal(summarize(short).delta.hrv,null);
  assert.match(summarize(short).quality.summary,/不足3小时/);
  const exactly=night(undefined,{tst:180,core:100,deep:30,rem:50,awake:5,off:485});
  assert.equal(I.latestNight([exactly],NOW),exactly);
  assert.equal(summarize(exactly).quality.label,'睡得偏少');
});
test('ignore future or unfinished records and prefer yesterday over current evening',()=>{
  const old=night('2026-10-02'), yesterday=night(), future=night('2026-10-06');
  const unfinished=night(undefined,{off:1400,tst:1000,core:800,deep:100,rem:100,awake:100});
  assert.equal(I.latestNight([old,future,unfinished],new Date(2026,9,5,16)),old);
  const evening=night('2026-10-05',{on:0,off:200,tst:180,core:100,deep:30,rem:50,awake:20});
  assert.equal(I.latestNight([evening,yesterday],NOW),yesterday);
  assert.equal(I.summarize(evening,[],{},NOW).isCurrentNight,true);
  assert.equal(I.summarize(yesterday,[],{},new Date(2026,9,5,1)).quality.label,'记录不完整');
});
test('stale fallback is not mislabeled last night',()=>{
  const s=summarize(night('2026-09-30'));
  assert.equal(s.staleDays,4);assert.equal(s.isLastNight,false);assert.equal(s.wakeDate,'2026-10-01');
});
test('8h+ sleep with 32m unrecorded retains metrics, deltas and verdict',()=>{
  const n=night(undefined,{tst:520,core:320,deep:85,rem:115,off:872}),s=summarize(n);
  assert.equal(s.durationMinutes,520);assert.equal(s.unrecordedMinutes,32);assert.equal(s.awakeMinutes,20);
  assert.equal(s.delta.hrv,0);assert.ok(s.stages.valid);
  assert.notEqual(s.quality.label,'记录不完整');assert.equal(s.quality.scope,'recorded');
  assert.equal(s.quality.signals.fragmented,false);assert.ok(s.quality.warnings.some(x=>x.includes('32分钟')));
});
test('there is no 30-minute visibility or baseline-comparison cutoff',()=>{
  for(const gap of [0,29,30,31,32,60,120,240]) {
    const n=night(undefined,{off:800+gap}),s=summarize(n);
    assert.equal(I.latestNight([n],NOW),n);assert.equal(s.unrecordedMinutes,gap);
    assert.equal(s.durationMinutes,480);assert.equal(s.delta.hrv,0);assert.equal(s.delta.deepPct,0);
    assert.equal(s.quality.signals.fragmented,false);assert.notEqual(s.quality.label,'记录不完整');
    if(gap>=60) assert.match(s.quality.label,/已记录部分/);
  }
});
test('legacy split and gap fields do not establish measured wakefulness',()=>{
  const s=summarize(night(undefined,{gap:180,split:1}));
  assert.equal(s.awakeMinutes,20);assert.equal(s.unrecordedMinutes,0);assert.equal(s.quality.signals.fragmented,false);
});
test('stage denominator excludes unspecified sleep, which is not an unrecorded gap',()=>{
  const s=summarize(night(undefined,{core:240,deep:60,rem:60,unspec:120}));
  assert.equal(s.stages.deepPct,16.7);assert.equal(s.stages.confirmedDeepPct,12.5);
  assert.equal(s.stages.coverage,75);assert.equal(s.stages.unknownMinutes,120);assert.equal(s.unrecordedMinutes,0);
  assert.equal(s.delta.deepPct,null);assert.equal(s.delta.hrv,0);assert.notEqual(s.quality.tone,'good');
});
test('missing deep remains unknown but measured zero remains zero',()=>{
  const missing=summarize(night(undefined,{core:0,deep:null,rem:null,unspec:480}));
  assert.equal(missing.stages.deepPct,null);assert.equal(missing.stages.deepMinutes,null);
  const zero=summarize(night(undefined,{core:380,deep:0}));
  assert.equal(zero.stages.deepPct,0);assert.equal(zero.quality.signals.deepLow,true);assert.equal(zero.quality.tone,'warn');
});
test('three-minute rounding tolerance does not silently accept impossible totals',()=>{
  for(const extra of [0,1,2,3]) assert.equal(summarize(night(undefined,{off:800-extra})).stages.valid,true);
  assert.equal(summarize(night(undefined,{off:796})).quality.label,'记录需要核对');
  assert.equal(summarize(night(undefined,{core:303})).stages.valid,true);
  assert.equal(summarize(night(undefined,{core:304})).quality.label,'记录需要核对');
});
test('invalid totals and timing cannot produce reassuring quality',()=>{
  for(const extra of [{off:200},{tst:-1},{deep:-1},{rem:'100'},{deep:120}]) {
    const s=summarize(night(undefined,extra));
    assert.equal(s.quality.label,'记录需要核对');assert.equal(s.stages.deepPct,null);assert.equal(s.delta.tst,null);
  }
});
test('baselines use prior 28 calendar days, not current or duplicate dates',()=>{
  const n=night(undefined,{hrv:100}),prior=history(35),s=summarize(n,prior);
  assert.equal(s.baseline.count,28);assert.equal(s.baseline.hrv,60);assert.equal(s.baseline.start,'2026-09-06');
  assert.equal(s.baseline.end,'2026-10-03');
  assert.deepEqual(summarize(n,prior).baseline,summarize(n,[...prior,...prior]).baseline);
});
test('each metric needs at least five samples; missing values are not zero',()=>{
  assert.equal(summarize(night(),history(4)).baseline.hrv,null);
  assert.equal(summarize(night(),history(5)).baseline.hrv,60);
  const prior=history(6);prior[0].hr=null;prior[1].hr=null;prior[0].hrv=null;prior[0].deep=null;prior[1].deep=null;
  const s=summarize(night(),prior);
  assert.equal(s.baseline.count,6);assert.equal(s.baseline.counts.hr,4);assert.equal(s.baseline.hr,null);
  assert.equal(s.baseline.counts.hrv,5);assert.equal(s.baseline.hrv,60);assert.equal(s.baseline.deepPct,null);
});
test('partial long nights remain in baselines; invalid and under-3h records do not',()=>{
  const prior=history(8,{off:850});assert.equal(summarize(night(),prior).baseline.count,8);
  prior[0].off=200;
  Object.assign(prior[1],{tst:60,core:60,deep:0,rem:0,off:380});
  assert.equal(summarize(night(),prior).baseline.count,6);
  assert.equal(summarize(night(),prior).baseline.excludedNights,2);
});
test('long duration and more deep minutes cannot cancel low deep ratio plus low HRV',()=>{
  const n=night(undefined,{tst:690,core:388,deep:82,rem:220,awake:10,off:1000,hrv:35}),s=summarize(n);
  assert.equal(s.quality.label,'睡得久，恢复信号偏弱');assert.equal(s.quality.tone,'warn');
  assert.ok(s.delta.deepMinutes>0);assert.ok(s.delta.deepPct<0);
  assert.equal(s.quality.signals.deepLow,true);assert.equal(s.quality.signals.hrvLow,true);
});
test('low deep ratio counts even with high HRV; high deep minutes do not cancel low HRV',()=>{
  const deep=summarize(night(undefined,{core:330,deep:50,hrv:120}));
  assert.equal(deep.quality.signals.deepLow,true);assert.equal(deep.quality.tone,'warn');
  const hrv=summarize(night(undefined,{core:270,deep:110,hrv:40}));
  assert.equal(hrv.quality.signals.hrvLow,true);assert.equal(hrv.quality.label,'恢复信号偏弱');
});
test('high sleep heart rate is a signal, not an infection diagnosis',()=>{
  const s=summarize(night(undefined,{hr:65}));assert.equal(s.quality.signals.hrVeryHigh,true);assert.equal(s.quality.tone,'warn');
  assert.doesNotMatch(s.quality.summary,/感染|发热|心脏病/);
});
test('threshold boundaries are explicit product rules and do not invent a medical score',()=>{
  assert.equal(summarize(night(undefined,{hrv:48})).quality.signals.hrvLow,true);
  assert.equal(summarize(night(undefined,{hrv:49})).quality.signals.hrvLow,false);
  assert.equal(summarize(night(undefined,{hr:60})).quality.signals.hrHigh,true);
  assert.match(summarize().quality.method,/不是临床诊断界值/);
  assert.equal(Object.hasOwn(summarize().quality,'score'),false);
});
test('recorded fatigue changes the verdict while good feelings do not erase signals',()=>{
  assert.equal(summarize(night(),history(),{feeling:'tired'}).quality.label,'睡后仍然困倦');
  const s=summarize(night(undefined,{hrv:35}),history(),{feeling:'good'});
  assert.equal(s.quality.tone,'warn');assert.match(s.quality.summary,/体感不错/);
});
test('long sleep alone is not rewarded',()=>{
  const s=summarize(night(undefined,{tst:650,core:400,deep:110,rem:140,awake:20,off:970}));
  assert.equal(s.quality.label,'睡得偏长，留意是否解乏');assert.notEqual(s.quality.tone,'good');
});
test('missing or nonpositive HRV cannot imply good recovery or an HRV collapse',()=>{
  for(const hrv of [null,0,-1,'40',NaN]) {
    const s=summarize(night(undefined,{hrv}));assert.equal(s.delta.hrv,null);
    assert.equal(s.quality.signals.hrvLow,false);assert.notEqual(s.quality.tone,'good');
  }
  assert.equal(summarize(night(),[]).quality.label,'时长够了');
});
test('recorded wake counts, unknown wake stays unknown, sleep debt remains visible',()=>{
  assert.equal(summarize(night(undefined,{awake:70,off:850})).quality.label,'睡得不太踏实');
  const missing=summarize(night(undefined,{awake:null}));
  assert.equal(missing.awakeMinutes,null);assert.equal(missing.recordedContinuityPct,null);assert.notEqual(missing.quality.tone,'good');
  assert.equal(summarize(night(undefined,{tst:350,core:180,deep:80,rem:90,off:670,hrv:100})).quality.label,'睡得偏少');
});
test('targets, signed wake offset and input data remain stable',()=>{
  const n=night(),all=history(),settings={wake:540,targetSleep:540},before=JSON.stringify([n,all,settings]);
  const s=I.summarize(n,all,settings,NOW);
  assert.equal(s.targetMinutes,540);assert.equal(s.durationGap,60);assert.equal(s.wakeOffsetMinutes,-100);
  assert.equal(JSON.stringify([n,all,settings]),before);
  assert.equal(summarize(n,all,{targetMinutes:510}).targetMinutes,510);
  assert.equal(summarize(n,all,{sleepTarget:450}).targetMinutes,450);
});
