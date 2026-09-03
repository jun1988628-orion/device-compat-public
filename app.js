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

function overallLabel(status) {
  return {
    compatible: "対応",
    compatible_with_requirements: "条件付き対応",
    limited_compatibility: "一部制約あり",
    incompatible: "非対応",
    unknown: "確認不能",
    conflicting_evidence: "情報が矛盾"
  }[status] || status;
}

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

    btn.append(strong, small);
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

  // Preserve the established Switch 2-only page rendering byte-for-byte in
  // structure when exactly one published host record exists.
  if (records.length === 1) {
    const r = records[0];
    const host = PRODUCTS.get(r.host_product_id);
    const allEvidence = [
      ...r.evidence_ids,
      ...r.feature_assessments.flatMap((f) => f.evidence_ids || [])
    ];

    $("#result").innerHTML = `
      <article class="card">
        <div class="head">
          <div>
            <div class="kicker">${escapeHtml(p.manufacturer)} · ${escapeHtml(p.category)}</div>
            <h2>${escapeHtml(p.product_name)} × ${escapeHtml(host?.product_name || r.host_product_id)}</h2>
            <p>${escapeHtml(r.summary)}</p>
          </div>
          <span class="status ${statusClass(r.overall_status)}">
            ${escapeHtml(overallLabel(r.overall_status))}
          </span>
        </div>

        ${r.requirements.length ? `
          <section>
            <h3>必要条件</h3>
            <ul>${r.requirements.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>
          </section>` : ""}

        ${relationshipRoleNotice(r.relationship_role)}

        <section class="meta">
          <div><strong>型番:</strong> ${escapeHtml(p.model_number ?? "未記録")}</div>
          <div><strong>最低FW:</strong> ${escapeHtml(r.minimum_firmware ?? "指定なし")}</div>
          <div><strong>公式掲載FW:</strong> ${escapeHtml(r.verified_firmware ?? "未記録")}</div>
          <div><strong>対象OS:</strong> ${escapeHtml(r.host_os_version ?? "指定なし")}</div>
          <div><strong>最終検証:</strong> ${escapeHtml(r.verified_at)}</div>
          <div><strong>Revision:</strong> ${r.revision}</div>
        </section>

        <section>
          <h3>機能別</h3>
          <div class="table-wrap">
            <table>
              <thead><tr><th>機能</th><th>判定</th><th>補足</th></tr></thead>
              <tbody>
                ${r.feature_assessments.map((f) => `
                  <tr>
                    <td>${escapeHtml(f.feature_name)}</td>
                    <td>${escapeHtml(featureLabel(f.status))}</td>
                    <td>${escapeHtml(f.notes)}</td>
                  </tr>`).join("")}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h3>根拠</h3>
          ${renderEvidence(allEvidence)}
        </section>
      </article>`;
    return;
  }

  // A missing host record is intentionally not rendered as unknown. Only
  // published, explicitly recorded platforms appear below.
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
          <span class="status ${statusClass(r.overall_status)}">${escapeHtml(overallLabel(r.overall_status))}</span></div>
          ${relationshipRoleNotice(r.relationship_role)}
          ${r.requirements.length ? `<h4>必要条件</h4><ul>${r.requirements.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>` : ""}
          <h4>機能別</h4><ul>${r.feature_assessments.map((f) => `<li><strong>${escapeHtml(f.feature_name)}</strong>: ${escapeHtml(featureLabel(f.status))} — ${escapeHtml(f.notes)}</li>`).join("")}</ul>
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
  module.exports = { publishedRecordsForProduct };
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
