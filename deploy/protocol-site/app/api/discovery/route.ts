import wellknown from '../../../data/wellknown.json';

const HEADERS = {
  'content-type': 'application/vnd.agent-page+json; charset=utf-8',
  'access-control-allow-origin': '*',
  'cache-control': 'no-store',
};

export function GET() {
  return new Response(JSON.stringify(wellknown), { headers: HEADERS });
}
