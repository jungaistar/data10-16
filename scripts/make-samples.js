// 가상 샘플 파일 만들기: node scripts/make-samples.js
// js/sample-data.js 의 통합문서(수불현황 · 생산대수 · 발주기준 시트)를 samples/수불_샘플_2026-10.xlsx 로 쓰고(전부 지어낸 값),
// 생산대수 년월 칸은 엑셀 날짜로 넣습니다. 방금 쓴 파일을 앱과 같은 방식으로 다시 읽어 자재 수·재고·출고·대수가 맞는지 확인합니다.
const fs = require('fs');
const path = require('path');
const XLSX = require('../vendor/xlsx.full.min.js');
const L = require('../js/logic.js');
const Sample = require('../js/sample-data.js');

const out = path.join(__dirname, '..', 'samples');
fs.mkdirSync(out, { recursive: true });
const b = Sample.build();
const wb = XLSX.utils.book_new();
for (const s of b.sheets) {
  const aoa = s.name === '생산대수' ? s.aoa.map((row, i) => i < 2 ? row : [new Date(row[0] + '-01T00:00:00'), row[1], row[2]]) : s.aoa;
  const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true, dateNF: 'yyyy-mm' });
  if (s.name === '수불현황') ws['!cols'] = [{ wch: 9 }, { wch: 9 }, { wch: 16 }, { wch: 5 }, { wch: 8 }, { wch: 8 }, { wch: 9 }, { wch: 9 }, { wch: 9 }, { wch: 9 }];
  if (s.name === '발주기준') ws['!cols'] = [{ wch: 9 }, { wch: 9 }, { wch: 16 }, { wch: 8 }, { wch: 11 }, { wch: 13 }, { wch: 9 }];
  XLSX.utils.book_append_sheet(wb, ws, s.name);
}
const file = path.join(out, b.fileName);
fs.writeFileSync(file, XLSX.write(wb, { bookType: 'xlsx', type: 'buffer', cellDates: true }));

const back = XLSX.read(fs.readFileSync(file), { type: 'buffer', cellDates: true });
const sheets = back.SheetNames.map(n => ({ name: n, aoa: XLSX.utils.sheet_to_json(back.Sheets[n], { header: 1, raw: true, defval: null }) }));
const r = L.parseWorkbook(sheets, { fileName: b.fileName });
const kinds = r.sheets.map(s => s.kind).join(',');
if (kinds !== 'ledger,prod,params') throw new Error('시트 종류를 잘못 가름: ' + kinds);
if (r.base !== b.base) throw new Error('기준월 ' + r.base);
if (r.items.length !== b.items.length) throw new Error('자재 수 ' + r.items.length);
r.items.forEach((it, i) => {
  const w = b.items[i];
  if (it.code !== w.code || it.stock !== w.stock || it.outNow !== w.outNow) throw new Error(w.code + ' 값이 다름');
  for (const y of Object.keys(w.out)) if ((it.out[y] || 0) !== w.out[y]) throw new Error(w.code + ' ' + y + ' 출고가 다름');
});
for (const y of Object.keys(b.prod)) if (JSON.stringify(r.prod[y]) !== JSON.stringify(b.prod[y])) throw new Error('생산대수 ' + y + ' 다름');
if (r.params.length !== b.items.length) throw new Error('발주 기준 ' + r.params.length);
const warn = r.sheets.flatMap(s => s.warnings.concat((s.det || {}).warnings || []));
if (warn.length) throw new Error('알림이 있음: ' + JSON.stringify(warn.slice(0, 3)));
console.log(b.fileName, '· 자재', r.items.length, '· 생산대수', Object.keys(r.prod).length, '개월 · 발주 기준', r.params.length, '· 기준월', r.base);
