const fs = require("fs");
const assert = require("assert");
const search = require("./search-utils.js");
const dataset = JSON.parse(fs.readFileSync("public-data.json", "utf8"));

function ids(query) {
  return search.searchPublishedProducts(dataset, query).map((entry) => entry.product.product_id);
}
function idsFrom(source, query) {
  return search.searchPublishedProducts(source, query).map((entry) => entry.product.product_id);
}
function includes(query, productId) {
  assert(ids(query).includes(productId), `${query} should include ${productId}; got ${ids(query).join(", ")}`);
}
function top(query, productId) {
  assert.strictEqual(ids(query)[0], productId, `${query} should rank ${productId} first; got ${ids(query)[0]}`);
}

top("NSGP0523JP-01", "powera-advantage-wired-controller-switch2");
top("nsgp0523jp01", "powera-advantage-wired-controller-switch2");
top("hac013", "nintendo-switch-pro-controller");
includes("powera", "powera-advantage-wireless-controller-switch2");
includes("powera controller", "powera-advantage-wired-controller-switch2");
includes("モニター", "iodata-gd243ud-series");
includes("1tb", "nextorage-g-series-ex-nm3a");
includes("dock", "jsaux-dock-adapter-cv0086");
assert.deepStrictEqual(ids("dock"), ids("ドック"), "dock and ドック should resolve to the same ranked set");
includes("microsd", "nextorage-g-series-ex-nm3a");
includes("カメラ", "nintendo-switch2-camera");
assert.deepStrictEqual(ids("存在しない型番XYZ999"), [], "unknown model must not match");
assert.strictEqual(search.searchPublishedProducts(dataset, "a").length, 0, "single-character query must not fan out");
assert(search.searchPublishedProducts(dataset, "powera").every((entry) => entry.record.publication_status === "published"), "only published records may be returned");
const unpublishedDataset = structuredClone(dataset);
unpublishedDataset.compatibility_records.find((record) => record.accessory_product_id === "nintendo-switch2-camera").publication_status = "under_review";
assert(!idsFrom(unpublishedDataset, "カメラ").includes("nintendo-switch2-camera"), "under_review records must not be returned");
console.log("SEARCH TESTS: PASS (15 assertions)");
