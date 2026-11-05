// 실행: node test/logic.test.mjs   (의존성 없음 — vendor 의 SheetJS 만 씀)
// 실제 수불 엑셀은 아직 받지 않았습니다(기획서 10장 ①). 여기서는 제출 글의 항목대로 만든 작은 가상 표와 가상 샘플로 검사합니다.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const L = require('../js/logic.js');
const Sample = require('../js/sample-data.js');
const XLSX = require('../vendor/xlsx.full.min.js');
const E = require('../js/ai-endpoint.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
}
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, a + ' ≠ ' + b);

// 작은 수불 표 — 한 줄 머리(「2026-09 출고」), 기준월은 제목 줄에서
const TINY = [
  ['원부자재 수불 2026년 10월'], [],
  ['품번', '재질', '규격', '현재재고(kg)', '당월 출고', '발주잔', '2026-09 출고', '2026-08 출고', '2026-07 출고', '2026-09 입고'],
  ['A-1', 'SS400', '6t', 1000, 300, null, 600, 300, 300, 900],
  ['A-2', 'SPHC', '2.3t', '2,000', 100, 500, 200, 200, 200, 0],
  ['A-1', 'SS400', '6t', 200, null, null, null, null, null, null],   // 같은 자재 두 줄 → 더함
  ['합계', null, null, 3200]
];
const PROD = [['년월', '생산실적', '생산계획'], ['2026-07', 100, 100], ['2026-08', 100, null], ['2026-09', 200, null], ['2026-11', null, 150], ['2026-12', null, 150], ['2027-01', null, 150]];
function tinyDb(extra = {}) {
  const r = L.parseWorkbook([{ name: '수불', aoa: TINY }, { name: '대수', aoa: PROD }]);
  const db = L.emptyDb();
  Object.assign(db, { items: r.items, prod: r.prod, params: r.params, base: r.base }, extra);
  db.settings = L.cleanSettings(Object.assign({ rateWindow: 3 }, extra.settings || {}));
  return db;
}

