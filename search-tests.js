const fs = require("fs");
const assert = require("assert");
const search = require("./search-utils.js");
const app = require("./app.js");
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

const multiHostDataset = structuredClone(dataset);
const switch2Host = multiHostDataset.products.find((product) => product.product_id === "host-switch2");
const switch2Record = multiHostDataset.compatibility_records.find((record) => record.accessory_product_id === "8bitdo-usb-adapter");
if (!multiHostDataset.products.some((product) => product.product_id === "host-steam-deck")) {
  multiHostDataset.products.push({
    ...switch2Host,
    product_id: "host-steam-deck",
    manufacturer: "Valve",
    product_name: "Steam Deck",
    aliases: ["Steam Deck"]
  });
}
// Isolate the fixture from newly published real platform records.
multiHostDataset.compatibility_records = multiHostDataset.compatibility_records.filter(
  (record) => record.accessory_product_id !== "8bitdo-usb-adapter"
);
multiHostDataset.compatibility_records.push(switch2Record);
multiHostDataset.compatibility_records.push({
  ...switch2Record,
  compatibility_id: "cmp-search-fixture-8bitdo-usb-adapter-steamdeck-r1",
  host_product_id: "host-steam-deck"
});
const multiHostResults = search.searchPublishedProducts(multiHostDataset, "8bitdo usb adapter");
assert.strictEqual(
  multiHostResults.filter((entry) => entry.product.product_id === "8bitdo-usb-adapter").length,
  1,
  "same product with two hosts must appear once in search results"
);
const aggregate = multiHostResults.find((entry) => entry.product.product_id === "8bitdo-usb-adapter");
assert.strictEqual(aggregate.records.length, 2, "platform records must remain available to the renderer");
const renderedRecords = app.publishedRecordsForProduct(multiHostDataset, "8bitdo-usb-adapter");
assert.strictEqual(renderedRecords.length, 2, "renderer must retain two explicit host records");
assert(!renderedRecords.some((record) => record.host_product_id === "host-ps5"), "absent host must be omitted, never represented as unknown");
console.log("SEARCH TESTS: PASS (19 assertions)");
