/* ─── State ───────────────────────────────── */
let ocrData     = null;
let ocrFilename = null;

// ダッシュボードの実データ置き場（月ごとに更新）
const DASH = {
  aiEnabled: false,
  stats: null,
  aiSuggestion: null,
  datasets: {},   // { claim, defect, takt, trend, procdefect }
};

/* ─── Init ────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initUpload();
  initBuilder();
  setDefaultMonth();
  loadStats();
  checkHealth();
});

/* ─── Tabs ────────────────────────────────── */
function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => { p.classList.remove('active'); p.classList.add('hidden'); });
      btn.classList.add('active');
      const pane = document.getElementById('tab-' + btn.dataset.tab);
      pane.classList.remove('hidden');
      pane.classList.add('active');
      if (btn.dataset.tab === 'dashboard') loadDashboard();
    });
  });
}

function switchTab(name) {
  const btn = document.querySelector(`.tab-btn[data-tab="${name}"]`);
  if (btn) btn.click();
}

function setDefaultMonth() {
  const now = new Date();
  const m   = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  document.getElementById('monthPicker').value = m;
  document.getElementById('auditMonth').value  = m;
}

/* ─── Stats bar ───────────────────────────── */
async function loadStats() {
  try {
    const r = await fetch('/api/stats').then(r => r.json());
    const bar = document.getElementById('statsBar');
    if (r.total === 0) {
      bar.innerHTML = `<span style="opacity:.8">データなし —</span>
        <button class="btn btn-ghost" style="padding:4px 12px;font-size:12px;color:#fff;background:rgba(255,255,255,.15);border-color:rgba(255,255,255,.3)" onclick="seedData(false)">
          ▶ サンプルデータを投入して試す
        </button>`;
    } else {
      bar.innerHTML = `
        <div class="stat-item"><div class="stat-label">総検査件数</div><div class="stat-value">${r.total.toLocaleString()}件</div></div>
        <div class="stat-item"><div class="stat-label">全期間NG率</div><div class="stat-value ${parseFloat(r.ngRate)>8?'red':''}">${r.ngRate}%</div></div>
        <div class="stat-item"><div class="stat-label">管理製品数</div><div class="stat-value">${r.products}品目</div></div>
        <div class="stat-item"><div class="stat-label">最終記録日</div><div class="stat-value" style="font-size:13px">${r.latest ?? '—'}</div></div>`;
    }
  } catch(e) { console.error(e); }
}

/* ─── Upload / OCR ────────────────────────── */
function initUpload() {
  const drop  = document.getElementById('dropZone');
  const input = document.getElementById('fileInput');

  input.addEventListener('change', e => {
    if (e.target.files[0]) previewFile(e.target.files[0]);
  });

  drop.addEventListener('dragover',  e => { e.preventDefault(); drop.classList.add('dragover'); });
  drop.addEventListener('dragleave', ()  => drop.classList.remove('dragover'));
  drop.addEventListener('drop', e => {
    e.preventDefault();
    drop.classList.remove('dragover');
    if (e.dataTransfer.files[0]) previewFile(e.dataTransfer.files[0]);
  });
}

function previewFile(file) {
  const reader = new FileReader();
  reader.onload = ev => {
    const img = document.getElementById('previewImg');
    img.src   = ev.target.result;
    img.classList.remove('hidden');
    document.getElementById('dropContent').classList.add('hidden');
    document.getElementById('ocrBtn').disabled = false;
    document.getElementById('ocrBtn')._file    = file;
  };
  reader.readAsDataURL(file);
}

async function runOCR() {
  const file = document.getElementById('ocrBtn')._file;
  if (!file) return;

  document.getElementById('ocrResult').innerHTML  = '';
  document.getElementById('ocrSpinner').classList.remove('hidden');
  document.getElementById('ocrBtn').disabled       = true;

  const fd = new FormData();
  fd.append('image', file);

  try {
    const res  = await fetch('/api/ocr', { method: 'POST', body: fd });
    const json = await res.json();
    if (!json.success) throw new Error(json.error);

    ocrData     = json.data;
    ocrFilename = json.filename;
    renderOCRResult(json.data);
    showToast('✅ 書類を読み取りました');
  } catch(e) {
    document.getElementById('ocrResult').innerHTML =
      `<div class="result-empty" style="color:#dc2626">❌ エラー: ${e.message}</div>`;
  } finally {
    document.getElementById('ocrSpinner').classList.add('hidden');
    document.getElementById('ocrBtn').disabled = false;
  }
}