console.log('열 · 시트 찾기');
test('제목 줄 아래 머리행을 찾고 별칭·단위를 무시해 연결(품번·재질·현재재고(kg)·당월 출고·발주잔)', () => {
  const d = L.detectSheet(TINY, 'ledger');
  assert.equal(d.headerRow, 2);
  assert.equal(d.map.code, 0); assert.equal(d.map.grade, 1); assert.equal(d.map.spec, 2); assert.equal(d.map.stock, 3); assert.equal(d.map.outNow, 4); assert.equal(d.map.onOrder, 5);
  assert.deepEqual(d.months.map(m => [m.ym, m.kind]), [['2026-09', 'out'], ['2026-08', 'out'], ['2026-07', 'out'], ['2026-09', 'in']]);
});
test('월 열 머리 여러 모양 — 「25.10」·「2026년 9월 출고」·「M-3」·「직전 2개월」·날짜 칸, 평균·당월은 월 열 아님', () => {
  assert.equal(L.monthHeader('25.10', '출고 실적').ym, '2025-10');
  assert.equal(L.monthHeader('2026년 9월 출고').ym, '2026-09');
  assert.equal(L.monthHeader('M-3 출고').rel, 3);
  assert.equal(L.monthHeader('직전 2개월').rel, 2);
  assert.equal(L.monthHeader(new Date('2026-05-01T00:00:00')).ym, '2026-05');
  assert.equal(L.monthHeader('2026-09', '입고 실적').kind, 'in');
  assert.equal(L.monthHeader('9월').mo, 9);
  assert.equal(L.monthHeader('분기평균'), null);
  assert.equal(L.monthHeader('당월출고'), null);
});
test('두 줄 머리 — 윗줄 「출고 실적」「입고 실적」 묶음으로 출고·입고를 가름 (샘플 시트)', () => {
  const b = Sample.build();
  const d = L.detectSheet(b.sheets[0].aoa, 'ledger');
  assert.equal(d.headerRow, 4); assert.equal(d.groupRow, 3);
  assert.equal(d.months.filter(m => m.kind === 'out').length, 24);
  assert.equal(d.months.filter(m => m.kind === 'in').length, 24);
  assert.ok(d.map.avgQ != null && d.map.avgH != null && d.map.avgY != null);
});
test('시트 종류 가르기 — 수불 현황 · 생산대수 · 발주 기준, 엉뚱한 시트는 null', () => {
  const b = Sample.build();
  assert.deepEqual(b.sheets.map(s => L.classifySheet(s.aoa).kind), ['ledger', 'prod', 'params']);
  assert.equal(L.classifySheet([['월', '매출'], ['1월', 3]]), null);
});
test('발주 기준 머리의 단위 — 리드타임 「(개월)」은 ×30일, 안전재고 「(개월)」/수량 구분', () => {
  const aoa = [['자재코드', 'L/T(개월)', '안전재고(kg)', 'MOQ'], ['A-1', 2, 500, 1000]];
  const p = L.parseParams(aoa, L.detectSheet(aoa, 'params')).params[0];
  assert.equal(p.ltDays, 60); assert.equal(p.ssQty, 500); assert.equal(p.moq, 1000); assert.equal(p.ssMonths, undefined);
  const aoa2 = [['강종', '규격', '리드타임(일)', '안전재고(개월)'], ['SS400', '6t', 45, 1]];
  const p2 = L.parseParams(aoa2, L.detectSheet(aoa2, 'params')).params[0];
  assert.equal(p2.ltDays, 45); assert.equal(p2.ssMonths, 1);
});
test('필수 열(현재고)이 없으면 머리행으로 보지 않고, 열 연결(덮어쓰기)로 고칠 수 있음', () => {
  const aoa = [['자재코드', '강종', '잔량', '2026-09 출고'], ['A', 'SS400', 10, 5]];
  assert.equal(L.detectSheet(aoa, 'ledger').headerRow, -1);
  const aoa2 = [['자재코드', '강종', '현재고', '잔량', '2026-09 출고'], ['A', 'SS400', null, 10, 5]];
  const p = L.parseWorkbook([{ name: 's', aoa: aoa2 }], { overrides: { s: { stock: 3 } } });
  assert.equal(p.items[0].stock, 10);
});

console.log('행 읽기');
const T = L.parseWorkbook([{ name: '수불', aoa: TINY }]);
test('기준월은 제목 줄에서(2026-10), 쉼표 숫자·같은 자재 두 줄 더하기·합계 줄 제외', () => {
  assert.equal(T.base, '2026-10'); assert.equal(T.sheets[0].baseFrom, '제목 줄');
  assert.equal(T.items.length, 2);
  const a1 = T.items.find(x => x.code === 'A-1'), a2 = T.items.find(x => x.code === 'A-2');
  assert.equal(a1.stock, 1200); assert.equal(a2.stock, 2000); assert.equal(a2.onOrder, 500);
  assert.equal(a1.out['2026-09'], 600); assert.equal(a1.inq['2026-09'], 900);
  assert.equal(T.sheets[0].summary, 1);
  assert.ok(T.sheets[0].warnings.some(w => /같은 자재/.test(w.msg)));
});
test('제목에 기준월이 없으면 가장 늦은 월 열 다음 달, 직접 넣은 기준월이 가장 우선', () => {
  const aoa = TINY.slice(2);
  assert.equal(L.parseWorkbook([{ name: 's', aoa }]).base, '2026-10');
  assert.equal(L.parseWorkbook([{ name: 's', aoa }], { base: '2026-11' }).base, '2026-11');
});
test('상대 월(M-1)·연도 없는 월은 기준월로 풀고, 기준월보다 늦은 월 열은 버림', () => {
  const aoa = [['기준월: 2026-03'], ['강종', '현재고', 'M-1', 'M-2', '12월', '11월', '2026-05']], row = ['SS400', 10, 1, 2, 3, 4, 99];
  aoa.push(row);
  const r = L.parseWorkbook([{ name: 's', aoa }]);
  const it = r.items[0];
  assert.deepEqual(it.out, { '2026-02': 1, '2026-01': 2, '2025-12': 3, '2025-11': 4 });
  assert.ok(r.sheets[0].warnings.some(w => /늦은 월 열/.test(w.msg)));
});
test('생산대수 — 날짜 칸·글자 연월 모두 읽고 실적·계획을 따로', () => {
  const aoa = [['년월', '생산실적(대)', '생산계획(대)'], [new Date('2026-09-01T00:00:00'), 120, 118], ['2026.11', null, 150], ['합계', 120, 268]];
  const p = L.parseProduction(aoa, L.detectSheet(aoa, 'prod'));
  assert.deepEqual(p.prod, { '2026-09': { actual: 120, plan: 118 }, '2026-11': { plan: 150 } });
});

