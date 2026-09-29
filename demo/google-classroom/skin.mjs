/**
 * Classwork demo skin — the "human chrome" for the classroom manifests:
 * friendly LMS identity, class-color accents, teacher/parent footer.
 * Core features come from the manifest; this file only adds decoration.
 */

export function gcSkin(origin) {
  const site = (slug) => `${origin}/site/gc/${slug}`;
  return {
    brand: 'Classwork',
    homeUrl: site('home'),
    appUrl: `${origin}/app/gc/home`,
    dark: false,
    colors: {
      acc: '#2f6f4f',
      acc2: '#8a5a00',
      topBg: '#ffffff',
      topInk: '#14301f',
      bg: '#f4f7f5',
      card: '#ffffff',
      ink: '#1f2c26',
      dim: '#5c6f64',
      line: '#dde6e1',
      footBg: '#14301f',
      footInk: '#e8f0ea',
    },
    favicon:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="4" y="10" width="56" height="40" rx="4" fill="#2f6f4f"/><rect x="10" y="18" width="30" height="4" rx="2" fill="#fff"/><rect x="10" y="26" width="44" height="4" rx="2" fill="#d9ead9"/><rect x="10" y="34" width="36" height="4" rx="2" fill="#d9ead9"/></svg>',
    cookieBanner: true,
    cookieText:
      'Classwork uses cookies for humans only — to keep you signed in and remember which class you opened last. Agents: the wire format needs none of this.',
    utilityNav: [
      { label: 'Ada Osei', url: site('notifications') },
      { label: 'Help', url: site('help') },
      { label: 'Demo — not a real school', url: site('help') },
    ],
    nav: [
      { label: 'Classes', url: site('home') },
      { label: 'To-do', url: site('todo') },
      { label: 'Calendar', url: site('calendar') },
      { label: 'Archived', url: site('archived') },
      { label: 'Notifications', url: site('notifications') },
    ],
    logoHtml: `Class<b>work</b>`,
    promos: {
      home: `<div class="promo"><div class="pb"><h3>This demo is also an agent page</h3><p>Every page you see is generated from a JSON manifest — the same document an agent reads. Agents never scrape this DOM; they fetch the manifest.</p><a class="plink" href="https://github.com/mosesman831/agent-page-protocol">How it works →</a></div></div>`,
    },
    footerColumns: [
      {
        heading: 'Your school',
        links: [
          { label: 'Your classes', url: site('home') },
          { label: 'To-do', url: site('todo') },
          { label: 'Calendar', url: site('calendar') },
          { label: 'Archived classes', url: site('archived') },
        ],
      },
      {
        heading: 'This class',
        links: [
          { label: 'Stream', url: site('stream') },
          { label: 'Classwork', url: site('classwork') },
          { label: 'Materials', url: site('materials') },
          { label: 'People', url: site('people') },
          { label: 'Grades', url: site('grades') },
        ],
      },
      {
        heading: 'Account',
        links: [
          { label: 'Notifications', url: site('notifications') },
          { label: 'Help centre', url: site('help') },
        ],
      },
      {
        heading: 'About',
        links: [
          {
            label: 'Agent Page Protocol',
            url: 'https://github.com/mosesman831/agent-page-protocol',
          },
          { label: 'Protocol lab', url: `${origin}/site/lab/home` },
        ],
      },
    ],
    footerNote: `© 2026 Classwork demo — a fictional classroom rendered by <a href="https://github.com/mosesman831/agent-page-protocol">Agent Page Protocol</a>. Not a real school: no real students, work, or grades.`,
    extraCss: `
      .brand{font-size:22px}.brand b{color:var(--acc);font-weight:800}
      .card .cb h4{color:var(--acc)}
      .stars{color:var(--acc)}
    `,
  };
}