function renderOCRResult(data) {
  const el   = document.getElementById('ocrResult');
  const badge = document.getElementById('resultBadge');

  if (data.type === 'quality_check') {
    badge.textContent = '品質チェックシート';
    badge.className   = 'badge badge-check';
    badge.classList.remove('hidden');
    el.innerHTML = buildQCForm(data);
  } else if (data.type === 'production_instruction') {
    badge.textContent = '生産指示書';
    badge.className   = 'badge badge-prod';
    badge.classList.remove('hidden');
    el.innerHTML = buildProdForm(data);
  } else {
    el.innerHTML = `<pre style="font-size:12px;white-space:pre-wrap">${JSON.stringify(data,null,2)}</pre>`;
  }
}

function buildQCForm(d) {
  const items = (d.items || []).map((it,i) => `
    <tr>
      <td>${i+1}</td>
      <td><input class="ocr-input" value="${esc(it.check_item)}" data-idx="${i}" data-field="check_item"></td>
      <td><input class="ocr-input" value="${esc(it.process)}" data-idx="${i}" data-field="process"></td>
      <td>
        <select class="ocr-input" data-idx="${i}" data-field="result">
          <option value="OK" ${it.result==='OK'?'selected':''}>OK</option>
          <option value="NG" ${it.result==='NG'?'selected':''}>NG</option>
        </select>
      </td>
      <td><input class="ocr-input" value="${esc(it.ng_reason)}" data-idx="${i}" data-field="ng_reason" style="${it.result==='NG'?'background:#fff5f5':''}"></td>
      <td><input class="ocr-input" type="number" step="0.1" value="${it.takt_time_minutes??''}" data-idx="${i}" data-field="takt_time_minutes" style="width:70px"></td>
    </tr>
  `).join('');

  return `<div class="ocr-data">
    <div class="ocr-header-grid">
      <div class="ocr-field"><div class="ocr-label">品番</div><input class="ocr-input" id="f_product_code" value="${esc(d.product_code)}"></div>
      <div class="ocr-field"><div class="ocr-label">品名</div><input class="ocr-input" id="f_product_name" value="${esc(d.product_name)}"></div>
      <div class="ocr-field"><div class="ocr-label">検査日</div><input class="ocr-input" type="date" id="f_check_date" value="${esc(d.check_date)}"></div>
      <div class="ocr-field"><div class="ocr-label">検査員</div><input class="ocr-input" id="f_inspector" value="${esc(d.inspector)}"></div>
    </div>
    <table class="items-table">
      <thead><tr><th>No.</th><th>検査項目</th><th>工程</th><th>判定</th><th>NG内容</th><th>タクト(分)</th></tr></thead>
      <tbody id="itemsBody">${items}</tbody>
    </table>
    <div class="save-area">
      <button class="btn btn-success" onclick="saveQC()">💾 データベースに保存</button>
      <button class="btn btn-ghost" onclick="resetOCR()">やり直す</button>
    </div>
  </div>`;
}

function buildProdForm(d) {
  return `<div class="ocr-data">
    <div class="ocr-header-grid">
      <div class="ocr-field"><div class="ocr-label">品番</div><input class="ocr-input" id="f_product_code" value="${esc(d.product_code)}"></div>
      <div class="ocr-field"><div class="ocr-label">品名</div><input class="ocr-input" id="f_product_name" value="${esc(d.product_name)}"></div>
      <div class="ocr-field"><div class="ocr-label">生産指示日</div><input class="ocr-input" type="date" id="f_production_date" value="${esc(d.production_date)}"></div>
      <div class="ocr-field"><div class="ocr-label">指示数量</div><input class="ocr-input" type="number" id="f_quantity" value="${d.quantity??''}"></div>
      <div class="ocr-field"><div class="ocr-label">工程</div><input class="ocr-input" id="f_process" value="${esc(d.process)}"></div>
      <div class="ocr-field"><div class="ocr-label">担当者</div><input class="ocr-input" id="f_operator" value="${esc(d.operator)}"></div>
    </div>
    <div class="ocr-field" style="margin-top:6px"><div class="ocr-label">備考</div><input class="ocr-input" id="f_notes" value="${esc(d.notes??'')}"></div>
    <div class="save-area">
      <button class="btn btn-success" onclick="saveProd()">💾 データベースに保存</button>
      <button class="btn btn-ghost" onclick="resetOCR()">やり直す</button>
    </div>
  </div>`;
}