console.log('요율 · 예상 출고 · 굴리기');
test('대당 요율은 「출고 합 ÷ 대수 합」(월별 요율의 평균이 아님)', () => {
  const an = L.analyze(tinyDb());
  const a1 = an.items.find(x => x.code === 'A-1');
  near(a1.rate, (600 + 300 + 300) / (200 + 100 + 100)); // 3.0 — 월별 요율 평균이면 (3+3+3)/3=3 이라 아래 A-2 로 가름
  const a2 = an.items.find(x => x.code === 'A-2');
  near(a2.rate, 600 / 400); // 1.5 — 월별 평균이면 (1+2+2)/3 = 1.667
  near(a2.avg[3], 200);
});
test('예상 출고 = 요율 × 그 달 생산계획 대수', () => {
  const a2 = L.analyze(tinyDb()).items.find(x => x.code === 'A-2');
  assert.deepEqual(a2.fc.map(f => f.ym), ['2026-11', '2026-12', '2027-01']);
  a2.fc.forEach(f => near(f.issue, 1.5 * 150));
});
test('월별 기초재고 굴리기 — 1월 기초 = 현재고 + 발주잔량, 다음 달 기초 = 이번 달 기말', () => {
  const a2 = L.analyze(tinyDb()).items.find(x => x.code === 'A-2');
  near(a2.roll[0].open, 2500); near(a2.roll[0].close, 2275); near(a2.roll[1].open, 2275); near(a2.roll[2].close, 2500 - 675);
});
test('생산계획이 없는 달은 직전 평균 실적 대수로, 알림을 남김', () => {
  const db = tinyDb(); delete db.prod['2027-01'];
  const an = L.analyze(db);
  near(an.planUnits['2027-01'], 400 / 3);
  assert.deepEqual(an.planMissing, ['2027-01']);
  assert.ok(an.warnings.some(w => /생산계획이 없는 달/.test(w)));
});
test('생산실적이 하나도 없으면 평균 출고를 그대로 예상 출고로', () => {
  const db = tinyDb(); db.prod = {};
  const a1 = L.analyze(db).items.find(x => x.code === 'A-1');
  assert.equal(a1.rate, null);
  a1.fc.forEach(f => near(f.issue, 400));
});
test('월별 출고 열이 없으면 평균 출고 열 ÷ 평균 대수로 요율, 그것도 없으면 시트의 요율 칸', () => {
  const aoa = [['기준월 2026-10'], ['강종', '현재고', '분기평균', '요율'], ['SS400', 100, 300, null], ['SPHC', 100, null, 2]];
  const r = L.parseWorkbook([{ name: 's', aoa }]);
  const db = L.emptyDb(); Object.assign(db, { items: r.items, base: r.base, prod: { '2026-07': { actual: 100 }, '2026-08': { actual: 100 }, '2026-09': { actual: 100 }, '2026-11': { plan: 50 } } });
  db.settings = L.cleanSettings({ rateWindow: 3 });
  const an = L.analyze(db);
  near(an.items.find(x => x.grade === 'SS400').rate, 3);
  assert.equal(an.items.find(x => x.grade === 'SPHC').rateSrc, '수불 시트의 요율 칸');
});

