/**
 * Halvern House DOM skin — the "human extras" layer for the manifest→
 * HTML renderer: brand, nav, hero imagery, booking widget tabs, marketing
 * chrome, footer columns, cookie bar. Core features come from the manifest
 * itself; this file only adds the decoration a real hotel site wraps it in.
 *
 * Halvern House is a fictional boutique hotel collection: deep teal + brass
 * on cream, serif display type, dusk photography.
 */

export function hotelSkin(origin) {
  const site = (slug) => `${origin}/site/hotel/${slug}`;
  return {
    brand: 'Halvern House',
    homeUrl: site('home'),
    appUrl: `${origin}/app/hotel/home`,
    dark: false,
    colors: {
      acc: '#0e4a49',
      acc2: '#b08d4a',
      bg: '#f6f0e6',
      card: '#fffdf8',
      ink: '#2c2620',
      dim: '#6f6557',
      line: '#e3d8c4',
      topBg: '#0b3332',
      topInk: '#f2ead9',
      footBg: '#0b3332',
      footInk: '#cfc4ae',
    },
    favicon:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0e4a49"/><path d="M22 48V28a10 10 0 0 1 20 0v20" fill="none" stroke="#b08d4a" stroke-width="6"/></svg>',
    cookieBanner: true,
    cookieText:
      'We use cookies to keep your dates and preferences handy — nothing travels further than your next stay.',
    utilityNav: [
      { label: 'Halvern Circle', url: site('loyalty') },
      { label: 'Help & contact', url: site('help') },
      { label: 'English · GBP £', url: site('help') },
    ],
    nav: [
      { label: 'Book a stay', url: site('home') },
      { label: 'Our houses', url: site('destinations') },
      { label: 'Offers', url: site('deals') },
      { label: 'Dining & spa', url: site('dining') },
      { label: 'Meetings & events', url: site('events') },
      { label: 'Reviews', url: site('reviews') },
    ],
    logoHtml: `Halvern&nbsp;<b>House</b>`,
    heroTabs: [
      { label: 'Book a stay', url: site('home'), slug: 'home' },
      { label: 'Offers', url: site('deals'), slug: 'deals' },
      { label: 'Our houses', url: site('destinations'), slug: 'destinations' },
      { label: 'Manage booking', url: site('manage'), slug: 'manage' },
    ],
    heroForm: { home: 'search_hotels', search: 'search_hotels' },
    heroes: {
      home: {
        img: `${origin}/demo/files/hotel-hero.jpg`,
        heading: 'Rooms with a<br/>view of history',
        sub: 'Sixteen independent houses across Britain, France and the Netherlands — fires lit, dinner on.',
      },
      search: {
        img: `${origin}/demo/files/hotel-suite.jpg`,
        heading: 'Find your room',
        sub: 'Tell us where and when — we will find the bed.',
      },
      destinations: {
        img: `${origin}/demo/files/hotel-lake.jpg`,
        heading: 'Sixteen houses, one collection',
        sub: 'City flagships, country hideaways and a maison in Le Marais — each one its own place.',
      },
      deals: {
        img: `${origin}/demo/files/hotel-paris.jpg`,
        heading: 'Worth turning up for',
        sub: 'Seasonal offers, gift cards and the member rate — honest prices, no small print ambush.',
      },
      dining: {
        img: `${origin}/demo/files/hotel-dining.jpg`,
        heading: 'Dinner is part of the stay',
        sub: 'Candlelit dining rooms, thermal pools and cellars we are quietly proud of.',
      },
      events: {
        img: `${origin}/demo/files/hotel-spa.jpg`,
        heading: 'Gather somewhere lovely',
        sub: 'Boardrooms, barns and ballrooms — with people who have run a thousand weddings.',
      },
      loyalty: {
        img: `${origin}/demo/files/hotel-suite.jpg`,
        heading: 'The key to the house',
        sub: 'Halvern Circle: member rates, upgrades and a free night every ten stays.',
      },
      reviews: {
        img: `${origin}/demo/files/hotel-lake.jpg`,
        heading: 'In our guests’ words',
        sub: '18,000+ verified reviews across the collection — the good and the occasional wet weekend.',
      },
      manage: {
        img: `${origin}/demo/files/hotel-suite.jpg`,
        heading: 'Your booking, your way',
        sub: 'Change dates, add breakfast, upgrade the room or cancel — no phone queue required.',
      },
      hotel: {
        img: `${origin}/demo/files/hotel-hero.jpg`,
        heading: 'The Observatory',
        sub: 'Our flagship — a Georgian railway hotel on Princes Street, crowned by its clock tower.',
      },
      help: {
        img: `${origin}/demo/files/hotel-paris.jpg`,
        heading: 'We are right here',
        sub: 'Answers, a person on the phone, and a concierge who has seen it all.',
      },
    },
    strips: {
      home: [
        { value: '16', label: 'Houses in the collection' },
        { value: '3', label: 'Countries' },
        { value: '9.2', label: 'Average guest rating' },
        { value: '1987', label: 'Family-run since' },
      ],
      destinations: [
        { value: '16', label: 'Houses' },
        { value: '10', label: 'Destinations' },
        { value: '2', label: 'Thermal spas' },
      ],
      loyalty: [
        { value: '4', label: 'Membership keys' },
        { value: '−10%', label: 'Member rates' },
        { value: '10', label: 'Keys = a free night' },
      ],
    },
    promos: {
      home: `<div class="promo"><img class="pimg" src="${origin}/demo/files/hotel-suite.jpg" alt=""/><div class="pb"><h3>Halvern Circle — our loyalty programme</h3><p>A key for every night, a free night every ten. Member rates, early check-in and a welcome dram at the door. Joining is free.</p><a class="plink" href="${site('loyalty')}">Join Halvern Circle →</a></div></div>`,
      confirmation: `<div class="promo"><div class="pb"><h3>Before you arrive</h3><p>Check-in from 15:00 — ring ahead if you are early and we will do our best. Dogs are welcome; the thermal suite opens at 07:00; The Forth Table books up at weekends, so request a table from Dining & spa.</p></div></div>`,
      deals: `<div class="promo"><div class="pb"><h3>The offers email</h3><p>One email a fortnight: new houses, seasonal rates, the occasional secret sale. Use “Get the offers email” below — unsubscribe any time.</p></div></div>`,
      reviews: `<div class="promo"><div class="pb"><h3>Only verified stays</h3><p>Every review here comes from a guest who checked out. We read them all — the housekeeping team gets the praise, the general manager gets the rest.</p></div></div>`,
      loyalty: `<div class="promo"><img class="pimg" src="${origin}/demo/files/hotel-hero.jpg" alt=""/><div class="pb"><h3>Members see more</h3><p>Circle members unlock −10% at checkout, early check-in from Silver Key, and guaranteed upgrades at Gold.</p></div></div>`,
    },
    footerColumns: [
      {
        heading: 'Stay',
        links: [
          { label: 'Book a stay', url: site('home') },
          { label: 'Find a stay', url: site('search') },
          { label: 'Manage booking', url: site('manage') },
          { label: 'Offers', url: site('deals') },
          { label: 'Gift cards', url: site('deals') },
        ],
      },
      {
        heading: 'The collection',
        links: [
          { label: 'Our houses', url: site('destinations') },
          { label: 'Dining & spa', url: site('dining') },
          { label: 'Meetings & events', url: site('events') },
          { label: 'Guest reviews', url: site('reviews') },
        ],
      },
      {
        heading: 'Halvern Circle',
        links: [
          { label: 'Join free', url: site('loyalty') },
          { label: 'Tiers & benefits', url: site('loyalty') },
          { label: 'Member rates', url: site('loyalty') },
        ],
      },
      {
        heading: 'The company',
        links: [
          { label: 'About Halvern', url: site('destinations') },
          { label: 'Careers', url: site('help') },
          { label: 'Press office', url: site('help') },
          { label: 'Help & contact', url: site('help') },
          {
            label: 'Agent Page Protocol',
            url: 'https://github.com/mosesman831/agent-page-protocol',
          },
        ],
      },
    ],
    footerNote: `© 2026 Halvern House Ltd — a fictional hotel collection built for the <a href="https://github.com/mosesman831/agent-page-protocol">Agent Page Protocol</a>. No real rooms, but the welcome is genuine.`,
    extraCss: `
      .brand{font-family:Georgia,'Times New Roman',serif;font-size:24px;font-weight:700;letter-spacing:.2px}
      .brand b{color:var(--acc2);font-weight:600}
      h1,.sec-t,.sec>.sec-t,.hero .inner h2,.pricebig,.card h4{font-family:Georgia,'Times New Roman',serif}
      .hero .inner h2{font-weight:600;letter-spacing:.2px}
      h1{font-weight:600}
      .btn{border-radius:999px}
      .strip .st b{font-family:Georgia,serif;font-weight:600}
      .gitem figcaption{font-weight:600}
      .widget .wbody{border-radius:0 16px 16px 16px}
    `,
  };
}
