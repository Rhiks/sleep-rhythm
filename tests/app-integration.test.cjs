// Real application scripts with an in-memory DOM; all health fixtures are synthetic.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname,'..');
const html = fs.readFileSync(path.join(root,'index.html'),'utf8');
const coreAndApp = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
  .map(m=>m[1]).find(text=>text.includes('var HCore ='));
class Element {
  constructor(id) { this.id=id;this.innerHTML='';this.textContent='';this.value='';this.hidden=false;this.clientWidth=800;this.handlers={};this.dataset={}; }
  addEventListener(type,fn) { (this.handlers[type] ||= []).push(fn); }
  async fire(type,e={}) { for(const fn of this.handlers[type]||[]) await fn.call(this,{target:this,...e}); }
  querySelectorAll() { return []; }
  setAttribute() {}
  click() { return this.fire('click'); }
  remove() {}
}
const fixed = new Date(2026,9,5,21);
class TestDate extends Date {
  constructor(...args) { super(...(args.length?args:[fixed.getTime()])); }
  static now() { return fixed.getTime(); }
}
function night(d,overrides={}) {
  return {d,on:360,off:850,tst:480,core:290,deep:80,rem:110,unspec:0,awake:10,
    f4:60,gap:3,split:0,nb:1,nap:0,hr:58,hrMin:50,rr:16,hrv:60,ox:96,oxMin:94,bd:null,wt:null,
    segs:[[360,160,0],[520,80,1],[600,110,2],[710,10,3],[720,130,0]],...overrides};
}
function backup() {
  const nights={};for(let i=18;i<=30;i++) nights['2026-09-'+i]=night('2026-09-'+i);
  nights['2026-10-04']=night('2026-10-04',{on:420,off:1040,tst:608,core:322,deep:91,rem:195,awake:12});
  return {nights,days:{},tags:{'2026-09-21':['原有标签']},settings:{wake:540},vo2:[]};
}
async function app(initial) {
  const elements={};for(const m of html.matchAll(/\bid="([^"]+)"/g)) elements[m[1]]=new Element(m[1]);
  const storage=new Map(initial?[['sleep-rhythm-v1',JSON.stringify(initial)]]:[]);
  const document={getElementById:id=>elements[id]||(elements[id]=new Element(id)),addEventListener(){},body:{appendChild(){}},createElement:()=>new Element('new'),hidden:false};
  const ctx=vm.createContext({document,navigator:{userAgent:'test'},location:{protocol:'https:',hostname:'test.example'},
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    Date:TestDate,console,setTimeout,clearTimeout,URL,Blob,TextDecoder,TextEncoder,
    requestAnimationFrame:fn=>setImmediate(fn),addEventListener(){}});
  ctx.window=ctx;
  for(const name of ['sleep-insights.js','morning-view.js']) vm.runInContext(fs.readFileSync(path.join(root,name),'utf8'),ctx,{filename:name});
  vm.runInContext(coreAndApp,ctx,{filename:'index.html inline'});
  await new Promise(setImmediate);
  return {ctx,e:elements,storage,read:()=>JSON.parse(storage.get('sleep-rhythm-v1'))};
}
function button(dataset) {
  return {dataset,disabled:false,closest(){return this;},hasAttribute(name){return name==='data-select-night'&&'selectNight'in dataset||name==='data-morning-import'&&'morningImport'in dataset;}};
}

