import site from '../../data/site.json';

const HEADERS = {
  'content-type': 'application/vnd.agent-page+json; charset=utf-8',
  'access-control-allow-origin': '*',
  'cache-control': 'no-store',
};

export function GET() {
  return new Response(JSON.stringify(site), { headers: HEADERS });
}