async function saveQC() {
  // Collect edited values
  const data = {
    type:         'quality_check',
    product_code: document.getElementById('f_product_code').value,
    product_name: document.getElementById('f_product_name').value,
    check_date:   document.getElementById('f_check_date').value,
    inspector:    document.getElementById('f_inspector').value,
    items: []
  };
  const rows = document.querySelectorAll('#itemsBody tr');
  rows.forEach(row => {
    const get = field => {
      const el = row.querySelector(`[data-field="${field}"]`);
      return el ? el.value : '';
    };
    data.items.push({
      check_item:        get('check_item'),
      process:           get('process'),
      result:            get('result'),
      ng_reason:         get('ng_reason'),
      takt_time_minutes: parseFloat(get('takt_time_minutes')) || null
    });
  });

  try {
    const r = await fetch('/api/records/quality', {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ data, filename: ocrFilename })
    }).then(r => r.json());
    if (r.success) {
      showToast(`✅ ${r.count}件を保存しました`);
      loadStats();
      resetOCR();
    } else throw new Error(r.error);
  } catch(e) { showToast('❌ ' + e.message, true); }
}

async function saveProd() {
  const data = {
    type:            'production_instruction',
    product_code:    document.getElementById('f_product_code').value,
    product_name:    document.getElementById('f_product_name').value,
    production_date: document.getElementById('f_production_date').value,
    quantity:        parseInt(document.getElementById('f_quantity').value) || 0,
    process:         document.getElementById('f_process').value,
    operator:        document.getElementById('f_operator').value,
    notes:           document.getElementById('f_notes').value,
  };
  try {
    const r = await fetch('/api/records/production', {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ data, filename: ocrFilename })
    }).then(r => r.json());
    if (r.success) { showToast('✅ 生産指示書を保存しました'); loadStats(); resetOCR(); }
    else throw new Error(r.error);
  } catch(e) { showToast('❌ ' + e.message, true); }
}

function resetOCR() {
  ocrData = null; ocrFilename = null;
  document.getElementById('previewImg').classList.add('hidden');
  document.getElementById('dropContent').classList.remove('hidden');
  document.getElementById('ocrBtn').disabled = true;
  document.getElementById('ocrResult').innerHTML = '<div class="result-empty">書類をアップロードすると、ここに読み取り結果が表示されます</div>';
  document.getElementById('resultBadge').classList.add('hidden');
  document.getElementById('fileInput').value = '';
}

function openSampleDocs() {
  window.open('/Dashboard_tmp/sample-docs/quality-check-001.html', '_blank');
  setTimeout(() => window.open('/Dashboard_tmp/sample-docs/seisan-shiji-001.html', '_blank'), 300);
}

/* ═══════════════════════════════════════════════════
   Dashboard : 実データ取得 → 部品カードを描画
   ═══════════════════════════════════════════════════ */

/* 色ヘルパー（ライトテーマ） */
const C = { bad:'#dc2626', warn:'#ea580c', good:'#16a34a', accent:'#1e3a8a', muted:'#94a3b8' };
const PALETTE = ['#1e3a8a','#dc2626','#ea580c','#ca8a04','#16a34a','#0891b2','#7c3aed','#db2777'];
const ngColor   = v => v>10 ? C.bad : v>5  ? C.warn : C.good;
const taktColor = v => v>20 ? C.bad : v>14 ? C.warn : C.accent;

async function loadDashboard() {
  const picker = document.getElementById('monthPicker');
  let month = picker.value;
  if (!month) return;

  let stats;
  try { stats = await fetch('/api/stats').then(r=>r.json()); }
  catch(e) { console.error(e); showToast('データ取得に失敗しました', true); return; }

  // データはあるのに選択月が空なら、最新のデータ月へ自動補正（既定が当月=データ無しのケース対策）
  if (stats.total > 0 && stats.latest) {
    const probe = await fetch(`/api/report/monthly?month=${month}`).then(r=>r.json()).catch(()=>({data:[]}));
    if (!probe.data || probe.data.length === 0) {
      month = stats.latest.slice(0, 7);
      picker.value = month;
    }
  }

  let monthly, defects, takt, trend, procdefect;
  try {
    [monthly, defects, takt, trend, procdefect] = await Promise.all([
      fetch(`/api/report/monthly?month=${month}`).then(r=>r.json()),
      fetch(`/api/report/defects?month=${month}`).then(r=>r.json()),
      fetch('/api/report/takt').then(r=>r.json()),
      fetch(`/api/report/trend?month=${month}`).then(r=>r.json()).catch(()=>({data:[]})),
      fetch(`/api/report/process-defect?month=${month}`).then(r=>r.json()).catch(()=>({data:[]})),
    ]);
  } catch(e) { console.error(e); showToast('データ取得に失敗しました', true); return; }

  DASH.stats = stats;
  DASH.datasets = {
    claim: { label:'製品別NG率', unit:'%',
      items:(monthly.data||[]).map(r=>({ name:r.product_name, v:r.ng_rate, c:ngColor(r.ng_rate) })) },
    defect: { label:'指摘内訳', unit:'件',
      items:(defects.data||[]).map((r,i)=>({ name:r.ng_reason, v:r.count, c:PALETTE[i%PALETTE.length] })) },
    takt: { label:'工程別タクト', unit:'分',
      items:(takt.data||[]).map(r=>({ name:r.process, v:r.avg_takt, c:taktColor(r.avg_takt) })) },
    trend: { label:'NG率の推移', unit:'%',
      points:(trend.data||[]).map(r=>({ x:r.label, y:r.ng_rate })) },
    procdefect: { label:'工程別不良率', unit:'%',
      items:(procdefect.data||[]).map(r=>({ name:r.process, v:r.ng_rate, c:ngColor(r.ng_rate) })) },
  };

  renderBoard(!!stats.total && stats.total > 0);
}