test('old backup boots without losing tags and skips short Watch fragments',async()=>{
  const b=backup();b.nights['2026-10-03']=night('2026-10-03',{tst:90,off:460,core:90,deep:null,rem:null});
  const a=await app(b);
  assert.equal(a.e.app.hidden,false);
  assert.match(a.e.today.innerHTML,/睡得偏长，留意是否解乏/);
  assert.match(a.e.today.innerHTML,/15\.0%/);
  assert.match(a.e.today.innerHTML,/10<small>小时<\/small>08/);
  assert.match(a.e.morningWeek.innerHTML,/已跳过/);
  assert.equal(a.e.targetSleep.value,'480');assert.match(a.e.logList.innerHTML,/原有标签/);
});
test('HRV and sleep heart rate appear in the first four metrics',async()=>{
  const a=await app(backup()),h=a.e.today.innerHTML;
  const cards=h.slice(h.indexOf('morning-metrics'),h.indexOf('wake-feedback'));
  for(const name of ['已记录睡眠','深睡比例','睡眠 HRV','睡眠心率']) assert.ok(cards.includes(name));
  assert.match(cards,/60<small>ms/);assert.doesNotMatch(cards,/REM 睡眠/);
});
test('date selection and feelings change the verdict, persist, and can be undone',async()=>{
  const a=await app(backup());
  await a.e.morningSection.fire('click',{target:button({selectNight:'2026-09-30'})});
  assert.match(a.e.today.innerHTML,/9月30日晚/);
  await a.e.morningSection.fire('click',{target:button({feeling:'tired',feelingDate:'2026-09-30'})});
  assert.equal(a.read().feelings['2026-09-30'],'tired');assert.deepEqual(a.read().tags,backup().tags);
  assert.match(a.e.today.innerHTML,/睡后仍然困倦/);
  const b=await app(a.read());
  await b.e.morningSection.fire('click',{target:button({selectNight:'2026-09-30'})});
  assert.match(b.e.today.innerHTML,/data-feeling="tired"[^>]+aria-pressed="true"/);
  assert.match(b.e.today.innerHTML,/睡后仍然困倦/);
  await b.e.morningSection.fire('click',{target:button({feeling:'tired',feelingDate:'2026-09-30'})});
  assert.equal(b.read().feelings['2026-09-30'],undefined);
});
test('sleep target persists and backup import preserves feelings',async()=>{
  const a=await app(backup());
  a.e.targetSleep.value='540';await a.e.targetSleep.fire('change');
  assert.equal(a.read().settings.targetSleep,540);assert.match(a.e.today.innerHTML,/9小时 目标/);
  const imported=backup();imported.feelings={'2026-10-04':'good'};imported.settings.targetSleep=510;
  await a.e.file.fire('change',{target:{files:[{name:'backup.json',text:async()=>JSON.stringify(imported)}],value:''}});
  assert.equal(a.read().feelings['2026-10-04'],'good');assert.equal(a.read().settings.targetSleep,510);
  assert.match(a.e.status.textContent,/已恢复备份/);
});
test('single-night Shortcut refresh preserves optional vitals absent from its feed',async()=>{
  const a=await app(backup());
  const feed='#sleep\n2026-10-05 00:00:00\n2026-10-05 04:00:00\n2026-10-05 06:00:00\n#sleep_end\n2026-10-05 04:00:00\n2026-10-05 06:00:00\n2026-10-05 08:00:00\n#sleep_src\nApple Watch\nApple Watch\nApple Watch\n#sleep_val\nCore\nDeep\nREM\n';
  await a.e.file.fire('change',{target:{files:[{name:'sleep-feed.txt',text:async()=>feed}],value:''}});
  const n=a.read().nights['2026-10-04'];
  assert.equal(n.tst,480);assert.equal(n.deep,120);assert.equal(n.hr,58);assert.equal(n.hrv,60);
  assert.match(a.e.status.textContent,/已更新 1 晚/);assert.match(a.e.today.innerHTML,/25\.0%/);
});
test('short records use explicitly dated fallback; long records with gaps remain visible',async()=>{
  const b=backup();b.nights['2026-10-04'].tst=90;
  const a=await app(b);assert.match(a.e.morningFreshness.innerHTML,/不足 3 小时/);assert.doesNotMatch(a.e.today.innerHTML,/昨夜 ·/);
  for(const gap of [32,100]) {
    const c=backup();c.nights['2026-10-04'].off+=gap;
    const d=await app(c);
    assert.match(d.e.today.innerHTML,/data-recording-gap/);
    assert.match(d.e.today.innerHTML,/10<small>小时<\/small>08/);
    assert.match(d.e.today.innerHTML,/不计作清醒/);
    assert.doesNotMatch(d.e.today.innerHTML,/暂不判断深睡比平时|记录不完整/);
  }
});
test('long duration and late wake cannot mask simultaneous deep and HRV decline',async()=>{
  const b=backup();Object.assign(b.nights['2026-10-04'],{on:300,off:1000,tst:690,core:388,deep:82,rem:220,awake:10,hrv:35});
  const a=await app(b),h=a.e.today.innerHTML;
  assert.match(h,/睡得久，恢复信号偏弱/);
  assert.match(h,/分钟增加不代表整体恢复更好/);
  assert.doesNotMatch(h,/睡够了，起床偏晚|把比例摊薄了/);
});
test('empty app is useful and invalid backup leaves saved data unchanged',async()=>{
  const a=await app();assert.equal(a.e.app.hidden,true);assert.equal(a.e.emptyState.hidden,false);
  const b=await app(backup()),before=b.storage.get('sleep-rhythm-v1');
  await b.e.file.fire('change',{target:{files:[{name:'bad.json',text:async()=>'{"nights":null}'}],value:''}});
  assert.equal(b.storage.get('sleep-rhythm-v1'),before);assert.match(b.e.status.textContent,/导入没成功/);
});
