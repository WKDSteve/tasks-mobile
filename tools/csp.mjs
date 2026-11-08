// The policy the page is tested under: the one appkit's hub sets on every page it serves (`shell_policy` in
// appkit-hub/src/guard.rs), plus what an installable page needs: `manifest-src`, `worker-src`, and a second Trusted
// Types policy, `tasks-mobile-worker`, which turns exactly one string into a script URL: the address of the service
// worker (`src/lib/worker.ts`). The hub has to add these when it serves this page (docs/HUB.md); until then the e2e
// tests hold the page to this.

export const POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
  "require-trusted-types-for 'script'",
  'trusted-types svelte-trusted-html tasks-mobile-worker',
].join('; ');