console.log('우선순위 · 발주량');
function one(stock, opts = {}) {
  // 매달 100 씩 나가는 자재 하나 — 안전재고 50(0.5개월분)
  const it = { code: 'X', grade: 'SS400', spec: '', unit: 'kg', stock, onOrder: opts.onOrder || 0, out: {}, inq: {}, param: opts.param || {} };
  for (let k = 1; k <= 6; k++) it.out[L.ymAdd('2026-10', -k)] = 100;
  it.key = L.itemKey(it);
  const db = L.emptyDb();
  const prod = {}; for (let k = 1; k <= 6; k++) prod[L.ymAdd('2026-10', -k)] = { actual: 10 };
  ['2026-11', '2026-12', '2027-01'].forEach(y => prod[y] = { plan: 10 });
  Object.assign(db, { base: '2026-10', items: [it], prod, settings: L.cleanSettings(Object.assign({ ltDays: 30 }, opts.settings || {})) });
  return L.analyze(db).items[0];
}
test('빨강 — 리드타임 안에 결품(지금 발주해도 늦음)', () => {
  const x = one(80, { param: { ltDays: 30 } });
  assert.equal(x.L, 1); assert.equal(x.firstOut, 1); assert.equal(x.priority, 'red');
  assert.equal(L.deadlineText(x, '2026-10'), '지금(늦음)');
});
test('주황 — 이번 달 발주해야 안전재고 유지 / 노랑 — 다음 달 발주 / 초록 — 3개월 안전', () => {
  const o = one(230); assert.equal(o.firstShort, 2); assert.equal(o.deadline, 0); assert.equal(o.priority, 'orange');
  const y = one(330); assert.equal(y.firstShort, 3); assert.equal(y.deadline, 1); assert.equal(y.priority, 'yellow');
  assert.equal(L.deadlineText(y, '2026-10'), '2026년 11월까지');
  const g = one(400); assert.equal(g.priority, 'green'); assert.equal(g.qty, 0);
});
test('발주잔량은 1월 기초재고에 더해 우선순위를 낮춤', () => {
  assert.equal(one(80).priority, 'red'); assert.equal(one(80, { onOrder: 250 }).priority, 'yellow'); assert.equal(one(80, { onOrder: 320 }).priority, 'green');
});
test('리드타임이 길면(75일 → 3개월) 같은 재고라도 빨강', () => {
  const x = one(230, { param: { ltDays: 75 } });
  assert.equal(x.L, 3); assert.equal(x.priority, 'red');
  assert.ok(x.notes.some(n => /리드타임/.test(n)));
});
test('권장 발주량 — 필요량을 발주단위로 올림, MOQ 보다 작으면 MOQ (발주단위로 다시 올림)', () => {
  const x = one(230, { param: { lot: 40 } });
  near(x.need, 50 + 300 - 230); assert.equal(x.qty, 120);
  const m = one(230, { param: { moq: 250, lot: 40 } });
  assert.equal(m.qty, 280);
  assert.equal(one(230).qty, 120); // 단위 없음 → 1 단위 올림
  assert.equal(one(230, { param: { lot: 50 } }).qty, 150, '120 을 50 단위로 → 올림 150 (반올림이면 100 으로 모자람)');
});
test('MOQ 과다 — MOQ 때문에 3개월 뒤에도 장기재고 기준 이상 남으면 표시, 발주단위 올림만으로는 표시 안 함', () => {
  const x = one(230, { param: { moq: 1000 } });
  assert.ok(x.moqWarn); assert.ok(x.dead.includes('moq'));
  near(x.coverAfter, (230 - 300 + 1000) / 100);
  assert.ok(!one(230, { param: { lot: 1000 } }).moqWarn, '발주단위가 커서 남는 것은 MOQ 과다가 아님');
});
test('안전재고 — 자재별 수량이 있으면 그 값, 없으면 개월분 × 평균 예상 출고', () => {
  near(one(400).ss, 50);
  near(one(400, { param: { ssMonths: 2 } }).ss, 200);
  near(one(400, { param: { ssQty: 70, ssMonths: 2 } }).ss, 70);
});
test('자재별 기준의 우선순위 — 설정 화면 값 > 발주 기준 시트 > 수불 시트 칸 > 기본값', () => {
  const S = L.cleanSettings({});
  const P = L.effParam({ param: { moq: 1 }, sheetParam: { moq: 2, lot: 5 } }, S, { moq: 3 });
  assert.equal(P.moq, 3); assert.equal(P.lot, 5); assert.equal(P.ltDays, S.ltDays);
});

