/* 가상 샘플 — 원/부자재 입출고 수불 통합문서 1개 (시트 3장, 전부 지어낸 값)
   · 자재코드 RM-1xx, 공급사A~D — 실제 회사·제품과 관계없는 가짜 이름입니다. 강종(SS400·SPHC·STS304 …)은 KS·JIS 일반 표기입니다.
   · 시트 ① 수불현황: 제목 줄 · 기준월 줄 · 윗줄 묶음 머리(「출고 실적」「입고 실적」) · 자재 20종 × (현재고·당월 입고·당월 출고·발주잔량
     + 직전 24개월 출고 + 직전 24개월 입고 + 분기·반기·년 평균 출고) · 합계 줄. 기준월 = 2026년 10월(당월), 직전 = 2024-10 ~ 2026-09.
     시트 ② 생산대수: 2024-10 ~ 2026-10 실적, 2026-11 ~ 2027-01 계획(차 3개월 — 연말에 늘어남).
     시트 ③ 발주기준: 자재별 MOQ·리드타임(일)·안전재고(개월)·발주단위. 기획서 10장 ③④ 확인 전이라 값은 가정입니다.
   · 일부러 심어 둔 것 — 화면에서 바로 보이게:
       ① RM-102 SS400 6t — 로트 절단으로 출고가 한 번에 몰려 나감(들쭉날쭉) + 재고 0.6개월분 → 긴급(빨강)
       ② RM-104 SM490A 12t — 리드타임 75일인데 재고 1.3개월분 → 리드타임 안에 결품(빨강)
       ③ RM-110 SAPH440 2.6t — 2026-07 부터 새 모델로 대당 출고가 늘어남(분기 요율 ≫ 년간 요율)
       ④ RM-112 STS304 3t — MOQ 3,000kg 이 한 달 사용량의 9배라 발주하면 장기재고가 남음(MOQ 과다)
       ⑤ RM-113 STS430 1.0t — 2025-08 뒤로 출고 없음(14개월) → 불용 의심 · RM-120 은 9개월 무출고 → 장기재고 위험
       ⑥ RM-115 SCM440 Ø80 — 최근 출고 감소 · RM-114 S45C Ø50 — 재고 9개월분
     RM-103·107·109 등은 재고가 넉넉한 대조군(초록)입니다.
   브라우저에서는 window.MRSample, node 에서는 require('./sample-data.js'). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MRSample = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var BASE = '2026-10';
  // rate: 대당 출고(kg/대 · 매/대), stockM: 현재고가 차 3개월 평균 예상 출고의 몇 개월분인지, lt: 리드타임(일), ss: 안전재고(개월)
  var ITEMS = [
    { code: 'RM-101', grade: 'SS400', spec: '4.5t×1219×2438', sup: '공급사A', price: 1100, rate: 120, stockM: 1.3, lt: 30, moq: 5000, lot: 1000 },
    { code: 'RM-102', grade: 'SS400', spec: '6t×1524×3048', sup: '공급사A', price: 1100, rate: 210, stockM: 0.6, lt: 45, moq: 10000, lot: 1000, lumpy: 48000 },
    { code: 'RM-103', grade: 'SS400', spec: '9t×1524×6096', sup: '공급사B', price: 1120, rate: 95, stockM: 4.0, lt: 30, moq: 5000, lot: 1000 },
    { code: 'RM-104', grade: 'SM490A', spec: '12t×2438×6096', sup: '공급사B', price: 1250, rate: 160, stockM: 1.3, lt: 75, moq: 10000, lot: 1000 },
    { code: 'RM-105', grade: 'SM490A', spec: '16t×2438×6096', sup: '공급사B', price: 1260, rate: 60, stockM: 3.25, lt: 30, moq: 5000, lot: 1000 },
    { code: 'RM-106', grade: 'SPHC', spec: '2.3t×1219×C', sup: '공급사C', price: 1050, rate: 300, stockM: 2.3, lt: 30, moq: 20000, lot: 5000 },
    { code: 'RM-107', grade: 'SPHC', spec: '3.2t×1219×C', sup: '공급사C', price: 1050, rate: 180, stockM: 3.4, lt: 30, moq: 20000, lot: 5000, onOrder: 20000 },
    { code: 'RM-108', grade: 'SPCC', spec: '1.2t×1219×2438', unit: '매', sup: '공급사C', price: 32000, rate: 1.5, stockM: 1.9, lt: 14, moq: 100, lot: 50 },
    { code: 'RM-109', grade: 'SPCC', spec: '0.8t×1219×2438', sup: '공급사C', price: 1150, rate: 20, stockM: 4.5, lt: 30, moq: 2000, lot: 500 },
    { code: 'RM-110', grade: 'SAPH440', spec: '2.6t×1219×C', sup: '공급사D', price: 1300, rate: 80, rate2: 140, from2: '2026-07', stockM: 2.6, lt: 30, moq: 10000, lot: 5000 },
    { code: 'RM-111', grade: 'STS304', spec: '1.5t×1219×2438', sup: '공급사D', price: 4200, rate: 12, stockM: 4.2, lt: 45, moq: 1000, lot: 100 },
    { code: 'RM-112', grade: 'STS304', spec: '3t×1219×2438', sup: '공급사D', price: 4250, rate: 2, stockM: 1.0, lt: 30, moq: 3000, lot: 100 },
    { code: 'RM-113', grade: 'STS430', spec: '1.0t×1219×2438', sup: '공급사D', price: 2900, rate: 9, stopAfter: '2025-08', stockKg: 2400, lt: 45, moq: 1000, lot: 100 },
    { code: 'RM-114', grade: 'S45C', spec: 'Ø50 환봉', sup: '공급사B', price: 1600, rate: 15, stockM: 9.0, lt: 30, moq: 2000, lot: 500 },
    { code: 'RM-115', grade: 'SCM440', spec: 'Ø80 환봉', sup: '공급사B', price: 2100, rate: 10, rate2: 3, from2: '2026-07', stockKg: 14000, lt: 60, moq: 2000, lot: 500 },
    { code: 'RM-116', grade: 'SS400', spec: '3.2t×1219×2438', sup: '공급사A', price: 1100, rate: 70, stockM: 3.1, lt: 30, moq: 5000, lot: 1000 },
    { code: 'RM-117', grade: 'SM490A', spec: '8t×1524×6096', sup: '공급사B', price: 1240, rate: 110, stockM: 1.6, lt: 30, moq: 10000, lot: 1000, lumpy: 30000 },
    { code: 'RM-118', grade: 'SPHC', spec: '4.5t×1219×C', sup: '공급사C', price: 1050, rate: 90, stockM: 4.0, lt: 30, moq: 20000, lot: 5000 },
    { code: 'RM-119', grade: 'SS275', spec: '6t×1524×3048', sup: '공급사A', price: 1120, rate: 50, stockM: 4.0, lt: 30, moq: 5000, lot: 1000 },
    { code: 'RM-120', grade: 'SAPH440', spec: '3.2t×1219×C', sup: '공급사D', price: 1300, rate: 25, stopAfter: '2026-01', stockKg: 900, lt: 30, moq: 10000, lot: 5000 }
  ];
  var PLAN = { '2026-11': 170, '2026-12': 185, '2027-01': 160 };

  function rng(seed) { // mulberry32 — 같은 씨앗이면 늘 같은 값
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymAdd(ym, k) { var y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1 + k; y += Math.floor(m / 12); m = ((m % 12) + 12) % 12; return y + '-' + pad(m + 1); }
  function r1(v) { return Math.round(v); }

  /* → { base, items:[{…, out:{ym:q}, inq:{ym:q}, stock, outNow, inNow, onOrder}], prod:{ym:{actual,plan}}, sheets:[{name, aoa}], fileName } */
  function build() {
    var R = rng(20261027), gauss = function () { var u = 1 - R(), v = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    var hist = []; for (var k = 24; k >= 1; k--) hist.push(ymAdd(BASE, -k)); // 오래된 달부터
    var prod = {};
    hist.concat([BASE]).forEach(function (ym, i) {
      var m = +ym.slice(5, 7), season = m === 12 || m <= 2 ? 10 : m >= 7 && m <= 8 ? -12 : 0; // 연말·연초 많고 여름 적음
      var actual = Math.round(140 + i * 0.6 + season + gauss() * 7);
      prod[ym] = { actual: actual, plan: Math.round(actual + gauss() * 5) };
    });
    Object.keys(PLAN).forEach(function (ym) { prod[ym] = { plan: PLAN[ym] }; });
    var planAvg = (PLAN['2026-11'] + PLAN['2026-12'] + PLAN['2027-01']) / 3;
    var items = ITEMS.map(function (d) {
      var out = {}, inq = {}, cum = 0;
      function rateAt(ym) { return d.rate2 != null && ym >= d.from2 ? d.rate2 : d.rate; }
      hist.concat([BASE]).forEach(function (ym) {
        var need = d.stopAfter && ym > d.stopAfter ? 0 : rateAt(ym) * prod[ym].actual * (1 + gauss() * 0.06);
        var q;
        if (d.lumpy) { cum += need; q = Math.floor(cum / d.lumpy) * d.lumpy; cum -= q; } // 로트(코일 묶음) 단위로만 절단·출고
        else q = need;
        q = d.unit === '매' ? Math.round(q) : r1(q);
        if (ym === BASE) d._outNow = q; else out[ym] = q;
      });
      // 입고(참고) — 두 달마다 두 달 치를 한 번에
      hist.forEach(function (ym, i) { inq[ym] = i % 2 ? r1((out[hist[i - 1]] || 0) + (out[ym] || 0)) : 0; });
      var rateNow = rateAt(BASE);
      var stock = d.stockKg != null ? d.stockKg : r1(d.stockM * rateNow * planAvg);
      return {
        code: d.code, grade: d.grade, spec: d.spec, unit: d.unit || 'kg', supplier: d.sup, price: d.price,
        stock: stock, inNow: d.stopAfter ? 0 : r1((d._outNow || 0) * (0.8 + R() * 0.5)), outNow: d._outNow, onOrder: d.onOrder || 0,
        out: out, inq: inq, moq: d.moq, lt: d.lt, ss: d.ss != null ? d.ss : 0.5, lot: d.lot
      };
    });
    function avgN(it, n) { var s = 0; for (var i = 1; i <= n; i++) s += it.out[ymAdd(BASE, -i)] || 0; return Math.round(s / n); }
    // ① 수불현황
    var outCols = [], inCols = []; for (k = 1; k <= 24; k++) { outCols.push(ymAdd(BASE, -k)); inCols.push(ymAdd(BASE, -k)); }
    var lead = ['자재코드', '강종', '규격', '단위', '공급사', '단가(원)', '현재고', '당월입고', '당월출고', '발주잔량'];
    var group = lead.map(function () { return null; }).concat(['출고 실적 (직전 1~24개월)']).concat(outCols.slice(1).map(function () { return null; }))
      .concat(['입고 실적 (참고)']).concat(inCols.slice(1).map(function () { return null; })).concat(['평균 출고', null, null]);
    var head = lead.concat(outCols).concat(inCols).concat(['분기평균', '반기평균', '년평균']);
    var ledger = [['■ 원/부자재 입출고 수불 현황 — 2026년 10월 (가상 샘플)'], ['기준월: 2026-10 · 단위: kg (RM-108 은 매) · 직전 1~24개월은 마감 실적'], [], group, head];
    var tot = 0;
    items.forEach(function (it) {
      ledger.push([it.code, it.grade, it.spec, it.unit, it.supplier, it.price, it.stock, it.inNow, it.outNow, it.onOrder || null]
        .concat(outCols.map(function (y) { return it.out[y]; })).concat(inCols.map(function (y) { return it.inq[y]; }))
        .concat([avgN(it, 3), avgN(it, 6), avgN(it, 12)]));
      if (it.unit === 'kg') tot += it.stock;
    });
    ledger.push([]);
    ledger.push(['합계', null, null, 'kg', null, null, tot]);
    // ② 생산대수
    var prodAoa = [['■ 생산대수 실적·계획 (가상 샘플)'], ['년월', '생산실적(대)', '생산계획(대)']];
    Object.keys(prod).sort().forEach(function (y) { prodAoa.push([y, prod[y].actual == null ? null : prod[y].actual, prod[y].plan == null ? null : prod[y].plan]); });
    // ③ 발주기준
    var params = [['■ 자재별 발주 기준 (가상 — 실제 값 확인 전)'], ['자재코드', '강종', '규격', 'MOQ', '리드타임(일)', '안전재고(개월)', '발주단위']];
    items.forEach(function (it) { params.push([it.code, it.grade, it.spec, it.moq, it.lt, it.ss, it.lot]); });
    return {
      base: BASE, items: items, prod: prod, plan: PLAN, fileName: '수불_샘플_2026-10.xlsx',
      sheets: [{ name: '수불현황', aoa: ledger }, { name: '생산대수', aoa: prodAoa }, { name: '발주기준', aoa: params }]
    };
  }

  return { VERSION: '2026-11-10.1', build: build, BASE: BASE, ITEMS: ITEMS, PLAN: PLAN };
});
