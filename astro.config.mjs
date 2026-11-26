import { defineConfig } from 'astro/config';
import netlify from '@astrojs/netlify';
import tailwindcss from '@tailwindcss/vite';
import cms from './src/data/cms.json' with { type: 'json' };

// Canonical origin: PUBLIC_SITE_URL env → cms.json site.liveUrl → Netlify URL env. At runtime src/lib/site.ts uses the same order.
const configuredSite = process.env.PUBLIC_SITE_URL?.trim() || cms.site.liveUrl?.trim() || process.env.URL?.trim();

export default defineConfig({
  ...(configuredSite ? { site: configuredSite } : {}),
  output: 'server',
  adapter: netlify({ cacheOnDemandPages: false }),
  vite: { plugins: [tailwindcss()] },
});