console.log('가상 샘플에 심어 둔 것');
const SB = Sample.build();
const SR = L.parseWorkbook(SB.sheets);
const SDB = L.emptyDb(); Object.assign(SDB, { items: SR.items, prod: SR.prod, params: SR.params, base: SR.base });
const AN = L.analyze(SDB);
const X = code => AN.items.find(x => x.code === code);
test('샘플 시트 셋을 모두 읽음 — 자재 20 · 기준월 2026-10 · 차 3개월 계획 · 알림 없음', () => {
  assert.equal(SR.items.length, 20); assert.equal(SR.base, '2026-10');
  assert.deepEqual(AN.fmonths, ['2026-11', '2026-12', '2027-01']);
  assert.deepEqual(AN.planMissing, []); assert.deepEqual(AN.warnings, []);
  assert.equal(SR.params.length, 20);
});
test('RM-102(로트 절단)·RM-104(긴 리드타임)는 빨강, 발주 리스트 맨 위', () => {
  assert.equal(X('RM-102').priority, 'red'); assert.equal(X('RM-104').priority, 'red');
  assert.deepEqual(AN.items.slice(0, 2).map(x => x.code).sort(), ['RM-102', 'RM-104']);
});
test('RM-102 는 「출고 들쭉날쭉」, 대조군(RM-103·107·109)은 변동 작음·초록·지표 없음', () => {
  assert.ok(X('RM-102').cv >= AN.S.cvWarn); assert.ok(X('RM-102').notes.some(n => /들쭉날쭉/.test(n)));
  ['RM-103', 'RM-107', 'RM-109'].forEach(c => { assert.ok(X(c).cv < 0.2, c); assert.equal(X(c).priority, 'green', c); assert.deepEqual(X(c).dead, [], c); });
});
test('RM-110 — 최근 분기 요율이 년간보다 높아 「요율 변화」, 분기 요율로 보면 더 급해짐', () => {
  assert.ok(X('RM-110').trend >= AN.S.trendWarn);
  const db = Object.assign({}, SDB, { settings: L.cleanSettings({ rateWindow: 3 }) });
  const q = L.analyze(db).items.find(x => x.code === 'RM-110');
  assert.ok(L.PRIORITY[q.priority].rank < L.PRIORITY[X('RM-110').priority].rank, q.priority + ' vs ' + X('RM-110').priority);
});
test('RM-112 MOQ 과다 · RM-113 불용 의심(14개월 무출고) · RM-120 장기재고 위험(9개월) · RM-114 재고 9개월분', () => {
  assert.ok(X('RM-112').dead.includes('moq'));
  assert.ok(X('RM-113').dead.includes('dead')); assert.equal(X('RM-113').lastAgo, 14);
  assert.ok(X('RM-120').dead.includes('long')); assert.ok(!X('RM-120').dead.includes('dead')); assert.equal(X('RM-120').lastAgo, 9);
  assert.ok(X('RM-114').dead.includes('long')); assert.ok(X('RM-114').cover > 9);
  assert.ok(X('RM-115').dead.includes('down'));
  assert.equal(AN.deadCounts.dead, 1);
});
test('강종별 묶음은 단위가 다르면 따로(SPCC kg · 매)', () => {
  const spcc = AN.grades.filter(g => g.grade === 'SPCC').map(g => g.unit).sort();
  assert.deepEqual(spcc, ['kg', '매']);
});

