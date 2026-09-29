/**
 * Shared manifest mutations used by the emit oracle (validator level) and the
 * emit-wire oracle (real middleware level). Each entry is [label, fn] where
 * fn mutates the cloned doc in place (or returns a replacement root).
 */
export function clone(v) {
  return structuredClone(v);
}
export function set(d, path, val) {
  const parts = path.split('.');
  let cur = d;
  for (const p of parts.slice(0, -1)) cur = cur?.[p];
  if (cur) cur[parts.at(-1)] = val;
}
export function drop(d, path) {
  const parts = path.split('.');
  let cur = d;
  for (const p of parts.slice(0, -1)) cur = cur?.[p];
  if (cur) delete cur[parts.at(-1)];
}

const M = (label, fn) => [label, fn];

export function stateMutations(doc) {
  const out = [
    M('state=null', (d) => set(d, 'state', null)),
    M('state=array', (d) => set(d, 'state', [])),
    // own-property __proto__ (spread copies it as a real key, unlike
    // assignment which would just retarget the prototype)
    M('state root key __proto__', (d) => {
      d.state = { ...d.state, ...JSON.parse('{"__proto__":{"type":"string","value":"x"}}') };
      return d;
    }),
  ];
  for (const key of Object.keys(doc.state ?? {}).slice(0, 8)) {
    const node = doc.state[key];
    out.push(
      M(`state.${key} type=bogus`, (d) => set(d, `state.${key}.type`, 'bogus')),
      M(`state.${key} extra member`, (d) => set(d, `state.${key}.zzz_extra`, 1)),
      M(`state.${key} drop type`, (d) => drop(d, `state.${key}.type`)),
    );
    if (node && typeof node === 'object') {
      if (node.type === 'string')
        out.push(M(`state.${key} value num`, (d) => set(d, `state.${key}.value`, 7)));
      if (node.type === 'number')
        out.push(M(`state.${key} value str`, (d) => set(d, `state.${key}.value`, 'oops')));
      if (node.type === 'enum') {
        out.push(
          M(`state.${key} enum out`, (d) => set(d, `state.${key}.value`, '__x__')),
          M(`state.${key} enum dup options`, (d) => set(d, `state.${key}.options`, ['a', 'a'])),
          M(`state.${key} enum empty options`, (d) => set(d, `state.${key}.options`, [])),
          M(`state.${key} option_labels stray key`, (d) =>
            set(d, `state.${key}.option_labels`, { __stray__: 'x' }),
          ),
        );
      }
      if (node.type === 'geopoint') {
        out.push(
          M(`state.${key} lat>90`, (d) => set(d, `state.${key}.value.lat`, 200)),
          M(`state.${key} lng>180`, (d) => set(d, `state.${key}.value.lng`, 400)),
          M(`state.${key} accuracy negative`, (d) => set(d, `state.${key}.value.accuracy_m`, -1)),
          M(`state.${key} lat missing`, (d) => drop(d, `state.${key}.value.lat`)),
        );
      }
      if (node.type === 'order') {
        out.push(
          M(`state.${key} order status bogus`, (d) =>
            set(d, `state.${key}.value.status`, 'exploded'),
          ),
          M(`state.${key} order total string`, (d) => set(d, `state.${key}.value.total`, 'lots')),
        );
      }
      if (node.type === 'table') {
        out.push(
          M(`state.${key} fields not array`, (d) => set(d, `state.${key}.fields`, 'x')),
          M(`state.${key} fields empty`, (d) => set(d, `state.${key}.fields`, [])),
        );
      }
      if (node.type === 'number') {
        out.push(
          M(`state.${key} min>max`, (d) => {
            set(d, `state.${key}.min`, 10);
            set(d, `state.${key}.max`, 5);
            set(d, `state.${key}.value`, 7);
          }),
          M(`state.${key} scale frac`, (d) => set(d, `state.${key}.scale`, 1.5)),
        );
      }
      if (node.type === 'datetime')
        out.push(M(`state.${key} bad datetime`, (d) => set(d, `state.${key}.value`, 'not a date')));
      if (node.type === 'file')
        out.push(M(`state.${key} mime not string`, (d) => set(d, `state.${key}.value.mime`, 9)));
      if (node.type === 'file')
        out.push(M(`state.${key} drop value.url`, (d) => drop(d, `state.${key}.value.url`)));
      if (node.type === 'boolean')
        out.push(M(`state.${key} value str`, (d) => set(d, `state.${key}.value`, 'yes')));
      if (node.type === 'null')
        out.push(M(`state.${key} stray value`, (d) => set(d, `state.${key}.value`, 1)));
      if (node.type === 'date')
        out.push(M(`state.${key} bad date`, (d) => set(d, `state.${key}.value`, '13/45/2026')));
      if (node.type === 'array')
        out.push(
          M(`state.${key} item non-node`, (d) => set(d, `state.${key}.value`, ['oops'])),
          M(`state.${key} value obj`, (d) => set(d, `state.${key}.value`, { x: 1 })),
        );
      if (node.type === 'quantity' && node.value && typeof node.value === 'object') {
        out.push(
          M(`state.${key} unit empty`, (d) => set(d, `state.${key}.value.unit`, '')),
          M(`state.${key} unit badchars`, (d) => set(d, `state.${key}.value.unit`, '!!')),
          M(`state.${key} drop unit`, (d) => drop(d, `state.${key}.value.unit`)),
          M(`state.${key} value not obj`, (d) => set(d, `state.${key}.value`, 5)),
        );
      }
      if (node.type === 'daterange' && node.value && typeof node.value === 'object') {
        out.push(
          M(`state.${key} from bad date`, (d) => set(d, `state.${key}.value.from`, 'not-a-date')),
          M(`state.${key} drop to`, (d) => drop(d, `state.${key}.value.to`)),
        );
      }
      if (node.type === 'datetimerange' && node.value && typeof node.value === 'object') {
        out.push(
          M(`state.${key} from bad datetime`, (d) =>
            set(d, `state.${key}.value.from`, 'yesterday'),
          ),
          M(`state.${key} drop to`, (d) => drop(d, `state.${key}.value.to`)),
        );
      }
      if (node.type === 'embed') {
        out.push(
          M(`state.${key} embed http url`, (d) => set(d, `state.${key}.url`, 'http://x.co')),
          M(`state.${key} embed drop description`, (d) => drop(d, `state.${key}.description`)),
          M(`state.${key} embed bad sandbox`, (d) =>
            set(d, `state.${key}.sandbox`, ['everything']),
          ),
          M(`state.${key} embed height 4000`, (d) => set(d, `state.${key}.height`, 4000)),
        );
      }
      if (node.type === 'markdown') {
        out.push(M(`state.${key} markdown value num`, (d) => set(d, `state.${key}.value`, 42)));
      }
      if (node.type === 'media') {
        out.push(
          M(`state.${key} media item drop url`, (d) => {
            const it = d.state?.[key]?.value?.[0];
            if (it) delete it.url;
          }),
          M(`state.${key} media value obj`, (d) => set(d, `state.${key}.value`, { x: 1 })),
          M(`state.${key} media bad kind`, (d) => {
            const it = d.state?.[key]?.value?.[0];
            if (it) it.kind = 'gif';
          }),
        );
      }
      if (node.type === 'tree') {
        out.push(
          M(`state.${key} tree item bad id`, (d) => {
            const it = d.state?.[key]?.value?.[0];
            if (it) it.id = 'Bad ID';
          }),
          M(`state.${key} tree item drop label`, (d) => {
            const it = d.state?.[key]?.value?.[0];
            if (it) delete it.label;
          }),
          M(`state.${key} tree children obj`, (d) => {
            const it = d.state?.[key]?.value?.[0];
            if (it) it.children = { x: 1 };
          }),
        );
      }
      if (node.pagination)
        out.push(M(`state.${key} pag extra`, (d) => set(d, `state.${key}.pagination.zzz`, 1)));
      if (node.type === 'object' && node.value && typeof node.value === 'object') {
        const childKey = Object.keys(node.value)[0];
        if (childKey) {
          out.push(
            M(`state.${key} nested __proto__`, (d) => {
              d.state[key].value = JSON.parse('{"__proto__":{"type":"string","value":"pwned"}}');
              return d;
            }),
            M(`state.${key}.${childKey} type bogus`, (d) =>
              set(d, `state.${key}.value.${childKey}.type`, 'bogus'),
            ),
          );
        }
      }
    }
  }
  return out;
}

