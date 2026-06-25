// Force client-side SPA mode app-wide: no SSR, no prerendering. Combined with
// adapter-static's `fallback`, every route resolves through the client router.
export const ssr = false;
export const prerender = false;