/* ─── 盤面の描画（基本カード＋カスタムカード＋並び順） ─── */
const K_ORDER='iso_dash_order_v1', K_CUSTOM='iso_dash_custom_v1', K_HIDDEN='iso_dash_hidden_v1';
const lsGet=(k,f)=>{ try{ const v=JSON.parse(localStorage.getItem(k)); return v??f; }catch(e){ return f; } };
const lsSet=(k,v)=>{ try{ localStorage.setItem(k,JSON.stringify(v)); }catch(e){} };

function baseSpecs() {
  return [
    { id:'kpi',    render:'kpiSummary', title:'今月のサマリー',                    size:'col-6', tag:'自動集計' },
    { id:'claim',  render:'chart', chartType:'bar',   dataset:'claim',  title:'製品別 NG率（クレーム率）ランキング', size:'col-3', tag:'今月' },
    { id:'defect', render:'chart', chartType:'donut', dataset:'defect', title:'指摘箇所の傾向',                   size:'col-3', tag:'不適合 内訳' },
    { id:'takt',   render:'chart', chartType:'bar',   dataset:'takt',   title:'工程別 タクトタイム',              size:'col-3', tag:'平均(分)' },
    { id:'ai',     render:'aiSuggest', title:'AI 改善サマリー',                   size:'col-3', tag:'Claude' },
    { id:'audit',  render:'audit',     title:'ISO監査エビデンス 出力',            size:'col-6', tag:'継続審査用' },
  ];
}

function renderBoard(hasData) {
  const board = document.getElementById('board');
  const hidden = lsGet(K_HIDDEN, []);
  const custom = lsGet(K_CUSTOM, []);

  if (!hasData) {
    board.innerHTML = `<div class="board-empty" id="boardEmpty">「▶ サンプルデータ投入」を押すか、書類を読み取ると<br>ここに品質レポートが表示されます。</div>`;
    return;
  }

  // 基本カード（非表示を除く）＋カスタムカード
  let specs = baseSpecs().filter(s => !hidden.includes(s.id)).concat(custom);

  // 保存済みの並び順を適用
  const order = lsGet(K_ORDER, null);
  if (order) {
    const byId = Object.fromEntries(specs.map(s => [s.id, s]));
    const ordered = order.map(id => byId[id]).filter(Boolean);
    const rest = specs.filter(s => !order.includes(s.id));
    specs = ordered.concat(rest);
  }

  board.innerHTML = '';
  specs.forEach(spec => board.appendChild(buildCardEl(spec)));
}

function buildCardEl(spec) {
  const el = document.createElement('section');
  el.className = 'card ' + (spec.size || 'col-3');
  el.setAttribute('draggable', 'true');
  el.dataset.id = spec.id;
  el.innerHTML = `
    <div class="card-head">
      <span class="grip" title="ドラッグで移動">⠿</span>
      <h3>${esc(spec.title)}</h3>
      <span class="tag">${esc(spec.tag || 'AI生成')}</span>
      <button class="del" title="削除">×</button>
    </div>
    ${renderBody(spec)}`;
  return el;
}

/* ─── 部品描画 ─── */
function renderBody(spec) {
  switch (spec.render) {
    case 'kpiSummary': return kpiSummaryHTML();
    case 'aiSuggest':  return aiSuggestHTML();
    case 'audit':      return auditHTML();
    case 'chart':      return chartHTML(spec);
    case 'kpi':        return kpiStatHTML(spec);
    case 'note':       return noteHTML(spec);
    default:           return `<div class="ai-suggest-empty">未対応の部品です</div>`;
  }
}

