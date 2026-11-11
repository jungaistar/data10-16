// 헤드리스 브라우저로 주요 흐름 점검 (선택 — playwright-core 가 있는 PC 에서만)
//   PLAYWRIGHT_CORE=/경로/node_modules/playwright-core node scripts/check-browser.mjs
// file:// 로 index.html 을 열어 샘플 → 7개 화면 × 두 폭(1280·390) 가로 넘침 → 요율 기간 바꾸기 → 엑셀·Word 내려받기와 내용
// → 설정(계획·자재별 MOQ) → AI 가리기 → 샘플 xlsx 를 파일 고르기로 가져오기 순서로 누르고, JS 오류를 잽니다.
// BREAK=1 이면 일부러 넓은 상자를 넣어 넘침 검사가 잡는지 봅니다.
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const XLSX = require(path.join(root, 'vendor/xlsx.full.min.js'));
const url = 'file://' + path.join(root, 'index.html');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'data10-16-check-'));

const errors = [], problems = [];
const browser = await chromium.launch();
const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
// fresh-guard 는 file:// 에서 HEAD 를 못 보내 콘솔에 한 줄 남깁니다(잡아서 무시함 — 배포 주소에서는 안 남)
page.on('console', m => { if (m.type() === 'error' && !/Fetch API cannot load file:.*_fg=/.test(m.text())) errors.push('console: ' + m.text()); });
page.on('dialog', d => d.accept());
function ok(cond, msg) { if (!cond) { problems.push(msg); console.log('  FAIL ' + msg); } else console.log('  ok  ' + msg); }
async function go(hash) { await page.evaluate(h => { location.hash = h; }, hash); await page.waitForTimeout(200); }
async function overflow() {
  return page.evaluate(() => {
    const W = document.documentElement.clientWidth, bad = [];
    document.querySelectorAll('main *').forEach(el => {
      const r = el.getBoundingClientRect(); if (!r.width || !r.height) return;
      let p = el.parentElement, inScroll = false;
      while (p) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll') { inScroll = true; break; } p = p.parentElement; }
      if (!inScroll && r.right > W + 1) bad.push(el.tagName + '.' + el.className);
    });
    return bad.slice(0, 3);
  });
}
async function saveDl(p) { const d = await p; const f = path.join(tmp, d.suggestedFilename()); await d.saveAs(f); return { name: d.suggestedFilename(), file: f }; }

await page.goto(url);
await page.evaluate(() => { localStorage.clear(); });
await page.reload();
if (process.env.BREAK) await page.addStyleTag({ content: '.page-head { min-width: 900px; }' });
ok((await page.textContent('main')).includes('수불 엑셀 가져오기'), '처음 열면 가져오기 화면');
await page.locator('button', { hasText: '샘플로 시작' }).first().click();
await page.waitForTimeout(500);
ok(await page.locator('#sampleBanner').isVisible(), '샘플 띠 보임');
ok(page.url().endsWith('#/order'), '샘플을 넣으면 ② 발주 리스트로');
let t = await page.textContent('main');
ok(/빨강 · 긴급\s*2종/.test(t) && /주황 · 이번 달 발주\s*5종/.test(t), '빨강 2 · 주황 5');
const firstRows = await page.$$eval('table.order tbody tr', trs => trs.slice(0, 2).map(tr => tr.className + ' ' + tr.textContent));
ok(firstRows.every(r => /row-red/.test(r)) && firstRows.some(r => r.includes('RM-102')) && firstRows.some(r => r.includes('RM-104')), '맨 위 두 줄이 빨강 RM-102·RM-104');
ok(await page.$$eval('table.order td.neg', a => a.length) > 0, '결품 칸 빨간 글자');

for (const w of [1280, 390]) {
  await page.setViewportSize({ width: w, height: 900 });
  for (const id of ['import', 'forecast', 'order', 'dead', 'ai', 'report', 'settings']) {
    await go('#/' + id);
    const bad = await overflow();
    ok(!bad.length, w + 'px ' + id + ' 가로 넘침 없음' + (bad.length ? ' — ' + bad.join(', ') : ''));
  }
}
await page.setViewportSize({ width: 1280, height: 900 });

