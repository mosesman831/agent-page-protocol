/**
 * All SPEC §19.3 / §27 conformance test vectors (TV-01..TV-140).
 */

import type { TestVector, VectorMeta } from './types.js';
import { tv01Vector } from './TV-01.js';
import { tv02Vector } from './TV-02.js';
import { tv03Vector } from './TV-03.js';
import { tv04Vector } from './TV-04.js';
import { tv05Vector } from './TV-05.js';
import { tv06Vector } from './TV-06.js';
import { tv07Vector } from './TV-07.js';
import { tv08Vector } from './TV-08.js';
import { tv09Vector } from './TV-09.js';
import { tv10Vector } from './TV-10.js';
import { tv11Vector } from './TV-11.js';
import { tv12Vector } from './TV-12.js';
import { tv13Vector } from './TV-13.js';
import { tv14Vector } from './TV-14.js';
import { tv15Vector } from './TV-15.js';
import { tv16Vector } from './TV-16.js';
import { tv17Vector } from './TV-17.js';
import { tv18Vector } from './TV-18.js';
import { tv19Vector } from './TV-19.js';
import { tv20Vector } from './TV-20.js';
import { tv21Vector } from './TV-21.js';
import { tv22Vector } from './TV-22.js';
import { tv23Vector } from './TV-23.js';
import { tv24Vector } from './TV-24.js';
import { tv25Vector } from './TV-25.js';
import { tv26Vector } from './TV-26.js';
import { tv27Vector } from './TV-27.js';
import { tv28Vector } from './TV-28.js';
import { tv29Vector } from './TV-29.js';
import { tv30Vector } from './TV-30.js';
import { tv31Vector } from './TV-31.js';
import { tv32Vector } from './TV-32.js';
import { tv33Vector } from './TV-33.js';
import { tv34Vector } from './TV-34.js';
import { tv35Vector } from './TV-35.js';
import { tv36Vector } from './TV-36.js';
import { tv37Vector } from './TV-37.js';
import { tv38Vector } from './TV-38.js';
import { tv39Vector } from './TV-39.js';
import { tv40Vector } from './TV-40.js';
import { tv41Vector } from './TV-41.js';
import { tv42Vector } from './TV-42.js';
import { tv43Vector } from './TV-43.js';
import { tv44Vector } from './TV-44.js';
import { tv45Vector } from './TV-45.js';
import { tv46Vector } from './TV-46.js';
import { tv47Vector } from './TV-47.js';
import { tv48Vector } from './TV-48.js';
import { tv49Vector } from './TV-49.js';
import { tv50Vector } from './TV-50.js';
import { tv51Vector } from './TV-51.js';
import { tv52Vector } from './TV-52.js';
import { tv53Vector } from './TV-53.js';
import { tv54Vector } from './TV-54.js';
import { tv55Vector } from './TV-55.js';
import { tv56Vector } from './TV-56.js';
import { tv57Vector } from './TV-57.js';
import { tv58Vector } from './TV-58.js';
import { tv59Vector } from './TV-59.js';
import { tv60Vector } from './TV-60.js';
import { tv61Vector } from './TV-61.js';
import { tv62Vector } from './TV-62.js';
import { tv63Vector } from './TV-63.js';
import { tv64Vector } from './TV-64.js';
import { tv65Vector } from './TV-65.js';
import { tv66Vector } from './TV-66.js';
import { tv67Vector } from './TV-67.js';
import { tv68Vector } from './TV-68.js';
import { tv69Vector } from './TV-69.js';
import { tv70Vector } from './TV-70.js';
import { tv71Vector } from './TV-71.js';
import { tv72Vector } from './TV-72.js';
import { tv73Vector } from './TV-73.js';
import { tv74Vector } from './TV-74.js';
import { tv75Vector } from './TV-75.js';
import { tv76Vector } from './TV-76.js';
import { tv77Vector } from './TV-77.js';
import { tv78Vector } from './TV-78.js';
import { tv79Vector } from './TV-79.js';
import { tv80Vector } from './TV-80.js';
import { tv81Vector } from './TV-81.js';
import { tv82Vector } from './TV-82.js';
import { tv83Vector } from './TV-83.js';
import { tv84Vector } from './TV-84.js';
import { tv85Vector } from './TV-85.js';
import { tv86Vector } from './TV-86.js';
import { tv87Vector } from './TV-87.js';
import { tv88Vector } from './TV-88.js';
import { tv89Vector } from './TV-89.js';
import { tv90Vector } from './TV-90.js';
import { tv91Vector } from './TV-91.js';
import { tv92Vector } from './TV-92.js';
import { tv93Vector } from './TV-93.js';
import { tv94Vector } from './TV-94.js';
import { tv95Vector } from './TV-95.js';
import { tv96Vector } from './TV-96.js';
import { tv97Vector } from './TV-97.js';
import { tv98Vector } from './TV-98.js';
import { tv99Vector } from './TV-99.js';
import { tv100Vector } from './TV-100.js';
import { tv101Vector } from './TV-101.js';
import { tv102Vector } from './TV-102.js';
import { tv103Vector } from './TV-103.js';
import { tv104Vector } from './TV-104.js';
import { tv105Vector } from './TV-105.js';
import { tv106Vector } from './TV-106.js';
import { tv107Vector } from './TV-107.js';
import { tv108Vector } from './TV-108.js';
import { tv109Vector } from './TV-109.js';
import { tv110Vector } from './TV-110.js';
import { tv111Vector } from './TV-111.js';
import { tv112Vector } from './TV-112.js';
import { tv113Vector } from './TV-113.js';
import { tv114Vector } from './TV-114.js';
import { tv115Vector } from './TV-115.js';
import { tv116Vector } from './TV-116.js';
import { tv117Vector } from './TV-117.js';
import { tv118Vector } from './TV-118.js';
import { tv119Vector } from './TV-119.js';
import { tv120Vector } from './TV-120.js';
import { tv121Vector } from './TV-121.js';
import { tv122Vector } from './TV-122.js';
import { tv123Vector } from './TV-123.js';
import { tv124Vector } from './TV-124.js';
import { tv125Vector } from './TV-125.js';
import { tv126Vector } from './TV-126.js';
import { tv127Vector } from './TV-127.js';
import { tv128Vector } from './TV-128.js';
import { tv129Vector } from './TV-129.js';
import { tv130Vector } from './TV-130.js';
import { tv131Vector } from './TV-131.js';
import { tv132Vector } from './TV-132.js';
import { tv133Vector } from './TV-133.js';
import { tv134Vector } from './TV-134.js';
import { tv135Vector } from './TV-135.js';
import { tv136Vector } from './TV-136.js';
import { tv137Vector } from './TV-137.js';
import { tv138Vector } from './TV-138.js';
import { tv139Vector } from './TV-139.js';
import { tv140Vector } from './TV-140.js';
import { tv141Vector } from './TV-141.js';
import { tv142Vector } from './TV-142.js';
import { tv143Vector } from './TV-143.js';
import { tv144Vector } from './TV-144.js';
import { tv145Vector } from './TV-145.js';
import { tv146Vector } from './TV-146.js';
import { tv147Vector } from './TV-147.js';
import { tv148Vector } from './TV-148.js';
import { tv149Vector } from './TV-149.js';
import { tv150Vector } from './TV-150.js';
import { tv151Vector } from './TV-151.js';
import { tv152Vector } from './TV-152.js';
import { tv153Vector } from './TV-153.js';
import { tv154Vector } from './TV-154.js';
import { tv155Vector } from './TV-155.js';
import { tv156Vector } from './TV-156.js';
import { tv157Vector } from './TV-157.js';
import { tv158Vector } from './TV-158.js';