function kpiSummaryHTML() {
  const claim = DASH.datasets.claim?.items || [];
  const defect = DASH.datasets.defect?.items || [];
  const takt = DASH.datasets.takt?.items || [];
  const s = DASH.stats || {};
  const worstProduct = claim.slice().sort((a,b)=>b.v-a.v)[0];
  const slowest = takt.slice().sort((a,b)=>b.v-a.v)[0];
  const topDefect = defect[0];
  const kpis = [
    { k:'総検査件数', v:(s.total??0).toLocaleString()+'件', d:'全期間', cls:'flat' },
    { k:'今月の平均NG率', v:(worstProduct? avg(claim.map(i=>i.v)).toFixed(1):'0.0')+'%',
      color: C.warn, d:worstProduct?`最悪 ${worstProduct.name} ${worstProduct.v}%`:'—', cls:'up' },
    { k:'最遅工程', v:slowest?slowest.name:'—', color:C.bad,
      d:slowest?`平均 ${slowest.v}分/件`:'', cls:'up' },
  ];
  return kpiTilesHTML(kpis);
}
function kpiTilesHTML(kpis) {
  return `<div class="kpis">` + kpis.map(k=>`
    <div class="kpi"><div class="k">${esc(k.k)}</div>
      <div class="v" ${k.color?`style="color:${k.color}"`:''}>${esc(String(k.v))}</div>
      <div class="d ${k.cls||'flat'}">${esc(k.d||'')}</div></div>`).join('') + `</div>`;
}

function chartHTML(spec) {
  const ds = DASH.datasets[spec.dataset];
  if (!ds) return `<div class="ai-suggest-empty">データがありません</div>`;
  if (spec.chartType === 'line') {
    const pts = ds.points || [];
    if (!pts.length) return `<div class="ai-suggest-empty">推移データがまだありません（複数月のデータが必要です）</div>`;
    return lineHTML(pts, ds.unit, spec.color || C.accent);
  }
  let items = (ds.items || []).slice();
  if (!items.length) return `<div class="ai-suggest-empty">データがありません</div>`;
  if (spec.topN) items = items.slice().sort((a,b)=>b.v-a.v).slice(0, spec.topN);
  return spec.chartType === 'donut' ? donutHTML(items, ds.label) : barHTML(items, ds.unit);
}

function kpiStatHTML(spec) {
  const ds = DASH.datasets[spec.dataset];
  const items = (ds && ds.items) || [];
  if (!items.length) return `<div class="ai-suggest-empty">データがありません</div>`;
  const vals = items.map(i=>i.v);
  const worst = items.slice().sort((a,b)=>b.v-a.v)[0];
  return kpiTilesHTML([
    { k:'項目数', v:items.length+'件', cls:'flat' },
    { k:'平均', v:avg(vals).toFixed(1)+(ds.unit||''), d:'全体平均', cls:'flat' },
    { k:'最大（要注意）', v:worst.name, color:C.bad, d:worst.v+(ds.unit||''), cls:'up' },
  ]);
}

function noteHTML(spec) {
  const bullets = spec.bullets || deriveNoteBullets();
  return `<div class="card-ai">
    <p class="lead">${esc(spec.lead || '今月の品質データから、優先度の高い改善ポイントを抽出しました。')}</p>
    <ul>${bullets.map(b=>`<li>${b}</li>`).join('')}</ul>
    <div class="src">${esc(spec.src || '※ OCRで取り込んだ検査記録をもとに自動生成')}</div></div>`;
}
function deriveNoteBullets() {
  const claim = (DASH.datasets.claim?.items||[]).slice().sort((a,b)=>b.v-a.v);
  const takt  = (DASH.datasets.takt?.items||[]).slice().sort((a,b)=>b.v-a.v);
  const defect= DASH.datasets.defect?.items||[];
  const out = [];
  if (takt[0])   out.push(`<b>${esc(takt[0].name)}工程</b>の平均タクトが ${takt[0].v}分で最長。ボトルネックの可能性が高い工程です。`);
  if (claim[0])  out.push(`製品 <b>${esc(claim[0].name)}</b> のNG率が ${claim[0].v}% で突出。重点管理を推奨します。`);
  if (defect[0]) out.push(`不良内容は「<b>${esc(defect[0].name)}</b>」が最多。検査基準の見える化が有効です。`);
  if (!out.length) out.push('データを蓄積すると、ここに改善ポイントが表示されます。');
  return out;
}

function aiSuggestHTML() {
  const box = DASH.aiSuggestion
    ? `<div class="ai-suggest-box" id="aiSuggestBox">${esc(DASH.aiSuggestion)}</div>`
    : `<div class="ai-suggest-empty" id="aiSuggestBox">ボタンを押すと、タクトタイムと不良データをClaudeが分析して改善案を提案します。${DASH.aiEnabled?'':'<br>（現在キー未設定 — 押すと設定手順を表示）'}</div>`;
  return `<div class="card-ai">${box}
    <button class="btn btn-primary" onclick="getAISuggestion()">✨ AI改善提案を生成</button></div>`;
}

function auditHTML() {
  return `<div class="evlist">
    <button class="ev" onclick="exportAudit()"><span class="ic">📄</span>
      <span>月次品質レポート（PDF）<span class="desc">審査員へ提出する集計資料を1クリックで生成</span></span></button>
    <button class="ev" onclick="switchTab('audit')"><span class="ic">📊</span>
      <span>監査エビデンス出力タブを開く<span class="desc">対象月を選んで正式な記録書を生成</span></span></button>
  </div>`;
}

