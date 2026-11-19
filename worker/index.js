// Serves the Framer desktop under this address, and the project's own pages (proof embed, console gateway, demo)
// from the static files. The Framer site is the owner's own published site; this only passes requests through.
const FRAMER = 'https://aqua-lottery-936140.framer.app';
const OWN_PREFIXES = ['/embed/', '/console/', '/demo/', '/lib/'];
const OWN_FILES = new Set(['/proof.js', '/proof.css', '/proof-data.json']);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // /console/ is also the name of a Framer page: only frames (the Console window) get the gateway, page visits get the desktop.
    const dest = request.headers.get('sec-fetch-dest');
    const isGateway = url.pathname === '/console/' && (dest === 'document' || dest === null && request.headers.get('accept')?.includes('text/html') && request.headers.get('sec-fetch-mode') === 'navigate');
    const own = !isGateway && (OWN_PREFIXES.some((p) => url.pathname.startsWith(p)) || OWN_FILES.has(url.pathname));
    if (own) return env.ASSETS.fetch(request);
    const path = url.pathname === '/console/' ? '/console' : url.pathname;
    const upstream = new Request(new URL(path + url.search, FRAMER), request);
    return fetch(upstream, { redirect: 'manual' });
  },
};
