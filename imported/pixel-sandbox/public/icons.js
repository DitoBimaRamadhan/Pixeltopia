// Ikon UI orisinal Pixel Sandbox (SVG buatan sendiri, tanpa aset luar).
// Semua ikon: viewBox 24x24, garis tepi gelap tebal agar terlihat "chunky".
(function (root) {
  const K = '#0b1024'; // warna garis tepi
  const o = (w = 2.2) => `stroke="${K}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round" paint-order="stroke"`;
  const I = {
    gem: `<polygon points="7,3 17,3 22,9 12,22 2,9" fill="#e8263d" ${o(2.4)}/>
      <polygon points="7,3 12,9 17,3" fill="#ff6b7d"/><polygon points="2,9 7,3 12,9" fill="#ff98a5"/>
      <polygon points="12,9 17,3 22,9" fill="#c4142b"/><polygon points="2,9 12,9 12,21" fill="#ff4458"/>
      <polygon points="12,9 22,9 12,21" fill="#9e0d20"/><polygon points="5.5,7.5 7.5,5 8.6,5.8 6.6,8.3" fill="#fff" opacity=".9"/>`,
    plus: `<path d="M12 5v14M5 12h14" stroke="${K}" stroke-width="7" stroke-linecap="round"/><path d="M12 5v14M5 12h14" stroke="#fff" stroke-width="3.4" stroke-linecap="round"/>`,
    wrench: `<path d="M15 2.8a5.2 5.2 0 0 0-4.8 7.1L3.4 16.7a2.1 2.1 0 0 0 3 3l6.8-6.8A5.2 5.2 0 0 0 20.3 8l-3 3-2.8-.7-.7-2.8 3-3A5.2 5.2 0 0 0 15 2.8z" fill="#d7e0f0" ${o()}/>
      <circle cx="5" cy="18" r="1" fill="#7b8aa8"/>`,
    star: `<polygon points="12,2.5 14.8,8.6 21.4,9.3 16.4,13.7 17.9,20.3 12,16.9 6.1,20.3 7.6,13.7 2.6,9.3 9.2,8.6" fill="#ffd54a" ${o()}/>
      <polygon points="12,5.5 13.4,9.4 10.4,10" fill="#fff6c8"/>`,
    globe: `<circle cx="12" cy="12" r="9.2" fill="#3fa0ff" ${o()}/>
      <path d="M6.5 7.5c2 0 3 1 2.6 2.6-.4 1.4 1 2 1.6 3.2.6 1.4-.4 3.2-1.4 4.4-2.6-1-4.4-3.6-4.4-6.2 0-1.4.6-3 1.6-4zM14 4.8c1.6.6 2 1.8 1.2 2.6-.8.8.4 1.8 1.6 1.8 1.4 0 2.6 1.4 2.6 3-.4 2-1.6 3.4-3 3.8-.8-1.2-1-2.6-2-3.2-1.2-.8-1.4-2.2-.6-3.4.4-.8-.6-1.8.2-4.6z" fill="#5ee06a"/>
      <path d="M7 6.5a8 8 0 0 1 4-1.8" stroke="#bfe3ff" stroke-width="1.4" fill="none" stroke-linecap="round"/>`,
    shirt: `<path d="M8.2 3 3 6.2l2.2 4.3 2.6-1V21h8.4V9.5l2.6 1L21 6.2 15.8 3c-.6 1.6-2 2.6-3.8 2.6S8.8 4.6 8.2 3z" fill="#ff5a6a" ${o()}/>
      <path d="M8 13h8" stroke="#c2283a" stroke-width="1.6"/>`,
    menu: `<rect x="3" y="3" width="18" height="18" rx="3" fill="#e8f1ff" ${o()}/>
      <path d="M7 8h10M7 12h10M7 16h10" stroke="#3b6fd8" stroke-width="2.2" stroke-linecap="round"/>`,
    bars: `<path d="M5 7h14M5 12h14M5 17h14" stroke="${K}" stroke-width="5" stroke-linecap="round"/><path d="M5 7h14M5 12h14M5 17h14" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>`,
    chat: `<path d="M12 3.5c5.2 0 9 3.1 9 7.2s-3.8 7.2-9 7.2c-.9 0-1.8-.1-2.6-.3L4.5 20.5l1.3-4.2C4 15 3 13 3 10.7 3 6.6 6.8 3.5 12 3.5z" fill="#fff" ${o()}/>
      <circle cx="8" cy="10.8" r="1.2" fill="#3b6fd8"/><circle cx="12" cy="10.8" r="1.2" fill="#3b6fd8"/><circle cx="16" cy="10.8" r="1.2" fill="#3b6fd8"/>`,
    face: `<rect x="3" y="3" width="18" height="18" rx="4" fill="#9fd8ff" ${o()}/>
      <rect x="7.5" y="8" width="2.6" height="3.6" rx="1" fill="${K}"/><rect x="13.9" y="8" width="2.6" height="3.6" rx="1" fill="${K}"/>
      <path d="M7.5 14.5c2.6 2.6 6.4 2.6 9 0" stroke="${K}" stroke-width="2" fill="none" stroke-linecap="round"/>`,
    person: `<circle cx="12" cy="8" r="4.2" fill="#f2c79a" ${o()}/><path d="M4 21c0-4.4 3.6-7.4 8-7.4s8 3 8 7.4z" fill="#4aa8ff" ${o()}/>`,
    swap: `<path d="M4 8h13l-3.5-3.5M20 16H7l3.5 3.5" stroke="${K}" stroke-width="5.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M4 8h13l-3.5-3.5M20 16H7l3.5 3.5" stroke="#ffd54a" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
    cart: `<path d="M2.5 4h3l2.2 10.5h10.6L20.8 7H7" fill="#e8f1ff" ${o()}/><circle cx="9" cy="19" r="1.8" fill="#ffd54a" ${o(1.6)}/><circle cx="17" cy="19" r="1.8" fill="#ffd54a" ${o(1.6)}/>`,
    trash: `<rect x="5.5" y="7" width="13" height="14" rx="2" fill="#d7e0f0" ${o()}/><rect x="3.5" y="4.5" width="17" height="3" rx="1.2" fill="#ff5a6a" ${o(1.8)}/>
      <path d="M9.5 10.5v7M14.5 10.5v7" stroke="#7b8aa8" stroke-width="1.8" stroke-linecap="round"/>`,
    drop: `<path d="M12 3v11M7 9.5l5 5 5-5" stroke="${K}" stroke-width="5.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M12 3v11M7 9.5l5 5 5-5" stroke="#5ee06a" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      <rect x="4" y="18" width="16" height="3" rx="1.4" fill="#d7e0f0" ${o(1.8)}/>`,
    info: `<circle cx="12" cy="12" r="9" fill="#3fa0ff" ${o()}/><rect x="10.6" y="10.4" width="2.8" height="7" rx="1" fill="#fff"/><circle cx="12" cy="7.3" r="1.6" fill="#fff"/>`,
    search: `<circle cx="10" cy="10" r="6" fill="#bfe3ff" ${o(2.6)}/><path d="M14.5 14.5 20 20" stroke="${K}" stroke-width="5" stroke-linecap="round"/><path d="M14.5 14.5 20 20" stroke="#ffd54a" stroke-width="2.4" stroke-linecap="round"/>`,
    sound: `<path d="M4 9h4l5-4.5v15L8 15H4z" fill="#e8f1ff" ${o()}/><path d="M16 8.5c1.6 1.8 1.6 5.2 0 7M18.8 6c3 3.2 3 8.8 0 12" stroke="#ffd54a" stroke-width="2" fill="none" stroke-linecap="round"/>`,
    exit: `<rect x="4" y="3" width="11" height="18" rx="2" fill="#b07a3e" ${o()}/><circle cx="12" cy="12.5" r="1.1" fill="#ffd54a"/>
      <path d="M14 12h7M18 9l3 3-3 3" stroke="${K}" stroke-width="4.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M14 12h7M18 9l3 3-3 3" stroke="#ff8d9b" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
    help: `<circle cx="12" cy="12" r="9" fill="#ffd54a" ${o()}/><path d="M9.2 9.4c0-1.7 1.3-2.8 2.9-2.8s2.9 1.1 2.9 2.6c0 2.2-2.9 2.4-2.9 4.6" stroke="${K}" stroke-width="2.4" fill="none" stroke-linecap="round"/><circle cx="12.1" cy="17.2" r="1.4" fill="${K}"/>`,
    pencil: `<path d="M4 20l1.2-4.8L15.8 4.6a2 2 0 0 1 2.8 0l.8.8a2 2 0 0 1 0 2.8L8.8 18.8z" fill="#ffd54a" ${o()}/><path d="M4 20l1.2-4.8 3.6 3.6z" fill="#f2c79a"/>`,
    lock: `<rect x="5" y="10.5" width="14" height="10.5" rx="2" fill="#ffd54a" ${o()}/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" stroke="${K}" stroke-width="4.4" fill="none"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" stroke="#d7e0f0" stroke-width="2" fill="none"/><rect x="11" y="14" width="2" height="3.6" rx="1" fill="${K}"/>`,
    close: `<path d="M6 6l12 12M18 6 6 18" stroke="${K}" stroke-width="6" stroke-linecap="round"/><path d="M6 6l12 12M18 6 6 18" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/>`,
    fist: `<path d="M6 9.5c0-1.3 1-2.2 2.2-2.2.4-1.2 1.4-1.8 2.4-1.6.6-.9 1.7-1.3 2.7-.9.8-.6 2-.6 2.8.2.9-.2 2 .5 2.1 1.7l.3 6.8c.1 3.6-2.4 6.5-6 6.5H11c-2.8 0-5-2.2-5-5z" fill="#f2c79a" ${o()}/>
      <path d="M10.6 5.8v4.6M13.3 4.9v5.4M16.1 5.3v5M6.4 13c1.8-.8 4-.6 5.4.8" stroke="#c9945f" stroke-width="1.5" fill="none" stroke-linecap="round"/>`,
    send: `<path d="M3 11.5 20.5 4l-5.8 16-3-6.2z" fill="#5ee06a" ${o()}/><path d="M11.7 13.8 20.5 4" stroke="${K}" stroke-width="1.5"/>`
  };
  const svg = (name, size) => `<svg class="ico" viewBox="0 0 24 24" width="${size || 24}" height="${size || 24}" aria-hidden="true">${I[name] || ''}</svg>`;
  root.ICONS = { svg, names: Object.keys(I) };
  // Isi otomatis elemen bertanda data-ico="nama".
  const fill = () => { for (const el of document.querySelectorAll('[data-ico]')) if (!el.dataset.icoDone) { el.insertAdjacentHTML('afterbegin', svg(el.dataset.ico, el.dataset.icoSize)); el.dataset.icoDone = 1; } };
  root.ICONS.fill = fill;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fill); else fill();
})(window);
