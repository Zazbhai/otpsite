// Keep both references visible and copyable without interpolating IDs into JS.
globalThis.orderReferencesHtml = function orderReferencesHtml(order) {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, character =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  return `<div style="display:flex;flex-direction:column;gap:6px;min-width:0;max-width:280px;text-align:left">${[
    ['Order ID', order.order_id], ['External order ID', order.external_order_id],
  ].map(([label, value]) => `<div><div style="font-size:10px;opacity:0.7">${label}</div>${value
    ? `<button type="button" data-order-reference="${escape(value)}" onclick="event.stopPropagation();copyToClipboard(this.dataset.orderReference)" title="Copy ${label.toLowerCase()}" style="display:block;background:none;border:0;padding:0;color:inherit;font:inherit;font-family:monospace;font-size:11px;text-align:left;overflow-wrap:anywhere;white-space:normal;cursor:pointer">${escape(value)}</button>`
    : '<span style="font-size:11px;opacity:0.6">Not available</span>'}</div>`).join('')}</div>`;
};