/* ─── 描画プリミティブ（SVG／DOM） ─── */
function barHTML(items, unit) {
  const max = Math.max(...items.map(i=>i.v)) || 1;
  return `<div class="barlist">` + items.map(i=>`
    <div class="row"><div class="top"><span class="name">${esc(i.name)}</span><span class="v">${fmt(i.v)}${unit||''}</span></div>
      <div class="track"><div class="fill" style="width:${(i.v/max*100).toFixed(0)}%;background:${i.c||C.accent}"></div></div></div>`).join('') + `</div>`;
}
function donutHTML(items, label) {
  const total = items.reduce((s,i)=>s+i.v,0) || 1;
  let acc=0, circ=2*Math.PI*15.9155, rings='';
  items.forEach((f,idx)=>{ const col=f.c||PALETTE[idx%PALETTE.length]; const len=f.v/total*circ;
    rings += `<circle cx="21" cy="21" r="15.9155" fill="none" stroke="${col}" stroke-width="6" stroke-dasharray="${len} ${circ-len}" stroke-dashoffset="${-acc}" transform="rotate(-90 21 21)"/>`; acc+=len; });
  const legend = items.map((f,idx)=>{ const col=f.c||PALETTE[idx%PALETTE.length];
    return `<div class="li"><span class="sw" style="background:${col}"></span><span>${esc(f.name)}</span><span class="p">${Math.round(f.v/total*100)}%</span></div>`; }).join('');
  return `<div class="split"><svg width="116" height="116" viewBox="0 0 42 42">
    <circle cx="21" cy="21" r="15.9155" fill="none" stroke="#eef2f7" stroke-width="6"/>${rings}
    <text x="21" y="23" text-anchor="middle" font-size="5" fill="${C.muted}">内訳</text></svg>
    <div class="legend">${legend}</div></div>`;
}
function lineHTML(points, unit, col) {
  const W=300,H=120,pad=10;
  const ys=points.map(p=>p.y), mn=Math.min(...ys), mx=Math.max(...ys), span=(mx-mn)||1;
  const X=i=>pad+i*(W-2*pad)/(points.length-1||1);
  const Y=y=>H-pad-((y-mn)/span)*(H-2*pad-16);
  const line=points.map((p,i)=>`${X(i).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ');
  const dots=points.map((p,i)=>`<circle cx="${X(i).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="2.6" fill="${col}"/>`).join('');
  const vals=points.map((p,i)=>`<text x="${X(i).toFixed(1)}" y="${(Y(p.y)-6).toFixed(1)}" text-anchor="middle" font-size="8" fill="#334155">${fmt(p.y)}${unit||''}</text>`).join('');
  const labs=points.map((p,i)=>`<text x="${X(i).toFixed(1)}" y="${H-1}" text-anchor="middle" font-size="8" fill="${C.muted}">${esc(p.x)}</text>`).join('');
  return `<svg class="lchart" viewBox="0 0 ${W} ${H}"><polyline points="${line}" fill="none" stroke="${col}" stroke-width="2.2" stroke-linejoin="round"/>${dots}${vals}${labs}</svg>`;
}
const avg = a => a.length ? a.reduce((s,v)=>s+v,0)/a.length : 0;
const fmt = v => Number.isInteger(v) ? v : Number(v).toFixed(1);

/* ─── AI 改善提案（Claude Sonnet 5 / server 経由） ─── */
async function getAISuggestion() {
  const box = document.getElementById('aiSuggestBox');
  if (!DASH.aiEnabled) {
    if (box) { box.className='ai-suggest-empty'; box.innerHTML='⚠️ Claude APIキーが未設定です。<code>.env</code> に <code>ANTHROPIC_API_KEY</code> を設定すると、この機能が有効になります。'; }
    return;
  }
  if (box) { box.className='ai-suggest-empty'; box.textContent='Claude が分析中...'; }
  try {
    const r = await fetch('/api/report/ai-suggestion', {
      method:'POST', headers:{'Content-Type':'application/json'}, body:'{}'
    }).then(r=>r.json());
    if (r.error) throw new Error(r.error);
    DASH.aiSuggestion = r.suggestion;
    if (box) { box.className='ai-suggest-box'; box.textContent = r.suggestion; }
  } catch(e) {
    if (box) { box.className='ai-suggest-empty'; box.textContent = '❌ ' + e.message; }
  }
}

/* ─── ドラッグ&ドロップ 並べ替え＋削除 ─── */
(function initBoardDnD(){
  const board = document.getElementById('board');
  let dragEl = null;
  const saveOrder = () => lsSet(K_ORDER, [...board.children].filter(c=>c.dataset && c.dataset.id).map(c=>c.dataset.id));

  board.addEventListener('dragstart', e => {
    const card = e.target.closest('.card'); if (!card) return;
    dragEl = card; card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', card.dataset.id); } catch(_){}
  });
  board.addEventListener('dragend', () => {
    if (dragEl) dragEl.classList.remove('dragging');
    board.querySelectorAll('.drop-target').forEach(c=>c.classList.remove('drop-target'));
    dragEl = null; saveOrder();
  });
  board.addEventListener('dragover', e => {
    e.preventDefault();
    const target = e.target.closest('.card');
    board.querySelectorAll('.drop-target').forEach(c=>{ if(c!==target) c.classList.remove('drop-target'); });
    if (!target || target===dragEl) return;
    target.classList.add('drop-target');
    const r = target.getBoundingClientRect();
    const before = (e.clientY < r.top + r.height/2) || (Math.abs(e.clientY-(r.top+r.height/2))<4 && e.clientX < r.left + r.width/2);
    board.insertBefore(dragEl, before ? target : target.nextSibling);
  });
  board.addEventListener('drop', e => e.preventDefault());

  board.addEventListener('click', e => {
    const del = e.target.closest('.del'); if (!del) return;
    const card = del.closest('.card'); const id = card.dataset.id;
    if (id.startsWith('c_')) lsSet(K_CUSTOM, lsGet(K_CUSTOM,[]).filter(s=>s.id!==id));
    else { const h=lsGet(K_HIDDEN,[]); if(!h.includes(id)){ h.push(id); lsSet(K_HIDDEN,h); } }
    card.remove(); saveOrder();
  });
})();

document.getElementById('resetLayout').addEventListener('click', () => {
  [K_ORDER, K_CUSTOM, K_HIDDEN].forEach(k=>{ try{ localStorage.removeItem(k); }catch(e){} });
  loadDashboard();
  showToast('レイアウトを初期化しました');
});
document.getElementById('monthPicker').addEventListener('change', loadDashboard);

/* ═══════════════════════════════════════════════════
   ビルダー : 日本語 → カード
   ═══════════════════════════════════════════════════ */
const EXAMPLES = ['不良率が高い製品トップ3を棒グラフで','指摘の内訳を円グラフで','NG率の推移を折れ線で',
  '工程別タクトを棒グラフで','工程別の不良率を棒グラフで','NG率の数値サマリー','改善の所見を作って'];

function initBuilder() {
  const chips = document.getElementById('chips');
  chips.innerHTML = EXAMPLES.map(e=>`<span class="chip">${e}</span>`).join('');
  chips.addEventListener('click', e => { const c=e.target.closest('.chip'); if(!c) return;
    document.getElementById('prompt').value = c.textContent; document.getElementById('prompt').focus(); });
  document.getElementById('addCard').addEventListener('click', runBuild);
  document.getElementById('prompt').addEventListener('keydown', e => { if(e.key==='Enter') runBuild(); });
}

async function checkHealth() {
  try {
    const h = await fetch('/api/health').then(r=>r.json());
    DASH.aiEnabled = !!h.aiEnabled;
  } catch(e) { DASH.aiEnabled = false; }
  const el = document.getElementById('builderMode');
  if (el) el.textContent = DASH.aiEnabled
    ? 'AIモード（Claudeが解釈）'
    : 'デモ解釈モード（APIキー未設定 → キーワードで解釈）';
}

function setInterp(msg, isErr) {
  const el = document.getElementById('interp');
  el.className = 'interp' + (isErr ? ' err' : '');
  el.textContent = msg;
}

async function runBuild() {
  const input = document.getElementById('prompt');
  const txt = input.value.trim();
  if (!txt) { setInterp('指示を入力してください。', true); return; }
  if (!DASH.stats || !DASH.stats.total) { setInterp('先に「▶ サンプルデータ投入」または書類の読み取りでデータを入れてください。', true); return; }

  let spec = null;
  if (DASH.aiEnabled) { try { spec = await interpretViaAPI(txt); } catch(e){ spec = null; } }
  if (!spec) spec = interpretKeyword(txt);
  if (!spec) { setInterp('うまく解釈できませんでした。言い換えてみてください。', true); return; }

  addCustomCard(spec);
  setInterp(`✓ 「${txt}」→ ${spec.say || spec.title} を追加しました。`);
  input.value = '';
}

async function interpretViaAPI(text) {
  const r = await fetch('/api/interpret', {
    method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ text })
  }).then(r=>r.json());
  if (r.error || !r.spec) throw new Error(r.error || 'no spec');
  return r.spec;
}

