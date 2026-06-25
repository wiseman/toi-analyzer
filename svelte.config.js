import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://svelte.dev/docs/kit/integrations
	// for more information about preprocessors
	preprocess: vitePreprocess(),
	// Pure client-side SPA (every route is ssr=false): emit a static fallback
	// shell and let the client router resolve all paths.
	kit: { adapter: adapter({ fallback: 'index.html' }) }
};

export default config;
