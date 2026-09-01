(function (global) {
  "use strict";

  const REGION = "JP";
  const MAX_RESULTS = 20;

  const SYNONYMS = {
    dock: ["ドック"],
    "ドック": ["dock"],
    camera: ["webcam", "カメラ"],
    webcam: ["camera", "カメラ"],
    "カメラ": ["camera", "webcam"],
    lan: ["ethernet", "有線lan"],
    ethernet: ["lan", "有線lan"],
    "有線lan": ["lan", "ethernet"],
    microsd: ["micro sd", "express"],
    "micro sd": ["microsd", "express"],
    express: ["microsd"],
    charger: ["充電器", "充電"],
    "充電器": ["charger", "充電"],
    controller: ["コントローラー", "プロコン"],
    "コントローラー": ["controller", "プロコン"],
    "プロコン": ["controller", "コントローラー"],
    headset: ["headphones", "ヘッドセット", "イヤホン"],
    headphones: ["headset", "ヘッドセット", "イヤホン"],
    "ヘッドセット": ["headset", "headphones", "イヤホン"],
    "イヤホン": ["headset", "headphones", "ヘッドセット"],
    monitor: ["モニター"],
    "モニター": ["monitor"],
    capture: ["キャプチャ"],
    "キャプチャ": ["capture"],
    wireless: ["bluetooth", "無線"],
    bluetooth: ["wireless", "無線"],
    "無線": ["wireless", "bluetooth"],
    wired: ["有線"],
    "有線": ["wired"],
    "i-o data": ["iodata"],
    iodata: ["i-o data"]
  };

  const CATEGORY_TAGS = [
    [/micro\s*sd|microSD/i, ["microsd", "micro sd", "express", "ストレージ", "storage"]],
    [/dock|映像出力/i, ["dock", "ドック", "hdmi", "映像出力"]],
    [/カメラ/i, ["camera", "webcam", "カメラ"]],
    [/モニター/i, ["monitor", "モニター"]],
    [/キャプチャ/i, ["capture", "キャプチャ", "hdmi"]],
    [/ヘッドセット/i, ["headset", "headphones", "ヘッドセット", "イヤホン"]],
    [/イヤホン/i, ["headset", "headphones", "ヘッドセット", "イヤホン"]],
    [/コントローラー/i, ["controller", "コントローラー", "プロコン"]],
    [/充電|ACアダプター/i, ["charger", "充電器", "充電"]]
  ];

  function normalized(value) {
    return String(value || "")
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[‐‑‒–—―]/g, "-")
      .replace(/micro\s*sd/gi, "microsd")
      .replace(/switch\s*2/gi, "switch2")
      .replace(/[\s\-_／/().,]+/g, "");
  }

  function text(value) {
    return String(value || "").normalize("NFKC").toLowerCase().trim();
  }

  function values(product) {
    return [
      product.product_name,
      product.model_number,
      product.sku,
      product.jan,
      product.upc,
      ...(product.aliases || [])
    ].filter(Boolean);
  }

  function splitIdentifiers(value) {
    return String(value || "")
      .split(/[|,;／/]/)
      .map((part) => part.trim())
      .filter(Boolean);
  }

  function tagsFor(product) {
    const tags = new Set(product.connection_methods || []);
    for (const [pattern, tagsToAdd] of CATEGORY_TAGS) {
      if (pattern.test(product.category || "")) tagsToAdd.forEach((tag) => tags.add(tag));
    }
    return [...tags];
  }

  function queryTerms(query) {
    const initial = text(query);
    const terms = new Set([initial]);
    for (const synonym of SYNONYMS[initial] || []) terms.add(text(synonym));
    return [...terms].filter(Boolean);
  }

  function publishedProducts(dataset) {
    const products = new Map(dataset.products.map((product) => [product.product_id, product]));
    const published = dataset.compatibility_records.filter((record) =>
      record.publication_status === "published" &&
      record.region === REGION &&
      products.has(record.accessory_product_id)
    );
    // A product can have multiple explicit host-platform records. Search is
    // product-oriented, so aggregate those records instead of duplicating the
    // result or silently picking one platform's status.
    const byProduct = new Map();
    for (const record of published) {
      const productId = record.accessory_product_id;
      if (!byProduct.has(productId)) {
        byProduct.set(productId, {
          product: products.get(productId),
          // `record` remains for backward-compatible consumers. It is never
          // used to represent an absent platform; callers needing platform
          // facts must use `records`.
          record,
          records: [record]
        });
      } else {
        byProduct.get(productId).records.push(record);
      }
    }
    return [...byProduct.values()];
  }

  function wordTokens(query) {
    return text(query)
      .split(/\s+/)
      .map((value) => normalized(value))
      .filter((value) => value.length >= 2);
  }

  function scoreEntry(entry, query) {
    const qText = text(query);
    const qNormalized = normalized(query);
    if (!qNormalized || qNormalized.length < 2) return 0;

    const aliases = entry.product.aliases || [];
    const identifiers = [entry.product.model_number, entry.product.sku, entry.product.jan, entry.product.upc]
      .flatMap(splitIdentifiers)
      .filter(Boolean);
    const productValues = values(entry.product);
    const manufacturer = entry.product.manufacturer || "";
    const category = entry.product.category || "";
    const tags = tagsFor(entry.product);
    const terms = queryTerms(query);
    let score = 0;

    // Scores intentionally follow the site search policy: identifiers, aliases,
    // normalised identifiers, product name, manufacturer, category/tag, then partial.
    const exactIdentifier = identifiers.some((value) => text(value) === qText);
    const exactAlias = aliases.some((value) => text(value) === qText);
    const normalizedIdentifier = identifiers.some((value) => normalized(value) === qNormalized);
    const exactName = text(entry.product.product_name) === qText;
    const exactManufacturer = text(manufacturer) === qText;

    if (exactIdentifier) score = Math.max(score, 1000);
    if (exactAlias) score = Math.max(score, 900);
    if (normalizedIdentifier) score = Math.max(score, 800);
    if (exactName) score = Math.max(score, 700);
    if (exactManufacturer) score = Math.max(score, 500);

    for (const term of terms) {
      const termNormalized = normalized(term);
      if (!termNormalized) continue;
      const exactCategory = normalized(category) === termNormalized;
      const exactTag = tags.some((value) => normalized(value) === termNormalized);
      if (exactCategory || exactTag) score = Math.max(score, 300);

      // Partial matching is intentionally limited to 3+ normalized characters.
      if (termNormalized.length >= 3 && productValues.some((value) => normalized(value).includes(termNormalized))) {
        score = Math.max(score, 100);
      }
      if (termNormalized.length >= 3 && normalized(manufacturer).includes(termNormalized)) {
        score = Math.max(score, 200);
      }
      if (termNormalized.length >= 3 && (normalized(category).includes(termNormalized) || tags.some((value) => normalized(value).includes(termNormalized)))) {
        score = Math.max(score, 250);
      }
    }

    // A multiword manufacturer + keyword query is more specific than a category
    // lookup, but it never upgrades a product to an identifier/name match.
    const tokens = wordTokens(query);
    if (tokens.length >= 2 && tokens.some((token) => normalized(manufacturer) === token)) {
      const keywordTokens = tokens.filter((token) => normalized(manufacturer) !== token);
      if (keywordTokens.some((token) =>
        normalized(category).includes(token) ||
        tags.some((tag) => normalized(tag).includes(token)) ||
        productValues.some((value) => normalized(value).includes(token))
      )) {
        score = Math.max(score, 450);
      }
    }
    return score;
  }

  function searchPublishedProducts(dataset, query) {
    return publishedProducts(dataset)
      .map((entry) => ({ ...entry, score: scoreEntry(entry, query) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.product.product_name.localeCompare(b.product.product_name, "ja"))
      .slice(0, MAX_RESULTS);
  }

  const api = { normalized, tagsFor, scoreEntry, searchPublishedProducts };
  global.DeviceCompatibilitySearch = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