/* デモ解釈（キーワード → dataset を指す spec） */
function interpretKeyword(t) {
  let type='bar';
  if (/折れ線|推移|トレンド|時系列|変化|月次|月別/.test(t)) type='line';
  else if (/円|ドーナツ|内訳|割合|構成|比率|パイ/.test(t)) type='donut';
  else if (/数値|指標|kpi|合計|件数だけ|カウント|サマリ|要約/i.test(t)) type='kpi';
  else if (/所見|コメント|提案|アドバイス|評価/.test(t)) type='note';

  let theme=null;
  if (/指摘|不適合|監査/.test(t)) theme='defect';
  else if (/タクト|作業時間|工程時間|リードタイム|ネック|ボトル/.test(t)) theme='takt';
  else if (/工程.*不良|不良.*工程/.test(t)) theme='procdefect';
  else if (/クレーム|苦情|不良|不具合|NG|エヌジー/i.test(t)) theme='claim';

  const nMatch = t.match(/(?:トップ|top|上位|ベスト)\s*([0-9０-９]+)/i);
  const topN = nMatch ? parseInt(nMatch[1].replace(/[０-９]/g,d=>'0123456789'['０１２３４５６７８９'.indexOf(d)]),10) : null;

  const labelOf = { claim:'製品別NG率', defect:'指摘内訳', takt:'工程別タクト', procdefect:'工程別不良率', trend:'NG率の推移' };

  if (type==='line') {
    return { render:'chart', chartType:'line', dataset:'trend', size:'col-3',
      title:'NG率の推移', color:C.accent, say:'折れ線グラフ・「NG率の推移」' };
  }
  if (type==='note') {
    return { render:'note', size:'col-3', title:'AI 所見', say:'AI所見カード' };
  }
  const key = theme || 'claim';
  if (type==='donut') {
    const k = (theme && theme!=='trend') ? theme : 'defect';
    return { render:'chart', chartType:'donut', dataset:k, size:'col-3',
      title:labelOf[k]+'（構成比）', say:`円グラフ・「${labelOf[k]}」の構成比` };
  }
  if (type==='kpi') {
    return { render:'kpi', dataset:key, size:'col-3',
      title:labelOf[key]+' の要約', say:`数値サマリー・「${labelOf[key]}」` };
  }
  return { render:'chart', chartType:'bar', dataset:key, size:'col-3', topN,
    title:labelOf[key]+(topN?` トップ${topN}`:'')+'（棒グラフ）',
    say:`棒グラフ・「${labelOf[key]}」${topN?`のトップ${topN}`:''}` };
}

