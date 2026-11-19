// Same-origin worker entry for the compile check. It sets where the TeX engine lives and hands over to the shared shim in the
// maketitle-assets repository (GitHub Pages), which loads BusyTeX and fetches the big TeX Live files in the worker.
// Kept as one stable URL on purpose: the TeX Live data is cached in IndexedDB under this worker's address.
const local = /^(localhost|127\.0\.0\.1)$/.test(self.location.hostname);
const override = local ? new URL(self.location.href).searchParams.get('assets') : null; // tests only, never honoured on the live site
self.__MT_ASSETS__ = override || 'https://voyager-from-space.github.io/maketitle-assets/';
importScripts(self.__MT_ASSETS__ + 'core/worker-shim.js');