export * from './types.js';
export { VECTOR_CATALOG, metaFor } from './registry.js';
export {
  assert,
  readJson,
  readTextAndJson,
  expandUrlTemplate,
  errorCode,
  errorPath,
  tvPath,
  actionHeaders,
  v11GetHeaders,
  v11ActionHeaders,
  containsLeakedSecret,
  getWithBody,
  ACCEPT_PAGE,
  ACCEPT_DIFF,
  ACCEPT_DIFF_ONLY,
  ACCEPT_ANY_APP,
  ACCEPT_PAGE_11,
  ACCEPT_DIFF_11,
  ACCEPT_VERSIONS_11,
  MEDIA_PAGE,
  MEDIA_DIFF,
  MEDIA_ACTION,
  MEDIA_ERROR,
} from './helpers.js';
export { fetchWithAuthRefresh } from './runs/auth-refresh.js';
export { discover11, runMultiGate } from './runs/v11.js';

/** Ordered list of all required vectors (TV-01..TV-140). */
export const ALL_VECTORS: TestVector[] = [
  tv01Vector,
  tv02Vector,
  tv03Vector,
  tv04Vector,
  tv05Vector,
  tv06Vector,
  tv07Vector,
  tv08Vector,
  tv09Vector,
  tv10Vector,
  tv11Vector,
  tv12Vector,
  tv13Vector,
  tv14Vector,
  tv15Vector,
  tv16Vector,
  tv17Vector,
  tv18Vector,
  tv19Vector,
  tv20Vector,
  tv21Vector,
  tv22Vector,
  tv23Vector,
  tv24Vector,
  tv25Vector,
  tv26Vector,
  tv27Vector,
  tv28Vector,
  tv29Vector,
  tv30Vector,
  tv31Vector,
  tv32Vector,
  tv33Vector,
  tv34Vector,
  tv35Vector,
  tv36Vector,
  tv37Vector,
  tv38Vector,
  tv39Vector,
  tv40Vector,
  tv41Vector,
  tv42Vector,
  tv43Vector,
  tv44Vector,
  tv45Vector,
  tv46Vector,
  tv47Vector,
  tv48Vector,
  tv49Vector,
  tv50Vector,
  tv51Vector,
  tv52Vector,
  tv53Vector,
  tv54Vector,
  tv55Vector,
  tv56Vector,
  tv57Vector,
  tv58Vector,
  tv59Vector,
  tv60Vector,
  tv61Vector,
  tv62Vector,
  tv63Vector,
  tv64Vector,
  tv65Vector,
  tv66Vector,
  tv67Vector,
  tv68Vector,
  tv69Vector,
  tv70Vector,
  tv71Vector,
  tv72Vector,
  tv73Vector,
  tv74Vector,
  tv75Vector,
  tv76Vector,
  tv77Vector,
  tv78Vector,
  tv79Vector,
  tv80Vector,
  tv81Vector,
  tv82Vector,
  tv83Vector,
  tv84Vector,
  tv85Vector,
  tv86Vector,
  tv87Vector,
  tv88Vector,
  tv89Vector,
  tv90Vector,
  tv91Vector,
  tv92Vector,
  tv93Vector,
  tv94Vector,
  tv95Vector,
  tv96Vector,
  tv97Vector,
  tv98Vector,
  tv99Vector,
  tv100Vector,
  tv101Vector,
  tv102Vector,
  tv103Vector,
  tv104Vector,
  tv105Vector,
  tv106Vector,
  tv107Vector,
  tv108Vector,
  tv109Vector,
  tv110Vector,
  tv111Vector,
  tv112Vector,
  tv113Vector,
  tv114Vector,
  tv115Vector,
  tv116Vector,
  tv117Vector,
  tv118Vector,
  tv119Vector,
  tv120Vector,
  tv121Vector,
  tv122Vector,
  tv123Vector,
  tv124Vector,
  tv125Vector,
  tv126Vector,
  tv127Vector,
  tv128Vector,
  tv129Vector,
  tv130Vector,
  tv131Vector,
  tv132Vector,
  tv133Vector,
  tv134Vector,
  tv135Vector,
  tv136Vector,
  tv137Vector,
  tv138Vector,
  tv139Vector,
  tv140Vector,
  tv141Vector,
  tv142Vector,
  tv143Vector,
  tv144Vector,
  tv145Vector,
  tv146Vector,
  tv147Vector,
  tv148Vector,
  tv149Vector,
  tv150Vector,
  tv151Vector,
  tv152Vector,
  tv153Vector,
  tv154Vector,
  tv155Vector,
  tv156Vector,
  tv157Vector,
  tv158Vector,
];

