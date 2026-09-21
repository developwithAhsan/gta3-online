# GTA III Cloudflare asset proxy

The GitHub Pages site cannot fetch the Google Drive archive directly because
Google Drive does not allow the required cross-origin browser request.

This Worker streams the authorized ZIP server-side and returns CORS/range
headers required by `web/opfs-cache-worker.js`.

## Deploy

```bash
cd cloudflare-worker
npx wrangler login
npx wrangler deploy
```

Wrangler prints the public Worker URL after deployment. Put that exact URL in:

```js
// web/asset-source.js
proxyUrl: "https://YOUR-WORKER.workers.dev/",
```

Then push the change. The existing **Download & Play** button will use the
proxy, save the ZIP once in OPFS, extract it into the WASM runtime, validate it,
and auto-start GTA III. Later visits reuse the OPFS cache and do not download
the archive again.