console.log('AI 가리기 · 보고서 · 저장');
test('프롬프트에 공급사·자재코드가 별칭으로만 — 안전망도 비어 있음', () => {
  const al = L.assignAllAliases({}, SDB.items);
  const info = L.buildAiPromptInfo(AN, al);
  assert.ok(!/공급사[A-D]|RM-1\d\d/.test(info.prompt), '실제 이름이 남음');
  assert.deepEqual(info.leaks, []);
  assert.ok(/공급사\d/.test(info.prompt) && /자재\d/.test(info.prompt));
  assert.ok(info.prompt.includes('SS400'), '강종·규격은 그대로');
});
test('AI 답 되돌리기 — 「자재3」은 원래 코드로, 「자재 3종」「공급사2곳」 같은 수 세기는 그대로', () => {
  const al = { code: { 'RM-101': '자재1', 'RM-102': '자재3' }, supplier: { '공급사A': '공급사2' } };
  assert.equal(L.unmaskText('자재3 먼저, 공급사2 확인. 자재 3종, 공급사2곳', al), 'RM-102 먼저, 공급사A 확인. 자재 3종, 공급사2곳');
  assert.deepEqual(L.findLeaks('RM-101 남음, RM-1012 는 다름', al), ['RM-101']);
});
test('별칭은 다시 만들어도 같은 이름 → 같은 별칭', () => {
  const a = L.assignAllAliases({}, [{ supplier: 'B사' }, { supplier: 'A사' }]);
  const b = L.assignAllAliases(a, [{ supplier: 'C사' }, { supplier: 'A사' }]);
  assert.equal(b.supplier['A사'], a.supplier['A사']); assert.equal(b.supplier['C사'], '공급사3');
});
test('보고서 — 총괄·기준·발주 리스트·강종별·장기불용 절, AI 의견은 넣을 때만', () => {
  const t = L.buildReport(AN);
  ['1. 총괄', '2. 계산 기준', '3. 발주 리스트', '4. 강종별 부족량', '5. 장기·불용'].forEach(s => assert.ok(t.includes(s), s));
  assert.ok(!t.includes('6. AI')); assert.ok(L.buildReport(AN, '확인 필요').includes('6. AI 검토 의견'));
  assert.ok(t.indexOf('RM-102') < t.indexOf('RM-101'), '빨강이 먼저');
});
test('엑셀 표 — 발주 리스트(필요한 것만/전체) · 굴리기(자재×3개월) · 요율 · 장기불용', () => {
  assert.equal(L.orderToAoa(AN, false).length, 2 + AN.orderItems.length);
  assert.equal(L.orderToAoa(AN, true).length, 2 + AN.items.length);
  assert.equal(L.rollToAoa(AN).length, 2 + AN.items.length * 3);
  assert.equal(L.rateToAoa(AN).length, 2 + AN.items.length);
  assert.equal(L.deadToAoa(AN)[2][0], 'RM-113', '출고 없는 자재가 맨 위');
});
test('설정 정리 — 잘못된 값은 기본값, 요율 기간은 3·6·12·24 만', () => {
  const s = L.cleanSettings({ rateWindow: 5, ssMonths: -1, ltDays: 'x', deadMonths: 9 });
  assert.equal(s.rateWindow, 6); assert.equal(s.ssMonths, 0.5); assert.equal(s.ltDays, 30); assert.equal(s.deadMonths, 9);
});
test('저장 형식 — 되살리기, 잘못된 자재·연월 버림, 가리기 기본 켬', () => {
  const db = L.restoreDb({ base: '2026-10', items: [{ code: 'A', stock: 1 }, { stock: 2 }], prod: { '2026-09': { actual: 5, plan: -1 }, x: { actual: 1 } }, paramOverrides: { k: { moq: 'x', lot: 5 } } });
  assert.equal(db.items.length, 1); assert.ok(db.items[0].key);
  assert.deepEqual(db.prod, { '2026-09': { actual: 5 } }); assert.deepEqual(db.paramOverrides, { k: { lot: 5 } });
  assert.equal(db.mask, true); assert.equal(L.restoreDb({ mask: false }).mask, false);
});
test('붙여 넣기 — 발주 기준 6칸 · 생산대수 3칸, 머리 줄은 건너뜀', () => {
  const p = L.parseParamText('자재코드\t규격\tMOQ\t리드타임\t안전재고\t발주단위\nRM-101\t4.5t\t5000\t30\t0.5\t1000\nSS400\t6t\t1000\t45');
  assert.equal(p.items.length, 2); assert.equal(p.items[0].code, 'RM-101'); assert.equal(p.items[0].lot, 1000);
  assert.equal(p.items[1].grade, 'SS400'); assert.equal(p.items[1].ltDays, 45);
  const q = L.parseProdText('년월\t실적\t계획\n2026-11\t\t170\n2026-12\t\t185');
  assert.deepEqual(q.prod, { '2026-11': { plan: 170 }, '2026-12': { plan: 185 } });
});
test('xlsx 로 쓰고 다시 읽어도 같음(엑셀 날짜 머리 포함)', () => {
  const aoa = [['기준월: 2026-10'], ['강종', '현재고', new Date('2026-09-01T00:00:00'), new Date('2026-08-01T00:00:00')], ['SS400', 10, 5, 7]];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa, { cellDates: true }), 's');
  const back = XLSX.read(XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellDates: true }), { type: 'array', cellDates: true });
  const r = L.parseWorkbook([{ name: 's', aoa: XLSX.utils.sheet_to_json(back.Sheets.s, { header: 1, raw: true, defval: null }) }]);
  assert.deepEqual(r.items[0].out, { '2026-09': 5, '2026-08': 7 });
});