function addCustomCard(spec) {
  spec.id = spec.id || ('c_' + Date.now() + Math.floor(Math.random()*1000));
  const list = lsGet(K_CUSTOM, []); list.push(spec); lsSet(K_CUSTOM, list);
  const board = document.getElementById('board');
  const empty = document.getElementById('boardEmpty'); if (empty) empty.remove();
  const el = buildCardEl(spec);
  el.classList.add('new-in');
  board.appendChild(el);
  el.scrollIntoView({ behavior:'smooth', block:'center' });
  lsSet(K_ORDER, [...board.children].filter(c=>c.dataset && c.dataset.id).map(c=>c.dataset.id));
}

/* ─── Seed / Clear ────────────────────────── */
async function seedData(force=false) {
  if (force && !confirm('既存のデータをすべて削除してサンプルデータを再投入します。よろしいですか？')) return;
  showToast('サンプルデータを投入中...', false);
  try {
    const r = await fetch('/api/seed', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ force })
    }).then(r=>r.json());
    if (r.already && !force) {
      showToast(`すでに ${r.count} 件のデータがあります。強制再投入するには「データ削除」後に投入してください`);
      return;
    }
    showToast(`✅ ${r.count} 件のサンプルデータを投入しました`);
    loadStats();
    const active = document.querySelector('.tab-pane.active');
    if (active && active.id === 'tab-dashboard') loadDashboard();
  } catch(e) { showToast('❌ ' + e.message, true); }
}

async function clearData() {
  if (!confirm('すべてのデータを削除します。よろしいですか？')) return;
  await fetch('/api/data', { method:'DELETE' });
  showToast('🗑 データを削除しました');
  loadStats();
  const active = document.querySelector('.tab-pane.active');
  if (active && active.id === 'tab-dashboard') loadDashboard();
}

/* ─── Audit Export ────────────────────────── */
function exportAudit() {
  const month = document.getElementById('auditMonth').value;
  if (!month) { showToast('月を選択してください'); return; }
  window.open(`/api/export/audit?month=${month}`, '_blank');
}

/* ─── Utils ───────────────────────────────── */
function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

let toastTimer;
function showToast(msg, isError=false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.background = isError ? '#dc2626' : '#1e293b';
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 3500);
}
