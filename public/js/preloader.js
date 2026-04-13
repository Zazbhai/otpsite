/* ── Skeleton UI Helpers (Loaded in Head) ────────────────────────── */
window.skeletonTable = (cols, rows = 5) => {
  let h = '';
  for(let i=0; i<rows; i++) {
    let cells = '';
    for(let j=0; j<cols; j++) {
      cells += '<td><div class="skeleton" style="height:20px;border-radius:4px"></div></td>';
    }
    h += `<tr>${cells}</tr>`;
  }
  return h;
};

window.skeletonCards = (count = 6) => {
  let h = '';
  for(let i=0; i<count; i++) {
    h += `<div class="skeleton" style="height:120px;border-radius:16px"></div>`;
  }
  return h;
};

window.skeletonList = (count = 5) => {
  let h = '';
  for(let i=0; i<count; i++) {
    h += `<div class="skeleton" style="height:48px;margin-bottom:8px;border-radius:12px"></div>`;
  }
  return h;
};
