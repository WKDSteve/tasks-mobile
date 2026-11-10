// The policy the page is tested under: the one appkit's hub sets on every page it serves (`shell_policy` in
// appkit-hub/src/guard.rs), plus what an installable page needs: `manifest-src`, `worker-src`, and a second Trusted
// Types policy, `tasks-mobile-worker`, which turns exactly one string into a script URL: the address of the service
// worker (`src/lib/worker.ts`). The hub adds exactly these under `/m/` (appkit v0.40.0,
// `GuardRules::with_installable_page`); tasks-desktop's browser test checks the real header. Since appkit v0.45.0 the
// page may also record a voice note (`GuardRules::with_installable_microphone`): `media-src 'self' blob:` to play it
// back, and `microphone=(self)` in the permissions (`PERMISSIONS`). Images may be `blob:`s the page made (a photo
// before it is sent), as on every page of the hub.

export const POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' blob:",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "media-src 'self' blob:",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
  "require-trusted-types-for 'script'",
  'trusted-types svelte-trusted-html tasks-mobile-worker',
].join('; ');

/** The permissions of the page under `/m/` (appkit-hub `set_page_headers` with the microphone let on). */
export const PERMISSIONS =
  'camera=(), microphone=(self), geolocation=(), payment=(), usb=(), clipboard-read=(), clipboard-write=(self)';