console.log('판 맞추기 (2026-10-27)');
const { versions } = await import('../scripts/bump-version.mjs');
test('판 맞추기 — index.html ?v= · logic.js · app.js · sample-data.js 가 같은 판 (scripts/bump-version.mjs)', () => {
  const v = versions();
  assert.ok(L.VERSION && v.logic === L.VERSION && v.app === L.VERSION && v.sample === L.VERSION, JSON.stringify(v));
  assert.ok(v.html.length >= 9 && v.html.every(x => x === L.VERSION), 'index.html 의 모든 js·css 에 ?v=' + L.VERSION);
});

console.log('AI 연결 설정 (선택 기능)');
test('주소 정리·점검·요청 — 키는 넣을 때만 머리글, https 페이지에서 http 주소 막음', () => {
  assert.equal(E.normalizeBaseUrl('https://x.example/v1/chat/completions/'), 'https://x.example/v1');
  assert.ok(E.validateConfig({ baseUrl: 'http://10.0.0.5/v1', model: 'm' }, 'https:').errors.length);
  assert.equal(E.buildChatRequest({ baseUrl: 'https://x/v1', model: 'm' }, E.promptMessages('hi')).init.headers.Authorization, undefined);
  assert.equal(E.toStored({ baseUrl: 'https://x/v1', model: 'm', apiKey: 'k', remember: false }).apiKey, '');
  assert.equal(E.STORE_KEY, 'data10-16.ai');
});

console.log('\n' + passed + '개 통과' + (process.exitCode ? ' — 실패 있음' : ''));
