'use strict';
/* ================================================================
   억을모으자 — 모든 데이터는 이 기기(localStorage)에만 저장됩니다.
   서버로 전송되는 것은 오직 'AI 피드백'을 켰을 때 Claude API 호출뿐입니다.
   ================================================================ */

/* ---------- 저장소 ---------- */
const KEY = 'moneybook.v1';
const DEFAULTS = {
  tx: [],            // {id, type:'expense'|'income', amount, category, date:'YYYY-MM-DD', memo}
  recurring: [],     // {id, type, amount, category, memo, day, from:'YYYY-MM', last:'YYYY-MM'}
  budgets: {},       // { category: 월예산금액 }  (매월 반복 적용)
  assets: [],        // {id, name, type, value(평가금액), principal(원금·선택), memo}
  allocation: [      // 월급 배분 목표 (role: 'save' 저축·투자 / 'spend' 소비)
    { name: '저축', pct: 30, emoji: '🐷', role: 'save' },
    { name: '투자', pct: 20, emoji: '📈', role: 'save' },
    { name: '생활비', pct: 50, emoji: '🛒', role: 'spend' }
  ],
  goals: { monthlySpend: 0, annualSaving: 0, assetGoal: 100000000 },
  categories: {
    expense: [
      { name: '식비', emoji: '🍚' }, { name: '카페/간식', emoji: '☕' },
      { name: '교통', emoji: '🚌' }, { name: '주거/통신', emoji: '🏠' },
      { name: '생활', emoji: '🧺' }, { name: '쇼핑', emoji: '🛍️' },
      { name: '의료/건강', emoji: '💊' }, { name: '문화/여가', emoji: '🎬' },
      { name: '경조사', emoji: '🎁' }, { name: '기타', emoji: '💸' }
    ],
    income: [
      { name: '월급', emoji: '💼' }, { name: '용돈', emoji: '💰' },
      { name: '부수입', emoji: '📈' }, { name: '기타수입', emoji: '✨' }
    ]
  },
  settings: { apiKey: '', model: 'claude-opus-4-8', theme: 'system' }
};

let DB;
function load() {
  // 1순위 본 저장소, 손상/없으면 2순위 자동백업본을 시도 (절대 스스로 데이터를 날리지 않음)
  let parsed = null;
  try { const raw = localStorage.getItem(KEY); if (raw) parsed = JSON.parse(raw); } catch { parsed = null; }
  if (!parsed || !Array.isArray(parsed.tx)) {
    try { const b = localStorage.getItem(KEY + '.bak'); if (b) { const p = JSON.parse(b); if (Array.isArray(p.tx)) parsed = p; } } catch { /* ignore */ }
  }
  DB = { ...structuredClone(DEFAULTS), ...(parsed || {}) };
  // 중첩 기본값 보정
  DB.goals = { ...DEFAULTS.goals, ...(DB.goals || {}) };
  DB.settings = { ...DEFAULTS.settings, ...(DB.settings || {}) };
  DB.categories = DB.categories || structuredClone(DEFAULTS.categories);
  DB.assets = DB.assets || [];
  DB.allocation = (DB.allocation && DB.allocation.length) ? DB.allocation : structuredClone(DEFAULTS.allocation);
}

// 자산 종류
const ASSET_TYPES = [
  { t: '적금', e: '🏦' }, { t: '예금', e: '💵' }, { t: '주식', e: '📈' },
  { t: '펀드/ETF', e: '📊' }, { t: '코인', e: '🪙' }, { t: '연금', e: '👵' },
  { t: '현금', e: '💰' }, { t: '기타', e: '📦' }
];
const assetEmoji = (type) => (ASSET_TYPES.find((x) => x.t === type) || { e: '📦' }).e;
function save() {
  const s = JSON.stringify(DB);
  localStorage.setItem(KEY, s);
  try { localStorage.setItem(KEY + '.bak', s); } catch { /* 용량 초과 등 무시 */ }
}

/* ---------- 테마 ---------- */
function applyTheme() {
  const t = DB.settings.theme || 'system';
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('theme-dark', dark);
  const meta = document.getElementById('theme-color');
  if (meta) meta.setAttribute('content', dark ? '#101014' : '#3182F6');
}
// 시스템 테마가 바뀌면 (설정이 '시스템'일 때) 자동 반영
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if ((DB.settings.theme || 'system') === 'system') applyTheme();
});

/* ---------- 유틸 ---------- */
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const won = (n) => (n < 0 ? '-' : '') + '₩' + Math.abs(Math.round(n)).toLocaleString('ko-KR');
const comma = (n) => Math.round(Math.abs(n)).toLocaleString('ko-KR');   // 콤마만 (₩ 없이)
const wonShort = (n) => {
  const a = Math.abs(n);
  if (a >= 100000000) return (n / 100000000).toFixed(1).replace(/\.0$/, '') + '억';
  if (a >= 10000) return Math.round(n / 10000).toLocaleString('ko-KR') + '만';
  return won(n);
};
const ym = (d) => d.slice(0, 7);                     // 'YYYY-MM'
const todayStr = () => new Date().toISOString().slice(0, 10);
const monthLabel = (yms) => { const [y, m] = yms.split('-'); return `${y}년 ${+m}월`; };
const catInfo = (type, name) => (DB.categories[type] || []).find((c) => c.name === name) || { name, emoji: type === 'income' ? '✨' : '💸' };
const shiftMonth = (yms, delta) => {
  const [y, m] = yms.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
};

// 색상 팔레트 (통계 차트)
const PALETTE = ['#16a085', '#2f80ed', '#eb5757', '#f2994a', '#9b51e0', '#2d9cdb', '#27ae60', '#e67e22', '#eb5794', '#56ccf2'];

/* ---------- 앱 상태 ---------- */
let curMonth = ym(todayStr());     // 현재 보고 있는 달
let curTab = 'home';

/* ---------- 반복 거래 자동 생성 ---------- */
function runRecurring() {
  const nowYM = ym(todayStr());
  let added = 0;
  for (const r of DB.recurring) {
    // r.from 부터 이번 달까지, 아직 생성 안 된 달들을 채운다
    let m = r.last ? shiftMonth(r.last, 1) : (r.from || nowYM);
    while (m <= nowYM) {
      const [y, mm] = m.split('-').map(Number);
      const lastDay = new Date(y, mm, 0).getDate();
      const day = Math.min(r.day || 1, lastDay);
      const date = `${m}-${String(day).padStart(2, '0')}`;
      DB.tx.push({ id: uid(), type: r.type, amount: r.amount, category: r.category, date, memo: (r.memo || '') + ' (반복)', recurringId: r.id });
      r.last = m; added++;
      m = shiftMonth(m, 1);
    }
  }
  if (added) save();
  return added;
}

