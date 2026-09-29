/**
 * Geopoint input / display - SPEC §9.1.1 / §24.3.
 * Protocol does not ship map tiles; lat/lng number inputs with optional label.
 */

/**
 * Render a geopoint ParamDef control.
 * @returns {HTMLElement & { getValue: () => {lat:number,lng:number,label?:string}|null, setValue: (v) => void }}
 */
export function createGeopointControl(id, name, param = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'app-geopoint';
  wrap.dataset.param = name;

  const latId = `${id}-lat`;
  const lngId = `${id}-lng`;

  const latLabel = document.createElement('label');
  latLabel.className = 'app-label';
  latLabel.setAttribute('for', latId);
  latLabel.textContent = 'Latitude';

  const lat = document.createElement('input');
  lat.type = 'number';
  lat.id = latId;
  lat.className = 'app-input app-geopoint-lat';
  lat.name = `${name}.lat`;
  lat.min = String(param.min_lat ?? -90);
  lat.max = String(param.max_lat ?? 90);
  lat.step = 'any';
  if (param.required) lat.required = true;

  const lngLabel = document.createElement('label');
  lngLabel.className = 'app-label';
  lngLabel.setAttribute('for', lngId);
  lngLabel.textContent = 'Longitude';

  const lng = document.createElement('input');
  lng.type = 'number';
  lng.id = lngId;
  lng.className = 'app-input app-geopoint-lng';
  lng.name = `${name}.lng`;
  lng.min = String(param.min_lng ?? -180);
  lng.max = String(param.max_lng ?? 180);
  lng.step = 'any';
  if (param.required) lng.required = true;

  wrap.append(latLabel, lat, lngLabel, lng);

  if (param.default && typeof param.default === 'object') {
    if (param.default.lat != null) lat.value = param.default.lat;
    if (param.default.lng != null) lng.value = param.default.lng;
  }

  wrap.getValue = () => {
    if (lat.value === '' || lng.value === '') {
      return param.required ? { lat: null, lng: null } : null;
    }
    const out = { lat: Number(lat.value), lng: Number(lng.value) };
    if (!Number.isFinite(out.lat) || !Number.isFinite(out.lng)) return null;
    return out;
  };

  wrap.setValue = (v) => {
    if (!v) {
      lat.value = '';
      lng.value = '';
      return;
    }
    const plain = v.type === 'geopoint' ? v.value : v;
    const la = typeof plain?.lat === 'number' ? plain.lat : plain?.lat?.value;
    const ln = typeof plain?.lng === 'number' ? plain.lng : plain?.lng?.value;
    if (la != null) lat.value = String(la);
    if (ln != null) lng.value = String(ln);
  };

  return wrap;
}

/**
 * Display a geopoint StateNode.
 */
export function renderGeopoint(opts) {
  const node = opts.node;
  const value = node?.type === 'geopoint' ? node.value : node?.value || node || {};
  const lat = typeof value.lat === 'number' ? value.lat : value.lat?.value;
  const lng = typeof value.lng === 'number' ? value.lng : value.lng?.value;
  const label = typeof value.label === 'string' ? value.label : value.label?.value;

  const el = document.createElement('div');
  el.className = 'app-geopoint-display';
  if (label) {
    const t = document.createElement('div');
    t.className = 'app-geopoint-label';
    t.textContent = label;
    el.appendChild(t);
  }
  const coords = document.createElement('div');
  coords.className = 'app-geopoint-coords';
  coords.textContent =
    lat != null && lng != null ? `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}` : '';
  el.appendChild(coords);
  return { el };
}
