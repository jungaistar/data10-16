/* 원/부자재 미결 방지 사전 관리 — 화면
   계산은 js/logic.js(MRLogic), 그래프는 js/charts.js, 저장은 js/store.js, AI 연결은 js/ai-endpoint.js·ai-panel.js.
   뼈대(가져오기·열 연결·AI 패널·보고서 내보내기)는 data10-11 에서 가져왔습니다. */
(function () {
  'use strict';
  var L = window.MRLogic, S = window.MRStore, C = window.MRCharts, AIP = window.AIPanel;
  /* 판 맞추기 — 브라우저가 옛 logic.js 와 새 app.js 를 섞어 쓰면(Pages 캐시) 단추와 결과가 어긋날 수 있어, 섞였으면 계산하지 않고 새로고침을 안내합니다.
     판은 scripts/bump-version.mjs 로 index.html(?v=) · logic.js · sample-data.js 와 함께 올립니다. */
  var APP_VERSION = '2026-11-11.6';
  var mixed = [['js/logic.js', L], ['js/sample-data.js', window.MRSample]].filter(function (x) { return !x[1] || x[1].VERSION !== APP_VERSION; });
  if (mixed.length || !S || !C || !AIP) {
    var m0 = document.getElementById('main');
    m0.innerHTML = '';
    var box = document.createElement('section'); box.className = 'card'; box.id = 'versionMismatch';
    box.innerHTML = '<h1>새 판이 나왔습니다 — 새로고침(Ctrl+F5)해 주세요</h1><p class="alert warn">이 브라우저가 옛 파일과 새 파일을 섞어 불러왔습니다(' +
      mixed.map(function (x) { return x[0] + ' ' + (x[1] && x[1].VERSION ? x[1].VERSION : '옛 판'); }).join(', ') + ' · 화면 ' + APP_VERSION + '). 이대로 계산하면 단추와 결과가 어긋날 수 있어 멈췄습니다.</p>' +
      '<p>Windows 는 <b>Ctrl+F5</b>, Mac 은 <b>Cmd+Shift+R</b> 을 한 번 눌러 주세요. 쌓아 둔 자료는 지워지지 않습니다.</p>';
    m0.appendChild(box);
    return;
  }
  var db = S.loadDb();
  var ui = { pending: [], errors: [], progress: '', orderView: 'need' };
  var main = document.getElementById('main');

  /* ── 작은 도구 ───────────────────────────── */
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  /* 이 PC 시각(예전에는 toISOString 이라 한국 시각보다 9시간 이른 UTC 가 「가져온 때」에 찍혔습니다) */
  function localStamp(dateOnly) { var d = new Date(); var s = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); return dateOnly ? s : s + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
  function h(tag, attrs) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') e.className = v;
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else if (v === true) e.setAttribute(k, '');
      else e.setAttribute(k, v);
    });
    for (var i = 2; i < arguments.length; i++) add(e, arguments[i]);
    return e;
  }
  function add(e, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { add(e, x); }); return; }
    e.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
  }
  function fld(label, control, hint) {
    return h('label', { class: 'field' }, h('span', null, label), control, hint ? h('small', { class: 'hint' }, hint) : null);
  }
  var toastTimer = null;
  function toast(msg, err) {
    var t = document.getElementById('toast');
    t.textContent = msg; t.className = 'toast' + (err ? ' error' : ''); t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 3500);
  }
  function save() {
    var ok = S.saveDb(db);
    document.getElementById('storeNote').textContent = ok ? '이 브라우저에 저장됨 · ' + S.sizeKb() + 'KB' : '저장 안 됨(브라우저 저장소가 막혔거나 가득 참) — JSON 백업을 받아 두세요';
    return ok;
  }
  var N = L.fmtNum;
  function download(name, blob) {
    var a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function copyText(t) {
    function fallback() { var ta = h('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); toast('복사했습니다.'); } catch (e) { toast('복사하지 못했습니다. 직접 선택해 복사해 주세요.', true); } ta.remove(); }
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(t).then(function () { toast('복사했습니다.'); }, fallback); else fallback();
  }
  function pageHead(stage, title, lead, right) {
    return h('div', { class: 'page-head' }, h('div', { class: 'titles' }, h('div', { class: 'stage' }, stage), h('h1', null, title), lead ? h('p', { class: 'lead' }, lead) : null), right || null);
  }
  function emptyNotice() {
    return h('section', { class: 'card empty' },
      h('p', null, '아직 가져온 수불 현황이 없습니다.'),
      h('p', null, '입출고 수불 엑셀을 가져오거나, 가상 샘플로 먼저 둘러봐 주세요.'),
      h('div', { class: 'btn-row', style: 'justify-content:center' },
        h('a', { class: 'btn btn-primary', href: '#/import' }, '데이터 가져오기로'),
        h('button', { type: 'button', class: 'btn', onclick: loadSample }, '샘플로 시작')));
  }
  function tile(k, v, sub, cls) { return h('div', { class: 'tile' + (cls ? ' t-' + cls : '') }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v), sub ? h('div', { class: 'note' }, sub) : null); }
  function table(head, rows, opts) {
    opts = opts || {};
    var t = h('table', { class: 'list' + (opts.cls ? ' ' + opts.cls : '') });
    var tr = h('tr');
    head.forEach(function (x, i) { tr.appendChild(h('th', { class: opts.num && opts.num[i] ? 'num' : null, scope: 'col' }, x)); });
    t.appendChild(h('thead', null, tr));
    var tb = h('tbody');
    rows.forEach(function (r) {
      var row = h('tr', { class: r.cls || null });
      (r.cells || r).forEach(function (x, i) { row.appendChild(h('td', { class: ((opts.num && opts.num[i] ? 'num' : '') + (r.tdCls && r.tdCls[i] ? ' ' + r.tdCls[i] : '')) || null }, x)); });
      tb.appendChild(row);
    });
    t.appendChild(tb);
    return h('div', { class: 'table-wrap' }, t);
  }
  function chip(pr) { var P = L.PRIORITY[pr]; return h('span', { class: 'pr pr-' + pr, title: P.desc }, P.color + ' · ' + P.label); }
  function itemCell(x) { return h('span', null, h('strong', null, x.name), x.code ? h('small', { class: 'code' }, ' ' + x.code) : null); }
  function q(v, x) { return N(v) + (x && x.unit && x.unit !== 'kg' ? ' ' + x.unit : ''); }
  function analysis() { return L.analyze(db); }
  function has() { return db.items.length > 0 && !!db.base; }

  /* ── 가져오기 ───────────────────────────── */
  function readFile(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () {
        try { resolve(prepare(file.name, XLSX.read(new Uint8Array(fr.result), { type: 'array', cellDates: true }))); }
        catch (e) { reject(new Error(file.name + ': 엑셀로 읽지 못했습니다(' + e.message + ')')); }
      };
      fr.onerror = function () { reject(new Error(file.name + ': 파일을 읽지 못했습니다.')); };
      fr.readAsArrayBuffer(file);
    });
  }
  function prepare(name, wb) {
    var sheets = wb.SheetNames.map(function (n) { return { name: n, aoa: XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null }) }; });
    var item = { fileName: name, sheets: sheets, kinds: {}, overrides: {}, base: '' };
    reparse(item);
    // 처음 가른 종류를 고정해 두면 열 연결을 고쳐도 종류가 흔들리지 않습니다
    item.result.sheets.forEach(function (s) { item.kinds[s.name] = s.kind; });
    return item;
  }
  function reparse(item) { item.result = L.parseWorkbook(item.sheets, { kinds: item.kinds, overrides: item.overrides, base: item.base, fileName: item.fileName }); }
  function fileId(f) { return f.name + '|' + f.size + '|' + (f.lastModified || 0); }
  function handleFiles(list) {
    var all = Array.prototype.slice.call(list || []), skipped = [], batch = {};
    var files = all.filter(function (f) {
      if (batch[fileId(f)]) { skipped.push(f.name + ' (같은 파일을 두 번 고름)'); return false; }
      batch[fileId(f)] = 1;
      if (/^~\$/.test(f.name)) { skipped.push(f.name + ' (엑셀 잠금 파일)'); return false; }
      if (!/\.(xlsx|xlsm|xls|csv)$/i.test(f.name)) { if (!/^\./.test(f.name)) skipped.push(f.name + ' (엑셀 아님)'); return false; }
      if (ui.pending.some(function (p) { return p.fid === fileId(f); })) { skipped.push(f.name + ' (이미 올려 둠)'); return false; }
      return true;
    });
    if (!files.length) { toast(skipped.length ? '가져올 엑셀이 없습니다(' + skipped.length + '개 건너뜀).' : '엑셀 파일(.xlsx·.xls·.csv)을 골라 주세요.', true); return; }
    ui.errors = skipped.map(function (x) { return '건너뜀: ' + x; });
    var i = 0;
    (function next() {
      if (i >= files.length) { ui.progress = ''; render(); toast(files.length + '개 파일을 읽었습니다. 아래에서 확인한 뒤 반영해 주세요.'); return; }
      var f = files[i++];
      ui.progress = '읽는 중 ' + i + ' / ' + files.length + ' — ' + f.name;
      var pr = document.getElementById('importProgress'); if (pr) pr.textContent = ui.progress;
      readFile(f).then(function (it) { it.fid = fileId(f); ui.pending.push(it); }, function (e) { ui.errors.push(e.message); }).then(function () { setTimeout(next, 0); });
    })();
  }
  function blocked(it) {
    return it.result.sheets.some(function (s) { return s.kind !== 'skip' && s.det && s.det.missing.length; }) ||
      it.result.sheets.some(function (s) { return s.kind === 'ledger' && !s.base; }) ||
      !it.result.sheets.some(function (s) { return s.kind !== 'skip'; });
  }
  function commit(items) {
    var ledgerItems = [], ok = 0, base = '', hist = {}, prodN = 0, paramN = 0;
    items.forEach(function (it) {
      var r = it.result;
      if (r.items.length) { ledgerItems = ledgerItems.concat(r.items); base = base || r.base; }
      r.sheets.forEach(function (s) { (s.monthCols || []).forEach(function (c) { if (c.kind === 'out' && c.ym < s.base) hist[c.ym] = 1; }); });
      Object.keys(r.prod).forEach(function (y) { db.prod[y] = Object.assign(db.prod[y] || {}, r.prod[y]); prodN++; });
      if (r.params.length) {
        var byKey = {}; db.params.forEach(function (p) { byKey[p.key] = p; });
        r.params.forEach(function (p) { byKey[p.key] = p; paramN++; });
        db.params = Object.keys(byKey).map(function (k) { return byKey[k]; });
      }
      db.files.push({ name: it.fileName, sheets: r.sheets.filter(function (s) { return s.kind !== 'skip'; }).map(function (s) { return s.name + '(' + L.KINDS[s.kind].label.split('(')[0] + ')'; }).join(', '), at: localStamp() });
      ok++;
    });
    if (ledgerItems.length) {
      var byKey = {}, order = [];
      ledgerItems.forEach(function (x) { if (!byKey[x.key]) order.push(x.key); byKey[x.key] = x; });
      db.items = order.map(function (k) { return byKey[k]; });
      db.base = base; db.histMonths = Object.keys(hist).sort();
    }
    db.sample = items.every(function (it) { return it.sample; });
    ui.pending = ui.pending.filter(function (p) { return items.indexOf(p) < 0; });
    ui.errors = [];
    save();
    toast(ok + '개 파일 반영 — ' + (ledgerItems.length ? '자재 ' + db.items.length + '종(기준월 ' + db.base + ')' : '수불 현황 없음') + (prodN ? ' · 생산대수 ' + prodN + '개월' : '') + (paramN ? ' · 발주 기준 ' + paramN + '건' : ''));
    render();
  }
  function loadSample() {
    var b = window.MRSample.build();
    db = L.emptyDb();
    // 앱이 실제 파일을 읽을 때와 같은 길로 — 엑셀 통합문서로 만들었다가 다시 읽습니다
    var wb = XLSX.utils.book_new();
    b.sheets.forEach(function (s) { XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s.aoa), s.name); });
    var back = XLSX.read(XLSX.write(wb, { bookType: 'xlsx', type: 'array' }), { type: 'array', cellDates: true });
    var it = prepare(b.fileName, back); it.sample = true;
    ui.pending = [];
    commit([it]);
    location.hash = '#/order';
  }

  function pageImport() {
    var input = h('input', { type: 'file', multiple: true, accept: '.xlsx,.xlsm,.xls,.csv' });
    input.addEventListener('change', function () { handleFiles(input.files); input.value = ''; });
    var drop = h('div', { class: 'drop' },
      h('label', { class: 'btn btn-primary' }, input, '수불 엑셀 고르기(여러 개 가능)'),
      h('span', { class: 'note' }, '또는 파일을 여기로 끌어다 놓아 주세요. 수불 현황 · 생산대수 · 발주 기준이 시트로 나뉘어 있어도, 파일로 나뉘어 있어도 됩니다.'));
    drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', function () { drop.classList.remove('over'); });
    drop.addEventListener('drop', function (e) { e.preventDefault(); drop.classList.remove('over'); handleFiles(e.dataTransfer.files); });

    var out = [pageHead('데이터', '수불 엑셀 가져오기', '입출고 수불 엑셀을 그대로 넣어 주세요. 시트마다 수불 현황(강종·규격·현재고·당월 입출고·직전 1~24개월 출고)인지, 생산대수(실적·계획)인지, 발주 기준(MOQ·리드타임·안전재고)인지 알아서 가르고 머리행을 찾습니다.'),
      h('section', { class: 'card' }, h('h2', null, '1. 파일 넣기'), drop,
        h('div', { class: 'btn-row' },
          h('button', { type: 'button', class: 'btn', onclick: function () { if (!db.items.length || confirm('지금 데이터를 지우고 가상 샘플을 불러올까요?')) loadSample(); } }, '샘플로 시작'),
          h('a', { class: 'btn', href: 'samples/' + encodeURIComponent('수불_샘플_2026-10.xlsx'), download: '' }, '샘플 파일 내려받기')),
        h('ul', { class: 'note' },
          h('li', null, '열 이름이 조금 달라도(「재질」「품번」「현재재고(kg)」「L/T」 등) 찾습니다. 못 찾은 열은 아래 「열 연결」에서 골라 주세요.'),
          h('li', null, '월별 출고 열은 「2026-09」「25.10 출고」「M-1」「직전 3개월」처럼 적힌 머리를 읽고, 윗줄에 「출고 실적」「입고 실적」 묶음 머리가 있으면 그것으로 출고·입고를 가릅니다.'),
          h('li', null, '기준월(당월)은 제목 줄(「2026년 10월」「기준월: 2026-10」)에서 찾고, 없으면 가장 늦은 월 열의 다음 달로 봅니다. 아래에서 고칠 수 있습니다.'),
          h('li', null, '「합계」「소계」 줄은 빼고, 같은 자재가 두 줄이면(로트·창고별) 수량을 더합니다.'),
          h('li', null, '파일은 서버로 보내지 않고 이 브라우저 안에서만 읽습니다.')),
        h('p', { class: 'note', id: 'importProgress', 'aria-live': 'polite' }, ui.progress || ''),
        ui.errors.length ? h('details', { class: 'warn-list', open: true }, h('summary', null, '읽지 못했거나 건너뛴 파일 ' + ui.errors.length + '개'),
          h('ul', null, ui.errors.map(function (e) { return h('li', null, e); }))) : null)];

    if (ui.pending.length) {
      var ready = ui.pending.filter(function (it) { return !blocked(it); });
      var box = h('section', { class: 'card' }, h('h2', null, '2. 시트 · 열 연결 확인 후 반영 (' + ui.pending.length + '개 파일)'));
      ui.pending.forEach(function (it) { box.appendChild(pendingCard(it)); });
      box.appendChild(h('p', { class: 'note' }, '수불 현황을 반영하면 자재 목록과 기준월이 새 파일로 바뀝니다(이전 수불은 지워짐). 생산대수·발주 기준은 같은 달·같은 자재만 새 값으로 바뀌고 나머지는 남습니다.'));
      box.appendChild(h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn btn-primary', disabled: !ready.length, onclick: function () { if (!db.items.length || !ready.some(function (x) { return x.result.items.length; }) || confirm('지금 수불 현황(' + db.items.length + '종, 기준월 ' + db.base + ')을 새 파일로 바꿀까요?')) commit(ready); } }, '확인한 ' + ready.length + '개 파일 반영'),
        h('button', { type: 'button', class: 'btn', onclick: function () { ui.pending = []; render(); } }, '취소')));
      out.push(box);
    }

    var an = has() ? analysis() : null;
    out.push(h('section', { class: 'card' }, h('h2', null, '지금 들어 있는 데이터'),
      db.items.length ? h('div', null,
        h('div', { class: 'tiles' },
          tile('기준월(당월)', L.ymLabel(db.base), '예상: ' + (an ? an.fmonths.map(L.ymShort).join(' · ') : '-')),
          tile('자재', N(db.items.length) + '종', '월별 출고 ' + db.histMonths.length + '개월 치'),
          tile('생산대수', Object.keys(db.prod).length + '개월', an && an.planMissing.length ? '계획 없는 달 ' + an.planMissing.length + '개' : '차 3개월 계획 있음'),
          tile('발주 기준', db.params.length + '건', '자재별 직접 고친 값 ' + Object.keys(db.paramOverrides).length + '건')),
        an && an.warnings.length ? an.warnings.map(function (w) { return h('p', { class: 'alert warn' }, w); }) : null,
        h('details', null, h('summary', null, '가져온 파일 ' + db.files.length + '개 보기'),
          table(['가져온 파일', '쓴 시트', '가져온 때'], db.files.slice().reverse().map(function (f) { return [f.name, f.sheets, f.at]; }))),
        h('div', { class: 'btn-row', style: 'margin-top:12px' },
          h('button', { type: 'button', class: 'btn btn-danger', onclick: function () {
            if (!confirm('이 브라우저에 있는 수불·생산대수·발주 기준·설정을 모두 지울까요? (되돌릴 수 없습니다. 먼저 설정 화면에서 JSON 백업을 받아 두면 안전합니다)')) return;
            db = L.emptyDb(); S.clearDb(); save(); render();
          } }, '모든 데이터 지우기')))
        : h('p', { class: 'note' }, '아직 없습니다.')));
    return out;
  }
  function pendingCard(it) {
    var r = it.result;
    var parts = r.sheets.map(function (s) {
      var sh = it.sheets.filter(function (x) { return x.name === s.name; })[0];
      var kindSel = h('select', { 'aria-label': s.name + ' 시트 종류' });
      [['ledger', '수불 현황'], ['prod', '생산대수'], ['params', '발주 기준'], ['skip', '쓰지 않음']].forEach(function (k) { var o = h('option', { value: k[0] }, k[1]); if (k[0] === s.kind) o.selected = true; kindSel.appendChild(o); });
      kindSel.addEventListener('change', function () { it.kinds[s.name] = kindSel.value; delete it.overrides[s.name]; reparse(it); render(); });
      var body = [fld('시트 「' + s.name + '」 종류', kindSel)];
      if (s.kind !== 'skip' && s.det) {
        var det = s.det, hdr = det.headers || [], ex = sh.aoa[det.headerRow + 1] || [];
        body.push(h('p', { class: 'note' }, det.headerRow < 0 ? '머리행을 못 찾음' : '머리행 ' + (det.headerRow + 1) + '행' + (det.groupRow >= 0 ? '(윗줄 묶음 머리 ' + (det.groupRow + 1) + '행)' : '') + ' · 읽은 ' + (s.kind === 'ledger' ? '자재 ' : s.kind === 'prod' ? '달 ' : '기준 ') + s.count + (s.skipped ? ' · 건너뛴 행 ' + s.skipped : '') + (s.summary ? ' · 합계 줄 ' + s.summary : '')));
        if (s.kind === 'ledger') {
          var outs = (s.monthCols || []).filter(function (c) { return c.kind === 'out'; }).map(function (c) { return c.ym; }).sort();
          var ins = (s.monthCols || []).filter(function (c) { return c.kind === 'in'; }).length;
          var baseIn = h('input', { type: 'month', value: it.base || s.base || '' });
          baseIn.addEventListener('change', function () { it.base = baseIn.value; reparse(it); render(); });
          body.push(h('div', { class: 'form-grid' },
            fld('기준월(당월)', baseIn, s.base ? '찾은 곳: ' + s.baseFrom : '찾지 못했습니다 — 넣어 주세요'),
            h('div', { class: 'field' }, h('span', null, '월별 열'), h('div', null, '출고 ' + outs.length + '개월' + (outs.length ? ' (' + outs[0] + ' ~ ' + outs[outs.length - 1] + ')' : '') + ' · 입고(참고) ' + ins + '개월'))));
        }
        det.warnings.forEach(function (w) { body.push(h('p', { class: 'alert warn' }, w)); });
        if (s.kind === 'ledger' && !s.base) body.push(h('p', { class: 'alert warn' }, '기준월을 넣어야 반영할 수 있습니다.'));
        if (s.warnings.length) body.push(h('details', { class: 'warn-list' }, h('summary', null, '행 점검 알림 ' + s.warnings.length + '건'),
          h('ul', null, s.warnings.slice(0, 80).map(function (w) { return h('li', null, w.row + '행: ' + w.msg); }))));
        var grid = h('div', { class: 'map-grid' });
        L.KINDS[s.kind].fields.forEach(function (f) {
          var sel = h('select', { 'aria-label': f.label + ' 열' });
          sel.appendChild(h('option', { value: '-1' }, '(이 시트에는 없음)'));
          hdr.forEach(function (t, i) { var o = h('option', { value: String(i) }, L.colName(i) + ' · ' + (t || '(빈 머리)')); if (det.map[f.id] === i) o.selected = true; sel.appendChild(o); });
          sel.addEventListener('change', function () { (it.overrides[s.name] || (it.overrides[s.name] = {}))[f.id] = Number(sel.value); reparse(it); render(); });
          var col = det.map[f.id], exv = col == null ? '' : ex[col];
          if (exv instanceof Date) exv = L.ymOf(exv);
          grid.appendChild(h('div', { class: 'map-row' + (f.req && col == null ? ' missing' : '') },
            h('span', { class: 'col' }, f.label, f.req ? h('span', { class: 'req' }, ' 필수') : null), sel,
            h('span', { class: 'ex' }, col == null ? '연결 안 됨' : '예: ' + (exv == null || exv === '' ? '(빈칸)' : String(exv)))));
        });
        body.push(h('details', { open: det.missing.length ? true : null }, h('summary', null, '열 연결 보기·고치기 (' + Object.keys(det.map).length + '개 연결됨)'), grid));
      }
      return h('div', { class: 'sheet-box' }, body);
    });
    return h('details', { class: 'block', open: true }, h('summary', null, it.fileName + (blocked(it) ? ' — 확인 필요' : ' — 반영 준비됨')), parts);
  }

  /* ── ① 생산계획 · 출고 요율 ───────────────── */
  function windowTabs(onPick) {
    var w = L.cleanSettings(db.settings).rateWindow;
    // 설정의 「2년(24개월)」도 단추로 — 예전에는 24개월을 고르면 어느 단추도 눌리지 않은 채 24개월로 계산했습니다
    return h('div', { class: 'tabs no-print', role: 'group', 'aria-label': '요율 기간' }, [[3, '분기(3개월)'], [6, '반기(6개월)'], [12, '년간(12개월)'], [24, '2년(24개월)']].map(function (x) {
      return h('button', { type: 'button', 'aria-pressed': w === x[0] ? 'true' : 'false', onclick: function () { db.settings = L.cleanSettings(Object.assign({}, db.settings, { rateWindow: x[0] })); save(); render(); if (onPick) onPick(); } }, '요율 ' + x[1]);
    }));
  }
  function prodChart(an) {
    var rows = an.prodRows;
    return C.figure('월별 생산대수 — 실적(파랑) · 차 3개월 계획(주황)', { type: 'bar', labels: rows.map(function (r) { return L.ymShort(r.ym); }), unit: '대',
      series: [{ name: '생산대수', values: rows.map(function (r) { return r.ym > an.base ? (an.planUnits[r.ym] != null ? an.planUnits[r.ym] : r.plan) : r.actual; }),
        colors: rows.map(function (r) { return r.ym > an.base ? 'var(--series-2)' : r.ym === an.base ? 'var(--series-plan)' : 'var(--series-1)'; }), color: 'var(--series-1)' }] });
  }
  function pageForecast() {
    var head = pageHead('①', '생산계획 · 출고 요율 · 예상 출고', '직전 출고와 생산실적 대수로 자재별 대당 출고 요율을 내고, 차 3개월 생산계획 대수를 곱해 달마다 예상 출고를 냅니다.');
    if (!has()) return [head, emptyNotice()];
    var an = analysis(), S0 = an.S, ms = an.fmonths;
    var totalPlan = ms.reduce(function (s, y) { return s + (an.planUnits[y] || 0); }, 0);
    var vol = an.items.filter(function (x) { return x.cv != null && x.cv >= S0.cvWarn && x.notes.some(function (n) { return /들쭉날쭉/.test(n); }); });
    var tr = an.items.filter(function (x) { return x.trend != null && x.trend >= S0.trendWarn; });
    return [head,
      an.warnings.map(function (w) { return h('p', { class: 'alert warn' }, w); }),
      h('div', { class: 'tiles' },
        tile('기준월(당월)', L.ymLabel(an.base), '평균·요율은 당월을 빼고 직전 개월로'),
        tile('차 3개월 생산계획', N(totalPlan, 0) + '대', ms.map(function (y) { return L.ymShort(y) + ' ' + N(an.planUnits[y], 0); }).join(' · ')),
        tile('직전 ' + S0.rateWindow + '개월 평균 실적', N(an.avgUnits[S0.rateWindow], 1) + '대', '계획 ÷ 평균 = ' + (an.avgUnits[S0.rateWindow] ? L.round(totalPlan / 3 / an.avgUnits[S0.rateWindow], 2) + '배' : '-')),
        tile('주의할 자재', vol.length + tr.length + '종', '출고 들쭉날쭉 ' + vol.length + ' · 요율 늘어남 ' + tr.length)),
      h('section', { class: 'card' }, h('h2', null, '생산대수'), prodChart(an),
        h('p', { class: 'note' }, '계획 대수는 설정 화면에서 고칠 수 있습니다. 계획이 없는 달은 직전 평균 실적 대수로 봅니다.')),
      h('section', { class: 'card' }, h('div', { class: 'page-head' }, h('h2', null, '자재별 출고 요율과 차 3개월 예상 출고'), windowTabs()),
        table(['자재', '단위', '분기 평균', '반기 평균', '년간 평균', '대당 요율(쓰는 값)', '분기/년간', '변동'].concat(ms.map(function (y) { return L.ymShort(y) + ' 예상'; })).concat(['3개월 합']),
          an.items.slice().sort(function (a, b) { return L.itemKey(a) < L.itemKey(b) ? -1 : 1; }).map(function (x) {
            var volFlag = x.cv != null && x.cv >= S0.cvWarn && (x.lastAgo == null || x.lastAgo < 6);
            return { cells: [itemCell(x), x.unit, N(x.avg[3]), N(x.avg[6]), N(x.avg[12]),
              h('span', { title: x.rateSrc }, x.rate == null ? '-' : N(x.rate, 2)),
              x.trend == null ? '-' : L.round(x.trend, 2) + '배', x.cv == null ? '-' : h('span', { class: volFlag ? 'flag' : null }, L.round(x.cv, 2) + (volFlag ? ' 큼' : ''))]
              .concat(x.fc.map(function (f) { return N(f.issue); })).concat([N(x.sumE)]),
              tdCls: { 6: x.trend != null && (x.trend >= S0.trendWarn || x.trend <= 1 / S0.trendWarn) ? 'over' : '' } };
          }), { num: [0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1] }),
        h('ul', { class: 'note' },
          h('li', null, '대당 요율 = 직전 ' + S0.rateWindow + '개월 출고 합 ÷ 같은 달 생산실적 대수 합 (월별 요율의 평균이 아님). 위 단추로 분기·반기·년간을 바꾸면 모든 화면이 함께 바뀝니다.'),
          h('li', null, '「분기/년간」이 ' + S0.trendWarn + '배 이상이면 최근에 대당 출고가 늘어난 것입니다(새 모델 등) — 분기 요율로 보면 부족이 더 일찍 잡힙니다.'),
          h('li', null, '「변동」은 월별 대당 출고의 변동계수입니다. ' + S0.cvWarn + ' 이상이면 로트 단위 절단으로 출고가 한 번에 몰려 나가는 자재로 보고, 안전재고를 늘리기를 권합니다.'))) ];
  }

  /* ── ② 부족 자재 · 발주 리스트 ─────────────── */
  function pageOrder() {
    var head0 = pageHead('②', '부족 자재 · 발주 리스트');
    if (!has()) return [head0, emptyNotice()];
    var an = analysis(), ms = an.fmonths, c = an.counts;
    var list = ui.orderView === 'all' ? an.items : an.orderItems;
    var head = pageHead('②', '부족 자재 · 발주 리스트', '현재고 + 발주잔량에서 달마다 예상 출고를 빼 월말 재고를 굴리고, 안전재고 아래로 떨어지는 달과 리드타임으로 발주 마감과 우선순위를 정합니다.',
      h('div', { class: 'btn-row no-print' },
        h('button', { type: 'button', class: 'btn btn-primary', onclick: function () { exportXlsx(an); } }, '엑셀로 내려받기'),
        h('a', { class: 'btn', href: '#/report' }, '보고서·인쇄')));
    var rows = list.map(function (x) {
      return { cls: 'row-' + x.priority, cells: [chip(x.priority), itemCell(x), x.supplier || '-', q(x.stock, x) + (x.onOrder ? ' (+' + N(x.onOrder) + ')' : '')]
        .concat(x.roll.map(function (r) { return N(r.close); }))
        .concat([N(x.ss), x.param.ltDays + '일', L.deadlineText(x, an.base), N(x.need), h('strong', null, N(x.qty)), x.notes.length || x.dead.length ? h('span', { class: 'note' }, [L.deadText(x)].concat(x.notes).filter(Boolean).join(' / ')) : '']),
        tdCls: x.roll.reduce(function (o, r, i) { o[4 + i] = r.close < 0 ? 'neg' : r.close < r.ss ? 'low' : ''; return o; }, {}) };
    });
    return [head,
      an.warnings.map(function (w) { return h('p', { class: 'alert warn' }, w); }),
      h('div', { class: 'tiles' },
        tile('빨강 · 긴급', c.red + '종', L.PRIORITY.red.desc, 'red'),
        tile('주황 · 이번 달 발주', c.orange + '종', L.PRIORITY.orange.desc, 'orange'),
        tile('노랑 · 발주 예정', c.yellow + '종', L.PRIORITY.yellow.desc, 'yellow'),
        tile('초록 · 충분', c.green + '종', L.PRIORITY.green.desc, 'green')),
      h('section', { class: 'card' },
        h('div', { class: 'page-head' }, h('h2', null, '발주 리스트 — 기준월 ' + L.ymLabel(an.base)),
          h('div', { class: 'tabs no-print' },
            h('button', { type: 'button', 'aria-pressed': ui.orderView !== 'all' ? 'true' : 'false', onclick: function () { ui.orderView = 'need'; render(); } }, '발주 필요만 (' + an.orderItems.length + ')'),
            h('button', { type: 'button', 'aria-pressed': ui.orderView === 'all' ? 'true' : 'false', onclick: function () { ui.orderView = 'all'; render(); } }, '전체 자재 (' + an.items.length + ')'))),
        list.length ? table(['우선순위', '자재', '공급사', '현재고(+발주잔)'].concat(ms.map(function (y) { return L.ymShort(y) + ' 월말'; })).concat(['안전재고', '리드타임', '발주 마감', '필요량', '권장 발주량', '참고']), rows,
          { num: [0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 1, 1, 0], cls: 'order' }) : h('p', { class: 'note' }, '3개월 안에 안전재고 아래로 떨어지는 자재가 없습니다.'),
        h('ul', { class: 'note' },
          h('li', null, '월말 재고는 새 발주 없이 굴린 값입니다. 빨간 칸 = 결품(0 아래), 노란 칸 = 안전재고 아래.'),
          h('li', null, '리드타임은 「지금(기준월 말) 발주하면 리드타임 개월 수(일 ÷ 30 올림) 뒤 달 말에 들어와 그다음 달부터 쓴다」로 보수적으로 봅니다. 그래서 그 안에 결품이 나면 빨강(지금 발주해도 늦음)입니다.'),
          h('li', null, '필요량 = 안전재고 + 3개월 예상 출고 − (현재고 + 발주잔량). 권장 발주량은 필요량을 발주단위로 올림하고 MOQ 보다 작으면 MOQ 로 맞춘 값입니다.'),
          h('li', null, '안전재고는 자재별 값이 없으면 3개월 평균 예상 출고의 ' + an.S.ssMonths + '개월분입니다(설정에서 자재별로 바꿀 수 있음).'))),
      h('section', { class: 'card' }, h('h2', null, '강종별 부족량'),
        table(['강종', '단위', '자재 수', '발주 필요', '가장 급한 것', '현재고 합', '3개월 예상 출고 합', '필요량 합', '권장 발주량 합'], an.grades.map(function (g) {
          return { cls: 'row-' + g.worst, cells: [g.grade, g.unit, g.items, g.order, chip(g.worst), N(g.stock), N(g.sumE), N(g.short), N(g.qty)] };
        }), { num: [0, 0, 1, 1, 0, 1, 1, 1, 1] }),
        h('p', { class: 'note' }, '같은 강종이라도 규격(두께·폭)이 다르면 서로 대신 쓸 수 없을 수 있어, 발주는 위 자재(규격)별 표로 합니다. 이 표는 강종 단위로 얼마가 모자란지 한눈에 보는 용도입니다.')),
      h('section', { class: 'card' }, h('h2', null, '월별 기초재고 굴리기 (자세히)'),
        h('details', null, h('summary', null, '자재 ' + list.length + '종 × ' + ms.length + '개월 표 열기'),
          table(['자재', '월', '생산계획', '기초재고', '예상 출고', '기말재고', '안전재고', '안전재고 대비 부족', '결품량'], [].concat.apply([], list.map(function (x) {
            return x.roll.map(function (r, i) {
              return { cls: i === 0 ? 'first' : null, cells: [i === 0 ? itemCell(x) : '', L.ymShort(r.ym), r.units == null ? '-' : N(r.units), N(r.open), N(r.issue), N(r.close), N(r.ss), N(r.short), N(r.stockout)],
                tdCls: { 5: r.close < 0 ? 'neg' : r.close < r.ss ? 'low' : '' } };
            });
          })), { num: [0, 0, 1, 1, 1, 1, 1, 1, 1] })))];
  }
  function exportXlsx(an) {
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(L.orderToAoa(an, false)), '발주 리스트');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(L.orderToAoa(an, true)), '전체 자재');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(L.rollToAoa(an)), '월별 굴리기');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(L.rateToAoa(an)), '출고 요율');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(L.deadToAoa(an)), '장기·불용 지표');
    XLSX.writeFile(wb, '발주리스트_' + an.base + '.xlsx');
  }

  /* ── ③ 장기 · 불용 재고 지표 ───────────────── */
  function pageDead() {
    var head = pageHead('③', '장기 · 불용 재고 지표', '재고가 출고에 비해 너무 많거나, 오래 출고가 없거나, MOQ 때문에 남을 자재를 미리 찾아 발주를 줄이거나 멈출 근거로 씁니다.');
    if (!has()) return [head, emptyNotice()];
    var an = analysis(), S0 = an.S, dc = an.deadCounts;
    var sorted = an.items.slice().sort(function (a, b) { return (b.cover === Infinity ? 1e9 : b.cover) - (a.cover === Infinity ? 1e9 : a.cover); });
    var top = sorted.slice(0, 12);
    var cap = 24;
    return [head,
      h('div', { class: 'tiles' },
        tile('불용 의심', dc.dead + '종', S0.deadMonths + '개월 이상 출고 없음', dc.dead ? 'dead' : null),
        tile('장기재고 위험', dc.long + '종', '재고 ' + S0.longMonths + '개월분 이상 또는 6개월 무출고', dc.long ? 'long' : null),
        tile('출고 감소 · MOQ 과다', dc.down + ' · ' + dc.moq + '종', '분기 요율 ≤ 년간의 1/' + S0.trendWarn + ' · MOQ 로 장기재고'),
        tile('재고 금액', an.totalValue == null ? '단가 없음' : N(an.totalValue / 1e6, 1) + '백만 원', an.deadValue == null ? '' : '그중 장기·불용 ' + N(an.deadValue / 1e6, 1) + '백만 원')),
      h('section', { class: 'card' }, h('h2', null, '재고 개월수 (현재고 ÷ 년간 평균 출고) — 많은 순 12개'),
        C.figure('재고 개월수', { type: 'hbar', labels: top.map(function (x) { return x.name; }), unit: '개월', refs: [{ value: S0.longMonths, label: S0.longMonths + '개월' }],
          series: [{ name: '재고 개월수', values: top.map(function (x) { return x.cover === Infinity ? cap : x.cover; }), colors: top.map(function (x) { return x.dead.indexOf('dead') >= 0 ? 'var(--danger)' : x.dead.indexOf('long') >= 0 ? 'var(--series-2)' : 'var(--series-1)'; }), color: 'var(--series-1)' }] }),
        h('p', { class: 'note' }, '출고가 전혀 없는 자재는 막대를 ' + cap + '개월로 그립니다. 빨강 = 불용 의심, 주황 = 장기재고 위험.')),
      h('section', { class: 'card' }, h('h2', null, '자재별 지표'),
        table(['자재', '현재고', '년간 평균 출고', '재고 개월수', '마지막 출고', '분기/년간 요율', '재고 금액(원)', '판정'], sorted.map(function (x) {
          return { cls: x.dead.length ? 'row-dead' : null, cells: [itemCell(x), q(x.stock, x), N(x.monthly), L.coverText(x.cover), L.agoText(x.lastAgo), x.trend == null ? '-' : L.round(x.trend, 2) + '배', x.value == null ? '-' : N(x.value), L.deadText(x) || '-'] };
        }), { num: [0, 1, 1, 1, 0, 1, 1, 0] }),
        h('ul', { class: 'note' },
          h('li', null, '불용 의심: ' + S0.deadMonths + '개월 이상 출고 없음 · 장기재고 위험: 재고가 년간 평균 출고의 ' + S0.longMonths + '개월분 이상이거나 6개월 이상 출고 없음 — 기준은 설정에서 바꿀 수 있습니다(기획서 10장 ⑤ 확인 전 임시).'),
          h('li', null, 'MOQ 과다: 필요량보다 MOQ 가 커서, 발주하면 3개월 뒤에도 ' + S0.longMonths + '개월분 이상 남는 자재입니다. MOQ 협의·다른 규격과 묶음 발주·분할 입고를 검토해 주세요.'))) ];
  }

  /* ── ④ AI 프롬프트 ───────────────────────── */
  function pageAi() {
    var head = pageHead('④', 'AI 검토 프롬프트', '계산된 사실만 담은 프롬프트를 만들어 회사가 허용한 AI 에 붙여 넣고, 받은 답을 보고서에 씁니다.');
    if (!has()) return [head, emptyNotice()];
    var an = analysis();
    var mask = db.mask !== false;
    if (mask) db.aliases = L.assignAllAliases(db.aliases, db.items);
    var info = L.buildAiPromptInfo(an, mask ? db.aliases : null);
    var prompt = info.prompt, key = an.base + '|' + an.S.rateWindow;
    function back(t) { return mask ? L.unmaskText(t, db.aliases) : t; }
    var answer = h('textarea', { rows: 10, placeholder: 'AI 답을 여기에 붙여 넣어 주세요. 별칭(공급사1·자재2 등)은 원래 이름으로 되돌려 보고서의 「AI 검토 의견」에 넣습니다.' });
    answer.value = (db.aiNotes || {})[key] || '';
    answer.addEventListener('input', function () { db.aiNotes[key] = back(answer.value); save(); });
    answer.addEventListener('change', function () { var b = back(answer.value); if (b !== answer.value) { answer.value = b; toast('답의 별칭을 원래 이름으로 되돌렸습니다.'); } });
    var promptBox = h('textarea', { rows: 14, readonly: true, class: 'mono' }); promptBox.value = prompt;
    var maskBox = h('input', { type: 'checkbox' }); maskBox.checked = mask;
    maskBox.addEventListener('change', function () { db.mask = maskBox.checked; save(); render(); });
    var mapRows = [];
    Object.keys(info.map).forEach(function (cat) { Object.keys(info.map[cat]).forEach(function (v) { mapRows.push([info.map[cat][v], v, L.MASK_CATS[cat] === '자재' ? '자재코드' : L.MASK_CATS[cat]]); }); });
    mapRows.sort(function (a, b) { return a[0] < b[0] ? -1 : 1; });
    return [head,
      h('section', { class: 'card', id: 'ai' }, h('h2', null, 'AI 검토 (반자동 기본)'),
        h('ol', { class: 'steps' },
          h('li', null, '아래 프롬프트를 복사해 회사가 허용한 AI(ChatGPT 등)에 붙여 넣어 주세요. 도구가 계산한 숫자(예상 출고·월말 재고·발주 마감·권장량·장기재고 지표)만 들어 있습니다.'),
          h('li', null, '받은 답을 「AI 답」 칸에 붙여 넣으면 별칭이 원래 이름으로 돌아가 ⑤ 보고서에 들어갑니다. 발주 결정은 꼭 사람이 검토해 주세요.')),
        h('div', { class: 'mask-box' },
          h('label', { class: 'opt' }, maskBox, h('span', null, h('span', { class: 't' }, '이름 가리기(외부 AI 에 공급사·자재코드를 보내지 않음)'),
            h('span', { class: 's' }, '「공급사1」「자재2」 같은 별칭으로 바꿉니다. 대응표는 이 브라우저에만 있고, 같은 이름은 늘 같은 별칭입니다.'))),
          mask && info.leaks.length ? h('p', { class: 'alert warn' }, '가리지 못한 이름이 프롬프트에 남아 있습니다: ' + info.leaks.join(', ') + ' — 보내기 전에 지워 주세요.') : null,
          mask ? h('p', { class: 'note' }, info.leaks.length ? '' : '확인: 프롬프트에 실제 공급사 이름·자재코드가 없습니다. 강종·규격(SS400 6t 같은 표준 표기)과 수량은 그대로 들어갑니다.')
            : h('p', { class: 'alert info' }, '지금은 이름이 그대로 들어갑니다. 회사 보안 기준을 확인해 주세요.'),
          mask && mapRows.length ? h('details', null, h('summary', null, '별칭 대응표 — 이 프롬프트에 쓴 ' + mapRows.length + '개 (이 PC 에만 있음)'),
            table(['별칭', '원래 이름', '구분'], mapRows, { cls: 'alias' }),
            h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn', onclick: function () { copyText(mapRows.map(function (r) { return r.join('\t'); }).join('\n')); } }, '대응표 복사(엑셀 붙여넣기용)'))) : null),
        promptBox,
        h('div', { class: 'btn-row', style: 'margin:10px 0' },
          h('button', { type: 'button', class: 'btn btn-primary', onclick: function () { copyText(prompt); } }, '프롬프트 복사'),
          AIP.sendButton('설정한 AI 서버로 보내기(선택)', function () { return prompt; }, function (text) { text = back(text); answer.value = text; db.aiNotes[key] = text; save(); toast('AI 답을 받았습니다(별칭은 원래 이름으로 되돌림). 검토 후 보고서에 씁니다.'); },
            { toast: toast, settingsHref: '#/settings', system: '너는 제조업 구매팀의 자재 수급 계획 보조야. 주어진 사실 밖의 숫자를 만들지 마.' })),
        fld('AI 답 (기준월 ' + an.base + ', 요율 ' + an.S.rateWindow + '개월)', answer, '기준월·요율 기간마다 따로 저장됩니다(이 브라우저).'))];
  }

  /* ── ⑤ 보고서 ───────────────────────────── */
  function pageReport() {
    var head0 = pageHead('⑤', '발주 계획 보고서');
    if (!has()) return [head0, emptyNotice()];
    var an = analysis();
    var ai = (db.aiNotes || {})[an.base + '|' + an.S.rateWindow];
    var text = L.buildReport(an, ai);
    var paper = reportPaper(an, ai);
    return [
      pageHead('⑤', '발주 계획 보고서', '계산 결과로 보고서 초안을 만듭니다. 고쳐 쓸 곳을 확인한 뒤 인쇄하거나 Word·엑셀로 내려받아 주세요.',
        h('div', { class: 'btn-row no-print' },
          h('button', { type: 'button', class: 'btn btn-primary', onclick: function () { window.print(); } }, '인쇄 / PDF'),
          h('button', { type: 'button', class: 'btn', onclick: function () { exportWord(an, paper); } }, 'Word 로'),
          h('button', { type: 'button', class: 'btn', onclick: function () { exportReportXlsx(an, text); } }, '엑셀로'),
          h('button', { type: 'button', class: 'btn', onclick: function () { copyText(text); } }, '글자로 복사'))),
      h('p', { class: 'note no-print' }, ai ? 'AI 검토 의견은 ④ 화면에서 붙여 넣은 답입니다.' : 'AI 검토 의견을 넣으려면 ④ 화면에서 AI 답을 붙여 넣어 주세요(선택).'),
      h('section', { class: 'card paper' }, paper)];
  }
  function reportPaper(an, ai) {
    var c = an.counts, ms = an.fmonths;
    return h('div', { class: 'rp' },
      h('h1', null, '원/부자재 발주 계획 보고'),
      h('p', { class: 'note' }, '기준월 ' + L.ymLabel(an.base) + ' · 예상 ' + ms.map(L.ymShort).join('·') + ' · 요율 직전 ' + an.S.rateWindow + '개월 · 작성: 구매팀 · 자동 생성 초안(검토 후 사용)'),
      h('h2', null, '1. 총괄'),
      table(['자재', '빨강 · 긴급', '주황 · 이번 달', '노랑 · 예정', '초록 · 충분', '불용 의심', '장기재고 위험', 'MOQ 과다'],
        [[an.items.length + '종', c.red, c.orange, c.yellow, c.green, an.deadCounts.dead, an.deadCounts.long, an.deadCounts.moq]], { num: [1, 1, 1, 1, 1, 1, 1, 1] }),
      h('h2', null, '2. 생산계획과 계산 기준'),
      table(['월', '생산계획(대)', '비고'], ms.map(function (y) { return [L.ymLabel(y), N(an.planUnits[y], 1), an.planMissing.indexOf(y) >= 0 ? '계획 없음 → 직전 평균' : '']; }), { num: [0, 1, 0] }),
      h('p', null, '대당 출고 요율 = 직전 ' + an.S.rateWindow + '개월 출고 합 ÷ 생산실적 대수 합. 안전재고 기본 ' + an.S.ssMonths + '개월분, 리드타임 기본 ' + an.S.ltDays + '일(자재별 값 우선).'),
      h('h2', null, '3. 발주 리스트 (우선순위 순)'),
      an.orderItems.length ? table(['우선순위', '자재', '공급사', '현재고'].concat(ms.map(function (y) { return L.ymShort(y) + ' 월말'; })).concat(['발주 마감', '권장 발주량', '참고']), an.orderItems.map(function (x) {
        return { cls: 'row-' + x.priority, cells: [chip(x.priority), x.name + (x.code ? ' (' + x.code + ')' : ''), x.supplier || '-', q(x.stock, x)].concat(x.roll.map(function (r) { return N(r.close); })).concat([L.deadlineText(x, an.base), N(x.qty), x.notes.join(' / ')]),
          tdCls: x.roll.reduce(function (o, r, i) { o[4 + i] = r.close < 0 ? 'neg' : r.close < r.ss ? 'low' : ''; return o; }, {}) };
      }), { num: [0, 0, 0, 1, 1, 1, 1, 0, 1, 0] }) : h('p', null, '3개월 안에 발주할 자재가 없습니다.'),
      h('h2', null, '4. 강종별 부족량'),
      table(['강종', '단위', '발주 필요/자재 수', '필요량 합', '권장 발주량 합'], an.grades.filter(function (g) { return g.order; }).map(function (g) { return [g.grade, g.unit, g.order + ' / ' + g.items, N(g.short), N(g.qty)]; }), { num: [0, 0, 1, 1, 1] }),
      h('h2', null, '5. 장기 · 불용 재고 지표'),
      (function () {
        var dl = an.items.filter(function (x) { return x.dead.length; });
        return dl.length ? table(['자재', '현재고', '재고 개월수', '마지막 출고', '판정'], dl.map(function (x) { return [x.name, q(x.stock, x), L.coverText(x.cover), L.agoText(x.lastAgo), L.deadText(x)]; }), { num: [0, 1, 1, 0, 0] }) : h('p', null, '해당 없음');
      })(),
      h('p', { class: 'note' }, '계산은 수불 기록과 생산계획만으로 한 것입니다. 로트 절단 계획·대체 규격 사용·공급사 사정은 확인이 필요합니다.'),
      ai ? [h('h2', null, '6. AI 검토 의견 (검토 후 사용)'), h('div', { class: 'pre' }, ai)] : null);
  }
  function exportWord(an, paper) {
    var html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>발주 계획 보고</title>' +
      '<style>body{font-family:"맑은 고딕",sans-serif;font-size:10.5pt} table{border-collapse:collapse;margin:6px 0} th,td{border:1px solid #999;padding:3px 6px;font-size:9pt} th{background:#eef2f7} h1{font-size:16pt} h2{font-size:12.5pt;margin-top:14pt} .pre{white-space:pre-wrap}' +
      ' tr.row-red td{background:#fbe1dd} tr.row-orange td{background:#fdebd3} tr.row-yellow td{background:#fdf6cf} td.neg{color:#a1170d;font-weight:bold}</style></head><body>' + paper.innerHTML + '</body></html>';
    download('발주계획보고_' + an.base + '.doc', new Blob(['﻿' + html], { type: 'application/msword' }));
  }
  function exportReportXlsx(an, text) {
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(text.split('\n').map(function (s) { return [s]; })), '보고서');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(L.orderToAoa(an, false)), '발주 리스트');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(L.rollToAoa(an)), '월별 굴리기');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(L.deadToAoa(an)), '장기·불용 지표');
    XLSX.writeFile(wb, '발주계획보고_' + an.base + '.xlsx');
  }

  /* ── 설정 ───────────────────────────────── */
  function pageSettings() {
    var s = L.cleanSettings(db.settings);
    function num(v, step) { return h('input', { type: 'number', min: 0, step: step || 'any', inputmode: 'decimal', value: v == null ? '' : v }); }
    var win = h('select', null, [[3, '분기 (직전 3개월)'], [6, '반기 (직전 6개월)'], [12, '년간 (직전 12개월)'], [24, '2년 (직전 24개월)']].map(function (x) { var o = h('option', { value: x[0] }, x[1]); if (s.rateWindow === x[0]) o.selected = true; return o; }));
    var inp = { ssMonths: num(s.ssMonths, 0.1), ltDays: num(s.ltDays, 1), moq: num(s.moq), lot: num(s.lot), longMonths: num(s.longMonths, 1), deadMonths: num(s.deadMonths, 1), cvWarn: num(s.cvWarn, 0.05), trendWarn: num(s.trendWarn, 0.05) };
    function saveSettings() {
      var p = { rateWindow: Number(win.value) }; Object.keys(inp).forEach(function (k) { p[k] = inp[k].value === '' ? null : Number(inp[k].value); });
      db.settings = L.cleanSettings(p); save(); toast('설정을 저장했습니다.'); render();
    }
    var an = has() ? analysis() : null;
    // 생산계획 차 3개월
    var planBox = null;
    if (an) {
      var planIn = an.fmonths.map(function (y) { return num(db.prod[y] && db.prod[y].plan != null ? db.prod[y].plan : '', 1); });
      var prodPaste = h('textarea', { rows: 4, placeholder: '년월\t생산실적\t생산계획\n2026-11\t\t170' });
      planBox = h('section', { class: 'card' }, h('h2', null, '차 3개월 생산계획 (대)'),
        h('div', { class: 'inline-form' }, an.fmonths.map(function (y, i) { return fld(L.ymLabel(y), planIn[i], an.planMissing.indexOf(y) >= 0 ? '비어 있음 → 평균 ' + N(an.planUnits[y], 1) + '대로 계산' : null); }),
          h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
            an.fmonths.forEach(function (y, i) { var v = planIn[i].value; var o = db.prod[y] || {}; if (v === '') delete o.plan; else o.plan = Math.max(0, Number(v)); if (Object.keys(o).length) db.prod[y] = o; else delete db.prod[y]; });
            save(); toast('생산계획을 저장했습니다.'); render();
          } }, '계획 저장')),
        h('details', { style: 'margin-top:10px' }, h('summary', null, '엑셀에서 생산대수 여러 줄 붙여 넣기'),
          h('p', { class: 'note' }, '「년월 · 생산실적 · 생산계획」 세 칸을 복사해 붙여 넣어 주세요(머리 줄은 있어도 됩니다).'), prodPaste,
          h('div', { class: 'btn-row', style: 'margin-top:8px' }, h('button', { type: 'button', class: 'btn', onclick: function () {
            var r = L.parseProdText(prodPaste.value), n = Object.keys(r.prod).length;
            if (!n) { toast('읽을 줄이 없습니다.', true); return; }
            Object.keys(r.prod).forEach(function (y) { db.prod[y] = Object.assign(db.prod[y] || {}, r.prod[y]); });
            save(); toast(n + '개월 넣었습니다' + (r.bad.length ? ' · 못 읽은 줄 ' + r.bad.join(', ') : '') + '.'); render();
          } }, '붙여 넣은 줄 넣기'))));
    }
    // 자재별 발주 기준
    var paramBox = null;
    if (an) {
      var inputs = {};
      var rows = an.items.slice().sort(function (a, b) { return a.key < b.key ? -1 : 1; }).map(function (x) {
        var o = db.paramOverrides[x.key] || {};
        var mk = function (k, ph) { var i = h('input', { type: 'number', min: 0, step: 'any', inputmode: 'decimal', value: o[k] == null ? '' : o[k], placeholder: ph, 'aria-label': x.name + ' ' + k }); (inputs[x.key] || (inputs[x.key] = {}))[k] = i; return i; };
        var P = x.param;
        return [itemCell(x), mk('moq', N(P.moq)), mk('ltDays', String(P.ltDays)), mk('ssMonths', String(P.ssMonths)), mk('ssQty', P.ssQty == null ? '' : N(P.ssQty)), mk('lot', N(P.lot)), N(x.ss)];
      });
      var paramPaste = h('textarea', { rows: 4, placeholder: '자재코드(또는 강종)\t규격\tMOQ\t리드타임(일)\t안전재고(개월)\t발주단위\nRM-101\t4.5t×1219×2438\t5000\t30\t0.5\t1000' });
      paramBox = h('section', { class: 'card' }, h('h2', null, '자재별 발주 기준 — MOQ · 리드타임 · 안전재고 · 발주단위'),
        h('p', { class: 'note' }, '칸을 비워 두면 흐린 글자(발주 기준 시트 → 기본값 순서)의 값을 씁니다. 여기서 적은 값이 가장 우선입니다. 안전재고는 「개월분」 또는 「수량」 하나만 적어 주세요(수량이 있으면 수량).'),
        table(['자재', 'MOQ', '리드타임(일)', '안전재고(개월분)', '안전재고(수량)', '발주단위', '지금 안전재고'], rows, { cls: 'items params', num: [0, 0, 0, 0, 0, 0, 1] }),
        h('div', { class: 'btn-row', style: 'margin-top:10px' },
          h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
            Object.keys(inputs).forEach(function (k) {
              var o = {}; Object.keys(inputs[k]).forEach(function (f) { if (inputs[k][f].value !== '') o[f] = Number(inputs[k][f].value); });
              o = L.cleanParam(o);
              if (Object.keys(o).length) db.paramOverrides[k] = o; else delete db.paramOverrides[k];
            });
            save(); toast('자재별 발주 기준을 저장했습니다.'); render();
          } }, '자재별 기준 저장'),
          h('button', { type: 'button', class: 'btn', onclick: function () { if (confirm('여기서 직접 적은 자재별 값을 모두 지울까요? (발주 기준 시트 값과 기본값은 남습니다)')) { db.paramOverrides = {}; save(); render(); } } }, '직접 적은 값 지우기')),
        h('details', { style: 'margin-top:10px' }, h('summary', null, '엑셀에서 발주 기준 여러 줄 붙여 넣기'),
          h('p', { class: 'note' }, '「자재코드(또는 강종) · 규격 · MOQ · 리드타임(일) · 안전재고(개월) · 발주단위」 여섯 칸 순서로 복사해 붙여 넣어 주세요. 발주 기준 시트로 들어갑니다.'), paramPaste,
          h('div', { class: 'btn-row', style: 'margin-top:8px' }, h('button', { type: 'button', class: 'btn', onclick: function () {
            var r = L.parseParamText(paramPaste.value);
            if (!r.items.length) { toast('읽을 줄이 없습니다. 칸 순서를 확인해 주세요.', true); return; }
            var byKey = {}; db.params.forEach(function (p) { byKey[p.key] = p; }); r.items.forEach(function (p) { byKey[p.key] = p; });
            db.params = Object.keys(byKey).map(function (k) { return byKey[k]; });
            save(); toast(r.items.length + '건 넣었습니다' + (r.bad.length ? ' · 못 읽은 줄 ' + r.bad.join(', ') : '') + '.'); render();
          } }, '붙여 넣은 줄 넣기'))));
    }
    var backup = h('input', { type: 'file', accept: '.json' });
    backup.addEventListener('change', function () {
      var f = backup.files[0]; if (!f) return;
      f.text().then(function (t) {
        var o = JSON.parse(t); if (!o || !Array.isArray(o.items)) throw new Error('이 도구의 백업 파일이 아닙니다.');
        db = L.restoreDb(o); save(); toast('백업을 불러왔습니다(자재 ' + db.items.length + '종).'); render();
      }).catch(function (e) { toast('불러오지 못했습니다: ' + e.message, true); });
    });
    return [
      pageHead('설정', '계산 기준 · 생산계획 · 자재별 발주 기준 · AI 연결 · 백업'),
      h('section', { class: 'card' }, h('h2', null, '계산 기준 (기본값)'),
        h('div', { class: 'form-grid' },
          fld('출고 요율 기간', win, '제출 글: 분기·반기·년간 평균'),
          fld('안전재고 기본 (개월분)', inp.ssMonths, '차 3개월 평균 예상 출고의 몇 개월분'),
          fld('리드타임 기본 (일)', inp.ltDays, '자재별 값이 없을 때'),
          fld('MOQ 기본', inp.moq, '0 = 없음'),
          fld('발주단위 기본', inp.lot, '0 = 없음(1 단위로 올림)'),
          fld('장기재고 위험 — 재고 개월수', inp.longMonths, '현재고 ÷ 년간 평균 출고'),
          fld('불용 의심 — 무출고 개월수', inp.deadMonths),
          fld('「출고 들쭉날쭉」 변동계수', inp.cvWarn, '로트 절단 영향 의심'),
          fld('「요율 변화」 배수', inp.trendWarn, '분기 요율 ÷ 년간 요율')),
        h('div', { class: 'btn-row', style: 'margin-top:12px' },
          h('button', { type: 'button', class: 'btn btn-primary', onclick: saveSettings }, '저장'),
          h('button', { type: 'button', class: 'btn', onclick: function () { db.settings = L.cleanSettings({}); save(); render(); } }, '기본값으로'))),
      planBox, paramBox,
      AIP.settingsCard({ toast: toast, onChange: render }),
      h('section', { class: 'card' }, h('h2', null, '백업'),
        h('p', { class: 'note' }, '가져온 수불·생산대수·발주 기준은 이 브라우저에만 있습니다. 다른 PC 로 옮기거나 브라우저 정리 전에 JSON 으로 받아 두세요. (파일에는 공급사·단가도 들어 있으니 보관에 주의해 주세요)'),
        h('div', { class: 'btn-row' },
          h('button', { type: 'button', class: 'btn', onclick: function () { download('발주관리_백업_' + localStamp(true) + '.json', new Blob([JSON.stringify(db)], { type: 'application/json' })); } }, 'JSON 백업 내려받기'),
          h('label', { class: 'btn' }, backup, 'JSON 백업 불러오기')))
    ];
  }

  /* ── 라우터 ─────────────────────────────── */
  var PAGES = [
    { id: 'import', no: '0', t: '데이터 가져오기', s: '수불·생산대수·발주 기준', fn: pageImport },
    { id: 'forecast', no: '①', t: '예상 출고', s: '생산계획 × 출고 요율', fn: pageForecast },
    { id: 'order', no: '②', t: '발주 리스트', s: '부족량·우선순위 색', fn: pageOrder },
    { id: 'dead', no: '③', t: '장기·불용 지표', s: '재고 개월수·무출고·MOQ', fn: pageDead },
    { id: 'ai', no: '④', t: 'AI 프롬프트', s: '사실만 · 이름 가림', fn: pageAi },
    { id: 'report', no: '⑤', t: '보고서', s: '인쇄·Word·엑셀', fn: pageReport },
    { id: 'settings', no: '설', t: '설정', s: 'MOQ·리드타임·안전재고·AI', fn: pageSettings }
  ];
  function route() { var id = (location.hash || '').replace(/^#\//, '').split('?')[0]; return PAGES.filter(function (p) { return p.id === id; })[0] || (has() ? PAGES[2] : PAGES[0]); }
  function render() {
    var p = route();
    var nav = document.getElementById('nav'); nav.innerHTML = '';
    PAGES.forEach(function (x) {
      nav.appendChild(h('a', { href: '#/' + x.id, 'aria-current': x === p ? 'page' : null }, h('span', { class: 'no' }, x.no), h('span', { class: 't' }, x.t), h('span', { class: 's' }, x.s)));
    });
    document.getElementById('dataChip').textContent = has() ? '기준월 ' + L.ymLabel(db.base) + ' · 자재 ' + db.items.length + '종 · 예상 ' + L.ymShort(L.ymAdd(db.base, 1)) + '~' + L.ymShort(L.ymAdd(db.base, 3)) : '데이터 없음';
    var b = document.getElementById('sampleBanner');
    b.hidden = !db.sample;
    b.textContent = '지금 보시는 것은 가상 샘플입니다(가짜 자재코드 RM-1xx, 공급사A~D, 생산대수·MOQ·리드타임도 가정). 로트 절단으로 들쭉날쭉한 RM-102, 리드타임이 긴 RM-104, 요율이 늘어난 RM-110, MOQ 과다 RM-112, 14개월 무출고 RM-113 을 일부러 심어 두었습니다. 실제 파일을 넣기 전에 「모든 데이터 지우기」를 해 주세요.';
    main.innerHTML = '';
    add(main, p.fn());
    document.title = p.t + ' — 원/부자재 미결 방지';
    var ft = document.querySelector('.site-footer');
    if (ft && !ft.querySelector('.ver')) ft.appendChild(h('span', { class: 'ver' }, ' · 판 ' + APP_VERSION));
    save();
  }
  window.addEventListener('hashchange', function () { render(); main.focus(); window.scrollTo(0, 0); });
  render();
})();
