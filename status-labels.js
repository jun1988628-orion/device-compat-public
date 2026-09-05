(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.DeviceCompatibilityStatus = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const fallback = {
    compatible: "対応",
    compatible_with_requirements: "条件付き対応",
    limited_compatibility: "一部制約あり",
    incompatible: "非対応",
    unknown: "確認不能",
    conflicting_evidence: "情報が矛盾"
  };
  function present(record) {
    const status = record?.overall_status;
    const state = record?.verification_state;
    if (state === "searched_no_confirmation" && status === "unknown") {
      return { label: "公式確認できず", explanation: "公式情報を調査しましたが、この製品と機器の組み合わせを直接確認できる情報は見つかっていません。", kind: "unknown" };
    }
    if (state === "conflicting_sources" && status === "conflicting_evidence") {
      return { label: "情報が矛盾", explanation: "確認できた公式情報の内容が一致していません。", kind: "unknown" };
    }
    if (state === "directly_verified") {
      const labels = {
        compatible: "対応確認済み",
        compatible_with_requirements: "条件付き対応",
        limited_compatibility: "一部対応",
        incompatible: "非対応確認済み"
      };
      if (labels[status]) return { label: labels[status], explanation: "公式情報で確認", kind: status === "incompatible" ? "bad" : status === "compatible" ? "ok" : "warn" };
    }
    return { label: fallback[status] || status || "判定未表示", explanation: "", kind: status === "incompatible" ? "bad" : status === "compatible" ? "ok" : status === "unknown" || status === "conflicting_evidence" ? "unknown" : "warn" };
  }
  return { present };
});