// ① 요율 기간 바꾸기 → RM-110 이 더 급해짐
await go('#/order');
const before = await page.$$eval('table.order tbody tr', trs => (trs.find(tr => tr.textContent.includes('RM-110')) || {}).className || '');
await go('#/forecast');
await page.locator('button', { hasText: '요율 분기(3개월)' }).click();
await page.waitForTimeout(200);
await go('#/order');
const after = await page.$$eval('table.order tbody tr', trs => (trs.find(tr => tr.textContent.includes('RM-110')) || {}).className || '');
ok(before !== after, '요율 분기로 바꾸면 RM-110 우선순위가 바뀜 (' + before + ' → ' + after + ')');
await go('#/forecast');
// 단추 ↔ 계산 기간: 단추마다 눌린 단추 하나 = 타일 「직전 N개월」 = 설정 고르기 상자 = 보고서 머리
for (const [label, n] of [['분기(3개월)', 3], ['반기(6개월)', 6], ['년간(12개월)', 12], ['2년(24개월)', 24]]) {
  await go('#/forecast');
  const btn = page.locator('.tabs button', { hasText: '요율 ' + label });
  if (!(await btn.count())) { ok(false, '요율 ' + label + ' 단추가 있음'); continue; }
  await btn.click(); await page.waitForTimeout(150);
  const pr = await page.$$eval('.tabs[aria-label="요율 기간"] button[aria-pressed=true]', a => a.map(b => b.textContent));
  const tt = await page.textContent('main');
  await go('#/settings'); const sv = await page.$eval('main select', s => s.value);
  await go('#/report'); const rp = await page.textContent('main');
  ok(pr.join() === '요율 ' + label && tt.includes('직전 ' + n + '개월 평균 실적') && sv === String(n) && rp.includes('요율 직전 ' + n + '개월'), '요율 ' + label + ' — 눌린 단추 = 타일 = 설정 = 보고서 (' + pr + ' · 설정 ' + sv + ')');
}
await go('#/settings');
await page.selectOption('main select >> nth=0', '24'); await page.locator('button', { hasText: /^저장$/ }).first().click(); await page.waitForTimeout(150);
await go('#/forecast');
ok((await page.$$eval('.tabs[aria-label="요율 기간"] button[aria-pressed=true]', a => a.map(b => b.textContent))).join() === '요율 2년(24개월)', '설정에서 2년(24개월)을 고르면 ① 에서도 그 단추가 눌림');
await go('#/forecast');
await page.locator('button', { hasText: '요율 반기(6개월)' }).click();

// ② 엑셀
await go('#/order');
const x1 = await saveDl(Promise.all([page.waitForEvent('download'), page.locator('button', { hasText: '엑셀로 내려받기' }).click()]).then(a => a[0]));
const wb = XLSX.read(fs.readFileSync(x1.file), { type: 'buffer' });
ok(x1.name === '발주리스트_2026-10.xlsx' && wb.SheetNames.join(',') === '발주 리스트,전체 자재,월별 굴리기,출고 요율,장기·불용 지표', '엑셀 5개 시트');
const ol = XLSX.utils.sheet_to_json(wb.Sheets['발주 리스트'], { header: 1 });
ok(ol.length === 12 && ol[2][0] === '긴급' && ol[2][1] === '빨강', '발주 리스트 10줄, 첫 줄 긴급·빨강');

// ③ 장기·불용
await go('#/dead');
t = await page.textContent('main');
ok(/불용 의심\s*1종/.test(t) && t.includes('14개월 전'), '불용 의심 1종 · 14개월 전');

