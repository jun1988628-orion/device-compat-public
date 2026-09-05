let DATASET = null;
let PRODUCTS = new Map();
let EVIDENCE = new Map();

const DATA_FILE = "public-data.json";
const REGION = "JP";

const $ = (s) => document.querySelector(s);

let SUPABASE = null;

function initSupabase() {
  const cfg = window.SUPABASE_CONFIG || {};
  if (!cfg.url || !cfg.anonKey || cfg.url.includes("YOUR_PROJECT")) {
    console.warn("Supabase is not configured. Falling back to localStorage.");
    return;
  }

  if (!window.supabase || !window.supabase.createClient) {
    console.warn("Supabase client library is unavailable. Falling back to localStorage.");
    return;
  }

  SUPABASE = window.supabase.createClient(cfg.url, cfg.anonKey);
}

function nameKey(value) {
  return (value || "")
    .trim()
    .toLowerCase()
    .normalize("NFKC")
    .replace(/\s+/g, " ");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

const statusPresentation = (record) => {
  if (typeof DeviceCompatibilityStatus !== "undefined") return DeviceCompatibilityStatus.present(record);
  return { label: record.overall_status, explanation: "", kind: statusClass(record.overall_status) };
};

function featureLabel(status) {
  return {
    supported: "対応",
    supported_with_requirements: "条件あり",
    limited: "一部制限",
    unsupported: "非対応",
    unknown: "未確認",
    conflicting_evidence: "情報矛盾"
  }[status] || status;
}

function statusClass(status) {
  if (status === "compatible") return "ok";
  if (status === "incompatible") return "bad";
  if (status === "unknown" || status === "conflicting_evidence") return "unknown";
  return "warn";
}

async function loadDataset() {
  const res = await fetch(DATA_FILE, { cache: "no-store" });
  if (!res.ok) throw new Error(`${DATA_FILE} の読み込みに失敗しました (${res.status})`);

  DATASET = await res.json();
  PRODUCTS = new Map(DATASET.products.map((p) => [p.product_id, p]));
  EVIDENCE = new Map(DATASET.evidence.map((e) => [e.evidence_id, e]));

  updateStats();
}

function updateStats() {
  const publishedRecords = DATASET.compatibility_records.filter(
    (r) => r.publication_status === "published"
  );
  const accessoryProductIds = new Set(publishedRecords.map((r) => r.accessory_product_id));
  const hostIds = [...new Set(publishedRecords.map((r) => r.host_product_id))];
  const hostNames = hostIds.map((id) => PRODUCTS.get(id)?.product_name || id);
  $("#stats").textContent =
    `公開済み互換性 ${publishedRecords.length}件 / 製品 ${accessoryProductIds.size}件 / プラットフォーム ${hostIds.length}件`;
  const hostSummary = $("#hostSummary");
  if (hostSummary) hostSummary.textContent = `対応状況を掲載: ${hostNames.join(" / ")}`;
  const productListLink = $("#productListLink");
  if (productListLink) productListLink.textContent = `公開済み製品一覧（${accessoryProductIds.size}件）を見る`;
}

function featureDisplayLabel(name) {
  if (typeof DeviceCompatibilityStatus !== "undefined") return DeviceCompatibilityStatus.featureName(name);
  return {
    "Audio / controller connection": "音声 / コントローラー接続",
    "Audio connection": "音声接続",
    "Controller adapter connection": "コントローラーアダプター接続",
    "Controller connection": "コントローラー接続",
    "Dock connection": "ドック接続",
    "Dock video output": "ドック映像出力",
    "Host connection": "接続先機器との接続",
    "Platform compatibility": "プラットフォーム互換性",
    "Capture passthrough": "キャプチャーパススルー",
    "Capture resolution": "キャプチャー解像度",
    "Capture source input": "キャプチャー入力源",
    "Capture-source input": "キャプチャー入力源",
    "Display output": "映像出力",
    "Power delivery": "給電",
    "Power supply": "電源供給",
    "Separate capture host": "別のキャプチャーホスト",
    "Separate capture/display host": "別のキャプチャー / 表示ホスト",
    "Video output": "映像出力"
  }[name] || name;
}

function searchProducts(query) {
  if (!window.DeviceCompatibilitySearch) {
    console.error("検索モジュールを読み込めませんでした。");
    return [];
  }

  return window.DeviceCompatibilitySearch
    .searchPublishedProducts(DATASET, query)
    .map(({ product }) => product);
}

function publishedRecordsForProduct(dataset, productId, region = REGION) {
  return dataset.compatibility_records
    .filter((r) =>
      r.accessory_product_id === productId &&
      r.region === region &&
      r.publication_status === "published"
    )
    .sort((a, b) => {
      // Keep the established Switch 2 result first when it exists. New hosts
      // remain separate records and are never used to infer a missing result.
      if (a.host_product_id === "host-switch2" && b.host_product_id !== "host-switch2") return -1;
      if (b.host_product_id === "host-switch2" && a.host_product_id !== "host-switch2") return 1;
      if (b.revision !== a.revision) return b.revision - a.revision;
      return new Date(b.verified_at) - new Date(a.verified_at);
    });
}

function relationshipRoleNotice(role) {
  if (role === "capture_source") {
    return "<p class=\"role-note\">このplatformはこの製品への映像キャプチャー入力源として確認されています。PCがこのplatform上で動作する、またはPC host互換性を示すものではありません。</p>";
  }
  if (role === "display_sink") {
    return "<p class=\"role-note\">このplatformから本製品へ映像を出力する用途として確認されています。</p>";
  }
  return "";
}

function requirementGroupsHtml(record) {
  const groups = { "接続": [], "電源": [], "firmware / system": [], "本体設定": [], "用途制約": [], "その他": [] };
  for (const item of (record.requirements || [])) {
    const t = String(item), l = t.toLowerCase();
    let key = "その他";
    if (/firmware|ファーム|system version|os version|fw要件/.test(l)) key = "firmware / system";
    else if (/電源|給電|充電|power|charger|\bpd\b/.test(l)) key = "電源";
    else if (/設定|setting|enable|有効|hdcp/.test(l)) key = "本体設定";
    else if (/保存|移動|起動|用途|game|録画|capture|限定/.test(l)) key = "用途制約";
    else if (/接続|usb|hdmi|bluetooth|wired|wireless|adapter|ドック/.test(l)) key = "接続";
    groups[key].push(t);
  }
  return Object.entries(groups).filter(([, v]) => v.length).map(([k, v]) => `<div class="requirement-group"><h4>${escapeHtml(k)}</h4><ul>${v.map(x => `<li>${escapeHtml(x)}</li>`).join("")}</ul></div>`).join("");
}

function importantRequirementsHtml(record) {
  if (!record.requirements || !record.requirements.length) return "";
  return `<section class="important-conditions"><h4>重要条件</h4><ul>${record.requirements.slice(0, 2).map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul></section>`;
}

function recordDetailsHtml(record, product) {
  const methods = (product.connection_methods || []).filter(Boolean);
  const connection = methods.length ? `<section class="record-detail"><h4>接続情報</h4><p>${escapeHtml(methods.join(" / "))}</p></section>` : "";
  const system = [["最低FW", record.minimum_firmware], ["公式掲載FW", record.verified_firmware], ["対象OS / system", record.host_os_version]].filter(([, v]) => v).map(([k, v]) => `<div><strong>${k}:</strong> ${escapeHtml(v)}</div>`).join("");
  const firmware = system ? `<section class="record-detail"><h4>Firmware / system</h4>${system}</section>` : "";
  const storage = /storage|microSD|SSD|保存|移動|起動/i.test(`${product.category || ""} ${record.summary || ""}`) && record.feature_assessments?.length
    ? `<section class="record-detail"><h4>用途別</h4><ul>${record.feature_assessments.map(f => `<li><strong>${escapeHtml(f.feature_name)}</strong>: ${escapeHtml(featureLabel(f.status))} — ${escapeHtml(f.notes)}</li>`).join("")}</ul></section>` : "";
  const capture = record.relationship_role === "capture_source" ? `<section class="record-detail"><h4>映像入力源 / capture host</h4><p>このplatformは映像入力源として確認されています。PC/Mac側のcapture host要件とは別です。</p></section>` : "";
  return connection + firmware + storage + capture;
}

function publishedRecords(productId) {
  return publishedRecordsForProduct(DATASET, productId);
}

function renderCandidates(products) {
  const box = document.createElement("article");
  box.className = "card";

  const title = document.createElement("h2");
  title.textContent = "候補を選んでください";
  box.appendChild(title);

  const msg = document.createElement("p");
  msg.textContent = "複数候補が一致したため、自動確定していません。";
  box.appendChild(msg);

  for (const p of products) {
    const btn = document.createElement("button");
    btn.className = "candidate";

    const strong = document.createElement("strong");
    strong.textContent = p.product_name;

    const small = document.createElement("span");
    small.textContent = `${p.manufacturer} / ${p.model_number || "型番不明"}`;

    const states = publishedRecords(p.product_id).map((record) => {
      const host = PRODUCTS.get(record.host_product_id);
      const presentation = statusPresentation(record);
      return `${host?.product_name || record.host_product_id}: ${presentation.label}`;
    });
    const statuses = document.createElement("span");
    statuses.className = "candidate-statuses";
    statuses.textContent = states.join(" / ");

    btn.append(strong, small, statuses);
    btn.addEventListener("click", () => renderProduct(p.product_id));
    box.appendChild(btn);
  }

  $("#result").replaceChildren(box);
}

function renderEvidence(ids) {
  const unique = [...new Set(ids)];
  const items = unique.map((id) => EVIDENCE.get(id)).filter(Boolean);

  if (!items.length) return "<p>表示可能な根拠がありません。</p>";

  return items.map((ev) => {
    const safeUrl = safeHttpsUrl(ev.source_url);
    return `
      <div class="evidence">
        <strong>${escapeHtml(ev.source_label)} — ${escapeHtml(ev.source_title)}</strong>
        <div>${escapeHtml(ev.source_authority)} / ${escapeHtml(ev.product_specificity)} / ${escapeHtml(ev.directness)}</div>
        <div>地域: ${escapeHtml(ev.region)} / 取得: ${escapeHtml(ev.accessed_at)}</div>
        ${ev.applies_to_firmware ? `<div>対象FW: ${escapeHtml(ev.applies_to_firmware)}</div>` : ""}
        ${ev.applies_to_host_os ? `<div>対象OS: ${escapeHtml(ev.applies_to_host_os)}</div>` : ""}
        <div>根拠箇所: ${escapeHtml(ev.excerpt_or_location)}</div>
        ${safeUrl
          ? `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">根拠ページを開く</a>`
          : `<span>安全なURLを確認できません</span>`}
      </div>`;
  }).join("");
}

function renderProduct(productId) {
  const p = PRODUCTS.get(productId);
  const records = publishedRecords(productId);

  if (!records.length) {
    $("#result").innerHTML = `
      <article class="card">
        <h2>${escapeHtml(p.product_name)}</h2>
        <p>この製品には現在公開可能な互換判定がありません。</p>
      </article>`;
    return;
  }

  // Use the same platform-grouped renderer for one or more published records.
  // A missing host record is intentionally not rendered as unknown.
  $("#result").innerHTML = `
    <article class="card">
      <div class="kicker">${escapeHtml(p.manufacturer)} · ${escapeHtml(p.category)}</div>
      <h2>${escapeHtml(p.product_name)}</h2>
      <p>公開済みのplatform別判定のみを表示しています。recordがないplatformは表示しません。</p>
      ${records.map((r) => {
        const host = PRODUCTS.get(r.host_product_id);
        const allEvidence = [...r.evidence_ids, ...r.feature_assessments.flatMap((f) => f.evidence_ids || [])];
        return `<section class="platform-result">
          <div class="head"><div><h3>${escapeHtml(host?.product_name || r.host_product_id)}</h3><p>${escapeHtml(r.summary)}</p></div>
          <span class="status ${statusClass(r.overall_status)}">${escapeHtml(statusPresentation(r).label)}</span></div>
          ${statusPresentation(r).explanation ? `<p class="verification-note">${escapeHtml(statusPresentation(r).explanation)}</p>` : ""}
          ${importantRequirementsHtml(r)}
          ${relationshipRoleNotice(r.relationship_role)}
          ${r.requirements.length ? `<h4>必要条件</h4>${requirementGroupsHtml(r)}` : ""}
          ${recordDetailsHtml(r, p)}
          <h4>機能別</h4><ul>${r.feature_assessments.map((f) => `<li><strong>${escapeHtml(featureDisplayLabel(f.feature_name))}</strong>: ${escapeHtml(featureLabel(f.status))} — ${escapeHtml(f.notes)}</li>`).join("")}</ul>
          <h4>根拠</h4>${renderEvidence(allEvidence)}
        </section>`;
      }).join("")}
    </article>`;
}

function handleSearch(query) {
  const q = query.trim();
  if (!q) return;

  const items = searchProducts(q);

  if (!items.length) {
    renderNotFound(q);
    return;
  }

  if (items.length === 1) {
    renderProduct(items[0].product_id);
  } else {
    renderCandidates(items);
  }
}


const MISS_KEY = "device_compat_misses_v1";
const REQUEST_KEY = "device_compat_requests_v1";

function readLocalArray(key) {
  try {
    const raw = localStorage.getItem(key);
    const value = raw ? JSON.parse(raw) : [];
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function writeLocalArray(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn("localStorage write failed:", err);
  }
}

async function recordMiss(query) {
  const payload = {
    query: query,
    normalized_query: nameKey(query),
    searched_at: new Date().toISOString()
  };

  // Keep a local fallback/audit copy.
  const misses = readLocalArray(MISS_KEY);
  misses.push(payload);
  writeLocalArray(MISS_KEY, misses.slice(-1000));

  if (!SUPABASE) return;

  try {
    const { error } = await SUPABASE.from("search_misses").insert({
      query_text: payload.query,
      normalized_query: payload.normalized_query,
      searched_at: payload.searched_at,
      source: "public_web"
    });
    if (error) console.warn("Supabase miss insert failed:", error.message);
  } catch (err) {
    console.warn("Supabase miss insert failed:", err);
  }
}

async function recordRequest(query) {
  const payload = {
    query: query,
    normalized_query: nameKey(query),
    requested_at: new Date().toISOString()
  };

  // Keep a local fallback/audit copy.
  const requests = readLocalArray(REQUEST_KEY);
  requests.push(payload);
  writeLocalArray(REQUEST_KEY, requests.slice(-1000));

  if (!SUPABASE) return true;

  try {
    const { error } = await SUPABASE.from("research_requests").insert({
      query_text: payload.query,
      normalized_query: payload.normalized_query,
      requested_at: payload.requested_at,
      source: "public_web"
    });
    if (error) {
      console.warn("Supabase request insert failed:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("Supabase request insert failed:", err);
    return false;
  }
}

function renderNotFound(query) {
  recordMiss(query);

  $("#result").innerHTML = `
    <article class="card">
      <h2>見つかりませんでした</h2>
      <p><strong>${escapeHtml(query)}</strong> は現在の公開データにありません。</p>
      <p>この製品の互換性調査を希望する場合は、下のボタンを押してください。</p>
      <button id="requestResearch" class="request-button" type="button">この製品の調査を希望する</button>
      <div id="requestMessage" class="request-message" aria-live="polite"></div>
    </article>`;

  $("#requestResearch").addEventListener("click", async () => {
    $("#requestResearch").disabled = true;
    $("#requestResearch").textContent = "送信中...";

    const remoteOk = await recordRequest(query);

    $("#requestResearch").textContent = "調査希望を受け付けました";
    $("#requestMessage").textContent = remoteOk
      ? "ありがとうございます。共有需要データとして記録しました。"
      : "ローカルには記録しました。共有DBへの送信は失敗したため、後で再確認してください。";
  });
}

if (typeof module !== "undefined") {
  module.exports = { publishedRecordsForProduct, statusPresentation };
}

if (typeof document !== "undefined") document.addEventListener("DOMContentLoaded", async () => {
  try {
    initSupabase();
    await loadDataset();

    $("#searchForm").addEventListener("submit", (e) => {
      e.preventDefault();
      handleSearch($("#query").value);
    });

    $("#query").focus();
  } catch (err) {
    console.error(err);
    $("#result").innerHTML = `
      <article class="card error">
        <h2>データ読み込みエラー</h2>
        <p>${escapeHtml(err.message)}</p>
        <p>PowerShellで <code>py -m http.server 8080</code> を実行し、
        HTTP経由で開いているか確認してください。</p>
      </article>`;
  }
});