export function actionMutations(doc) {
  const out = [];
  for (const aid of Object.keys(doc.actions ?? {})) {
    out.push(
      [`actions.${aid} kind bogus`, (d) => set(d, `actions.${aid}.kind`, 'explode')],
      [`actions.${aid} extra member`, (d) => set(d, `actions.${aid}.zzz_extra`, 1)],
      [`actions.${aid} side_effect bad`, (d) => set(d, `actions.${aid}.side_effect`, 'lethal')],
      [`actions.${aid} drop description`, (d) => drop(d, `actions.${aid}.description`)],
    );
    const def = doc.actions[aid];
    for (const [pname, pdef] of Object.entries(def?.input ?? {}).slice(0, 4)) {
      out.push(
        [
          `actions.${aid}.input.${pname} type bogus`,
          (d) => set(d, `actions.${aid}.input.${pname}.type`, 'bogus'),
        ],
        [
          `actions.${aid}.input.${pname} unknown member`,
          (d) => set(d, `actions.${aid}.input.${pname}.secret`, 42),
        ],
      );
      if (pdef?.type === 'array')
        out.push([
          `actions.${aid}.input.${pname} item_type bogus`,
          (d) => set(d, `actions.${aid}.input.${pname}.item_type`, 'bogus'),
        ]);
    }
    out.push([
      `actions.${aid} 129th actions`,
      (d) => {
        for (let i = 0; i < 200; i++) d.actions[`pad_${i}`] = { description: 'p', kind: 'query' };
        return d;
      },
    ]);
  }
  return out;
}

