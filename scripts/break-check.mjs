// 일부러 깨뜨려 검사가 잡는지(전역 규칙 §5.5): node scripts/break-check.mjs — 원본은 이 스크립트 변수에만 두고 finally 로 되돌림
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import { execSync } from 'node:child_process';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const F = ROOT + '/js/logic.js';
const orig = fs.readFileSync(F, 'utf8');
const breaks = [
  ['요율을 월별 요율의 평균으로', "ms.forEach(function (y) { var a = prod[y] && prod[y].actual; if (a > 0 && ctx.histMonths[y]) { q += it.out[y] || 0; u += a; } });\n        return u > 0 ? q / u : null;",
   "var rs = []; ms.forEach(function (y) { var a = prod[y] && prod[y].actual; if (a > 0 && ctx.histMonths[y]) rs.push((it.out[y] || 0) / a); });\n        return rs.length ? rs.reduce(function (s, v) { return s + v; }, 0) / rs.length : null;"],
  ['발주잔량을 기초재고에서 빼먹음', "var open = (it.stock || 0) + (it.onOrder || 0), roll", "var open = (it.stock || 0), roll"],
  ['리드타임 안 결품 판정을 하나 짧게', "if (firstOut != null && firstOut <= L) pr = 'red';", "if (firstOut != null && firstOut < L) pr = 'red';"],
  ['MOQ 미반영', "if (P.moq > 0 && qty < P.moq) qty =", "if (false) qty ="],
  ['발주단위 올림 대신 반올림', "qty = qtyNoMoq = P.lot > 0 ? Math.ceil(need / P.lot - 1e-9) * P.lot", "qty = qtyNoMoq = P.lot > 0 ? Math.round(need / P.lot) * P.lot"],
  ['MOQ 과다를 발주단위 올림에도 표시', "var moqWarn = qty > qtyNoMoq &&", "var moqWarn = qty > need + 1e-9 &&"],
  ['프롬프트에서 공급사 안 가림', "if (!aliases || !aliases[cat] || !aliases[cat][v]) return v;", "if (!aliases || !aliases[cat] || !aliases[cat][v] || cat === 'supplier') return v;"],
  ['「자재 3종」 예외 빼기', "(?![0-9개건종가곳])", "(?![0-9])"],
  ['합계 줄 안 거름', "if (isSummaryRow(row)) { out.summary++; continue; }", "if (false) { out.summary++; continue; }"],
  ['같은 자재 두 줄을 더하지 않고 덮어씀', "if (prev) { // 같은", "if (false) { // 같은"],
  ['기준월보다 늦은 월 열도 씀', "cols = cols.filter(function (c) { return c.ym <= base; });", ""],
  ['판 맞추기 — logic.js 판만 다름', "var VERSION = '", "var VERSION = 'x"],
  ['평균을 당월 포함으로', "function windowMonths(base, n) { var a = []; for (var k = 1; k <= n; k++)", "function windowMonths(base, n) { var a = []; for (var k = 0; k < n; k++)"],
];
const res = [];
try {
  for (const [name, a, b] of breaks) {
    if (!orig.includes(a)) { res.push([name, '바꿀 곳을 못 찾음']); continue; }
    fs.writeFileSync(F, orig.replace(a, b));
    let out = '';
    try { out = execSync('node test/logic.test.mjs', { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { out = (e.stdout || '') + (e.stderr || ''); }
    const fails = (out.match(/FAIL/g) || []).length;
    res.push([name, fails ? '잡힘 — 실패 ' + fails + '개' : '못 잡음!']);
  }
} finally { fs.writeFileSync(F, orig); }
res.forEach(r => console.log(r[0].padEnd(28), r[1]));
console.log('원복 확인:', fs.readFileSync(F, 'utf8') === orig);
