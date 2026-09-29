/**
 * Multiversal Airways DOM skin — the "human extras" layer for the manifest→
 * HTML renderer: brand, nav, hero imagery, booking widget tabs, marketing
 * chrome, footer columns, cookie bar. Core features come from the manifest
 * itself; this file only adds the decoration a real airline site wraps it in.
 */

export function mvaSkin(origin) {
  const site = (slug) => `${origin}/site/mva/${slug}`;
  return {
    brand: 'Multiversal Airways',
    homeUrl: site('home'),
    appUrl: `${origin}/app/mva/home`,
    dark: false,
    colors: {
      acc: '#143d8f',
      acc2: '#b78a3e',
      topBg: '#0d1b3e',
      footBg: '#0d1b3e',
    },
    favicon:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M32 2 62 32 32 62 2 32Z" fill="#143d8f"/><path d="M32 14 50 32 32 50 14 32Z" fill="#b78a3e"/></svg>',
    cookieBanner: true,
    cookieText:
      'We use cookies to make Multiversal better for humans — seat picks, preferences, one kept booking.',
    utilityNav: [
      { label: 'Singularity rewards', url: site('account') },
      { label: 'Help centre', url: site('help') },
      { label: 'English · GBP £', url: site('help') },
    ],
    nav: [
      { label: 'Book & manage', url: site('home') },
      { label: 'Deals', url: site('deals') },
      { label: 'Destinations', url: site('destinations') },
      { label: 'Cabins', url: site('cabins') },
      { label: 'Travel extras', url: site('travel-extras') },
      { label: 'Flight status', url: site('status') },
    ],
    logoHtml: `Multiversal<b>◆</b>Airways`,
    heroTabs: [
      { label: 'Book flights', url: site('home'), slug: 'home' },
      { label: 'Manage booking', url: site('manage'), slug: 'manage' },
      { label: 'Check in', url: site('checkin'), slug: 'checkin' },
      { label: 'Flight status', url: site('status'), slug: 'status' },
    ],
    heroForm: { home: 'search_flights' },
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
      destinations: {
        img: `${origin}/demo/files/mva-singapore.jpg`,
        heading: 'Ninety-two worlds, one airline',
        sub: 'Where Multiversal flies — every route, every terminal, every timeline.',
      },
      cabins: {
        img: `${origin}/demo/files/mva-hero.jpg`,
        heading: 'Choose your universe of comfort',
        sub: 'Four cabins, one promise: no middle seats, ever.',
      },
    },
    strips: {
      home: [
        { value: '92', label: 'Destinations across 8 timelines' },
        { value: '4.9★', label: 'SkyTrax timeline rating' },
        { value: '0', label: 'Middle seats on any aircraft' },
        { value: '99.2%', label: 'On-time arrivals last year' },
      ],
      destinations: [
        { value: '92', label: 'Destinations' },
        { value: '8', label: 'Hubs' },
        { value: '214', label: 'Daily departures' },
      ],
    },
    promos: {
      home: `<div class="promo"><img class="pimg" src="${origin}/demo/files/mva-singapore.jpg" alt=""/><div class="pb"><h3>Singularity — our loyalty programme</h3><p>Points on every ticket. Lounge at Gold, flat-bed upgrades at Platinum. Join free — cards live forever in this wallet and the next.</p><a class="plink" href="${site('account')}">Join Singularity →</a></div></div>`,
      confirmation: `<div class="promo"><div class="pb"><h3>Travel tips for humans</h3><p>Arrive 3h early for long-haul. Liquids under 100ml. Your gate opens 90 minutes before departure. Multiversal lounges open to Nebula and above.</p></div></div>`,
      'fare-finder': `<div class="promo"><div class="pb"><h3>Fare rules, honestly</h3><p>The price you see is the price you pay: taxes, one cabin bag, and one checked bag are already in. Seat choice is free from Classic up.</p></div></div>`,
    },
    footerColumns: [
      {
        heading: 'Book & manage',
        links: [
          { label: 'Book flights', url: site('home') },
          { label: 'Manage booking', url: site('manage') },
          { label: 'Check in', url: site('checkin') },
          { label: 'Fare finder', url: site('fare-finder') },
          { label: 'Flight status', url: site('status') },
        ],
      },
      {
        heading: 'Travel info',
        links: [
          { label: 'Baggage allowance', url: site('baggage') },
          { label: 'Our cabins', url: site('cabins') },
          { label: 'Special assistance', url: site('assistance') },
          { label: 'Travel documents', url: site('travel-docs') },
          { label: 'Disruption & refunds', url: site('disruption') },
        ],
      },
      {
        heading: 'Singularity',
        links: [
          { label: 'Join the programme', url: site('account') },
          { label: 'Tiers & benefits', url: site('loyalty') },
          { label: 'Lounges', url: site('lounges') },
          { label: 'Earning partners', url: site('partners') },
        ],
      },
      {
        heading: 'Company',
        links: [
          { label: 'About Multiversal', url: site('about') },
          { label: 'Careers', url: site('about') },
          { label: 'Press office', url: site('about') },
          { label: 'Sustainability', url: site('about') },
          {
            label: 'Agent Page Protocol',
            url: 'https://github.com/mosesman831/agent-page-protocol',
          },
        ],
      },
    ],
    footerNote: `© 2026 Multiversal Airways plc — fictional demo airline for the <a href="https://github.com/mosesman831/agent-page-protocol">Agent Page Protocol</a>. Not a real airline: no flights exist in this or any universe.`,
    extraCss: `
      .brand{font-size:22px}.brand b{margin:0 4px;color:var(--acc2);font-size:16px}
      .gitem figcaption{font-weight:600}
      .fare .card{border-top:4px solid var(--line)}
      .fare .card.best{border-top-color:var(--acc2)}
    `,
  };
}
