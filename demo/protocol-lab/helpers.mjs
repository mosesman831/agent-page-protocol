/**
 * Shared builders for the Protocol Lab pages (see pages.mjs).
 */

export const LAB = (o, slug) => `${o}/app/lab/${slug}`;

export const lab = (o, slug) => LAB(o, slug);

export const page = ({
  origin,
  slug,
  id,
  title,
  version,
  state,
  actions,
  present,
  navigation,
  error,
  meta,
}) => ({
  app: '1.1',
  page: {
    id,
    url: lab(origin, slug),
    title,
    version,
    language: 'en-GB',
    description: 'APP protocol lab feature page',
  },
  state,
  ...(present ? { present } : {}),
  ...(actions ? { actions } : {}),
  ...(navigation ? { navigation } : {}),
  ...(error ? { error } : {}),
  ...(meta ? { meta } : {}),
});

export const navHome = (o) => ({
  breadcrumb: [{ label: 'Protocol Lab', url: lab(o, 'home') }],
});

/**
 * Lab present blocks — one `detail` section per state path (the schema field
 * is `state_path`, singular) plus one `form` section per action. renderForm
 * only binds the primary action's inputs, so a form section per action is how
 * every lab action stays exercisable from the shipped page.
 *
 * @param {{ state?: [string, string, string?][], actions?: string[], components?: object }} opts
 */
export const labPresent = ({ state = [], actions = [], components } = {}) => ({
  layout: 'detail',
  sections: [
    ...state.map(([path, label, sectionLayout]) => ({
      id: `s_${path.replace(/[^a-z0-9_]/gi, '_')}`,
      label,
      layout: sectionLayout ?? 'detail',
      state_path: path,
    })),
    ...actions.map((id) => ({
      id: `f_${id}`,
      label: `Action: ${id}`,
      layout: 'form',
      primary_action: id,
    })),
  ],
  ...(components ? { components } : {}),
});
