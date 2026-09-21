// Persistent GTA III asset-source configuration.
//
// The OPFS cache works with a local ZIP immediately. If you own/control an
// archive URL and are authorized to distribute it, put that URL in archiveUrl.
// The launcher will download it once, cache the ZIP in OPFS, and reuse it on
// later visits without another network download.
window.GTA3_ASSET_CONFIG = Object.freeze({
  archiveUrl: "",
  autoInstall: false,
  cacheVersion: "gta3-zip-v1",
});