export function blockMutations(doc) {
  const out = [
    M('page.id grammar', (d) => set(d, 'page.id', 'BAD ID!')),
    M('page drop id', (d) => drop(d, 'page.id')),
    M('page.url null', (d) => set(d, 'page.url', null)),
    M('page.version bad', (d) => set(d, 'page.version', 'bad space')),
    M('page extra member', (d) => set(d, 'page.zzz_extra', 1)),
    M('present must be object', (d) => set(d, 'present', ['nope'])),
    M('present layout bogus', (d) => set(d, 'present.layout', 'hyperspace')),
    M('present extra root member', (d) => set(d, 'present.zzz_ext', 1)),
    ...(doc.present?.sections
      ? [
          M('present section extra member', (d) => set(d, 'present.sections.0.zzz', 1)),
          M('present section bad id', (d) => set(d, 'present.sections.0.id', '9bad')),
          M('present section drop id', (d) => drop(d, 'present.sections.0.id')),
          M('present section layout bogus', (d) =>
            set(d, 'present.sections.0.layout', 'hyperspace'),
          ),
          M('present section bad state_path', (d) =>
            set(d, 'present.sections.0.state_path', 'a..b'),
          ),
          M('present section not object', (d) => set(d, 'present.sections.0', 'x')),
        ]
      : []),
    ...(doc.present?.components
      ? (() => {
          const first = Object.keys(doc.present.components)[0];
          return [
            M('present component bogus type', (d) =>
              set(d, `present.components.${first}.type`, 'warp_drive'),
            ),
            M('present component extra member', (d) =>
              set(d, `present.components.${first}.zzz`, 1),
            ),
            M('present component drop type', (d) => drop(d, `present.components.${first}.type`)),
            M('present component bad variant', (d) =>
              set(d, `present.components.${first}.variant`, 'neon'),
            ),
            M('present component bad action_id', (d) =>
              set(d, `present.components.${first}.action_id`, 'Bad Action'),
            ),
          ];
        })()
      : []),
    M('meta must be object', (d) => set(d, 'meta', 42)),
    M('meta __proto__ key', (d) => {
      d.meta = { ...d.meta, ...JSON.parse('{"__proto__":{"x":1}}') };
      return d;
    }),
  ];
  if (doc.navigation) {
    out.push(
      M('nav extra member', (d) => set(d, 'navigation.zzz', 1)),
      M('nav breadcrumb not array', (d) => set(d, 'navigation.breadcrumb', {})),
    );
    if (Array.isArray(doc.navigation.breadcrumb) && doc.navigation.breadcrumb.length) {
      out.push(
        M('nav item drop label', (d) => drop(d, 'navigation.breadcrumb.0.label')),
        M('nav item drop url', (d) => drop(d, 'navigation.breadcrumb.0.url')),
        M('nav item extra member', (d) => set(d, 'navigation.breadcrumb.0.zzz', 1)),
        M('nav item rel bogus', (d) => set(d, 'navigation.breadcrumb.0.rel', 'sideways')),
        M('nav item page_id bad', (d) => set(d, 'navigation.breadcrumb.0.page_id', 'BAD ID')),
      );
    }
  }
  return out;
}

export function manifestMutations(doc) {
  return [...stateMutations(doc), ...actionMutations(doc), ...blockMutations(doc)];
}

// Emit is deliberately stricter than the schema — but only for the checks
// JSON Schema cannot express: sibling-member constraints (enum value ∈
// options, option_labels keys ⊆ options, daterange from <= to, table row
// width), cross-field rules (quantity scale vs integer value), and the
// forbidden-key hardening (__proto__/constructor/prototype) against
// prototype pollution. Anything else that's schema-valid but emit-rejected
// is a spec hole: a doc legal by the schema that no server can emit.
export const KNOWN_DIVERGENCE = [
  /Forbidden key: (__proto__|constructor|prototype)/,
  /enum value not in options/,
  /enum\.option_labels key not in options/,
  /range from must be <= to/,
  /table row length \d+ != fields count/,
  /scale must be integer >= 0/,
];