/* ---------- 집계 ---------- */
function txOfMonth(yms) { return DB.tx.filter((t) => ym(t.date) === yms); }
function sum(list, type) { return list.filter((t) => t.type === type).reduce((s, t) => s + t.amount, 0); }
function catTotals(yms, type) {
  const map = {};
  for (const t of txOfMonth(yms)) if (t.type === type) map[t.category] = (map[t.category] || 0) + t.amount;
  return Object.entries(map).sort((a, b) => b[1] - a[1]);
}
function yearNet(year) {
  return DB.tx.filter((t) => t.date.slice(0, 4) === String(year))
    .reduce((s, t) => s + (t.type === 'income' ? t.amount : -t.amount), 0);
}

/* ================================================================
   렌더링
   ================================================================ */
const view = document.getElementById('view');

function render() {
  if (curTab === 'home') renderHome();
  else if (curTab === 'list') renderList();
  else if (curTab === 'save') renderSave();
  else if (curTab === 'stats') renderStats();
  else if (curTab === 'more') renderMore();
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === curTab));
  window.scrollTo(0, 0);
}

// 상단 월 선택 바 (‹ 2026년 7월 › + 오늘 버튼)
function monthBarHTML() {
  const isCur = curMonth === ym(todayStr());
  return `<div class="appbar">
    <div class="mtitle">
      <button data-mn="-1">‹</button>
      <b class="num">${monthLabel(curMonth)}</b>
      <button data-mn="1">›</button>
    </div>
    ${isCur ? '' : `<button class="today-btn" data-today>오늘</button>`}
  </div>`;
}
function bindMonthNav() {
  view.querySelectorAll('[data-mn]').forEach((b) => b.onclick = () => { curMonth = shiftMonth(curMonth, +b.dataset.mn); render(); });
  const t = view.querySelector('[data-today]');
  if (t) t.onclick = () => { curMonth = ym(todayStr()); render(); };
}

// 캘린더용 초압축 금액 표기 (3.2만 / 12만 / 8천 / 500)
function calAmt(n) {
  if (n >= 100000000) return (n / 100000000).toFixed(1).replace(/\.0$/, '') + '억';
  if (n >= 10000) { const v = n / 10000; return (v >= 10 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, '')) + '만'; }
  if (n >= 1000) return Math.round(n / 1000) + '천';
  return String(n);
}

// 목표 진행 바(얇은 버전)
function goalSlimHTML(expense) {
  const target = DB.goals.monthlySpend;
  if (!target) return '';
  const pct = Math.min(100, (expense / target) * 100);
  const cls = expense > target ? 'over' : (pct > 85 ? 'warn' : '');
  const remain = target - expense;
  return `<div class="slim">
    <div class="top"><span>지출 목표</span><span class="r num">${won(expense)} / ${won(target)}</span></div>
    <div class="track ${cls}"><span style="width:${pct}%"></span></div>
    <div class="hint">${remain >= 0 ? `${won(remain)} 남았어요` : `${won(-remain)} 초과했어요`}</div>
  </div>`;
}

/* ---------- 홈 = 월간 캘린더 ---------- */
function renderHome() {
  const list = txOfMonth(curMonth);
  const income = sum(list, 'income'), expense = sum(list, 'expense');
  const balance = income - expense;

  // 날짜별 지출/수입 합계 (전체 DB 기준 — 이웃 달 칸도 채우기 위함)
  const byDay = {};
  for (const t of DB.tx) { (byDay[t.date] ||= { e: 0, i: 0 })[t.type === 'expense' ? 'e' : 'i'] += t.amount; }
  // 히트맵 강도는 '이번 달' 최대 지출일 기준
  const monthExpByDay = {};
  for (const t of list) if (t.type === 'expense') monthExpByDay[t.date] = (monthExpByDay[t.date] || 0) + t.amount;
  const maxE = Math.max(1, ...Object.values(monthExpByDay));

  const [Y, Mo] = curMonth.split('-').map(Number);
  const startWd = new Date(Y, Mo - 1, 1).getDay();       // 1일의 요일 (0=일)
  const daysInMonth = new Date(Y, Mo, 0).getDate();
  const prevDays = new Date(Y, Mo - 1, 0).getDate();
  const todayS = todayStr();

  let cells = '';
  for (let i = startWd - 1; i >= 0; i--) {               // 앞 달 잔여일 (흐리게)
    const d = prevDays - i;
    cells += dayCellHTML(`${shiftMonth(curMonth, -1)}-${String(d).padStart(2, '0')}`, d, true, byDay, maxE, todayS);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells += dayCellHTML(`${curMonth}-${String(d).padStart(2, '0')}`, d, false, byDay, maxE, todayS);
  }
  const trail = (7 - ((startWd + daysInMonth) % 7)) % 7; // 다음 달 채우기
  for (let d = 1; d <= trail; d++) {
    cells += dayCellHTML(`${shiftMonth(curMonth, 1)}-${String(d).padStart(2, '0')}`, d, true, byDay, maxE, todayS);
  }

  view.innerHTML = `
    <div class="brand">
      <img class="logo" src="icons/coin.png" alt="">
      <span class="wm"><span class="hi">억</span>을모으자</span>
    </div>
    ${monthBarHTML()}
    <div class="hero">
      <div class="label">이번 달 지출</div>
      <div class="big num">${won(expense)}</div>
      <div class="sub">수입 <span class="inc num">${won(income)}</span> · 잔액 <span class="bal num">${(balance >= 0 ? '+' : '') + won(balance)}</span></div>
      ${goalSlimHTML(expense)}
    </div>
    <div class="card cal">
      <div class="cal-week"><span class="sun">일</span><span>월</span><span>화</span><span>수</span><span>목</span><span>금</span><span class="sat">토</span></div>
      <div class="cal-grid">${cells}</div>
    </div>
    <button class="btn soft" id="ai-btn">🤖 이번 달 AI 소비 피드백</button>
    <div id="ai-out"></div>
  `;

  bindMonthNav();
  view.querySelectorAll('.day[data-date]').forEach((el) => el.onclick = () => openDay(el.dataset.date));
  document.getElementById('ai-btn').onclick = runAIFeedback;
}

function dayCellHTML(ds, dnum, dim, byDay, maxE, todayS) {
  const wd = new Date(ds + 'T00:00').getDay();
  const dd = byDay[ds] || { e: 0, i: 0 };
  const heat = dim ? 0 : Math.min(0.16, dd.e / maxE * 0.16);
  const cls = ['day'];
  if (dim) cls.push('dim');
  if (wd === 0) cls.push('sun'); else if (wd === 6) cls.push('sat');
  if (ds === todayS) cls.push('today');
  let amt = '';
  if (dd.e || dd.i) {
    amt = `<div class="damt">${dd.e ? `<span class="e num">${comma(dd.e)}</span>` : ''}${dd.i ? `<span class="i num">+${comma(dd.i)}</span>` : ''}</div>`;
  }
  return `<button class="${cls.join(' ')}" data-date="${ds}" style="--heat:${heat}"><span class="dnum num">${dnum}</span>${amt}</button>`;
}

