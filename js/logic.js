/* 원/부자재 미결 방지 사전 관리 — 순수 로직 (화면·저장소와 무관)
   브라우저에서는 window.MRLogic, node 에서는 require('./logic.js') 로 씁니다.
   기준 문서: docs/01_프로젝트_기획서.md (3장 데이터, 5장 기능, 8장 1단계)

   흐름: 수불 엑셀(시트 여러 개) → classifySheet(수불 현황 · 생산대수 · 발주 기준 시트 가르기)
        → detectSheet(머리행·열·월 열 찾기) → parseLedger · parseProduction · parseParams
        → analyze(기준월·생산계획·자재별 출고 요율 → 차 3개월 예상 출고 → 월별 기초재고 굴리기
          → 안전재고 대비 부족량 · 결품 · 발주 마감월 · MOQ·발주단위 반영 권장량 · 우선순위 색
          → 장기·불용 재고 지표) → buildAiPromptInfo · buildReport */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MRLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SCHEMA_VERSION = 1;
  /* 판(版) — index.html 의 ?v= · app.js 의 APP_VERSION · sample-data.js 와 같아야 합니다(scripts/bump-version.mjs 로 함께 올림).
     브라우저가 옛 파일과 새 파일을 섞어 쓰면(GitHub Pages 캐시 10분) 단추와 결과가 어긋날 수 있어, app.js 가 시작할 때 맞춰 봅니다. */
  var VERSION = '2026-11-10.6';
  var HORIZON = 3; // 차 3개월 (제출 글)

  /* ── 1. 글자·숫자 ───────────────────────────────────────── */
  function str(v) { return v == null ? '' : String(v).trim(); }
  var UNIT_RE = /(원kg|kg|ton|톤|매|ea|pcs|개월|개|일|원|대)$/;
  function norm(s) {
    var n = String(s == null ? '' : s).replace(/[\s()（）\[\]·.:_\/\-~,]/g, '').toLowerCase();
    var m = n.replace(UNIT_RE, '');
    return m || n;
  }
  /* 빈칸·「-」 → null, 숫자로 못 읽으면 NaN. 「1,200 kg」「3.5톤」처럼 단위가 붙어도 읽습니다(톤은 그대로 숫자만). */
  function toNum(v) {
    if (v == null) return null;
    if (typeof v === 'number') return isFinite(v) ? v : NaN;
    if (typeof v === 'boolean') return NaN;
    var s = String(v).trim();
    if (!s || s === '-') return null;
    if (s.charAt(0) === '=') return null;
    s = s.replace(/,/g, '').replace(/\s*(kg|ton|톤|매|ea|pcs|개월|개|일|원|대|%)$/i, '');
    if (/^\(\d+(\.\d+)?\)$/.test(s)) s = '-' + s.slice(1, -1); // 회계식 음수 (120)
    if (!/^-?\d+(\.\d+)?$/.test(s)) return NaN;
    return Number(s);
  }
  function round(n, d) { var p = Math.pow(10, d == null ? 2 : d); return Math.round(n * p) / p; }
  function fmtNum(n, d) { return n == null || !isFinite(n) ? '-' : Number(round(n, d == null ? 0 : d)).toLocaleString('ko-KR'); }
  function pctText(v, d) { return v == null || !isFinite(v) ? '-' : round(v * 100, d == null ? 1 : d) + '%'; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function colName(i) {
    var s = ''; i = Number(i);
    do { s = String.fromCharCode(65 + (i % 26)) + s; i = Math.floor(i / 26) - 1; } while (i >= 0);
    return s;
  }
  function cmp(a, b) { a = a == null ? '' : String(a); b = b == null ? '' : String(b); return a < b ? -1 : a > b ? 1 : 0; }
  function uniq(a) { var s = {}, o = []; a.forEach(function (x) { if (!s[x]) { s[x] = 1; o.push(x); } }); return o; }

  /* ── 2. 연월 ('YYYY-MM') ─────────────────────────────────── */
  function ymOk(y, m) { return y >= 1990 && y <= 2100 && m >= 1 && m <= 12 ? y + '-' + pad(m) : ''; }
  function ymAdd(ym, k) { var y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1 + k; y += Math.floor(m / 12); m = ((m % 12) + 12) % 12; return y + '-' + pad(m + 1); }
  function ymDiff(a, b) { return (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7)); } // b − a (개월)
  function ymLabel(ym) { return ym ? ym.slice(0, 4) + '년 ' + (+ym.slice(5, 7)) + '월' : ''; }
  function ymShort(ym) { return ym ? ym.slice(2, 4) + '.' + ym.slice(5, 7) : ''; }
  /* 칸 값 → 'YYYY-MM'. 엑셀 날짜·일련번호·「2026-09」「26.09」「2026년 9월」「202609」. 못 읽으면 '' */
  function ymOf(v) {
    if (v == null || v === '') return '';
    if (v instanceof Date || Object.prototype.toString.call(v) === '[object Date]') {
      if (isNaN(v.getTime())) return '';
      var d = new Date(v.getTime() + 12 * 3600 * 1000);
      return ymOk(d.getFullYear(), d.getMonth() + 1);
    }
    if (typeof v === 'number') {
      if (v >= 199001 && v <= 210012 && Number.isInteger(v)) return ymOk(Math.floor(v / 100), v % 100);
      if (v >= 20000 && v <= 80000) { var t = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000); return ymOk(t.getUTCFullYear(), t.getUTCMonth() + 1); }
      return '';
    }
    var s = String(v).trim();
    var m = /(?:^|[^0-9])(20\d\d|\d\d)\s*[-./년]\s*(\d{1,2})(?:\s*월|(?=[^0-9])|$)/.exec(s);
    if (m) return ymOk(m[1].length === 2 ? 2000 + +m[1] : +m[1], +m[2]);
    m = /^(20\d\d)(\d\d)$/.exec(s);
    if (m) return ymOk(+m[1], +m[2]);
    return '';
  }

  /* ── 3. 열 이름 ─────────────────────────────────────────────
     제출 글의 수불 항목: 강종별 현재 재고 · 당월 입고 · 당월 출고 · 직전 1~24개월 입고(참고)/출고 · 평균 출고(분기·반기·년간) · 생산대수 대비 평균 출고 요율.
     자재코드·규격·공급사·단가·발주잔량은 제출 글에 없지만(기획서 10장 확인 중) 있으면 함께 읽습니다. */
  var LEDGER_FIELDS = [
    { id: 'code', label: '자재코드', aliases: ['자재코드', '품번', '품목코드', '자재번호', '코드', 'code', '품목번호', '자재no'] },
    { id: 'grade', label: '강종(재질)', aliases: ['강종', '재질', '강종명', '소재', 'material', 'grade', '재종', '강재'] },
    { id: 'spec', label: '규격', aliases: ['규격', '사양', '치수', 'size', '사이즈', 'spec', '두께폭길이', '규격치수'] },
    { id: 'name', label: '품명', aliases: ['품명', '자재명', '품목명', '품목'] },
    { id: 'unit', label: '단위', aliases: ['단위', 'unit'] },
    { id: 'supplier', label: '공급사', aliases: ['공급사', '거래처', '매입처', '공급업체', '업체', '구매처', '메이커', 'maker', 'supplier'] },
    { id: 'price', label: '단가', aliases: ['단가', '구매단가', '입고단가', 'price'] },
    { id: 'stock', label: '현재고', req: true, aliases: ['현재고', '현재재고', '재고', '재고량', '재고수량', '기말재고', '현재고량', '재고현황'] },
    { id: 'inNow', label: '당월 입고', aliases: ['당월입고', '금월입고', '이번달입고', '입고당월'] },
    { id: 'outNow', label: '당월 출고', aliases: ['당월출고', '금월출고', '이번달출고', '출고당월'] },
    { id: 'onOrder', label: '발주잔량(입고 예정)', aliases: ['발주잔량', '발주잔', '입고예정', '입고예정량', '미입고', '미입고량', '미착', '발주미입고'] },
    { id: 'avgQ', label: '분기 평균 출고', aliases: ['분기평균', '분기평균출고', '3개월평균', '3개월평균출고'] },
    { id: 'avgH', label: '반기 평균 출고', aliases: ['반기평균', '반기평균출고', '6개월평균', '6개월평균출고'] },
    { id: 'avgY', label: '년간 평균 출고', aliases: ['년평균', '연평균', '년간평균', '연간평균', '년평균출고', '연평균출고', '12개월평균', '12개월평균출고', '년간평균출고'] },
    { id: 'rate', label: '출고 요율(대당)', aliases: ['요율', '출고요율', '평균출고요율', '원단위', '대당출고', '대당사용량', '대당소요량', '생산대수대비요율'] },
    { id: 'moq', label: 'MOQ', aliases: ['moq', '최소발주량', '최소주문량', '최소발주수량', '최소구매량'] },
    { id: 'lt', label: '리드타임(일)', aliases: ['리드타임', 'leadtime', 'lt', '조달기간', '납기', '조달리드타임', '발주리드타임', '납기일수'] },
    { id: 'ss', label: '안전재고', aliases: ['안전재고', '안전재고량', '안전재고수량', 'safetystock', 'ss'] },
    { id: 'lot', label: '발주단위', aliases: ['발주단위', '구매단위', '포장단위', '발주배수', 'lot', '로트', 'lot단위', '코일단위'] }
  ];
  var PROD_FIELDS = [
    { id: 'month', label: '년월', req: true, aliases: ['년월', '월', '기간', '생산월', '연월', '해당월', '월별', 'month'] },
    { id: 'actual', label: '생산실적(대)', aliases: ['생산실적', '생산대수', '실적', '실적대수', '생산량', '생산실적대수', '생산수량'] },
    { id: 'plan', label: '생산계획(대)', aliases: ['생산계획', '계획', '계획대수', '계획생산대수', '생산계획대수', '계획수량'] }
  ];
  var PARAM_FIELDS = LEDGER_FIELDS.filter(function (f) { return ['code', 'grade', 'spec', 'moq', 'lt', 'ss', 'lot', 'supplier'].indexOf(f.id) >= 0; });
  var KINDS = {
    ledger: { label: '수불 현황', fields: LEDGER_FIELDS },
    prod: { label: '생산대수(실적·계획)', fields: PROD_FIELDS },
    params: { label: '발주 기준(MOQ·리드타임·안전재고)', fields: PARAM_FIELDS }
  };
  function fieldById(kind, id) { return KINDS[kind].fields.filter(function (f) { return f.id === id; })[0]; }

  function matchField(text, fields) {
    var n = norm(text);
    if (!n) return null;
    for (var i = 0; i < fields.length; i++) if (fields[i].aliases.indexOf(n) >= 0) return fields[i].id;
    var has = function (id) { return fields.some(function (f) { return f.id === id; }); };
    var raw = String(text).toLowerCase().replace(/\s/g, '');
    // 비슷한 머리 — 구체적인 것부터
    if (/평균/.test(raw) && !/요율/.test(raw)) {
      if (has('avgQ') && /(분기|3개월)/.test(raw)) return 'avgQ';
      if (has('avgH') && /(반기|6개월)/.test(raw)) return 'avgH';
      if (has('avgY') && /(년|연|12개월)/.test(raw)) return 'avgY';
      return null;
    }
    if (has('ss') && /안전재고/.test(raw)) return 'ss';
    if (has('moq') && /(moq|최소발주|최소주문)/.test(raw)) return 'moq';
    if (has('lt') && /(리드타임|leadtime|l\/t|조달기간)/.test(raw)) return 'lt';
    if (has('lot') && /(발주단위|구매단위|발주배수)/.test(raw)) return 'lot';
    if (has('onOrder') && /(발주잔|입고예정|미입고|미착)/.test(raw)) return 'onOrder';
    if (has('outNow') && /(당월|금월)/.test(raw) && /출고/.test(raw)) return 'outNow';
    if (has('inNow') && /(당월|금월)/.test(raw) && /입고/.test(raw)) return 'inNow';
    if (has('rate') && /(요율|원단위|대당)/.test(raw)) return 'rate';
    if (has('stock') && /(현재고|현재재고)/.test(raw) && !/금액/.test(raw)) return 'stock';
    if (has('price') && /단가/.test(raw)) return 'price';
    if (has('actual') && /실적/.test(raw)) return 'actual';
    if (has('plan') && /계획/.test(raw)) return 'plan';
    return null;
  }

  /* 월 열 머리 → { ym | rel | mo, kind:'out'|'in', assumed }. 아니면 null.
     「2026-09 출고」「25.10」(윗줄 묶음 「출고 실적」), 「M-1」「직전 3개월」「3개월 전」, 연도 없는 「9월」, 날짜 칸 머리. */
  function monthHeader(text, group) {
    var raw = text instanceof Date ? '' : str(text);
    if (/평균|합계|누계|요율|당월|금월/.test(raw)) return null;
    var ym = ymOf(text), rel = null, mo = null;
    if (!ym && typeof text === 'string') {
      var m = /(?:^|[^a-z])m\s*-\s*(\d{1,2})(?![0-9])/i.exec(raw) || /직전\s*(\d{1,2})\s*개?월/.exec(raw) || /(\d{1,2})\s*개월\s*전/.exec(raw);
      if (m && +m[1] >= 1 && +m[1] <= 36) rel = +m[1];
      else if ((m = /^(\d{1,2})\s*월/.exec(raw)) && +m[1] >= 1 && +m[1] <= 12) mo = +m[1];
    }
    if (!ym && rel == null && mo == null) return null;
    var g = str(group);
    var kind = /출고|사용|소요|불출/.test(raw) ? 'out' : /입고|구매|매입/.test(raw) ? 'in'
      : /출고|사용|소요|불출/.test(g) ? 'out' : /입고|구매|매입/.test(g) ? 'in' : null;
    return { ym: ym, rel: rel, mo: mo, kind: kind || 'out', assumed: !kind };
  }

  /* ── 4. 머리행 찾기 ──────────────────────────────────────────
     aoa: SheetJS sheet_to_json(header:1) 행 배열. kind: 'ledger' | 'prod' | 'params'.
     반환: { kind, headerRow, groupRow, map:{field:col}, months:[{col, ym, rel, mo, kind, assumed, label}], headers, missing, warnings, score } */
  function detectSheet(aoa, kind, overrides) {
    aoa = aoa || [];
    var fields = KINDS[kind].fields;
    var limit = Math.min(aoa.length, 30);
    function readRow(r) {
      var row = aoa[r] || [], width = row.length;
      for (var k = r; k < Math.min(aoa.length, r + 3); k++) width = Math.max(width, (aoa[k] || []).length);
      var above = r > 0 ? (aoa[r - 1] || []) : [], groups = [], cur = '', any = false;
      for (var c = 0; c < width; c++) { if (str(above[c])) { cur = str(above[c]); any = true; } groups.push(cur); }
      var map = {}, months = [], headers = [], dup = [];
      for (c = 0; c < width; c++) {
        var cell = row[c], t = cell instanceof Date ? ymOf(cell) : str(cell);
        headers.push(t);
        if (!t) continue;
        var fid = matchField(t, fields);
        if (!fid && any && groups[c] && groups[c] !== t && !ymOf(t)) fid = matchField(groups[c] + t, fields);
        if (fid) { if (map[fid] == null) map[fid] = c; else dup.push({ label: t, fid: fid }); continue; }
        if (kind === 'ledger') {
          var mh = monthHeader(cell, any ? groups[c] : '');
          if (mh) { mh.col = c; mh.label = t; months.push(mh); }
        }
      }
      return { map: map, months: months, headers: headers, dup: dup, any: any };
    }
    function valid(rd) {
      var m = rd.map;
      if (kind === 'ledger') return m.stock != null && (m.grade != null || m.code != null || m.name != null);
      if (kind === 'prod') return m.month != null && (m.actual != null || m.plan != null);
      return (m.code != null || m.grade != null) && (m.moq != null || m.lt != null || m.ss != null || m.lot != null);
    }
    var best = -1, bestScore = 0, bestRead = null;
    for (var r = 0; r < limit; r++) {
      var rd = readRow(r);
      if (!valid(rd)) continue;
      var score = Object.keys(rd.map).length + (rd.months.length ? 2 : 0);
      if (score > bestScore) { best = r; bestScore = score; bestRead = rd; }
    }
    var out = { kind: kind, headerRow: best, groupRow: -1, map: {}, months: [], headers: [], missing: [], warnings: [], score: bestScore };
    if (best < 0) {
      out.warnings.push(kind === 'ledger' ? '머리행(강종·현재고 …)을 찾지 못했습니다. 수불 현황 시트인지 확인해 주세요.'
        : kind === 'prod' ? '머리행(년월·생산실적·생산계획)을 찾지 못했습니다.' : '머리행(자재코드 또는 강종 + MOQ·리드타임·안전재고)을 찾지 못했습니다.');
      out.missing = kind === 'ledger' ? ['stock'] : kind === 'prod' ? ['month'] : ['moq'];
      return out;
    }
    out.map = bestRead.map; out.months = bestRead.months; out.headers = bestRead.headers;
    if (bestRead.any) out.groupRow = best - 1;
    bestRead.dup.forEach(function (d) { out.warnings.push('「' + d.label + '」 열이 ' + fieldById(kind, d.fid).label + '(으)로 한 번 더 보입니다. 앞의 것(' + colName(out.map[d.fid]) + ')을 씁니다.'); });
    if (overrides) Object.keys(overrides).forEach(function (fid) {
      if (!fieldById(kind, fid)) return;
      var v = overrides[fid];
      if (v === -1 || v === '' || v == null) delete out.map[fid]; else out.map[fid] = Number(v);
      out.months = out.months.filter(function (mc) { return mc.col !== Number(v); });
    });
    // 단위를 머리에서 읽기 — 리드타임 「(개월)」「(주)」, 안전재고 「(개월)」
    var ltHead = out.map.lt != null ? str(out.headers[out.map.lt]) : '';
    out.ltUnit = /개월|month/i.test(ltHead) ? 30 : /주|week/i.test(ltHead) ? 7 : 1;
    var ssHead = out.map.ss != null ? str(out.headers[out.map.ss]) : '';
    out.ssIsMonths = /개월|month/i.test(ssHead);
    if (kind === 'ledger') {
      if (out.map.stock == null) out.missing.push('stock');
      var outs = out.months.filter(function (m) { return m.kind === 'out'; });
      if (!outs.length && out.map.avgQ == null && out.map.avgH == null && out.map.avgY == null && out.map.rate == null)
        out.warnings.push('월별 출고 열(「2026-09 출고」 같은)도, 평균 출고·요율 열도 찾지 못했습니다. 예상 출고를 계산할 수 없으니 열 머리를 확인해 주세요.');
      if (out.months.some(function (m) { return m.assumed; }))
        out.warnings.push('「출고」「입고」가 적히지 않은 월 열 ' + out.months.filter(function (m) { return m.assumed; }).length + '개는 출고로 봅니다.');
      if (out.months.some(function (m) { return m.mo != null; }))
        out.warnings.push('연도 없이 「9월」처럼 적힌 월 열은 기준월에서 가장 가까운 지난달로 봅니다(같은 달이 또 나오면 한 해 전).');
    }
    if (out.missing.length) out.warnings.push('꼭 필요한 열이 없습니다: ' + out.missing.map(function (id) { return fieldById(kind, id).label; }).join(', ') + ' — 열 연결에서 골라 주세요.');
    return out;
  }

  /* 시트 종류 가르기 — 수불 현황(현재고) > 발주 기준 > 생산대수 */
  function classifySheet(aoa) {
    var cands = ['ledger', 'params', 'prod'].map(function (k) { return detectSheet(aoa, k); }).filter(function (d) { return d.headerRow >= 0; });
    return cands[0] || null;
  }

  /* ── 5. 행 읽기 ─────────────────────────────────────────── */
  function isSummaryRow(row) {
    for (var c = 0; c < Math.min(row.length, 6); c++) {
      if (/^(합계|소계|총계|계|누계|total|sum|subtotal)$/i.test(str(row[c]).replace(/\s/g, ''))) return true;
    }
    return false;
  }
  function itemKey(it) { return it.code ? 'C:' + norm(it.code) : 'G:' + norm(it.grade) + '|' + norm(it.spec); }
  function itemName(it) { return [it.grade, it.spec].filter(Boolean).join(' ') || it.name || it.code || '(이름 없음)'; }

  /* 제목 줄에서 기준월 찾기 — 「기준월: 2026-10」「2026년 10월 수불」 */
  function baseFromTitle(aoa, upto) {
    for (var r = 0; r < Math.min(upto, aoa.length); r++) {
      var line = (aoa[r] || []).map(function (c) { return c instanceof Date ? ymOf(c) : str(c); }).join(' ');
      var m = /기준\s*(?:월|년월|연월)?\s*[:：]?\s*(20\d\d)\s*[-./년]\s*(\d{1,2})/.exec(line) || /(20\d\d)\s*년\s*(\d{1,2})\s*월/.exec(line);
      if (m) return ymOk(+m[1], +m[2]);
    }
    return '';
  }

  /* 수불 현황 → { items, base, baseFrom, warnings:[{row,msg}], skipped, summary, monthCols } */
  function parseLedger(aoa, det, opts) {
    opts = opts || {};
    var out = { items: [], base: '', baseFrom: '', warnings: [], skipped: 0, summary: 0, merged: 0 };
    if (!det || det.headerRow < 0 || det.missing.length) return out;
    var m = det.map;
    // 기준월: 사용자가 정한 값 > 제목 줄 > 가장 늦은 월 열 + 1
    var base = opts.base || '', from = opts.base ? '직접 입력' : '';
    if (!base) { base = baseFromTitle(aoa, det.headerRow); if (base) from = '제목 줄'; }
    if (!base) {
      var yms = det.months.filter(function (x) { return x.ym; }).map(function (x) { return x.ym; }).sort();
      if (yms.length) { base = ymAdd(yms[yms.length - 1], 1); from = '가장 늦은 월 열 다음 달'; }
    }
    out.base = base; out.baseFrom = from;
    if (!base) { out.warnings.push({ row: det.headerRow + 1, msg: '기준월(당월)을 알 수 없습니다. 가져오기 화면에서 기준월을 넣어 주세요.' }); return out; }
    // 월 열을 연월로 풀기
    var seen = {}, cols = [];
    det.months.forEach(function (mc) {
      var ym = mc.ym;
      if (!ym && mc.rel != null) ym = ymAdd(base, -mc.rel);
      if (!ym && mc.mo != null) {
        var k = mc.kind + mc.mo; seen[k] = (seen[k] || 0) + 1;
        ym = ymAdd(base, -(((+base.slice(5, 7) - mc.mo) + 12) % 12) - 12 * (seen[k] - 1));
      }
      cols.push({ col: mc.col, ym: ym, kind: mc.kind });
    });
    var future = cols.filter(function (c) { return c.ym > base; });
    if (future.length) out.warnings.push({ row: det.headerRow + 1, msg: '기준월(' + base + ')보다 늦은 월 열 ' + future.length + '개는 쓰지 않습니다.' });
    cols = cols.filter(function (c) { return c.ym <= base; });
    out.monthCols = cols;
    function cell(row, fid) { return m[fid] == null ? null : row[m[fid]]; }
    function num(row, fid, r, lbl) {
      var raw = fid.col != null ? row[fid.col] : cell(row, fid);
      var v = toNum(raw);
      if (v != null && isNaN(v)) { out.warnings.push({ row: r + 1, msg: (lbl || fieldById('ledger', fid).label) + ' 칸 「' + str(raw) + '」 을 숫자로 읽지 못해 비워 둡니다.' }); return null; }
      return v;
    }
    var byKey = {};
    for (var r = det.headerRow + 1; r < aoa.length; r++) {
      var row = aoa[r] || [];
      var code = str(cell(row, 'code')), grade = str(cell(row, 'grade')), spec = str(cell(row, 'spec')), name = str(cell(row, 'name'));
      var stockRaw = cell(row, 'stock');
      if (!code && !grade && !name && (stockRaw == null || str(stockRaw) === '')) continue;
      if (isSummaryRow(row)) { out.summary++; continue; }
      if (!grade && name) grade = name;
      if (!code && !grade) { out.skipped++; out.warnings.push({ row: r + 1, msg: '자재코드·강종이 모두 비어 건너뜁니다.' }); continue; }
      var stock = num(row, 'stock', r);
      if (stock == null) { out.skipped++; out.warnings.push({ row: r + 1, msg: '현재고가 비어 있어 건너뜁니다.' }); continue; }
      if (stock < 0) out.warnings.push({ row: r + 1, msg: '현재고가 음수(' + stock + ')입니다. 수불 마감 전인지 확인해 주세요(그대로 계산).' });
      var it = {
        code: code, grade: grade, spec: spec, name: name, unit: str(cell(row, 'unit')) || 'kg', supplier: str(cell(row, 'supplier')),
        price: num(row, 'price', r), stock: stock, inNow: num(row, 'inNow', r), outNow: num(row, 'outNow', r), onOrder: num(row, 'onOrder', r),
        avgQ: num(row, 'avgQ', r), avgH: num(row, 'avgH', r), avgY: num(row, 'avgY', r), rate: num(row, 'rate', r),
        out: {}, inq: {}, param: {}, file: opts.fileName || ''
      };
      cols.forEach(function (c) {
        var v = num(row, { col: c.col }, r, c.ym + (c.kind === 'out' ? ' 출고' : ' 입고'));
        if (v == null) return;
        if (c.ym === base) { if (c.kind === 'out' && it.outNow == null) it.outNow = v; if (c.kind === 'in' && it.inNow == null) it.inNow = v; return; }
        var bag = c.kind === 'out' ? it.out : it.inq;
        bag[c.ym] = (bag[c.ym] || 0) + v;
      });
      var moq = num(row, 'moq', r), lt = num(row, 'lt', r), ss = num(row, 'ss', r), lot = num(row, 'lot', r);
      if (moq != null) it.param.moq = moq;
      if (lt != null) it.param.ltDays = lt * (det.ltUnit || 1);
      if (ss != null) { if (det.ssIsMonths) it.param.ssMonths = ss; else it.param.ssQty = ss; }
      if (lot != null) it.param.lot = lot;
      it.key = itemKey(it);
      var prev = byKey[it.key];
      if (prev) { // 같은 자재가 두 줄(로트·창고별 등) — 수량을 더합니다
        ['stock', 'inNow', 'outNow', 'onOrder'].forEach(function (k) { if (it[k] != null) prev[k] = (prev[k] || 0) + it[k]; });
        ['out', 'inq'].forEach(function (b) { Object.keys(it[b]).forEach(function (y) { prev[b][y] = (prev[b][y] || 0) + it[b][y]; }); });
        out.merged++;
        out.warnings.push({ row: r + 1, msg: itemName(it) + ' 이(가) 앞 줄과 같은 자재라 재고·입출고를 더했습니다.' });
        continue;
      }
      byKey[it.key] = it;
      out.items.push(it);
    }
    return out;
  }

  /* 생산대수 → { prod:{ym:{actual,plan}}, warnings, skipped } */
  function parseProduction(aoa, det) {
    var out = { prod: {}, warnings: [], skipped: 0 };
    if (!det || det.headerRow < 0 || det.missing.length) return out;
    var m = det.map;
    for (var r = det.headerRow + 1; r < aoa.length; r++) {
      var row = aoa[r] || [];
      if (!row.some(function (c) { return str(c) !== ''; })) continue;
      if (isSummaryRow(row)) continue;
      var ym = ymOf(row[m.month]);
      if (!ym) { out.skipped++; out.warnings.push({ row: r + 1, msg: '년월 「' + str(row[m.month]) + '」 을 읽지 못해 건너뜁니다.' }); continue; }
      var o = {};
      ['actual', 'plan'].forEach(function (k) {
        if (m[k] == null) return;
        var v = toNum(row[m[k]]);
        if (v != null && isNaN(v)) { out.warnings.push({ row: r + 1, msg: fieldById('prod', k).label + ' 「' + str(row[m[k]]) + '」 을 숫자로 읽지 못했습니다.' }); return; }
        if (v != null && v < 0) { out.warnings.push({ row: r + 1, msg: '음수 대수는 비워 둡니다.' }); return; }
        if (v != null) o[k] = v;
      });
      if (Object.keys(o).length) out.prod[ym] = Object.assign(out.prod[ym] || {}, o);
    }
    return out;
  }

  /* 발주 기준 → { params:[{key, code, grade, spec, moq, ltDays, ssMonths, ssQty, lot, supplier}], warnings } */
  function parseParams(aoa, det) {
    var out = { params: [], warnings: [], skipped: 0 };
    if (!det || det.headerRow < 0 || det.missing.length) return out;
    var m = det.map;
    for (var r = det.headerRow + 1; r < aoa.length; r++) {
      var row = aoa[r] || [];
      var code = m.code != null ? str(row[m.code]) : '', grade = m.grade != null ? str(row[m.grade]) : '', spec = m.spec != null ? str(row[m.spec]) : '';
      if (!code && !grade) continue;
      if (isSummaryRow(row)) continue;
      var p = { code: code, grade: grade, spec: spec };
      ['moq', 'lt', 'ss', 'lot'].forEach(function (k) {
        if (m[k] == null) return;
        var v = toNum(row[m[k]]);
        if (v == null) return;
        if (isNaN(v) || v < 0) { out.warnings.push({ row: r + 1, msg: fieldById('params', k).label + ' 「' + str(row[m[k]]) + '」 을 읽지 못했습니다.' }); return; }
        if (k === 'lt') p.ltDays = v * (det.ltUnit || 1);
        else if (k === 'ss') { if (det.ssIsMonths) p.ssMonths = v; else p.ssQty = v; }
        else p[k] = v;
      });
      if (m.supplier != null && str(row[m.supplier])) p.supplier = str(row[m.supplier]);
      p.key = itemKey(p);
      out.params.push(p);
    }
    return out;
  }

  /* 통합문서 한 개 — 시트마다 종류를 가르고 읽습니다. opts.kinds = {시트이름: 'ledger'|'prod'|'params'|'skip'}, opts.overrides = {시트이름: {...}} */
  function parseWorkbook(sheets, opts) {
    opts = opts || {};
    var res = { sheets: [], items: [], prod: {}, params: [], base: '', baseFrom: '' };
    (sheets || []).forEach(function (s) {
      var kind = (opts.kinds || {})[s.name];
      var det = null;
      if (!kind) { det = classifySheet(s.aoa); kind = det ? det.kind : 'skip'; }
      if (kind !== 'skip') det = detectSheet(s.aoa, kind, (opts.overrides || {})[s.name]);
      var one = { name: s.name, kind: kind, det: det, warnings: [], count: 0 };
      if (kind === 'ledger') {
        var L = parseLedger(s.aoa, det, { base: opts.base, fileName: opts.fileName });
        one.warnings = L.warnings; one.count = L.items.length; one.skipped = L.skipped; one.summary = L.summary; one.base = L.base; one.baseFrom = L.baseFrom; one.monthCols = L.monthCols || [];
        if (L.base && !res.base) { res.base = L.base; res.baseFrom = L.baseFrom; }
        res.items = res.items.concat(L.items);
      } else if (kind === 'prod') {
        var P = parseProduction(s.aoa, det);
        one.warnings = P.warnings; one.count = Object.keys(P.prod).length; one.skipped = P.skipped;
        Object.keys(P.prod).forEach(function (y) { res.prod[y] = Object.assign(res.prod[y] || {}, P.prod[y]); });
      } else if (kind === 'params') {
        var Q = parseParams(s.aoa, det);
        one.warnings = Q.warnings; one.count = Q.params.length;
        res.params = res.params.concat(Q.params);
      }
      res.sheets.push(one);
    });
    return res;
  }
  function headerSignature(det) { return det && det.headers ? det.kind + ':' + det.headers.map(norm).join('|') : ''; }

  /* 발주 기준을 자재에 붙이기 — 자재코드가 같거나, 코드가 없으면 강종+규격이 같으면 */
  function paramIndex(params) {
    var idx = {};
    (params || []).forEach(function (p) {
      if (p.code) idx['C:' + norm(p.code)] = p;
      if (p.grade) idx['G:' + norm(p.grade) + '|' + norm(p.spec)] = p;
    });
    return idx;
  }
  function paramFor(idx, it) {
    return (it.code && idx['C:' + norm(it.code)]) || idx['G:' + norm(it.grade) + '|' + norm(it.spec)] || null;
  }

  /* 엑셀에서 붙여 넣은 발주 기준 줄 — 「자재코드(또는 강종) · 규격 · MOQ · 리드타임(일) · 안전재고(개월) · 발주단위」 */
  function parseParamText(text) {
    var out = { items: [], bad: [] };
    String(text || '').split(/\r?\n/).forEach(function (line, i) {
      if (!line.trim()) return;
      var c = line.split('\t').map(str);
      if (c.length < 3) c = line.trim().split(/\s{2,}|,/).map(str);
      if (/^(자재코드|강종|코드|품번)/.test(c[0])) return; // 머리 줄
      var nums = c.slice(2, 6).map(toNum);
      if (!c[0] || nums.every(function (v) { return v == null || isNaN(v); })) { out.bad.push(i + 1); return; }
      var p = /^[A-Za-z]{1,4}-?\d/.test(c[0]) && !/^(SS|SM|SPHC|SPCC|SAPH|STS|SCM|S\d)/i.test(c[0]) ? { code: c[0], spec: c[1] } : { grade: c[0], spec: c[1] };
      var ok = function (v) { return v != null && !isNaN(v) && v >= 0; };
      if (ok(nums[0])) p.moq = nums[0];
      if (ok(nums[1])) p.ltDays = nums[1];
      if (ok(nums[2])) p.ssMonths = nums[2];
      if (ok(nums[3])) p.lot = nums[3];
      p.key = itemKey(p);
      out.items.push(p);
    });
    return out;
  }
  /* 붙여 넣은 생산대수 줄 — 「년월 · 생산실적 · 생산계획」 */
  function parseProdText(text) {
    var out = { prod: {}, bad: [] };
    String(text || '').split(/\r?\n/).forEach(function (line, i) {
      if (!line.trim()) return;
      var c = line.split(/\t|,/).map(str);
      var ym = ymOf(c[0]);
      if (!ym) { if (!/년월|월|기간/.test(c[0])) out.bad.push(i + 1); return; }
      var o = {}, a = toNum(c[1]), p = toNum(c[2]);
      if (a != null && !isNaN(a) && a >= 0) o.actual = a;
      if (p != null && !isNaN(p) && p >= 0) o.plan = p;
      if (Object.keys(o).length) out.prod[ym] = o; else out.bad.push(i + 1);
    });
    return out;
  }

  /* ── 6. 설정 ──────────────────────────────────────────────── */
  var DEFAULT_SETTINGS = {
    rateWindow: 6,      // 출고 요율을 낼 기간(개월) — 3 분기 · 6 반기 · 12 년간
    ssMonths: 0.5,      // 안전재고 기본값: 차 3개월 평균 예상 출고의 몇 개월분 (기획서 10장 ④ 확인 전 임시)
    ltDays: 30,         // 리드타임 기본값(일)
    moq: 0,             // MOQ 기본값(0 = 없음)
    lot: 0,             // 발주단위 기본값(0 = 없음)
    longMonths: 6,      // 재고가 이 개월 수 이상이면 「장기재고 위험」
    deadMonths: 12,     // 이 개월 수 이상 출고가 없으면 「불용 의심」 (기획서 10장 ⑤ 확인 전 임시)
    cvWarn: 0.5,        // 월별 대당 출고의 변동계수가 이 이상이면 「출고 들쭉날쭉(로트 절단 의심)」
    trendWarn: 1.3      // 분기 요율이 년간 요율의 이 배 이상(또는 1/배 이하)이면 「요율 변화」
  };
  function numOr(v, d, lo, hi) {
    if (v === '' || v == null) return d;
    var n = Number(v);
    if (!isFinite(n) || n < lo || n > hi) return d;
    return n;
  }
  function cleanSettings(p) {
    p = p || {};
    var D = DEFAULT_SETTINGS, s = {};
    s.rateWindow = [3, 6, 12, 24].indexOf(Number(p.rateWindow)) >= 0 ? Number(p.rateWindow) : D.rateWindow;
    s.ssMonths = numOr(p.ssMonths, D.ssMonths, 0, 12);
    s.ltDays = numOr(p.ltDays, D.ltDays, 0, 365);
    s.moq = numOr(p.moq, D.moq, 0, 1e9);
    s.lot = numOr(p.lot, D.lot, 0, 1e9);
    s.longMonths = numOr(p.longMonths, D.longMonths, 1, 60);
    s.deadMonths = Math.round(numOr(p.deadMonths, D.deadMonths, 1, 24));
    s.cvWarn = numOr(p.cvWarn, D.cvWarn, 0.05, 5);
    s.trendWarn = numOr(p.trendWarn, D.trendWarn, 1.05, 10);
    return s;
  }
  function cleanParam(p) {
    var o = {};
    if (!p || typeof p !== 'object') return o;
    [['moq', 1e9], ['ltDays', 365], ['ssMonths', 12], ['ssQty', 1e12], ['lot', 1e9]].forEach(function (a) {
      var v = p[a[0]];
      if (v === '' || v == null) return;
      v = Number(v);
      if (isFinite(v) && v >= 0 && v <= a[1]) o[a[0]] = v;
    });
    return o;
  }
  /* 자재 한 개에 실제로 쓸 기준 — 자재별 값(설정 화면 > 발주 기준 시트 > 수불 시트의 칸) > 기본값 */
  function effParam(it, S, override) {
    var p = Object.assign({}, cleanParam(it.param), cleanParam(it.sheetParam), cleanParam(override));
    return {
      moq: p.moq != null ? p.moq : S.moq,
      ltDays: p.ltDays != null ? p.ltDays : S.ltDays,
      ssMonths: p.ssMonths != null ? p.ssMonths : S.ssMonths,
      ssQty: p.ssQty != null ? p.ssQty : null,
      lot: p.lot != null ? p.lot : S.lot,
      own: Object.keys(p)
    };
  }

  /* ── 7. 자재 한 개 계산 ─────────────────────────────────────
     · 평균 출고: 직전 3·6·12·24개월(당월 제외 — 제출 글 4번) 출고 합 ÷ 개월 수.
     · 출고 요율: 같은 기간 「출고 합 ÷ 생산실적 대수 합」 (월별 요율의 평균이 아니라 대수 가중).
     · 예상 출고 = 요율 × 그 달 생산계획 대수 (계획이 없으면 기간 평균 대수).
     · 굴리기: 1월 기초 = 현재고 + 발주잔량, 기말 = 기초 − 예상 출고, 다음 달 기초 = 이번 달 기말 (새 발주 없이).
     · 리드타임 L = 올림(리드타임 일 ÷ 30) 개월. 지금(기준월 말) 발주하면 M+L 월 말에 들어와 M+L+1 월부터 쓴다고 봅니다(보수적).
     · 우선순위: 빨강 = M+1~M+L 사이에 결품(지금 발주해도 늦음) · 주황 = 이번 달 발주해야 안전재고 유지 · 노랑 = 다음 달 이후 발주 · 초록 = 3개월 안전. */
  var PRIORITY = {
    red: { rank: 0, label: '긴급', color: '빨강', desc: '리드타임 안에 결품 — 지금 발주해도 늦음(긴급 조달·대체 검토)' },
    orange: { rank: 1, label: '이번 달 발주', color: '주황', desc: '이번 달 안에 발주해야 안전재고를 지킴' },
    yellow: { rank: 2, label: '발주 예정', color: '노랑', desc: '3개월 안에 안전재고 아래로 — 표시한 달까지 발주' },
    green: { rank: 3, label: '충분', color: '초록', desc: '3개월 동안 안전재고 위' }
  };
  function windowMonths(base, n) { var a = []; for (var k = 1; k <= n; k++) a.push(ymAdd(base, -k)); return a; }

  function computeItem(it, ctx) {
    var S = ctx.S, base = ctx.base, prod = ctx.prod;
    var hasHist = ctx.hasMonthCols; // 시트에 월별 출고 열이 있으면 빈칸은 0 으로 봅니다
    function avgOf(n) {
      if (!hasHist) return n === 3 ? it.avgQ : n === 6 ? it.avgH : n === 12 ? it.avgY : null;
      var ms = windowMonths(base, n), s = 0, c = 0;
      ms.forEach(function (y) { if (ctx.histMonths[y]) { s += it.out[y] || 0; c++; } });
      return c ? s / c : null;
    }
    function rateOf(n) {
      var ms = windowMonths(base, n);
      if (hasHist) {
        var q = 0, u = 0;
        ms.forEach(function (y) { var a = prod[y] && prod[y].actual; if (a > 0 && ctx.histMonths[y]) { q += it.out[y] || 0; u += a; } });
        return u > 0 ? q / u : null;
      }
      var av = avgOf(n), pu = ctx.avgUnits[n];
      return av != null && pu > 0 ? av / pu : null;
    }
    var avg = { 3: avgOf(3), 6: avgOf(6), 12: avgOf(12), 24: avgOf(24) };
    var rates = { 3: rateOf(3), 6: rateOf(6), 12: rateOf(12), 24: rateOf(24) };
    var W = S.rateWindow, rate = rates[W], rateSrc = '';
    if (rate != null) rateSrc = (hasHist ? '직전 ' + W + '개월 출고 ÷ 생산실적' : '평균 출고 열 ÷ 평균 생산대수');
    else if (it.rate != null && isFinite(it.rate)) { rate = it.rate; rateSrc = '수불 시트의 요율 칸'; }
    // 예상 출고
    var fc = ctx.fmonths.map(function (y) {
      var units = ctx.planUnits[y];
      var issue = rate != null && units != null ? rate * units : avg[W] != null ? avg[W] : avg[12] != null ? avg[12] : 0;
      return { ym: y, units: units, issue: Math.max(0, issue) };
    });
    if (rate == null) rateSrc = avg[W] != null || avg[12] != null ? '생산대수가 없어 평균 출고 그대로' : '출고 기록 없음';
    var sumE = fc.reduce(function (s, f) { return s + f.issue; }, 0), avgE = sumE / HORIZON;
    var P = effParam(it, S, ctx.overrides[it.key]);
    var ss = P.ssQty != null ? P.ssQty : P.ssMonths * avgE;
    var L = P.ltDays > 0 ? Math.ceil(P.ltDays / 30 - 1e-9) : 0;
    // 굴리기 (새 발주 없이)
    var open = (it.stock || 0) + (it.onOrder || 0), roll = [], firstShort = null, firstOut = null, maxOut = 0;
    fc.forEach(function (f, i) {
      var close = open - f.issue;
      var r = { ym: f.ym, units: f.units, open: open, issue: f.issue, close: close, ss: ss, short: Math.max(0, ss - close), stockout: Math.max(0, -close) };
      if (firstShort == null && close < ss - 1e-9) firstShort = i + 1;
      if (firstOut == null && close < -1e-9) firstOut = i + 1;
      if (i + 1 <= L) maxOut = Math.max(maxOut, r.stockout);
      roll.push(r); open = close;
    });
    var deadline = firstShort == null ? null : firstShort - L - 1; // 발주를 넣어야 하는 달(0 = 지금, 기준월)
    var pr = 'green';
    if (firstOut != null && firstOut <= L) pr = 'red';
    else if (firstShort != null && deadline <= 0) pr = 'orange';
    else if (firstShort != null) pr = 'yellow';
    // 권장 발주량 — 3개월 출고 + 안전재고를 채우는 양, MOQ·발주단위 반영
    var need = Math.max(0, ss + sumE - ((it.stock || 0) + (it.onOrder || 0)));
    if (need < 1e-9) need = 0;
    var qty = 0, qtyNoMoq = 0;
    if (need > 0) {
      qty = qtyNoMoq = P.lot > 0 ? Math.ceil(need / P.lot - 1e-9) * P.lot : Math.ceil(need);
      if (P.moq > 0 && qty < P.moq) qty = P.lot > 0 ? Math.ceil(P.moq / P.lot - 1e-9) * P.lot : P.moq;
    }
    var last3 = roll[roll.length - 1].close;
    var coverAfter = avgE > 0 ? (last3 + qty) / avgE : null; // 3개월 뒤 남는 재고가 몇 개월분인지(발주 반영)
    var moqWarn = qty > qtyNoMoq && coverAfter != null && coverAfter >= S.longMonths; // MOQ 가 양을 키워 장기재고가 남는 경우만
    // 변동(로트 절단 영향) — 직전 12개월 월별 「출고 ÷ 생산대수」의 변동계수
    var ratios = [];
    if (hasHist) windowMonths(base, 12).forEach(function (y) { var a = prod[y] && prod[y].actual; if (a > 0 && ctx.histMonths[y]) ratios.push((it.out[y] || 0) / a); });
    var cv = null;
    if (ratios.length >= 6) {
      var mean = ratios.reduce(function (s, v) { return s + v; }, 0) / ratios.length;
      if (mean > 0) cv = Math.sqrt(ratios.reduce(function (s, v) { return s + (v - mean) * (v - mean); }, 0) / (ratios.length - 1)) / mean;
    }
    var trend = rates[3] != null && rates[12] > 0 ? rates[3] / rates[12] : null;
    // 장기·불용 지표
    var lastAgo = null;
    if (it.outNow > 0) lastAgo = 0;
    else if (hasHist) {
      for (var k = 1; k <= 24; k++) { var y = ymAdd(base, -k); if ((it.out[y] || 0) > 0) { lastAgo = k; break; } }
      if (lastAgo == null) lastAgo = Math.max.apply(null, [0].concat(Object.keys(ctx.histMonths).map(function (y) { return ymDiff(y, base); })));
    }
    var monthly = avg[12] != null ? avg[12] : avg[6];
    var cover = (it.stock || 0) <= 0 ? 0 : monthly > 0 ? (it.stock || 0) / monthly : Infinity;
    var dead = [];
    if ((it.stock || 0) > 0 && lastAgo != null && lastAgo >= S.deadMonths) dead.push('dead');
    else if ((it.stock || 0) > 0 && (cover >= S.longMonths || (lastAgo != null && lastAgo >= 6))) dead.push('long');
    if ((it.stock || 0) > 0 && trend != null && trend <= 1 / S.trendWarn) dead.push('down');
    if (moqWarn) dead.push('moq');
    var notes = [];
    if (cv != null && cv >= S.cvWarn && (lastAgo == null || lastAgo < 6)) notes.push('출고 들쭉날쭉(변동 ' + round(cv, 2) + ') — 로트 절단 영향 의심, 안전재고 상향 검토');
    if (trend != null && trend >= S.trendWarn) notes.push('최근 분기 요율이 년간의 ' + round(trend, 2) + '배 — 요율 기간을 짧게 볼지 검토');
    if (moqWarn) notes.push('MOQ ' + fmtNum(P.moq) + ' 때문에 3개월 뒤에도 ' + round(coverAfter, 1) + '개월분이 남음 — 장기재고 위험');
    if (L + 1 > HORIZON) notes.push('리드타임(' + P.ltDays + '일)이 길어 3개월 안에 새 발주가 들어오지 못함 — 계획을 더 길게 봐야 함');
    return {
      key: it.key, code: it.code, grade: it.grade, spec: it.spec, name: itemName(it), unit: it.unit, supplier: it.supplier, price: it.price,
      stock: it.stock || 0, onOrder: it.onOrder || 0, inNow: it.inNow, outNow: it.outNow,
      avg: avg, rates: rates, rate: rate, rateSrc: rateSrc, cv: cv, trend: trend,
      fc: fc, sumE: sumE, avgE: avgE, param: P, ss: ss, L: L, roll: roll,
      firstShort: firstShort, firstOut: firstOut, maxOut: maxOut, deadline: deadline, deadlineYm: deadline == null ? '' : ymAdd(base, Math.max(0, deadline)),
      priority: pr, need: need, qty: qty, coverAfter: coverAfter, moqWarn: moqWarn,
      lastAgo: lastAgo, monthly: monthly, cover: cover, dead: dead, notes: notes,
      value: it.price != null ? (it.stock || 0) * it.price : null
    };
  }

  /* ── 8. 한 번에 — 모든 화면·AI·보고서가 같은 결과를 씁니다 ──── */
  function analyze(db) {
    var S = cleanSettings(db.settings), base = db.base, prod = db.prod || {};
    var out = { S: S, base: base, items: [], warnings: [], fmonths: [], counts: { red: 0, orange: 0, yellow: 0, green: 0 }, deadCounts: { dead: 0, long: 0, down: 0, moq: 0 } };
    if (!base || !(db.items || []).length) return out;
    var fmonths = []; for (var k = 1; k <= HORIZON; k++) fmonths.push(ymAdd(base, k));
    out.fmonths = fmonths;
    // 출고 기록이 있는 달(어느 자재든 월 열이 있던 달)
    var histMonths = {};
    db.items.forEach(function (it) { Object.keys(it.out || {}).forEach(function (y) { histMonths[y] = 1; }); });
    (db.histMonths || []).forEach(function (y) { histMonths[y] = 1; });
    var avgUnits = {};
    [3, 6, 12, 24].forEach(function (n) {
      var s = 0, c = 0; windowMonths(base, n).forEach(function (y) { if (prod[y] && prod[y].actual > 0) { s += prod[y].actual; c++; } });
      avgUnits[n] = c ? s / c : null;
    });
    var planUnits = {}, planMissing = [];
    fmonths.forEach(function (y) {
      var p = prod[y] && prod[y].plan;
      if (p != null) planUnits[y] = p;
      else { planUnits[y] = avgUnits[S.rateWindow] != null ? avgUnits[S.rateWindow] : null; planMissing.push(y); }
    });
    if (planMissing.length) out.warnings.push('생산계획이 없는 달(' + planMissing.map(ymLabel).join(', ') + ')은 ' + (avgUnits[S.rateWindow] != null ? '직전 ' + S.rateWindow + '개월 평균 생산대수(' + fmtNum(avgUnits[S.rateWindow], 1) + '대)로 봅니다.' : '생산대수를 몰라 평균 출고 그대로 봅니다.'));
    if (!Object.keys(prod).some(function (y) { return y < base && prod[y].actual > 0; })) out.warnings.push('생산실적 대수가 없어 출고 요율을 낼 수 없습니다. 평균 출고를 그대로 예상 출고로 씁니다(생산대수 시트를 넣거나 설정에서 붙여 넣어 주세요).');
    var ctx = { S: S, base: base, prod: prod, histMonths: histMonths, hasMonthCols: Object.keys(histMonths).length > 0, avgUnits: avgUnits, planUnits: planUnits, fmonths: fmonths, overrides: db.paramOverrides || {} };
    var pidx = paramIndex(db.params);
    out.items = db.items.map(function (it) {
      var p = paramFor(pidx, it);
      var x = Object.assign({}, it, { sheetParam: p ? cleanParam(p) : {} });
      if (p && p.supplier && !x.supplier) x.supplier = p.supplier;
      return computeItem(x, ctx);
    });
    out.items.sort(function (a, b) {
      return PRIORITY[a.priority].rank - PRIORITY[b.priority].rank || (a.firstOut || 9) - (b.firstOut || 9) || (a.deadline == null ? 99 : a.deadline) - (b.deadline == null ? 99 : b.deadline) || b.need - a.need || cmp(a.name, b.name);
    });
    out.items.forEach(function (x) { out.counts[x.priority]++; x.dead.forEach(function (d) { out.deadCounts[d]++; }); });
    out.avgUnits = avgUnits; out.planUnits = planUnits; out.planMissing = planMissing;
    out.prodRows = Object.keys(prod).sort().filter(function (y) { return y >= ymAdd(base, -24) && y <= fmonths[fmonths.length - 1]; }).map(function (y) { return { ym: y, actual: prod[y].actual, plan: prod[y].plan }; });
    out.orderItems = out.items.filter(function (x) { return x.priority !== 'green'; });
    // 강종별 묶음 — 같은 단위끼리만 더합니다
    var g = {};
    out.items.forEach(function (x) {
      var k = (x.grade || x.name) + '\u0001' + x.unit;
      var a = g[k] || (g[k] = { grade: x.grade || x.name, unit: x.unit, items: 0, order: 0, stock: 0, sumE: 0, short: 0, qty: 0, worst: 'green' });
      a.items++; a.stock += x.stock; a.sumE += x.sumE; a.qty += x.qty; a.short += x.need;
      if (x.priority !== 'green') a.order++;
      if (PRIORITY[x.priority].rank < PRIORITY[a.worst].rank) a.worst = x.priority;
    });
    out.grades = Object.keys(g).map(function (k) { return g[k]; }).sort(function (a, b) { return PRIORITY[a.worst].rank - PRIORITY[b.worst].rank || b.short - a.short; });
    out.totalValue = out.items.some(function (x) { return x.value != null; }) ? out.items.reduce(function (s, x) { return s + (x.value || 0); }, 0) : null;
    out.deadValue = out.totalValue == null ? null : out.items.filter(function (x) { return x.dead.indexOf('dead') >= 0 || x.dead.indexOf('long') >= 0; }).reduce(function (s, x) { return s + (x.value || 0); }, 0);
    return out;
  }
  var DEAD = {
    dead: { label: '불용 의심', desc: '설정한 개월 수 이상 출고 없음' },
    long: { label: '장기재고 위험', desc: '재고가 년간 평균 출고의 설정 개월분 이상이거나 6개월 이상 출고 없음' },
    down: { label: '출고 감소', desc: '최근 분기 요율이 년간 요율보다 뚜렷이 낮음' },
    moq: { label: 'MOQ 과다', desc: 'MOQ 때문에 발주 뒤 장기재고가 남음' }
  };
  function deadText(x) { return x.dead.map(function (d) { return DEAD[d].label; }).join(' · '); }
  function deadlineText(x, base) {
    if (x.priority === 'green') return '-';
    if (x.priority === 'red') return '지금(늦음)';
    if (x.deadline <= 0) return '이번 달(' + ymShort(base) + ')';
    return ymLabel(ymAdd(base, x.deadline)) + '까지';
  }
  function coverText(v) { return v == null ? '-' : v === Infinity ? '출고 없음' : round(v, 1) + '개월'; }
  function agoText(v) { return v == null ? '-' : v === 0 ? '당월' : v + '개월 전'; }

  /* ── 9. 값 가리기 (외부 AI 에 공급사·자재코드를 보내지 않음) ──
     「공급사1」「자재2」 별칭, 대응표는 이 브라우저에만. 강종·규격(SS400 6t 같은 표준 표기)과 수량은 분석에 필요해 그대로 둡니다. */
  var MASK_CATS = { supplier: '공급사', code: '자재' };
  function assignAliases(map, cat, values) {
    var pre = MASK_CATS[cat], out = {}, used = 0;
    var cur = (map && map[cat]) || {};
    Object.keys(cur).forEach(function (v) {
      var m = new RegExp('^' + pre + '(\\d+)$').exec(cur[v]);
      if (m) { out[v] = cur[v]; used = Math.max(used, +m[1]); }
    });
    uniq((values || []).map(str).filter(Boolean)).sort(cmp).forEach(function (v) { if (!out[v]) out[v] = pre + (++used); });
    return out;
  }
  function assignAllAliases(map, items) {
    var o = {};
    Object.keys(MASK_CATS).forEach(function (cat) { o[cat] = assignAliases(map, cat, (items || []).map(function (r) { return r[cat]; })); });
    return o;
  }
  function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\\/-]/g, '\\$&'); }
  function maskable(v) { return /[^0-9]/.test(v) ? v.length >= 2 : v.length >= 6; }
  function unmaskText(text, aliases) {
    var back = {};
    Object.keys(aliases || {}).forEach(function (cat) { Object.keys(aliases[cat] || {}).forEach(function (v) { back[aliases[cat][v]] = v; }); });
    var pres = Object.keys(MASK_CATS).map(function (c) { return MASK_CATS[c]; }).join('|');
    return String(text == null ? '' : text).replace(new RegExp('(' + pres + ')(\\d+)(?![0-9개건종가곳])', 'g'), function (all) { return back[all] || all; });
  }
  function findLeaks(text, aliases) {
    var s = String(text || ''), out = [];
    Object.keys(aliases || {}).forEach(function (cat) {
      Object.keys(aliases[cat] || {}).forEach(function (v) {
        if (!maskable(v)) return;
        var re = new RegExp('(^|[^0-9A-Za-z가-힣])' + escRe(v) + '(?![0-9A-Za-z])');
        if (re.test(s)) out.push(v);
      });
    });
    return uniq(out);
  }

  /* ── 10. AI 프롬프트 — 계산된 사실만 ─────────────────────── */
  function buildAiPrompt(an, aliases) { return buildAiPromptInfo(an, aliases).prompt; }
  function buildAiPromptInfo(an, aliases) {
    var used = {};
    function A(cat, v) {
      if (!v) return '';
      if (!aliases || !aliases[cat] || !aliases[cat][v]) return v;
      (used[cat] || (used[cat] = {}))[v] = aliases[cat][v];
      return aliases[cat][v];
    }
    function nm(x) { return x.name + (x.code ? '(' + A('code', x.code) + ')' : ''); }
    var S = an.S, L = [];
    L.push('너는 제조업 구매팀의 원/부자재 수급 계획 보조야. 아래 [사실]은 입출고 수불 엑셀과 생산계획으로 도구가 계산한 값이야.');
    L.push('[사실]에 있는 숫자만 근거로 삼아줘. 숫자를 새로 만들거나 바꾸지 말아줘.');
    L.push('예상 출고 = 출고 요율(직전 ' + S.rateWindow + '개월 출고 합 ÷ 생산실적 대수 합) × 그 달 생산계획 대수야. 기초재고 = 현재고 + 발주잔량에서 새 발주 없이 굴린 값이야.');
    L.push('리드타임은 「지금 발주하면 리드타임 개월 수 뒤 달 말에 들어와 그다음 달부터 쓴다」로 보수적으로 잡았어.');
    if (aliases) L.push('공급사·자재코드는 보안상 「공급사1」「자재2」 같은 별칭으로 바꿔 두었어. 답에서도 별칭을 그대로 써줘(실제 이름을 짐작하지 말아줘).');
    L.push('');
    L.push('[사실]');
    L.push('- 기준월(당월): ' + an.base + ' · 예상 기간: ' + an.fmonths.join(', '));
    L.push('- 생산계획 대수: ' + an.fmonths.map(function (y) { return y + ' ' + fmtNum(an.planUnits[y], 1) + '대' + (an.planMissing.indexOf(y) >= 0 ? '(계획 없음 → 평균)' : ''); }).join(', ') + ' / 직전 ' + S.rateWindow + '개월 평균 실적 ' + fmtNum(an.avgUnits[S.rateWindow], 1) + '대');
    L.push('- 자재 ' + an.items.length + '종 중 긴급(빨강) ' + an.counts.red + ' · 이번 달 발주(주황) ' + an.counts.orange + ' · 발주 예정(노랑) ' + an.counts.yellow + ' · 충분(초록) ' + an.counts.green);
    L.push('- 발주가 필요한 자재 (우선순위 순):');
    an.orderItems.forEach(function (x, i) {
      L.push('  ' + (i + 1) + '. [' + PRIORITY[x.priority].label + '] ' + nm(x) + (x.supplier ? ' · ' + A('supplier', x.supplier) : '') +
        ' — 현재고 ' + fmtNum(x.stock) + x.unit + (x.onOrder ? ' + 발주잔 ' + fmtNum(x.onOrder) : '') +
        ', 3개월 예상 출고 ' + x.fc.map(function (f) { return fmtNum(f.issue); }).join('/') +
        ', 월말 재고 ' + x.roll.map(function (r) { return fmtNum(r.close); }).join('/') +
        ', 안전재고 ' + fmtNum(x.ss) + ', 리드타임 ' + x.param.ltDays + '일' +
        (x.firstOut ? ', 결품 시작 M+' + x.firstOut : '') + ', 발주 마감 ' + deadlineText(x, an.base) +
        ', 권장 발주 ' + fmtNum(x.qty) + x.unit + '(필요 ' + fmtNum(x.need) + (x.param.moq ? ', MOQ ' + fmtNum(x.param.moq) : '') + (x.param.lot ? ', 발주단위 ' + fmtNum(x.param.lot) : '') + ')' +
        (x.notes.length ? ' / 참고: ' + x.notes.join('; ') : ''));
    });
    if (!an.orderItems.length) L.push('  (없음)');
    var dl = an.items.filter(function (x) { return x.dead.length; });
    L.push('- 장기·불용 재고 지표 (재고 개월수 = 현재고 ÷ 년간 평균 출고, 기준: 장기 ' + S.longMonths + '개월 · 불용 ' + S.deadMonths + '개월 무출고):');
    dl.forEach(function (x) {
      L.push('  · ' + nm(x) + ' — 현재고 ' + fmtNum(x.stock) + x.unit + ', 재고 ' + coverText(x.cover) + ', 마지막 출고 ' + agoText(x.lastAgo) + ', 판정 ' + deadText(x) + (x.trend != null ? ', 분기/년간 요율 ' + round(x.trend, 2) + '배' : ''));
    });
    if (!dl.length) L.push('  (해당 없음)');
    var vol = an.items.filter(function (x) { return x.cv != null && x.cv >= S.cvWarn; });
    if (vol.length) L.push('- 월별 출고가 들쭉날쭉한 자재(로트 절단 영향 의심, 변동계수 ' + S.cvWarn + ' 이상): ' + vol.map(function (x) { return nm(x) + ' ' + round(x.cv, 2); }).join(', '));
    L.push('');
    L.push('[요청] 다음 순서로 한국어로 짧게 정리해줘.');
    L.push('1. 한 줄 요약 (이번 달 꼭 발주할 자재 수와 긴급 자재)');
    L.push('2. 긴급·이번 달 발주 자재별로 할 일 (긴급 조달·대체 규격·분할 입고 요청 등, 근거 숫자 인용)');
    L.push('3. 들쭉날쭉한 자재의 안전재고를 어떻게 잡을지 제안 (로트 절단 계획과 함께 볼 점)');
    L.push('4. 장기·불용 재고를 줄이거나 더 만들지 않기 위해 할 일 (MOQ 협의, 대체 사용, 발주 보류 등)');
    L.push('5. 이 계산을 믿기 전에 현장·수불에서 확인할 것');
    L.push('확실하지 않은 것은 「확인 필요」라고 적어줘.');
    var text = L.join('\n');
    return { prompt: text, map: used, leaks: aliases ? findLeaks(text, aliases) : [] };
  }

  /* ── 11. 보고서 (글자) ────────────────────────────────────── */
  function buildReport(an, aiText) {
    var S = an.S, L = [];
    L.push('원/부자재 발주 계획 보고 — 기준월 ' + ymLabel(an.base) + ' (예상 ' + an.fmonths.map(ymShort).join('·') + ')');
    L.push('');
    L.push('1. 총괄');
    L.push('  - 자재 ' + an.items.length + '종: 긴급 ' + an.counts.red + ' · 이번 달 발주 ' + an.counts.orange + ' · 발주 예정 ' + an.counts.yellow + ' · 충분 ' + an.counts.green);
    L.push('  - 장기·불용 지표: 불용 의심 ' + an.deadCounts.dead + ' · 장기재고 위험 ' + an.deadCounts.long + ' · 출고 감소 ' + an.deadCounts.down + ' · MOQ 과다 ' + an.deadCounts.moq);
    L.push('');
    L.push('2. 계산 기준');
    L.push('  - 출고 요율: 직전 ' + S.rateWindow + '개월 출고 합 ÷ 생산실적 대수 합 (당월 제외)');
    L.push('  - 생산계획: ' + an.fmonths.map(function (y) { return ymShort(y) + ' ' + fmtNum(an.planUnits[y], 1) + '대' + (an.planMissing.indexOf(y) >= 0 ? '(평균)' : ''); }).join(', '));
    L.push('  - 안전재고 기본 ' + S.ssMonths + '개월분 · 리드타임 기본 ' + S.ltDays + '일 (자재별 값이 있으면 그 값)');
    L.push('');
    L.push('3. 발주 리스트 (우선순위 순)');
    if (!an.orderItems.length) L.push('  - 3개월 안에 발주할 자재가 없습니다.');
    an.orderItems.forEach(function (x) {
      L.push('  - [' + PRIORITY[x.priority].color + '·' + PRIORITY[x.priority].label + '] ' + x.name + (x.code ? ' (' + x.code + ')' : '') + (x.supplier ? ' / ' + x.supplier : '') +
        ': 권장 ' + fmtNum(x.qty) + x.unit + ' · 마감 ' + deadlineText(x, an.base) + (x.firstOut ? ' · M+' + x.firstOut + ' 결품 예상' : '') + (x.notes.length ? ' · ' + x.notes[0] : ''));
    });
    L.push('');
    L.push('4. 강종별 부족량');
    an.grades.filter(function (g) { return g.order; }).forEach(function (g) {
      L.push('  - ' + g.grade + ': 발주 필요 ' + g.order + '/' + g.items + '종 · 필요량 ' + fmtNum(g.short) + g.unit + ' · 권장 발주 ' + fmtNum(g.qty) + g.unit);
    });
    L.push('');
    L.push('5. 장기·불용 재고 지표');
    var dl = an.items.filter(function (x) { return x.dead.length; });
    if (!dl.length) L.push('  - 해당 없음');
    dl.forEach(function (x) { L.push('  - ' + x.name + ': ' + deadText(x) + ' (재고 ' + coverText(x.cover) + ', 마지막 출고 ' + agoText(x.lastAgo) + ')'); });
    L.push('  ※ 계산은 수불 기록과 생산계획만으로 한 것입니다. 로트 절단 계획·대체 규격 사용은 현장 확인이 필요합니다.');
    if (aiText && str(aiText)) {
      L.push('');
      L.push('6. AI 검토 의견 (검토 후 사용)');
      str(aiText).split('\n').forEach(function (s) { L.push('  ' + s); });
    }
    return L.join('\n');
  }

  /* ── 12. 엑셀 내보내기용 표 ──────────────────────────────── */
  function orderToAoa(an, all) {
    var ms = an.fmonths;
    var aoa = [['발주 리스트 — 기준월 ' + an.base + ' (우선순위 색: 빨강 긴급 · 주황 이번 달 · 노랑 예정 · 초록 충분)'],
      ['우선순위', '색', '자재코드', '강종', '규격', '단위', '공급사', '현재고', '발주잔량'].concat(ms.map(function (y) { return y + ' 예상 출고'; })).concat(ms.map(function (y) { return y + ' 월말 재고'; }))
        .concat(['안전재고', '리드타임(일)', '첫 부족 월', '결품 시작 월', '발주 마감', '필요량', 'MOQ', '발주단위', '권장 발주량', '참고'])];
    an.items.filter(function (x) { return all || x.priority !== 'green'; }).forEach(function (x) {
      aoa.push([PRIORITY[x.priority].label, PRIORITY[x.priority].color, x.code, x.grade, x.spec, x.unit, x.supplier, round(x.stock, 1), round(x.onOrder, 1)]
        .concat(x.fc.map(function (f) { return round(f.issue, 1); })).concat(x.roll.map(function (r) { return round(r.close, 1); }))
        .concat([round(x.ss, 1), x.param.ltDays, x.firstShort ? ms[x.firstShort - 1] : '', x.firstOut ? ms[x.firstOut - 1] : '', deadlineText(x, an.base), round(x.need, 1), x.param.moq || '', x.param.lot || '', x.qty, x.notes.join(' / ')]));
    });
    return aoa;
  }
  function rollToAoa(an) {
    var aoa = [['월별 기초재고 굴리기 (새 발주 없이)'], ['자재코드', '강종', '규격', '단위', '월', '생산계획(대)', '기초재고', '예상 출고', '기말재고', '안전재고', '안전재고 대비 부족', '결품량']];
    an.items.forEach(function (x) {
      x.roll.forEach(function (r) { aoa.push([x.code, x.grade, x.spec, x.unit, r.ym, r.units == null ? '' : round(r.units, 1), round(r.open, 1), round(r.issue, 1), round(r.close, 1), round(r.ss, 1), round(r.short, 1), round(r.stockout, 1)]); });
    });
    return aoa;
  }
  function rateToAoa(an) {
    var aoa = [['출고 요율 · 평균 출고 (당월 제외)'], ['자재코드', '강종', '규격', '단위', '분기 평균', '반기 평균', '년간 평균', '분기 요율(대당)', '반기 요율', '년간 요율', '쓰는 요율', '요율 출처', '변동계수', '분기/년간']];
    an.items.forEach(function (x) {
      var r = function (v, d) { return v == null ? '' : round(v, d); };
      aoa.push([x.code, x.grade, x.spec, x.unit, r(x.avg[3], 1), r(x.avg[6], 1), r(x.avg[12], 1), r(x.rates[3], 3), r(x.rates[6], 3), r(x.rates[12], 3), r(x.rate, 3), x.rateSrc, r(x.cv, 2), r(x.trend, 2)]);
    });
    return aoa;
  }
  function deadToAoa(an) {
    var aoa = [['장기·불용 재고 지표'], ['자재코드', '강종', '규격', '단위', '현재고', '년간 평균 출고', '재고 개월수', '마지막 출고', '분기/년간 요율', '재고 금액', '판정']];
    an.items.slice().sort(function (a, b) { return (b.cover === Infinity ? 1e9 : b.cover) - (a.cover === Infinity ? 1e9 : a.cover); }).forEach(function (x) {
      aoa.push([x.code, x.grade, x.spec, x.unit, round(x.stock, 1), x.monthly == null ? '' : round(x.monthly, 1), coverText(x.cover), agoText(x.lastAgo), x.trend == null ? '' : round(x.trend, 2), x.value == null ? '' : Math.round(x.value), deadText(x)]);
    });
    return aoa;
  }

  /* ── 13. 저장 형식 ─────────────────────────────────────────── */
  function emptyDb() {
    return { schemaVersion: SCHEMA_VERSION, base: '', items: [], prod: {}, params: [], paramOverrides: {}, histMonths: [], files: [], settings: cleanSettings({}), aliases: {}, mask: true, aiNotes: {}, sample: false };
  }
  function restoreDb(o) {
    var db = emptyDb();
    if (!o || typeof o !== 'object') return db;
    if (/^\d{4}-\d\d$/.test(o.base || '')) db.base = o.base;
    if (Array.isArray(o.items)) db.items = o.items.filter(function (it) { return it && (it.code || it.grade) && isFinite(it.stock); }).map(function (it) {
      it.out = it.out && typeof it.out === 'object' ? it.out : {}; it.inq = it.inq && typeof it.inq === 'object' ? it.inq : {}; it.param = cleanParam(it.param);
      it.key = itemKey(it); it.unit = it.unit || 'kg';
      return it;
    });
    if (o.prod && typeof o.prod === 'object') Object.keys(o.prod).forEach(function (y) {
      if (!/^\d{4}-\d\d$/.test(y) || !o.prod[y]) return;
      var v = {}; ['actual', 'plan'].forEach(function (k) { var n = Number(o.prod[y][k]); if (o.prod[y][k] != null && isFinite(n) && n >= 0) v[k] = n; });
      if (Object.keys(v).length) db.prod[y] = v;
    });
    if (Array.isArray(o.params)) db.params = o.params.filter(function (p) { return p && (p.code || p.grade); }).map(function (p) { var c = cleanParam(p); c.code = str(p.code); c.grade = str(p.grade); c.spec = str(p.spec); if (p.supplier) c.supplier = str(p.supplier); c.key = itemKey(c); return c; });
    if (o.paramOverrides && typeof o.paramOverrides === 'object') Object.keys(o.paramOverrides).forEach(function (k) { var c = cleanParam(o.paramOverrides[k]); if (Object.keys(c).length) db.paramOverrides[k] = c; });
    if (Array.isArray(o.histMonths)) db.histMonths = o.histMonths.filter(function (y) { return /^\d{4}-\d\d$/.test(y); });
    if (Array.isArray(o.files)) db.files = o.files;
    db.settings = cleanSettings(o.settings || {});
    if (o.aliases && typeof o.aliases === 'object') Object.keys(MASK_CATS).forEach(function (c) { var a = assignAliases(o.aliases, c, []); if (Object.keys(a).length) db.aliases[c] = a; });
    if (o.mask === false) db.mask = false;
    if (o.aiNotes && typeof o.aiNotes === 'object') db.aiNotes = o.aiNotes;
    db.sample = !!o.sample;
    return db;
  }

  return {
    SCHEMA_VERSION: SCHEMA_VERSION, VERSION: VERSION, HORIZON: HORIZON, KINDS: KINDS, LEDGER_FIELDS: LEDGER_FIELDS, PROD_FIELDS: PROD_FIELDS, PARAM_FIELDS: PARAM_FIELDS,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS, PRIORITY: PRIORITY, DEAD: DEAD, MASK_CATS: MASK_CATS,
    norm: norm, toNum: toNum, round: round, fmtNum: fmtNum, pctText: pctText, colName: colName,
    ymOf: ymOf, ymAdd: ymAdd, ymDiff: ymDiff, ymLabel: ymLabel, ymShort: ymShort,
    matchField: matchField, monthHeader: monthHeader, detectSheet: detectSheet, classifySheet: classifySheet,
    parseLedger: parseLedger, parseProduction: parseProduction, parseParams: parseParams, parseWorkbook: parseWorkbook, headerSignature: headerSignature,
    itemKey: itemKey, itemName: itemName, paramIndex: paramIndex, paramFor: paramFor, parseParamText: parseParamText, parseProdText: parseProdText,
    cleanSettings: cleanSettings, cleanParam: cleanParam, effParam: effParam, computeItem: computeItem, analyze: analyze,
    deadText: deadText, deadlineText: deadlineText, coverText: coverText, agoText: agoText,
    assignAliases: assignAliases, assignAllAliases: assignAllAliases, unmaskText: unmaskText, findLeaks: findLeaks,
    buildAiPrompt: buildAiPrompt, buildAiPromptInfo: buildAiPromptInfo, buildReport: buildReport,
    orderToAoa: orderToAoa, rollToAoa: rollToAoa, rateToAoa: rateToAoa, deadToAoa: deadToAoa,
    emptyDb: emptyDb, restoreDb: restoreDb
  };
});
