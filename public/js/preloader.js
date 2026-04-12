/* ── Skeleton UI Helpers (Loaded in Head) ────────────────────────── */
window.skeletonTable = (cols, rows = 5) => {
  let h = '';
  for(let i=0; i<rows; i++) {
    let cells = '';
    for(let j=0; j<cols; j++) {
      cells += '<td><div class="skeleton sk-row"></div></td>';
    }
    h += `<tr>${cells}</tr>`;
  }
  return h;
};

window.skeletonCards = (count = 6) => {
  let h = '';
  for(let i=0; i<count; i++) {
    h += `<div class="skeleton sk-card"></div>`;
  }
  return h;
};
