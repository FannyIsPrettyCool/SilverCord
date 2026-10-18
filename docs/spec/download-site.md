# Spec: public desktop download page

The owner opened the production address on an iPhone and received the raw API 404.
Bring the public homepage forward from ADR-0004/phase 7, while the full installer
update feed remains in phase 7. This page does not expose accounts or browser chat.

- `apps/site` prerenders English `/` and French `/fr/` as static HTML with Node.
  Reuse the product brand, Aurora tokens, icon and bundled Figtree font. No runtime
  JavaScript, third-party requests, cookies or analytics. A static build avoids
  introducing a client framework before the update feed exists.
- Center one download panel; support 320px phones and short windows without
  horizontal overflow. Keyboard focus, sufficient contrast and reduced motion
  work without JavaScript. Language links have native-language accessible labels.
- State clearly that this is a desktop app and browser/mobile chat is unavailable.
  Approved explanatory copy: "SilverCord runs on your computer. Browser and mobile
  chat are not available." Translate all page copy through build-time EN/FR data.
- Offer the actual Windows x64 installer built from the verified v0.2.0 desktop
  output. No inactive/fake Linux or browser buttons. Label version/platform and
  provide a SHA-256 checksum file. Do not claim automatic updates or signing.
- Caddy serves static assets from `/srv/silvercord-site/current`, immutable releases
  beneath `/srv/silvercord-site/releases/<commit>`, public installers beneath
  `/srv/silvercord-downloads`. Publish binaries only after verifying transfer hashes.
- Explicit API (`/api/*`), gateway (`/gateway/*`) and health routes still proxy to
  the API. API-host media stays rejected; the authenticated CDN remains separate.
- Site responses use a restrictive CSP with no scripts, nosniff and framing denied.
  Downloads are attachments; directories are not browsable. No secrets enter the
  static build or installer; production credentials remain in main/OS storage.

Acceptance: public `/` and `/fr/` return HTML/200; real mobile and desktop renders
show a centered usable panel without overflow or external requests; installer
download and checksum match the local release; API health, gateway and private
media boundaries remain intact. Full workspace verification passes.