/* ---------- 하루 상세 시트 ---------- */
function openDay(dateStr) {
  const dayList = DB.tx.filter((t) => t.date === dateStr).sort((a, b) => (a.type === b.type ? 0 : a.type === 'income' ? -1 : 1));
  const d = new Date(dateStr + 'T00:00');
  const wd = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
  const e = sum(dayList, 'expense'), i = sum(dayList, 'income');
  openSheet(`
    <h3>${+dateStr.slice(5, 7)}월 ${+dateStr.slice(8, 10)}일 (${wd})</h3>
    <div class="pills" style="margin-bottom:6px">
      <div class="pill"><div class="k">지출</div><div class="v exp num">${won(e)}</div></div>
      <div class="pill"><div class="k">수입</div><div class="v inc num">${won(i)}</div></div>
    </div>
    ${dayList.length ? `<div class="card" style="padding:6px 14px;margin-top:14px">${dayList.map(txRowHTML).join('')}</div>`
      : `<div class="empty" style="padding:30px"><div class="big">🗒️</div>이 날 기록이 없어요.</div>`}
    <button class="btn primary" id="day-add" style="margin-top:14px">+ 이 날 내역 추가</button>
  `);
  sheetEl.querySelectorAll('.tx').forEach((el) => el.onclick = () => openEditor(el.dataset.id, { date: dateStr }));
  sheetEl.querySelector('#day-add').onclick = () => openEditor(null, { date: dateStr });
}

function txRowHTML(t) {
  const c = catInfo(t.type, t.category);
  const sign = t.type === 'income' ? '+' : '-';
  return `<div class="tx" data-id="${t.id}">
    <div class="emoji">${c.emoji}</div>
    <div class="mid">
      <div class="cat">${esc(t.category)}</div>
      ${t.memo ? `<div class="memo">${esc(t.memo)}</div>` : ''}
    </div>
    <div class="amt ${t.type}">${sign}${won(t.amount)}</div>
  </div>`;
}

/* ---------- 내역 ---------- */
function renderList() {
  const list = [...txOfMonth(curMonth)].sort((a, b) => (a.date < b.date ? 1 : (a.date > b.date ? -1 : 0)));
  const income = sum(list, 'income'), expense = sum(list, 'expense');

  let body = '';
  if (!list.length) {
    body = `<div class="card"><div class="empty"><div class="big">🗒️</div>이 달의 기록이 없어요.</div></div>`;
  } else {
    const groups = {};
    for (const t of list) (groups[t.date] ||= []).push(t);
    for (const date of Object.keys(groups).sort((a, b) => (a < b ? 1 : -1))) {
      const g = groups[date];
      const wd = ['일', '월', '화', '수', '목', '금', '토'][new Date(date + 'T00:00').getDay()];
      const dExp = sum(g, 'expense');
      body += `<div class="day-head"><span class="d">${+date.slice(5, 7)}.${+date.slice(8, 10)} ${wd}</span><span class="s">지출 ${won(dExp)}</span></div>
        <div class="card" style="padding:4px 14px">${g.map(txRowHTML).join('')}</div>`;
    }
  }

  view.innerHTML = `
    <div class="page-title">내역</div>
    ${monthBarHTML()}
    <div class="pills">
      <div class="pill"><div class="k">수입</div><div class="v inc num">${won(income)}</div></div>
      <div class="pill"><div class="k">지출</div><div class="v exp num">${won(expense)}</div></div>
      <div class="pill"><div class="k">잔액</div><div class="v exp num">${(income - expense >= 0 ? '+' : '') + won(income - expense)}</div></div>
    </div>
    ${body}
  `;
  bindMonthNav();
  view.querySelectorAll('.tx').forEach((el) => el.onclick = () => openEditor(el.dataset.id));
}

/* ---------- 통계 ---------- */
function renderStats() {
  const totals = catTotals(curMonth, 'expense');
  const total = totals.reduce((s, [, v]) => s + v, 0);

  let donut = '';
  if (total > 0) {
    let acc = 0;
    const segs = totals.map(([name, v], i) => {
      const frac = v / total;
      const seg = arc(75, 75, 60, acc, acc + frac, PALETTE[i % PALETTE.length]);
      acc += frac; return seg;
    }).join('');
    donut = `<div class="donut-wrap">
      <svg class="donut" viewBox="0 0 150 150">
        ${segs}
        <circle cx="75" cy="75" r="42" fill="var(--card)"/>
        <text class="donut-center" x="75" y="70" text-anchor="middle">지출 합계</text>
        <text class="donut-center-v" x="75" y="88" text-anchor="middle">${wonShort(total)}</text>
      </svg>
      <div class="legend">
        ${totals.slice(0, 6).map(([name, v], i) => `<div class="legend-row">
          <span class="dot" style="background:${PALETTE[i % PALETTE.length]}"></span>
          <span>${catInfo('expense', name).emoji} ${esc(name)}</span>
          <span class="pct">${Math.round(v / total * 100)}%</span>
        </div>`).join('')}
      </div>
    </div>`;
  } else {
    donut = `<div class="empty"><div class="big">📊</div>이 달의 지출 기록이 없어요.</div>`;
  }

  // 예산 대비 실제
  let budgetHTML = '';
  const budgeted = Object.entries(DB.budgets).filter(([, v]) => v > 0);
  if (budgeted.length) {
    budgetHTML = `<div class="card"><h2>카테고리 예산</h2>` +
      budgeted.map(([name, bud]) => {
        const spent = (totals.find(([n]) => n === name) || [null, 0])[1];
        const pct = Math.min(100, spent / bud * 100);
        const cls = spent > bud ? 'over' : (pct > 85 ? 'warn' : '');
        return `<div class="goal">
          <div class="top"><span class="name">${catInfo('expense', name).emoji} ${esc(name)}</span>
            <span class="val num">${won(spent)} / ${won(bud)}</span></div>
          <div class="track ${cls}"><span style="width:${pct}%"></span></div>
        </div>`;
      }).join('') + `</div>`;
  }

  // 카테고리별 상세 리스트
  const detail = total > 0 ? `<div class="card"><h2>카테고리별 지출</h2>` +
    totals.map(([name, v], i) => {
      const pct = v / total * 100;
      return `<div class="cat-line">
        <span class="emoji">${catInfo('expense', name).emoji}</span>
        <div class="grow">
          <div class="top"><span>${esc(name)}</span><span class="num">${won(v)}</span></div>
          <div class="track"><span style="width:${pct}%;background:${PALETTE[i % PALETTE.length]}"></span></div>
        </div>
      </div>`;
    }).join('') + `</div>` : '';

  view.innerHTML = `
    <div class="page-title">통계</div>
    ${monthBarHTML()}
    <div class="card">${donut}</div>
    ${budgetHTML}
    ${detail}
  `;
  bindMonthNav();
}