// ④ AI 가리기
await go('#/ai');
const prompt = await page.$eval('textarea.mono', el => el.value);
ok(!/공급사[A-D]|RM-1\d\d/.test(prompt) && /자재\d/.test(prompt), '프롬프트에 공급사·자재코드 없음(별칭만)');
const ans = page.locator('textarea').nth(1);
await ans.fill('자재1 먼저 확인'); await ans.blur(); await page.waitForTimeout(100);
ok((await ans.inputValue()).startsWith('RM-'), 'AI 답의 별칭 → 원래 코드');

// ⑤ 보고서 Word
await go('#/report');
ok((await page.textContent('main')).includes('6. AI 검토 의견'), '보고서에 AI 의견');
const w1 = await saveDl(Promise.all([page.waitForEvent('download'), page.locator('button', { hasText: 'Word 로' }).click()]).then(a => a[0]));
ok(fs.readFileSync(w1.file, 'utf8').includes('row-red'), 'Word 에 우선순위 색 줄');

// 설정 — 계획 바꾸기 · 자재별 MOQ
await go('#/settings');
const plans = page.locator('.inline-form input[type=number]');
await plans.nth(0).fill('120'); await plans.nth(1).fill('120'); await plans.nth(2).fill('120');
await page.locator('button', { hasText: '계획 저장' }).click(); await page.waitForTimeout(200);
await go('#/order');
const red2 = await page.$$eval('table.order tr.row-red', a => a.length);
ok(red2 <= 2, '계획을 줄이면 빨강이 늘지 않음 (' + red2 + ')');
await go('#/settings');
await page.locator('input[aria-label="SS400 6t×1524×3048 moq"]').fill('500000');
await page.locator('button', { hasText: '자재별 기준 저장' }).click(); await page.waitForTimeout(200);
await go('#/order');
const r102 = await page.$$eval('table.order tbody tr', trs => (trs.find(tr => tr.textContent.includes('RM-102')) || {}).textContent || '');
ok(r102.includes('500,000') && r102.includes('MOQ 과다'), 'RM-102 MOQ 500,000 반영 · MOQ 과다 표시 (계획을 줄인 뒤에도 빨강인 자재)');

// 실제 파일 넣기 — samples/ 의 통합문서
await go('#/import');
await page.locator('button', { hasText: '모든 데이터 지우기' }).click(); await page.waitForTimeout(200);
await page.setInputFiles('input[type=file][multiple]', path.join(root, 'samples', '수불_샘플_2026-10.xlsx'));
await page.waitForTimeout(800);
t = await page.textContent('main');
ok(t.includes('반영 준비됨') && t.includes('출고 24개월 (2024-10 ~ 2026-09)'), '샘플 파일: 시트 3장 가름, 출고 24개월');
await page.locator('button', { hasText: '확인한 1개 파일 반영' }).click(); await page.waitForTimeout(300);
ok((await page.textContent('#dataChip')).includes('자재 20종'), '반영 후 자재 20종');
ok(!(await page.locator('#sampleBanner').isVisible()), '파일로 넣으면 샘플 띠 없음');

// 옛 logic.js 가 섞여 들어오면 계산하지 않고 새로고침 안내
const p2 = await ctx.newPage();
await p2.addInitScript(() => { let v; Object.defineProperty(window, 'MRLogic', { configurable: true, get: () => v, set: x => { x.VERSION = '2026-10-20.1'; v = x; } }); });
await p2.goto(url); await p2.waitForTimeout(300);
ok(await p2.locator('#versionMismatch').isVisible() && !(await p2.locator('table.order, .tabs').count()), '판이 다르면 「새 판이 나왔습니다 — 새로고침(Ctrl+F5)」 안내, 계산 화면 없음');
await p2.close();
ok((await page.textContent('.site-footer')).includes('판 2026-'), '바닥글에 판 표시');

ok(!errors.length, 'JS 오류 없음' + (errors.length ? ' — ' + errors.slice(0, 3).join(' | ') : ''));
await browser.close();
console.log(problems.length ? '\n문제 ' + problems.length + '건' : '\n모두 통과');
process.exitCode = problems.length ? 1 : 0;
