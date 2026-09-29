/**
 * Protocol Lab skin — dark developer-console chrome for the lab manifests:
 * status-style nav, mono accents, no marketing. The lab demonstrates the
 * protocol; the skin makes it feel like a real console to humans.
 */

export function labSkin(origin) {
  const site = (slug) => `${origin}/site/lab/${slug}`;
  return {
    brand: 'Protocol Lab',
    homeUrl: site('home'),
    appUrl: `${origin}/app/lab/home`,
    dark: true,
    colors: {
      acc: '#4fd1a5',
      acc2: '#e8b339',
      topBg: '#0b0e14',
      bg: '#0d1117',
      card: '#161b24',
      ink: '#dde5ee',
      dim: '#8b96a5',
      line: '#232b36',
      footBg: '#0b0e14',
      footInk: '#9aa7b4',
    },
    favicon:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#0d1117"/><text x="10" y="44" font-size="34" font-family="monospace" fill="#4fd1a5">{}</text></svg>',
    cookieBanner: true,
    cookieText: 'This console stores a session cookie for delegated-auth demos only.',
    utilityNav: [
      { label: 'vnd.agent-page+json v1.1', url: site('status') },
      { label: 'Status', url: site('status') },
      { label: 'Changelog', url: site('changelog') },
    ],
    nav: [
      { label: 'Feature index', url: site('home') },
      { label: 'Playground', url: site('playground') },
      { label: 'Showcase', url: site('showcase') },
      { label: 'Web nodes', url: site('webnodes') },
      { label: 'Counter', url: site('counter') },
      { label: 'Flows', url: site('delegate') },
    ],
    logoHtml: `protocol<b>:lab</b>`,
    strips: {
      home: [
        { value: '1.1', label: 'Wire version' },
        { value: 'L3', label: 'Conformance' },
        { value: '18', label: 'Lab pages' },
      ],
    },
    footerColumns: [
      {
        heading: 'Lab',
        links: [
          { label: 'Feature index', url: site('home') },
          { label: 'Playground', url: site('playground') },
          { label: 'Component showcase', url: site('showcase') },
          { label: 'Status', url: site('status') },
        ],
      },
      {
        heading: 'Protocol',
        links: [
          { label: 'GitHub', url: 'https://github.com/mosesman831/agent-page-protocol' },
          { label: 'Launch site', url: 'https://agent-page-protocol.vercel.app' },
          { label: 'Changelog', url: site('changelog') },
        ],
      },
      {
        heading: 'Other demos',
        links: [
          { label: 'Multiversal Airways', url: `${origin}/site/mva/home` },
          { label: 'Classwork', url: `${origin}/site/gc/home` },
        ],
      },
    ],
    footerNote: `Protocol Lab — the feature-coverage demo for <a href="https://github.com/mosesman831/agent-page-protocol">Agent Page Protocol</a>. Ephemeral in-memory state; nothing here is production.`,
    extraCss: `
      .brand{font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:19px}
      .brand b{color:var(--acc)}
      .card .cb h4{color:var(--acc)}
      code,.mono{font-family:ui-monospace,"SF Mono",Menlo,monospace}
    `,
  };
}