/** Metadata only — for external runners / catalogs. */
export const VECTOR_METADATA: VectorMeta[] = ALL_VECTORS.map((v) => v.meta);

export function getVector(id: string): TestVector | undefined {
  return ALL_VECTORS.find((v) => v.meta.id === id);
}

export function vectorsForLevel(level: string): TestVector[] {
  return ALL_VECTORS.filter((v) => v.meta.levels.includes(level as VectorMeta['levels'][number]));
}

export {
  tv01Vector,
  tv02Vector,
  tv03Vector,
  tv04Vector,
  tv05Vector,
  tv06Vector,
  tv07Vector,
  tv08Vector,
  tv09Vector,
  tv10Vector,
  tv11Vector,
  tv12Vector,
  tv13Vector,
  tv14Vector,
  tv15Vector,
  tv16Vector,
  tv17Vector,
  tv18Vector,
  tv19Vector,
  tv20Vector,
  tv21Vector,
  tv22Vector,
  tv23Vector,
  tv24Vector,
  tv25Vector,
  tv26Vector,
  tv27Vector,
  tv28Vector,
  tv29Vector,
  tv30Vector,
  tv31Vector,
  tv32Vector,
  tv33Vector,
  tv34Vector,
  tv35Vector,
  tv36Vector,
  tv37Vector,
  tv38Vector,
  tv39Vector,
  tv40Vector,
  tv41Vector,
  tv42Vector,
  tv43Vector,
  tv44Vector,
  tv45Vector,
  tv46Vector,
  tv47Vector,
  tv48Vector,
  tv49Vector,
  tv50Vector,
  tv51Vector,
  tv52Vector,
  tv53Vector,
  tv54Vector,
  tv55Vector,
  tv56Vector,
  tv57Vector,
  tv58Vector,
  tv59Vector,
  tv60Vector,
  tv61Vector,
  tv62Vector,
  tv63Vector,
  tv64Vector,
  tv65Vector,
  tv66Vector,
  tv67Vector,
  tv68Vector,
  tv69Vector,
  tv70Vector,
  tv71Vector,
  tv72Vector,
  tv73Vector,
  tv74Vector,
  tv75Vector,
  tv76Vector,
  tv77Vector,
  tv78Vector,
  tv79Vector,
  tv80Vector,
  tv81Vector,
  tv82Vector,
  tv83Vector,
  tv84Vector,
  tv85Vector,
  tv86Vector,
  tv87Vector,
  tv88Vector,
  tv89Vector,
  tv90Vector,
  tv91Vector,
  tv92Vector,
  tv93Vector,
  tv94Vector,
  tv95Vector,
  tv96Vector,
  tv97Vector,
  tv98Vector,
  tv99Vector,
  tv100Vector,
  tv101Vector,
  tv102Vector,
  tv103Vector,
  tv104Vector,
  tv105Vector,
  tv106Vector,
  tv107Vector,
  tv108Vector,
  tv109Vector,
  tv110Vector,
  tv111Vector,
  tv112Vector,
  tv113Vector,
  tv114Vector,
  tv115Vector,
  tv116Vector,
  tv117Vector,
  tv118Vector,
  tv119Vector,
  tv120Vector,
  tv121Vector,
  tv122Vector,
  tv123Vector,
  tv124Vector,
  tv125Vector,
  tv126Vector,
  tv127Vector,
  tv128Vector,
  tv129Vector,
  tv130Vector,
  tv131Vector,
  tv132Vector,
  tv133Vector,
  tv134Vector,
  tv135Vector,
  tv136Vector,
  tv137Vector,
  tv138Vector,
  tv139Vector,
  tv140Vector,
  tv141Vector,
  tv142Vector,
  tv143Vector,
  tv144Vector,
  tv145Vector,
  tv146Vector,
  tv147Vector,
  tv148Vector,
  tv149Vector,
  tv150Vector,
  tv151Vector,
  tv152Vector,
  tv153Vector,
  tv154Vector,
  tv155Vector,
  tv156Vector,
  tv157Vector,
  tv158Vector,
};
