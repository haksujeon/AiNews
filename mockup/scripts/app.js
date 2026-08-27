/* ============================================================
   AiNews Admin Mockup — Shared Interaction Logic
   ============================================================ */

"use strict";

// ── Icon SVGs (Lucide-style, inline) ──────────────────────────

const ICONS = {
  zap: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
  mail: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>`,
  users: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  chevronRight: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>`,
  arrowLeft: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>`,
  search: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`,
  plus: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>`,
  moreHoriz: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>`,
  x: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`,
  trash: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>`,
  edit: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>`,
  alertTriangle: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`,
  shield: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1Z"/></svg>`,
  barChart3: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/></svg>`,
  menu: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/></svg>`,
};

// ── Category badge class map ───────────────────────────────────

const CAT_CLASS = {
  "ai-tech":    "badge-ai-tech",
  "ai-product": "badge-ai-product",
  "ai-biz":     "badge-ai-biz",
  "politics":   "badge-politics",
  "economy":    "badge-economy",
  "society":    "badge-society",
  "culture":    "badge-culture",
  "tech":       "badge-tech",
  "all":        "badge-cyan",
};

const CAT_LABEL = {
  "all":        "전체",
  "ai-tech":    "AI 기술",
  "ai-product": "AI 제품",
  "ai-biz":     "AI 비즈니스",
  "politics":   "정치",
  "economy":    "경제",
  "society":    "사회",
  "culture":    "문화",
  "tech":       "기술",
};

const LANG_LABEL = { ko: "KO", en: "EN", zh: "ZH" };

// ── Status helpers ────────────────────────────────────────────

function sendStatusBadge(status) {
  const map = {
    sent:    { cls: "badge-cyan",  label: "발송완료" },
    partial: { cls: "badge-amber", label: "일부발송" },
    failed:  { cls: "badge-red",   label: "발송실패" },
  };
  const s = map[status] || map.sent;
  return `<span class="badge ${s.cls}">${s.label}</span>`;
}

function subscriberStatusDot(status) {
  const map = {
    active:       { dotCls: "dot-green",  label: "활성" },
    inactive:     { dotCls: "dot-muted",  label: "비활성" },
    unsubscribed: { dotCls: "dot-red",    label: "구독해지" },
  };
  const s = map[status] || map.inactive;
  return `<span class="status-dot"><span class="dot ${s.dotCls}"></span>${s.label}</span>`;
}

function categoryBadges(categories) {
  return categories
    .map(c => `<span class="badge ${CAT_CLASS[c] || 'badge-muted'}">${CAT_LABEL[c] || c}</span>`)
    .join(" ");
}

// ── Sidebar render helper ─────────────────────────────────────

function renderSidebar(activePage) {
  const navItems = [
    { href: "newsletter.html", icon: "mail",   label: "뉴스레터", id: "newsletter" },
    { href: "subscribers.html", icon: "users", label: "구독자",   id: "subscribers" },
  ];
  const navHTML = navItems.map(item => `
    <a href="${item.href}" class="nav-item ${activePage === item.id ? 'active' : ''}">
      <span class="nav-item-icon">${ICONS[item.icon]}</span>
      ${item.label}
    </a>
  `).join("");

  return `
    <aside class="sidebar">
      <div class="sidebar-logo">
        <div class="sidebar-logo-icon">${ICONS.zap}</div>
        <div>
          <div class="sidebar-logo-text">AI<span>NEWS</span></div>
          <div class="sidebar-admin-label">Admin</div>
        </div>
      </div>
      <nav class="sidebar-nav">
        <div class="sidebar-section-label">관리</div>
        ${navHTML}
      </nav>
      <div class="sidebar-footer">
        <a href="#" class="sidebar-back-link">
          ${ICONS.arrowLeft}
          사이트로 돌아가기
        </a>
      </div>
    </aside>
  `;
}

function renderMobileHeader(title) {
  return `
    <header class="mobile-header">
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-size:14px;font-weight:700;">AI<span style="color:var(--primary)">NEWS</span></span>
        <span style="font-size:10px;color:var(--fg-muted);letter-spacing:.1em;text-transform:uppercase;">Admin</span>
      </div>
      <button class="btn-icon" style="border:none;color:var(--fg);" onclick="alert('Mobile nav not implemented in mockup')">
        ${ICONS.menu}
      </button>
    </header>
  `;
}

// ── Pagination render ─────────────────────────────────────────

function renderPagination(page, totalPages, onPage) {
  const prevDisabled = page <= 1;
  const nextDisabled = page >= totalPages;
  let pages = "";
  for (let i = 1; i <= Math.min(totalPages, 5); i++) {
    pages += `<button class="page-btn ${i === page ? 'active' : ''}" onclick="${onPage}(${i})">${i}</button>`;
  }
  return `
    <div class="pagination">
      <span>페이지 ${page} / ${totalPages}</span>
      <div class="pagination-controls">
        <button class="page-btn" ${prevDisabled ? 'disabled style="opacity:.4"' : ''} onclick="${onPage}(${page - 1})">‹</button>
        ${pages}
        <button class="page-btn" ${nextDisabled ? 'disabled style="opacity:.4"' : ''} onclick="${onPage}(${page + 1})">›</button>
      </div>
    </div>
  `;
}

// ── Expose to pages ───────────────────────────────────────────

window.AdminUtils = {
  ICONS,
  CAT_CLASS,
  CAT_LABEL,
  LANG_LABEL,
  sendStatusBadge,
  subscriberStatusDot,
  categoryBadges,
  renderSidebar,
  renderMobileHeader,
  renderPagination,
};
