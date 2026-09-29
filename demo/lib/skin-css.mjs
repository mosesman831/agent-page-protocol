/**
 * Design-system CSS for the manifest→HTML renderer. The skin supplies a color
 * palette + flags; this emits the whole stylesheet — real-website chrome:
 * utility bar, sticky nav, hero, booking-widget card, image cards, rating
 * stars, comparison tables, footer columns, cookie bar. Light by default,
 * `dark: true` flips the palette.
 *
 * Every selector is generic (.card, .tbl, .fld …) so a demo's skin only
 * re-tints it — no per-site markup classes needed.
 */

export function siteCss(s = {}) {
  const dark = s.dark === true;
  const c = {
    acc: s.accent ?? '#1e3a8a',
    acc2: s.accent2 ?? '#b78a3e',
    bg: dark ? '#0b1220' : '#f3f5f9',
    card: dark ? '#131c33' : '#ffffff',
    ink: dark ? '#e8edf7' : '#14213b',
    dim: dark ? '#93a0b8' : '#5b6579',
    line: dark ? '#223156' : '#e2e7f0',
    topBg: dark ? '#0a0f1e' : '#0f1e45',
    topInk: '#ffffff',
    footBg: dark ? '#080d1a' : '#0d1730',
    footInk: dark ? '#93a0b8' : '#c3cbdd',
    ...(s.colors ?? {}),
  };
  return `:root{--bg:${c.bg};--card:${c.card};--ink:${c.ink};--dim:${c.dim};--line:${c.line};--acc:${c.acc};--acc2:${c.acc2}}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;font-family:"Segoe UI",ui-sans-serif,system-ui,-apple-system,Roboto,"Helvetica Neue",sans-serif;background:var(--bg);color:var(--ink);line-height:1.55;-webkit-font-smoothing:antialiased}
a{color:var(--acc);text-decoration:none}
a:hover{text-decoration:underline}
img{max-width:100%}
.skip{position:absolute;left:-9999px;top:0;background:var(--acc);color:#fff;padding:8px 14px;z-index:99}
.skip:focus{left:8px;top:8px}

/* ---- chrome: utility bar + main nav ---- */
.topbar{background:${c.topBg};color:${c.topInk};font-size:12.5px;display:flex;justify-content:flex-end;gap:22px;padding:7px 30px}
.topbar a{color:${c.topInk};opacity:.82}.topbar a:hover{opacity:1;text-decoration:none}
.topbar .sep{opacity:.35}
.top{display:flex;align-items:center;gap:30px;padding:0 30px;height:64px;background:${dark ? 'rgba(11,18,32,.92)' : '#fff'};border-bottom:1px solid var(--line);position:sticky;top:0;z-index:20;${dark ? 'backdrop-filter:blur(10px)' : 'box-shadow:0 1px 4px rgba(16,28,60,.07)'}}
.brand{font-weight:800;font-size:21px;letter-spacing:.3px;color:var(--ink)}
.brand b{color:var(--acc2)}
.top nav{display:flex;gap:4px;font-size:14.5px;font-weight:600;overflow-x:auto;scrollbar-width:none}
.top nav::-webkit-scrollbar{display:none}
.top nav a{color:var(--ink);padding:8px 14px;border-radius:8px;white-space:nowrap}
.top nav a:hover{background:${dark ? 'rgba(255,255,255,.06)' : '#eef1f7'};text-decoration:none}
.top .spacer{flex:1}

/* ---- hero + booking widget ---- */
.hero{position:relative;min-height:${s.heroHeight ?? '380px'};display:flex;align-items:center;overflow:hidden}
.hero>img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.hero::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(10,16,38,.25) 0%,rgba(10,16,38,.55) 100%)}
.hero .inner{position:relative;z-index:2;padding:44px 30px 90px;max-width:1140px;margin:0 auto;width:100%;color:#fff}
.hero .inner h2{font-size:clamp(30px,4.6vw,52px);line-height:1.08;margin:0 0 10px;font-weight:800;letter-spacing:-.5px;text-shadow:0 2px 22px rgba(0,0,0,.4)}
.hero .inner p{font-size:17px;max-width:560px;margin:0;opacity:.94}
.widget{max-width:1140px;margin:-72px auto 0;padding:0 30px;position:relative;z-index:3}
.widget .tabs{display:flex;gap:2px}
.widget .tabs a{background:rgba(255,255,255,.85);color:var(--ink);font-weight:600;font-size:13.5px;padding:11px 18px;border-radius:12px 12px 0 0;border:1px solid var(--line);border-bottom:none}
.widget .tabs a.on{background:var(--card);color:var(--acc)}
.widget .tabs a:hover{text-decoration:none}
.widget .wbody{background:var(--card);border:1px solid var(--line);border-radius:0 14px 14px 14px;box-shadow:0 14px 34px rgba(13,23,48,.14);padding:20px 22px}
@media(max-width:720px){.widget{margin-top:-56px}.widget .wbody{border-radius:0 12px 12px 12px}}

/* ---- layout ---- */
.wrap{max-width:1140px;margin:0 auto;padding:26px 30px 72px}
.wrap.tight{max-width:760px}
h1{font-size:clamp(24px,3vw,32px);margin:20px 0 8px;letter-spacing:-.4px;font-weight:800}
.lede{color:var(--dim);font-size:16px;margin:0 0 18px;max-width:720px}
h3.sec-t{color:var(--ink);font-size:19px;font-weight:800;letter-spacing:-.2px;margin:34px 0 12px;text-transform:none}
h4{margin:0 0 8px}
.crumbs{font-size:13px;color:var(--dim);margin-top:16px}
.crumbs .sep{margin:0 9px;color:var(--line)}
.crumbs a{color:var(--dim)}
.sec{margin:26px 0}
.sec>.sec-t{font-size:20px;font-weight:800;margin:0 0 4px}
.sec>.sub{color:var(--dim);font-size:13.5px;margin:0 0 14px}
.strip{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1px;background:var(--line);border:1px solid var(--line);border-radius:14px;overflow:hidden;margin:22px 0}
.strip .st{background:var(--card);padding:18px 20px}
.strip .st b{display:block;font-size:24px;color:var(--acc);letter-spacing:-.3px}
.strip .st span{font-size:12.5px;color:var(--dim)}

/* ---- cards & galleries ---- */
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(255px,1fr));gap:18px;margin:14px 0}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:0;overflow:hidden;box-shadow:0 1px 3px rgba(13,23,48,.06)}
.card .cb{padding:15px 17px}
.card .cardimg{display:block;width:100%;height:168px;object-fit:cover}
.card h4{margin:0 0 5px;font-size:15.5px;color:var(--ink);letter-spacing:-.1px}
.card p{margin:0 0 8px;font-size:13.5px;color:var(--dim)}
.card .price{display:block;font-size:19px;font-weight:800;color:var(--ink);margin-top:6px}
.card .price small{font-weight:600;color:var(--dim);font-size:12px}
.objcard{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 18px;margin:12px 0}
.gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:16px;margin:14px 0}
.gitem{margin:0;border-radius:14px;overflow:hidden;border:1px solid var(--line);background:var(--card)}
.gitem img{display:block;width:100%;height:180px;object-fit:cover}
.gitem figcaption{padding:11px 14px;font-size:13px;color:var(--dim)}
.embed iframe{width:100%;border:0;border-radius:12px}
.gallery.compact .gitem img{height:120px}

/* ---- node atoms ---- */
.detail{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px 30px}
dt{color:var(--dim);font-size:12px;text-transform:uppercase;letter-spacing:.7px;font-weight:700}
dd{margin:0 0 10px;font-size:15px}
dd.money,.price{font-weight:800;color:var(--ink)}
.pricebig{font-size:30px;font-weight:800;color:var(--acc);letter-spacing:-.5px}
.pricebig small{font-size:14px;color:var(--dim);font-weight:600}
.chip{display:inline-block;background:${dark ? 'rgba(255,255,255,.08)' : '#eef1f8'};border-radius:99px;padding:3px 12px;font-size:12.5px;font-weight:600}
.chip.yes{background:${dark ? 'rgba(60,190,120,.18)' : '#e0f5e9'};color:${dark ? '#7ce0a6' : '#137a43'}}
.chip.no{background:${dark ? 'rgba(230,90,90,.15)' : '#fbeaea'};color:${dark ? '#ff9c9c' : '#b3261e'}}
.chip.acc{background:var(--acc);color:#fff}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0}
.stars{color:#e8a825;letter-spacing:2px;font-size:16px}
.stars .dim{color:${dark ? '#3a4769' : '#d6dbe6'}}
.file{display:inline-flex;align-items:center;gap:8px;border:1px solid var(--line);border-radius:10px;padding:8px 13px;font-size:13.5px;font-weight:600;background:var(--card)}
.badge{display:inline-block;background:var(--acc);color:#fff;font-size:11.5px;font-weight:700;padding:3px 10px;border-radius:6px;text-transform:uppercase;letter-spacing:.6px}
.badge.alt{background:var(--acc2)}
.md p{margin:8px 0}
.md ul{padding-left:20px;margin:8px 0}
.md h3,.md h4{text-transform:none;letter-spacing:0;color:var(--ink);font-size:17px;margin:16px 0 6px}
.kv{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13.5px;background:${dark ? 'rgba(255,255,255,.07)' : '#eef1f8'};padding:2px 9px;border-radius:6px;letter-spacing:.8px}
.quote{font-size:15px;font-style:italic}
.byline{font-size:12.5px;color:var(--dim)}

/* ---- tables ---- */
.tblwrap{overflow-x:auto;margin:12px 0;border:1px solid var(--line);border-radius:14px;background:var(--card)}
table{border-collapse:collapse;width:100%;min-width:420px}
th,td{padding:11px 16px;text-align:left;border-bottom:1px solid var(--line);font-size:14px}
th{color:var(--dim);font-size:11.5px;text-transform:uppercase;letter-spacing:.7px;font-weight:700;background:${dark ? 'rgba(255,255,255,.03)' : '#f8f9fc'}}
tbody tr:hover{background:${dark ? 'rgba(255,255,255,.03)' : '#f6f8fc'}}
tbody tr:last-child td{border-bottom:none}
td.r,th.r{text-align:right}
td.c,th.c{text-align:center}
td .sub{display:block;font-size:12px;color:var(--dim)}
td .mono{font-family:ui-monospace,Menlo,monospace}
td.num{font-variant-numeric:tabular-nums;font-weight:700}

/* ---- itinerary flight rows ---- */
.seg{display:flex;align-items:center;gap:16px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 20px;margin:10px 0;flex-wrap:wrap}
.seg .t{font-size:21px;font-weight:800;letter-spacing:-.3px}
.seg .c{font-size:12.5px;color:var(--dim)}
.seg .path{flex:1;display:flex;align-items:center;gap:10px;min-width:120px;color:var(--dim);font-size:12px}
.seg .path i{flex:1;border-top:2px dashed var(--line);position:relative}
.seg .path i::after{content:"◆";position:absolute;right:-4px;top:-9px;color:var(--acc2);font-size:10px}
.seg .dur{color:var(--dim);font-size:13px;white-space:nowrap}
.seg .price{font-size:19px}

/* ---- forms ---- */
.act{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px 20px;margin:14px 0}
.act.plain{background:none;border:none;padding:0}
.fgrid{display:grid;grid-template-columns:repeat(12,1fr);gap:14px 16px}
.fld{display:flex;flex-direction:column;gap:5px;grid-column:span 12}
.fld.f4{grid-column:span 4}.fld.f6{grid-column:span 6}.fld.f3{grid-column:span 3}.fld.f8{grid-column:span 8}
@media(max-width:720px){.fld.f4,.fld.f6,.fld.f3,.fld.f8{grid-column:span 12}}
.fld label{font-size:12.5px;font-weight:700;color:var(--dim);letter-spacing:.3px}
.fld label i{color:#c62f3b;font-style:normal}
.fld input,.fld select,.fld textarea{border:1px solid var(--line);border-radius:10px;padding:11px 12px;font-size:14.5px;font-family:inherit;background:${dark ? 'rgba(255,255,255,.05)' : '#fff'};color:var(--ink);width:100%}
.fld input:focus,.fld select:focus,.fld textarea:focus{outline:2px solid var(--acc);outline-offset:-1px;border-color:var(--acc)}
.fld .hint{font-size:12px;color:var(--dim)}
.fld.check{flex-direction:row;align-items:center;gap:9px}
.fld.check input{width:auto;margin:0}
.fld.check label{font-weight:600;color:var(--ink);text-transform:none;font-size:14px}
.radios,.checks{display:flex;flex-wrap:wrap;gap:8px}
.radios label,.checks label{display:flex;align-items:center;gap:7px;border:1px solid var(--line);border-radius:10px;padding:9px 13px;font-size:13.5px;font-weight:600;color:var(--ink);cursor:pointer}
.radios label:has(input:checked),.checks label:has(input:checked){border-color:var(--acc);background:${dark ? 'rgba(124,150,255,.12)' : '#eef1fb'}}
input[type=range]{accent-color:var(--acc)}
.switch{position:relative;width:46px;height:26px;display:inline-block;flex-shrink:0}
.switch input{opacity:0;width:0;height:0;position:absolute}
.switch .tk{position:absolute;inset:0;background:${dark ? '#2a3554' : '#ccd4e2'};border-radius:99px;transition:.15s}
.switch .tk::after{content:"";position:absolute;left:3px;top:3px;width:20px;height:20px;border-radius:50%;background:#fff;transition:.15s;box-shadow:0 1px 3px rgba(0,0,0,.25)}
.switch input:checked+.tk{background:var(--acc)}
.switch input:checked+.tk::after{left:23px}
.fld.switchrow{flex-direction:row;align-items:center;gap:10px}
.fld.switchrow label{order:2;font-weight:600;color:var(--ink);font-size:14px}
.fsub{grid-column:span 12;display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:4px}

/* ---- buttons & actions ---- */
.btn{display:inline-block;background:${dark ? 'rgba(255,255,255,.08)' : '#eef1f7'};color:var(--ink);border:1px solid transparent;border-radius:99px;padding:11px 22px;font-size:14.5px;font-weight:700;cursor:pointer;font-family:inherit}
.btn:hover{text-decoration:none;filter:brightness(.97)}
.btn.primary{background:var(--acc);color:#fff}
.btn.ghost{background:none;border-color:var(--line);color:var(--ink)}
.btn.danger{background:#c62f3b;color:#fff}
.btn.slim{padding:6px 15px;font-size:13px}
.actions{display:flex;flex-direction:column;gap:2px}
.actions .row{display:flex;gap:12px;flex-wrap:wrap;align-items:stretch}
.ctab{display:inline-block;border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:10px;padding:9px 15px;font-size:13.5px;font-weight:600}

/* ---- components ---- */
.banner{background:linear-gradient(92deg,var(--acc),var(--acc2));color:#fff;padding:13px 20px;border-radius:12px;font-weight:700;margin:16px 0;font-size:14.5px}
.banner.soft{background:${dark ? 'rgba(232,168,37,.12)' : '#fdf3dd'};color:${dark ? '#f0c569' : '#8a6410'};border:1px solid ${dark ? 'rgba(232,168,37,.3)' : '#eed9a4'}}
.errbar{background:${dark ? 'rgba(230,80,90,.15)' : '#fdecec'};border:1px solid ${dark ? 'rgba(230,80,90,.4)' : '#f3c2c2'};color:${dark ? '#ffa3a3' : '#a12622'};border-radius:12px;padding:12px 18px;font-weight:600;margin:14px 0;font-size:14px}
.errcard{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:34px;max-width:560px;margin:40px auto;text-align:center}
.confcard{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:26px 30px;max-width:620px;margin:34px auto;box-shadow:0 8px 30px rgba(13,23,48,.08)}
.confcard h2{margin:0 0 8px}
.tabs{display:flex;gap:4px;border-bottom:2px solid var(--line);margin:16px 0 4px;overflow-x:auto}
.tabs a{padding:10px 16px;font-weight:600;font-size:14px;color:var(--dim);border-bottom:2px solid transparent;margin-bottom:-2px;white-space:nowrap}
.tabs a.on{color:var(--acc);border-color:var(--acc)}
.tabs a:hover{text-decoration:none;color:var(--ink)}
.calgrid{display:grid;grid-template-columns:repeat(7,1fr);gap:6px;margin:10px 0}
.calday{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:9px 6px;text-align:center;font-size:12px}
.calday span{display:block;color:var(--dim)}
.calday strong{display:block;color:var(--ink);font-size:13.5px;margin-top:3px}
.calday.low{border-color:${dark ? '#2e7a4c' : '#bfe3cd'};background:${dark ? 'rgba(60,190,120,.08)' : '#eaf7f0'}}
.calday.low strong{color:${dark ? '#7ce0a6' : '#137a43'}}
.stepper{display:flex;align-items:center;gap:12px;margin:14px 0}
.stepbar{flex:1;height:7px;background:${dark ? '#242f52' : '#e3e8f1'};border-radius:99px;overflow:hidden}
.stepbar i{display:block;height:100%;background:linear-gradient(90deg,var(--acc),var(--acc2));border-radius:99px}
.stepper span{font-size:13px;color:var(--dim);font-weight:600;white-space:nowrap}
.steps{display:flex;gap:0;margin:18px 0;counter-reset:st;flex-wrap:wrap}
.steps li{list-style:none;flex:1;min-width:110px;text-align:center;font-size:12.5px;color:var(--dim);position:relative;padding-top:26px;font-weight:600}
.steps li::before{counter-increment:st;content:counter(st);position:absolute;top:0;left:50%;transform:translateX(-50%);width:22px;height:22px;border-radius:50%;background:${dark ? '#242f52' : '#e3e8f1'};color:var(--dim);font-size:11.5px;font-weight:800;line-height:22px}
.steps li.done{color:var(--acc)}
.steps li.done::before{background:var(--acc);color:#fff}
.steps li.on{color:var(--ink)}
.steps li.on::before{background:var(--acc2);color:#fff}
.orderlist{counter-reset:ol;padding-left:0}
.orderlist li{list-style:none;counter-increment:ol;padding:10px 0 10px 44px;position:relative;border-bottom:1px solid var(--line);font-size:14.5px}
.orderlist li::before{content:counter(ol);position:absolute;left:8px;top:12px;width:24px;height:24px;border-radius:50%;background:var(--acc);color:#fff;font-weight:800;font-size:12.5px;line-height:24px;text-align:center}
.consent{background:${dark ? 'rgba(232,168,37,.1)' : '#fdf6e6'};border:1px solid ${dark ? 'rgba(232,168,37,.35)' : '#eedfae'};border-radius:12px;padding:14px 18px;font-size:13.5px;margin:12px 0}
.consent b{color:${dark ? '#f0c569' : '#8a6410'}}
.tree ul{list-style:none;padding-left:18px;border-left:1px solid var(--line);margin:4px 0}
.tree li{padding:3px 0;font-size:14px}
.promo{display:flex;gap:22px;background:var(--card);border:1px solid var(--line);border-radius:16px;overflow:hidden;margin:22px 0;align-items:stretch}
.promo .pimg{width:38%;object-fit:cover;min-height:180px}
.promo .pb{padding:22px 24px}
.promo h3{margin:0 0 6px;color:var(--ink);text-transform:none;font-size:19px;letter-spacing:-.2px}
.promo p{margin:0 0 10px;color:var(--dim);font-size:14px}
.promo .plink{font-weight:700;font-size:14px}
.chart{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 20px;margin:12px 0}
.chart svg{width:100%;height:auto;display:block}
.chart .bar{fill:var(--acc)}
.chart .bar:hover{fill:var(--acc2)}
.geocard{display:flex;align-items:center;gap:10px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 16px}
.geocard .pin{font-size:19px}
.review{font-style:normal}
.review .quote::before{content:"“";font-size:34px;line-height:0;color:var(--acc2);display:block;margin-bottom:2px}
.avatar{display:inline-flex;width:36px;height:36px;border-radius:50%;background:var(--acc);color:#fff;align-items:center;justify-content:center;font-weight:800;font-size:14px;flex-shrink:0}
.avrow{display:flex;align-items:center;gap:10px}

/* ---- cookie + footer ---- */
.cookie{position:fixed;left:50%;transform:translateX(-50%);bottom:18px;background:${dark ? '#101a30' : '#101c33'};color:#fff;border-radius:14px;padding:14px 20px;display:flex;gap:16px;align-items:center;font-size:13.5px;box-shadow:0 12px 40px rgba(0,0,0,.35);z-index:40;max-width:min(92vw,640px)}
.cookie a{color:#9fc0ff}
.cookie .btn.slim{background:#fff;color:#101c33}
.foot{background:${c.footBg};color:${c.footInk};margin-top:60px}
.foot .cols{max-width:1140px;margin:0 auto;display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:26px;padding:44px 30px 26px}
.foot .cols h5{margin:0 0 10px;font-size:12px;text-transform:uppercase;letter-spacing:.9px;color:#fff;opacity:.65}
.foot .cols a{display:block;color:${c.footInk};font-size:13.5px;padding:3px 0;opacity:.85}
.foot .cols a:hover{opacity:1;color:#fff}
.foot .base{max-width:1140px;margin:0 auto;padding:16px 30px 30px;border-top:1px solid rgba(255,255,255,.1);font-size:12.5px;opacity:.7}
.foot .base a{color:${c.footInk}}

@media(max-width:720px){
  .wrap{padding:20px 16px 56px}
  .top{padding:0 16px;gap:14px;height:58px}
  .brand{font-size:18px}
  .hero{min-height:300px}
  .promo{flex-direction:column}
  .promo .pimg{width:100%;max-height:200px}
  .cookie{left:12px;right:12px;transform:none;max-width:none;bottom:10px}
}
${s.extraCss ?? ''}`;
}