// 도넛 조각 SVG path
function arc(cx, cy, r, from, to, color) {
  if (to - from >= 0.9999) { // 전체 원
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="30"/>`;
  }
  const a0 = from * 2 * Math.PI - Math.PI / 2;
  const a1 = to * 2 * Math.PI - Math.PI / 2;
  const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
  const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
  const large = (to - from) > 0.5 ? 1 : 0;
  return `<path d="M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}" fill="none" stroke="${color}" stroke-width="30"/>`;
}

/* ================================================================
   모으기 = 자산 관리 + 월급 배분
   ================================================================ */
function renderSave() {
  const assets = DB.assets;
  const total = assets.reduce((s, a) => s + (a.value || 0), 0);
  // 손익은 '원금을 입력한 투자 자산'만 대상 (적금·예금 제외)
  const invested = assets.filter((a) => a.principal > 0);
  const principal = invested.reduce((s, a) => s + a.principal, 0);
  const investValue = invested.reduce((s, a) => s + a.value, 0);
  const profitTotal = investValue - principal;
  const goal = DB.goals.assetGoal || 100000000;
  const pct = Math.min(100, total / goal * 100);

  const nowYM = ym(todayStr());
  const monthList = txOfMonth(nowYM);
  const income = sum(monthList, 'income');
  const expense = sum(monthList, 'expense');
  const saved = income - expense;

  let allocHTML;
  if (income > 0) {
    allocHTML = DB.allocation.map((b) => {
      const target = Math.round(income * b.pct / 100);
      let extra = '';
      if (b.role === 'spend' && target > 0) {
        const over = expense - target;
        extra = `<div class="track ${expense > target ? 'over' : ''}" style="margin-top:7px"><span style="width:${Math.min(100, expense / target * 100)}%"></span></div>
          <div class="hint" style="margin-top:5px">실제 지출 <span class="num">${won(expense)}</span> · ${over > 0 ? `<span style="color:var(--expense)">${won(over)} 초과</span>` : `${won(-over)} 남음`}</div>`;
      }
      return `<div style="margin-bottom:15px">
        <div style="display:flex;justify-content:space-between;align-items:baseline">
          <span style="font-weight:700">${b.emoji} ${esc(b.name)} <span class="muted tiny">${b.pct}%</span></span>
          <span class="num" style="font-weight:800">${won(target)}</span>
        </div>${extra}</div>`;
    }).join('');
  } else {
    allocHTML = `<div class="hint">이번 달 수입(월급)을 기록하면 배분 목표가 자동으로 계산돼요.</div>`;
  }

  const assetCards = assets.length ? assets.map(assetRowHTML).join('') :
    `<div class="card"><div class="empty" style="padding:26px"><div class="big">🐷</div>아직 등록한 자산이 없어요.<br>적금·주식·예금을 추가해보세요.</div></div>`;

  view.innerHTML = `
    <div class="page-title">모으기</div>
    <div class="hero">
      <div class="label">총자산</div>
      <div class="big num">${won(total)}</div>
      ${principal > 0 ? `<div class="sub">투자원금 <span class="num">${won(principal)}</span> · 평가손익 <span class="num" style="color:${profitTotal >= 0 ? 'var(--income)' : 'var(--expense)'}">${(profitTotal >= 0 ? '+' : '') + won(profitTotal)}</span></div>` : ''}
      <div class="slim">
        <div class="top"><span>🎯 목표 ${won(goal)}</span><span class="r num">${pct < 10 ? pct.toFixed(1) : Math.round(pct)}%</span></div>
        <div class="track inc"><span style="width:${pct}%"></span></div>
        <div class="hint">${total >= goal ? '목표 달성! 🎉' : `목표까지 ${won(goal - total)}`} · <a data-editgoal>목표 수정</a></div>
      </div>
    </div>

    <div class="card">
      <h2>💰 월급 배분 <span class="muted tiny" style="font-weight:600">이번 달 수입 ${won(income)}</span></h2>
      ${allocHTML}
      ${income > 0 ? `<div class="hint" style="margin-top:2px">이번 달 실제로 남긴 돈: <b class="num" style="color:var(--income)">${(saved >= 0 ? '+' : '') + won(saved)}</b></div>` : ''}
      <button class="btn ghost" data-alloc style="margin-top:14px">배분 목표 설정</button>
    </div>

    <div style="display:flex;justify-content:space-between;align-items:center;margin:6px 4px 10px">
      <h2 style="margin:0;font-size:16px">내 자산 ${assets.length ? `<span class="muted tiny">${assets.length}개</span>` : ''}</h2>
      <button data-addasset style="color:var(--accent);font-weight:700;font-size:15px">+ 추가</button>
    </div>
    ${assetCards}
  `;
  view.querySelector('[data-alloc]').onclick = openAllocation;
  view.querySelector('[data-addasset]').onclick = () => openAsset(null);
  const eg = view.querySelector('[data-editgoal]'); if (eg) eg.onclick = openAssetGoal;
  view.querySelectorAll('[data-asset]').forEach((el) => el.onclick = () => openAsset(el.dataset.asset));
}

function assetRowHTML(a) {
  const profit = a.principal ? a.value - a.principal : null;
  const rate = a.principal ? (a.value - a.principal) / a.principal * 100 : null;
  return `<div class="card" style="padding:14px 16px;margin-bottom:10px" data-asset="${a.id}">
    <div class="tx" style="padding:0">
      <div class="emoji">${assetEmoji(a.type)}</div>
      <div class="mid"><div class="cat">${esc(a.name)}</div><div class="memo">${esc(a.type)}${a.memo ? ' · ' + esc(a.memo) : ''}</div></div>
      <div style="text-align:right">
        <div class="amt expense num">${won(a.value)}</div>
        ${profit !== null ? `<div class="tiny num" style="font-weight:700;margin-top:2px;color:${profit >= 0 ? 'var(--income)' : 'var(--expense)'}">${profit >= 0 ? '+' : ''}${won(profit)} · ${rate >= 0 ? '+' : ''}${rate.toFixed(1)}%</div>` : ''}
      </div>
    </div>
  </div>`;
}

function openAsset(id) {
  const editing = id ? DB.assets.find((a) => a.id === id) : null;
  const d = editing ? { ...editing } : { type: '적금', name: '', value: '', principal: '', memo: '' };
  openSheet(`
    <h3>${editing ? '자산 수정' : '자산 추가'}</h3>
    <div class="field"><label>종류</label>
      <div class="chips" id="atypes">${ASSET_TYPES.map((x) => `<button class="chip ${x.t === d.type ? 'on' : ''}" data-t="${x.t}">${x.e} ${x.t}</button>`).join('')}</div></div>
    <div class="field"><label>이름</label><input id="a-name" type="text" placeholder="예: 주택청약, 삼성전자" value="${esc(d.name)}"></div>
    <div class="field"><label>현재 평가금액</label><input id="a-value" class="amount-input" type="number" inputmode="numeric" placeholder="0" value="${d.value || ''}"></div>
    <div class="field"><label>투자 원금 <span class="muted tiny">선택 — 넣으면 수익률까지 계산</span></label>
      <input id="a-principal" type="number" inputmode="numeric" placeholder="비워두면 금액만 표시" value="${d.principal || ''}"></div>
    <div class="field"><label>메모 (선택)</label><input id="a-memo" type="text" placeholder="" value="${esc(d.memo || '')}"></div>
    <button class="btn primary" id="a-save">${editing ? '저장' : '추가'}</button>
    ${editing ? `<button class="btn danger" id="a-del" style="margin-top:8px">삭제</button>` : ''}
  `);
  sheetEl.querySelectorAll('#atypes .chip').forEach((b) => b.onclick = () => {
    sheetEl.querySelectorAll('#atypes .chip').forEach((x) => x.classList.remove('on')); b.classList.add('on'); d.type = b.dataset.t;
  });
  sheetEl.querySelector('#a-save').onclick = () => {
    const name = sheetEl.querySelector('#a-name').value.trim();
    const value = Math.round(Number(sheetEl.querySelector('#a-value').value) || 0);
    const principal = Math.round(Number(sheetEl.querySelector('#a-principal').value) || 0);
    const memo = sheetEl.querySelector('#a-memo').value.trim();
    if (!name) return toast('이름을 입력해주세요');
    if (value <= 0) return toast('평가금액을 입력해주세요');
    const rec = { type: d.type, name, value, principal: principal || 0, memo };
    if (editing) Object.assign(editing, rec); else DB.assets.push({ id: uid(), ...rec });
    save(); closeSheet(); render(); toast(editing ? '저장했어요 ✓' : '추가했어요 ✓');
  };
  if (editing) sheetEl.querySelector('#a-del').onclick = () => {
    if (confirm('이 자산을 삭제할까요?')) { DB.assets = DB.assets.filter((a) => a.id !== id); save(); closeSheet(); render(); toast('삭제했어요'); }
  };
}

function openAssetGoal() {
  openSheet(`<h3>🎯 자산 목표</h3>
    <div class="field"><label>목표 총자산</label>
      <input id="ag" type="number" inputmode="numeric" placeholder="100000000" value="${DB.goals.assetGoal || ''}">
      <div class="hint">「억을모으자」의 목표 금액이에요. 기본은 1억(100,000,000)이에요.</div></div>
    <button class="btn primary" id="ag-save">저장</button>`);
  sheetEl.querySelector('#ag-save').onclick = () => {
    DB.goals.assetGoal = Math.max(0, Math.round(Number(sheetEl.querySelector('#ag').value) || 0)) || 100000000;
    save(); closeSheet(); render(); toast('목표를 저장했어요');
  };
}

function openAllocation() {
  openSheet(`<h3>💰 월급 배분 목표</h3>
    <div class="hint" style="margin-bottom:16px">월급을 어떤 비율로 나눌지 정해요. 합계가 100%가 되게 맞춰주세요.</div>
    ${DB.allocation.map((b, i) => `<div class="field" style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
      <label style="margin:0;flex:1">${b.emoji} ${esc(b.name)}${b.role === 'spend' ? ' <span class="muted tiny">소비</span>' : ''}</label>
      <div style="display:flex;align-items:center;gap:6px;width:110px">
        <input class="alloc" data-i="${i}" type="number" inputmode="numeric" value="${b.pct}" style="text-align:right"><span class="muted">%</span></div>
    </div>`).join('')}
    <div class="hint" id="alloc-sum" style="text-align:right"></div>
    <button class="btn primary" id="al-save" style="margin-top:12px">저장</button>`);
  const upd = () => {
    const s = [...sheetEl.querySelectorAll('.alloc')].reduce((t, i) => t + (Number(i.value) || 0), 0);
    sheetEl.querySelector('#alloc-sum').innerHTML = `합계 <b style="color:${s === 100 ? 'var(--income)' : 'var(--expense)'}">${s}%</b>${s === 100 ? ' ✓' : ' — 100%로 맞춰주세요'}`;
  };
  sheetEl.querySelectorAll('.alloc').forEach((i) => i.oninput = upd); upd();
  sheetEl.querySelector('#al-save').onclick = () => {
    sheetEl.querySelectorAll('.alloc').forEach((i) => { DB.allocation[Number(i.dataset.i)].pct = Math.max(0, Math.round(Number(i.value) || 0)); });
    save(); closeSheet(); render(); toast('배분 목표를 저장했어요');
  };
}

/* ---------- 더보기 ---------- */
function renderMore() {
  const rc = DB.recurring.length;
  const bc = Object.values(DB.budgets).filter((v) => v > 0).length;
  view.innerHTML = `
    <div class="page-title">더보기</div>
    <div class="card">
      <div class="list-item" data-go="goals"><span class="ic">🎯</span>
        <div class="grow"><div>목표 설정</div><div class="sub">월 지출 목표 · 연간 저축 목표</div></div><span class="chev">›</span></div>
      <div class="list-item" data-go="budgets"><span class="ic">📊</span>
        <div class="grow"><div>카테고리 예산</div><div class="sub">${bc ? bc + '개 설정됨' : '미설정'}</div></div><span class="chev">›</span></div>
      <div class="list-item" data-go="recurring"><span class="ic">🔁</span>
        <div class="grow"><div>반복 지출 · 구독</div><div class="sub">${rc ? rc + '개 등록됨' : '월세, 구독료 등 자동 기록'}</div></div><span class="chev">›</span></div>
      <div class="list-item" data-go="categories"><span class="ic">🏷️</span>
        <div class="grow"><div>카테고리 관리</div></div><span class="chev">›</span></div>
    </div>
    <div class="card">
      <div class="list-item" data-go="theme"><span class="ic">🌗</span>
        <div class="grow"><div>화면 테마</div><div class="sub">${{ system: '시스템 자동', light: '밝게', dark: '어둡게' }[DB.settings.theme || 'system']}</div></div><span class="chev">›</span></div>
      <div class="list-item" data-go="ai"><span class="ic">🤖</span>
        <div class="grow"><div>AI 피드백 설정</div><div class="sub">${DB.settings.apiKey ? '연결됨 · ' + DB.settings.model : 'API 키 미설정'}</div></div><span class="chev">›</span></div>
    </div>
    <div class="card">
      <div class="list-item" data-go="export"><span class="ic">📤</span><div class="grow"><div>데이터 백업 (내보내기)</div></div><span class="chev">›</span></div>
      <div class="list-item" data-go="import"><span class="ic">📥</span><div class="grow"><div>데이터 복원 (가져오기)</div></div><span class="chev">›</span></div>
      <div class="list-item" data-go="reset"><span class="ic">🗑️</span><div class="grow"><div style="color:var(--expense)">전체 데이터 삭제</div></div></div>
    </div>
    <div class="hint" style="text-align:center;padding:6px 20px 20px">
      모든 데이터는 이 기기에만 저장됩니다.<br>앱 삭제 전 꼭 백업하세요.
    </div>
  `;
  view.querySelectorAll('[data-go]').forEach((el) => el.onclick = () => moreAction(el.dataset.go));
}

function moreAction(what) {
  if (what === 'theme') openTheme();
  else if (what === 'goals') openGoals();
  else if (what === 'budgets') openBudgets();
  else if (what === 'recurring') openRecurringList();
  else if (what === 'categories') openCategories();
  else if (what === 'ai') openAISettings();
  else if (what === 'export') exportData();
  else if (what === 'import') importData();
  else if (what === 'reset') resetData();
}

/* ================================================================
   입력 시트 (바텀 시트)
   ================================================================ */
const sheetEl = document.getElementById('sheet');
const backdrop = document.getElementById('backdrop');

function openSheet(html) {
  sheetEl.innerHTML = `<div class="grab"></div>` + html;
  sheetEl.classList.remove('hidden', 'closing');
  backdrop.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}
function closeSheet() {
  sheetEl.classList.add('closing');
  backdrop.classList.add('hidden');
  document.body.style.overflow = '';
  setTimeout(() => sheetEl.classList.add('hidden'), 260);
}
backdrop.onclick = closeSheet;

/* ---------- 거래 입력/편집 ---------- */
function openEditor(id, preset) {
  const editing = id ? DB.tx.find((t) => t.id === id) : null;
  const draft = editing
    ? { ...editing }
    : { type: 'expense', amount: '', category: '', date: (preset && preset.date) || todayStr(), memo: '' };

  function paint() {
    const cats = DB.categories[draft.type] || [];
    if (!cats.find((c) => c.name === draft.category)) draft.category = cats[0]?.name || '';
    openSheet(`
      <h3>${editing ? '내역 수정' : '새 내역'}</h3>
      <div class="seg" id="seg">
        <button data-t="expense" class="${draft.type === 'expense' ? 'on expense' : ''}">지출</button>
        <button data-t="income" class="${draft.type === 'income' ? 'on income' : ''}">수입</button>
      </div>
      <div class="field" style="margin-top:16px">
        <label>금액</label>
        <input class="amount-input" id="amt" type="number" inputmode="numeric" placeholder="0" value="${draft.amount || ''}">
      </div>
      <div class="field">
        <label>분류</label>
        <div class="chips" id="chips">
          ${cats.map((c) => `<button class="chip ${c.name === draft.category ? 'on' : ''}" data-c="${esc(c.name)}">${c.emoji} ${esc(c.name)}</button>`).join('')}
        </div>
      </div>
      <div class="row">
        <div class="field"><label>날짜</label><input id="date" type="date" value="${draft.date}"></div>
      </div>
      <div class="field"><label>메모 (선택)</label><input id="memo" type="text" placeholder="예: 점심 김밥" value="${esc(draft.memo || '')}"></div>
      <button class="btn primary" id="save-tx">${editing ? '저장' : '추가하기'}</button>
      ${editing ? `<button class="btn danger" id="del-tx" style="margin-top:8px">삭제</button>` : ''}
    `);

    sheetEl.querySelectorAll('#seg button').forEach((b) => b.onclick = () => { syncDraft(); draft.type = b.dataset.t; paint(); });
    sheetEl.querySelectorAll('#chips .chip').forEach((b) => b.onclick = () => {
      sheetEl.querySelectorAll('#chips .chip').forEach((x) => x.classList.remove('on'));
      b.classList.add('on'); draft.category = b.dataset.c;
    });
    sheetEl.querySelector('#save-tx').onclick = saveTx;
    if (editing) sheetEl.querySelector('#del-tx').onclick = () => {
      if (confirm('이 내역을 삭제할까요?')) { DB.tx = DB.tx.filter((t) => t.id !== id); save(); closeSheet(); render(); toast('삭제했어요'); }
    };
    setTimeout(() => { if (!editing) sheetEl.querySelector('#amt').focus(); }, 100);
  }
  function syncDraft() {
    draft.amount = sheetEl.querySelector('#amt')?.value ?? draft.amount;
    draft.date = sheetEl.querySelector('#date')?.value ?? draft.date;
    draft.memo = sheetEl.querySelector('#memo')?.value ?? draft.memo;
  }
  function saveTx() {
    syncDraft();
    const amt = Math.round(Number(draft.amount));
    if (!amt || amt <= 0) return toast('금액을 입력해주세요');
    if (!draft.category) return toast('분류를 선택해주세요');
    const rec = { type: draft.type, amount: amt, category: draft.category, date: draft.date, memo: draft.memo.trim() };
    if (editing) Object.assign(editing, rec);
    else DB.tx.push({ id: uid(), ...rec });
    save(); closeSheet(); render(); toast(editing ? '수정했어요' : '추가했어요 ✓');
  }
  paint();
}

/* ---------- 화면 테마 ---------- */
function openTheme() {
  const cur = DB.settings.theme || 'system';
  const opts = [
    { v: 'system', emoji: '📱', name: '시스템 자동', sub: '아이폰 설정을 따라가요' },
    { v: 'light', emoji: '☀️', name: '밝게', sub: '항상 라이트 모드' },
    { v: 'dark', emoji: '🌙', name: '어둡게', sub: '항상 다크 모드' }
  ];
  openSheet(`
    <h3>🌗 화면 테마</h3>
    ${opts.map((o) => `<div class="list-item" data-theme="${o.v}">
      <span class="ic">${o.emoji}</span>
      <div class="grow"><div>${o.name}</div><div class="sub">${o.sub}</div></div>
      <span class="chev" style="color:var(--accent);font-size:18px">${cur === o.v ? '✓' : ''}</span>
    </div>`).join('')}
  `);
  sheetEl.querySelectorAll('[data-theme]').forEach((el) => el.onclick = () => {
    DB.settings.theme = el.dataset.theme;
    save(); applyTheme(); closeSheet(); render(); toast('테마를 바꿨어요');
  });
}

/* ---------- 목표 설정 ---------- */
function openGoals() {
  openSheet(`
    <h3>🎯 목표 설정</h3>
    <div class="field">
      <label>이번 달 지출 목표 (한 달에 이만큼만 쓰기)</label>
      <input id="g-spend" type="number" inputmode="numeric" placeholder="예: 1500000" value="${DB.goals.monthlySpend || ''}">
    </div>
    <div class="field">
      <label>올해 저축 목표 (1년간 모으고 싶은 돈)</label>
      <input id="g-save" type="number" inputmode="numeric" placeholder="예: 12000000" value="${DB.goals.annualSaving || ''}">
      <div class="hint">저축 진행률 = 올해 (수입 − 지출) 합계로 자동 계산됩니다.</div>
    </div>
    <button class="btn primary" id="save-goals">저장</button>
  `);
  sheetEl.querySelector('#save-goals').onclick = () => {
    DB.goals.monthlySpend = Math.max(0, Math.round(Number(sheetEl.querySelector('#g-spend').value) || 0));
    DB.goals.annualSaving = Math.max(0, Math.round(Number(sheetEl.querySelector('#g-save').value) || 0));
    save(); closeSheet(); render(); toast('목표를 저장했어요');
  };
}

/* ---------- 카테고리 예산 ---------- */
function openBudgets() {
  const cats = DB.categories.expense;
  openSheet(`
    <h3>📊 카테고리 예산</h3>
    <div class="hint" style="margin-bottom:14px">매월 반복 적용됩니다. 비워두면 예산 없음.</div>
    ${cats.map((c) => `<div class="field">
      <label>${c.emoji} ${esc(c.name)}</label>
      <input class="bud" data-c="${esc(c.name)}" type="number" inputmode="numeric" placeholder="예산 없음" value="${DB.budgets[c.name] || ''}">
    </div>`).join('')}
    <button class="btn primary" id="save-bud">저장</button>
  `);
  sheetEl.querySelector('#save-bud').onclick = () => {
    sheetEl.querySelectorAll('.bud').forEach((i) => {
      const v = Math.max(0, Math.round(Number(i.value) || 0));
      if (v > 0) DB.budgets[i.dataset.c] = v; else delete DB.budgets[i.dataset.c];
    });
    save(); closeSheet(); render(); toast('예산을 저장했어요');
  };
}

/* ---------- 반복 지출/구독 ---------- */
function openRecurringList() {
  openSheet(`
    <h3>🔁 반복 지출 · 구독</h3>
    <div class="hint" style="margin-bottom:12px">월세, 구독료처럼 매달 자동으로 기록할 항목이에요.</div>
    ${DB.recurring.length ? DB.recurring.map((r) => {
      const c = catInfo(r.type, r.category);
      return `<div class="tx" data-r="${r.id}">
        <div class="emoji">${c.emoji}</div>
        <div class="mid"><div class="cat">${esc(r.memo || r.category)}</div>
          <div class="memo">매월 ${r.day}일 · ${esc(r.category)}</div></div>
        <div class="amt">${won(r.amount)}</div>
      </div>`;
    }).join('') : `<div class="empty" style="padding:20px"><div class="big">🔁</div>등록된 항목이 없어요.</div>`}
    <button class="btn primary" id="add-r" style="margin-top:12px">+ 새 반복 항목</button>
  `);
  sheetEl.querySelectorAll('[data-r]').forEach((el) => el.onclick = () => openRecurringEdit(el.dataset.r));
  sheetEl.querySelector('#add-r').onclick = () => openRecurringEdit(null);
}

function openRecurringEdit(id) {
  const editing = id ? DB.recurring.find((r) => r.id === id) : null;
  const d = editing ? { ...editing } : { type: 'expense', amount: '', category: DB.categories.expense[3]?.name || '', day: 1, memo: '' };
  function paint() {
    const cats = DB.categories[d.type] || [];
    if (!cats.find((c) => c.name === d.category)) d.category = cats[0]?.name || '';
    openSheet(`
      <h3>${editing ? '반복 항목 수정' : '새 반복 항목'}</h3>
      <div class="seg" id="rseg">
        <button data-t="expense" class="${d.type === 'expense' ? 'on expense' : ''}">지출</button>
        <button data-t="income" class="${d.type === 'income' ? 'on income' : ''}">수입</button>
      </div>
      <div class="field" style="margin-top:16px"><label>이름/메모</label>
        <input id="r-memo" type="text" placeholder="예: 넷플릭스, 월세" value="${esc(d.memo || '')}"></div>
      <div class="field"><label>금액</label>
        <input id="r-amt" type="number" inputmode="numeric" placeholder="0" value="${d.amount || ''}"></div>
      <div class="field"><label>분류</label>
        <div class="chips" id="r-chips">${cats.map((c) => `<button class="chip ${c.name === d.category ? 'on' : ''}" data-c="${esc(c.name)}">${c.emoji} ${esc(c.name)}</button>`).join('')}</div></div>
      <div class="field"><label>매월 며칠</label>
        <select id="r-day">${Array.from({ length: 31 }, (_, i) => `<option value="${i + 1}" ${d.day == i + 1 ? 'selected' : ''}>${i + 1}일</option>`).join('')}</select></div>
      <button class="btn primary" id="r-save">${editing ? '저장' : '추가'}</button>
      ${editing ? `<button class="btn danger" id="r-del" style="margin-top:8px">삭제</button>` : ''}
    `);
    sheetEl.querySelectorAll('#rseg button').forEach((b) => b.onclick = () => { sync(); d.type = b.dataset.t; paint(); });
    sheetEl.querySelectorAll('#r-chips .chip').forEach((b) => b.onclick = () => {
      sheetEl.querySelectorAll('#r-chips .chip').forEach((x) => x.classList.remove('on')); b.classList.add('on'); d.category = b.dataset.c;
    });
    sheetEl.querySelector('#r-save').onclick = doSave;
    if (editing) sheetEl.querySelector('#r-del').onclick = () => {
      if (confirm('반복 항목을 삭제할까요? (이미 기록된 내역은 남습니다)')) {
        DB.recurring = DB.recurring.filter((r) => r.id !== id); save(); closeSheet(); render(); toast('삭제했어요');
      }
    };
  }
  function sync() {
    d.amount = sheetEl.querySelector('#r-amt')?.value ?? d.amount;
    d.memo = sheetEl.querySelector('#r-memo')?.value ?? d.memo;
    d.day = sheetEl.querySelector('#r-day')?.value ?? d.day;
  }
  function doSave() {
    sync();
    const amt = Math.round(Number(d.amount));
    if (!amt || amt <= 0) return toast('금액을 입력해주세요');
    const rec = { type: d.type, amount: amt, category: d.category, day: Number(d.day), memo: (d.memo || '').trim() };
    if (editing) { Object.assign(editing, rec); }
    else { DB.recurring.push({ id: uid(), from: ym(todayStr()), last: '', ...rec }); }
    runRecurring(); save(); closeSheet(); render(); toast('저장했어요 ✓');
  }
  paint();
}

/* ---------- 카테고리 관리 ---------- */
function openCategories() {
  function paint(type = 'expense') {
    const cats = DB.categories[type];
    openSheet(`
      <h3>🏷️ 카테고리 관리</h3>
      <div class="seg" id="cseg">
        <button data-t="expense" class="${type === 'expense' ? 'on expense' : ''}">지출</button>
        <button data-t="income" class="${type === 'income' ? 'on income' : ''}">수입</button>
      </div>
      <div style="margin-top:14px">
        ${cats.map((c, i) => `<div class="list-item">
          <span class="ic">${c.emoji}</span><div class="grow">${esc(c.name)}</div>
          <button data-del="${i}" style="color:var(--expense);font-size:20px">×</button>
        </div>`).join('')}
      </div>
      <div class="row" style="margin-top:14px">
        <input id="c-emoji" type="text" maxlength="2" placeholder="🍔" style="flex:0 0 64px;text-align:center;padding:13px;border:1px solid var(--line);border-radius:12px;background:var(--card-2)">
        <input id="c-name" type="text" placeholder="새 분류 이름" style="flex:1;padding:13px 14px;border:1px solid var(--line);border-radius:12px;background:var(--card-2)">
      </div>
      <button class="btn ghost" id="c-add" style="margin-top:10px">+ 분류 추가</button>
    `);
    sheetEl.querySelectorAll('#cseg button').forEach((b) => b.onclick = () => paint(b.dataset.t));
    sheetEl.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => {
      if (cats.length <= 1) return toast('최소 1개는 있어야 해요');
      cats.splice(Number(b.dataset.del), 1); save(); paint(type);
    });
    sheetEl.querySelector('#c-add').onclick = () => {
      const name = sheetEl.querySelector('#c-name').value.trim();
      const emoji = sheetEl.querySelector('#c-emoji').value.trim() || (type === 'income' ? '✨' : '💸');
      if (!name) return toast('이름을 입력해주세요');
      if (cats.find((c) => c.name === name)) return toast('이미 있는 분류예요');
      cats.push({ name, emoji }); save(); paint(type);
    };
  }
  paint();
}

/* ================================================================
   AI 피드백 (Claude API 직접 호출 — 브라우저)
   ================================================================ */
function openAISettings() {
  openSheet(`
    <h3>🤖 AI 피드백 설정</h3>
    <div class="hint" style="margin-bottom:14px;line-height:1.6">
      Claude API 키를 넣으면 이번 달 소비를 분석해 조언해줘요.
      키는 <b>이 기기에만</b> 저장되고, 분석할 때만 Anthropic 서버로 요약이 전송됩니다.
      키는 <a href="https://console.anthropic.com/settings/keys" target="_blank">console.anthropic.com</a>에서 발급해요.
    </div>
    <div class="field"><label>API 키 (sk-ant-...)</label>
      <input id="ai-key" type="password" placeholder="sk-ant-..." value="${esc(DB.settings.apiKey || '')}"></div>
    <div class="field"><label>모델</label>
      <select id="ai-model">
        <option value="claude-opus-4-8" ${DB.settings.model === 'claude-opus-4-8' ? 'selected' : ''}>Claude Opus 4.8 (가장 똑똑함)</option>
        <option value="claude-haiku-4-5" ${DB.settings.model === 'claude-haiku-4-5' ? 'selected' : ''}>Claude Haiku 4.5 (가장 저렴/빠름)</option>
      </select>
      <div class="hint">가볍게 쓰려면 Haiku, 더 깊은 분석을 원하면 Opus를 고르세요.</div>
    </div>
    <button class="btn primary" id="ai-save">저장</button>
  `);
  sheetEl.querySelector('#ai-save').onclick = () => {
    DB.settings.apiKey = sheetEl.querySelector('#ai-key').value.trim();
    DB.settings.model = sheetEl.querySelector('#ai-model').value;
    save(); closeSheet(); render(); toast('저장했어요');
  };
}

async function runAIFeedback() {
  const out = document.getElementById('ai-out');
  const btn = document.getElementById('ai-btn');
  if (!DB.settings.apiKey) {
    openAISettings();
    return;
  }
  const list = txOfMonth(curMonth);
  if (!list.length) { out.innerHTML = `<div class="hint" style="margin-top:12px">이 달의 기록이 없어 분석할 게 없어요.</div>`; return; }

  const income = sum(list, 'income'), expense = sum(list, 'expense');
  const totals = catTotals(curMonth, 'expense');
  const target = DB.goals.monthlySpend, saveGoal = DB.goals.annualSaving;
  const saved = yearNet(curMonth.slice(0, 4));

  // 개인정보 최소화: 원시 메모가 아닌 '요약'만 전송
  const summary = [
    `기간: ${monthLabel(curMonth)}`,
    `총수입: ${income}원, 총지출: ${expense}원, 잔액: ${income - expense}원`,
    target ? `이번 달 지출 목표: ${target}원` : '지출 목표 미설정',
    saveGoal ? `연간 저축 목표: ${saveGoal}원, 올해 누적 저축: ${saved}원` : '저축 목표 미설정',
    '카테고리별 지출:',
    ...totals.map(([n, v]) => ` - ${n}: ${v}원 (${Math.round(v / expense * 100)}%)`)
  ].join('\n');

  out.innerHTML = `<div class="hint" style="margin-top:14px">🤖 분석 중이에요...</div>`;
  btn.disabled = true;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': DB.settings.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: DB.settings.model,
        max_tokens: 1024,
        system: '너는 다정하고 현실적인 한국어 가계부 코치야. 사용자의 이번 달 소비 요약을 보고, 칭찬할 점 1가지, 개선하면 좋을 점 1~2가지, 다음 달을 위한 구체적이고 실천 가능한 팁 2가지를 짧게 알려줘. 존댓말로, 이모지를 적당히 섞어서 따뜻하게. 마크다운 헤더(#)는 쓰지 말고 짧은 문단과 불릿(•)만 사용해.',
        messages: [{ role: 'user', content: `이번 달 내 소비 요약이야:\n\n${summary}\n\n피드백 부탁해!` }]
      })
    });
    const data = await res.json();
    if (!res.ok) {
      const msg = data?.error?.message || `오류 (${res.status})`;
      out.innerHTML = `<div class="hint" style="margin-top:14px;color:var(--expense)">AI 호출 실패: ${esc(msg)}<br>API 키와 결제 설정을 확인해주세요.</div>`;
      return;
    }
    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    out.innerHTML = `<div class="card" style="margin:14px 0 0;background:var(--accent-weak);box-shadow:none">
      <div style="white-space:pre-wrap;line-height:1.65">${esc(text)}</div></div>`;
  } catch (e) {
    out.innerHTML = `<div class="hint" style="margin-top:14px;color:var(--expense)">네트워크 오류예요. 인터넷 연결을 확인해주세요.</div>`;
  } finally {
    btn.disabled = false;
  }
}

/* ================================================================
   데이터 백업/복원/삭제
   ================================================================ */
function exportData() {
  const blob = new Blob([JSON.stringify(DB, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `억을모으자_백업_${todayStr()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  toast('백업 파일을 저장했어요');
}
function importData() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'application/json,.json';
  input.onchange = () => {
    const f = input.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const obj = JSON.parse(r.result);
        if (!obj || !Array.isArray(obj.tx)) throw 0;
        if (!confirm('현재 데이터를 백업 파일로 덮어쓸까요?')) return;
        DB = { ...structuredClone(DEFAULTS), ...obj };
        DB.goals = { ...DEFAULTS.goals, ...(DB.goals || {}) };
        DB.settings = { ...DEFAULTS.settings, ...(DB.settings || {}) };
        save(); render(); toast('복원했어요 ✓');
      } catch { toast('올바른 백업 파일이 아니에요'); }
    };
    r.readAsText(f);
  };
  input.click();
}
function resetData() {
  if (!confirm('정말 모든 데이터를 삭제할까요? 되돌릴 수 없어요.')) return;
  if (!confirm('마지막 확인이에요. 백업은 하셨나요?')) return;
  localStorage.removeItem(KEY); load(); curMonth = ym(todayStr()); render(); toast('초기화했어요');
}

/* ---------- 공통 ---------- */
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), 1900);
}

/* ---------- 부팅 ---------- */
document.getElementById('fab').onclick = () => openEditor(null);
document.querySelectorAll('.tab').forEach((b) => b.onclick = () => { curTab = b.dataset.tab; render(); });

load();
applyTheme();
runRecurring();
render();

// 서비스 워커 등록 (오프라인 지원)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
