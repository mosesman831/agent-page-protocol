/**
 * Multiversal Airways DOM skin — the "human extras" layer for the manifest→
 * HTML renderer: brand, nav, hero imagery, marketing chrome, footer, cookie
 * bar. Core features come from the manifest itself; this file only adds the
 * decoration a real airline site wraps it in.
 */

export function mvaSkin(origin) {
  const site = (slug) => `${origin}/site/mva/${slug}`;
  return {
    brand: 'Multiversal Airways',
    homeUrl: site('home'),
    appUrl: `${origin}/app/mva/home`,
    accent: '#7cc7ff',
    accent2: '#b48cff',
    cookieBanner: true,
    nav: [
      { label: 'Book', url: site('home') },
      { label: 'Deals', url: site('deals') },
      { label: 'Manage booking', url: site('manage') },
      { label: 'Check in', url: site('checkin') },
      { label: 'Flight status', url: site('status') },
      { label: 'Sign in', url: site('account') },
    ],
    logoHtml: `Multiversal<b>◆</b>Airways`,
    heroes: {
      home: {
        img: `${origin}/demo/files/mva-hero.jpg`,
        heading: 'Every destination.<br/>Every timeline.',
        sub: 'Full-service fares to 90+ destinations — flat beds, real food, no hidden anything.',
      },
      deals: {
        img: `${origin}/demo/files/mva-tokyo.jpg`,
        heading: 'Deals across the multiverse',
        sub: 'New fares drop every Tuesday at 07:00 UTC.',
      },
    },
    promos: {
      home: `<div class="promo"><h3>Singularity — our loyalty programme</h3><p>Points on every ticket. Lounge at Gold, flat-bed upgrades at Platinum. Join free.</p></div>`,
      confirmation: `<div class="promo"><h3>Travel tips for humans</h3><p>Arrive 3h early for long-haul. Liquids under 100ml. Your gate opens 90 minutes before departure.</p></div>`,
    },
    footerHtml: `
      <div><strong>Multiversal Airways</strong> · fictional demo airline for the
      <a href="https://github.com/mosesman831/agent-page-protocol">Agent Page Protocol</a><br/>
      About · Careers · Press · Legal · Privacy · Cookie preferences · Accessibility · Sitemap<br/>
      © 2026 Multiversal Airways plc (not a real airline — no flights exist in this or any universe)</div>`,
    extraCss: `
      .hero{min-height:340px}
      .hero .inner h2{font-size:44px}
      .promo{background:var(--card);border:1px solid #223156;border-radius:14px;padding:18px 22px;margin:18px 0;max-width:1060px}
      .promo h3{margin:0 0 4px;color:var(--acc);text-transform:none;font-size:18px;letter-spacing:0}
      .brand{font-size:22px}.brand b{margin:0 4px;color:var(--acc2);font-size:16px}
      .actions form{display:block}
      .gitem figcaption{font-weight:600}
    `,
  };
}
