# Run a production build

The production entry point is a small Node.js HTTP server. It serves the built
frontend and the **same** `/api/live-intel` handler used during development. A
static-only upload (including GitHub Pages) does not provide that API: the
simulation can render there, but live intelligence needs this server or an
equivalent same-origin backend.

## Build and start

Use Node.js 24 or later; the Node 24 LTS line is used in CI. Native TypeScript execution
strips types; the build performs the actual type checks.

```sh
npm ci
npm run build
npm start
```

Open `http://127.0.0.1:3000`. The default bind address is **local only**. The
server refuses to start without a built `dist/index.html`; rebuild after changing
the frontend. `npm run dev` is for development and `npm run preview` is for local
build checks, not the production entry point.

The deployable tree must contain `dist/`, `runtime/`, `server/`, `shared/`, and
`package.json`. Keep the directory structure intact. The runtime and source
adapters use Node built-ins and do not require Vite or a separate framework to
serve requests. Dependency installation and TypeScript are still needed in the
build environment.

## Bind address and port

`PORT` accepts integers from 1 through 65535 (default `3000`). `HOST` accepts an
IP address or `localhost` (default `127.0.0.1`). For a container or another
deliberately public deployment:

```sh
HOST=0.0.0.0 PORT=8080 npm start
```

PowerShell equivalent:

```powershell
$env:HOST = '0.0.0.0'
$env:PORT = '8080'
npm start
```

Binding to `0.0.0.0` makes the service reachable on every IPv4 interface allowed
by the machine's firewall. Do not use it for routine private local development.
No account, private telemetry, or authentication service is provided by this
portfolio app.

Invalid `HOST` or `PORT` values stop startup with exit code `1` and an explanatory
message. Check the hosting service's environment settings rather than retrying
the same invalid configuration in a restart loop.

## Health probes

Use `GET /healthz` or `HEAD /healthz` for a lightweight readiness probe. A started
server returns `200` with `{ "status": "ok" }` (no body for `HEAD`), `no-store`,
and no deployment paths or upstream details. Other methods return `405`.
The server validates the build before listening; health probes do not read
assets, fetch OSINT, or wait on third-party services. Source health belongs to
`/api/live-intel` and the dashboard, not the process-restart decision. Forward
`/healthz` through the proxy if your host needs to probe it.

## Production network boundary

- Put a maintained TLS reverse proxy or your host's HTTPS ingress in front of
  Node. Keep the Node port private when the proxy is on the same machine.
- Forward both static requests and `/api/live-intel` to the server. Do not rewrite
  failed API or asset requests to `index.html`.
- Configure proxy request limits, connection limits, and operational logging for
  your hosting environment. The in-process public-source cache is not a
  distributed cache or a substitute for edge abuse controls.
- Allow outbound HTTPS to the fixed CISA and Hacker News Algolia source hosts.
  No API key is needed. Source failures appear in the application; they must not
  be represented as a healthy fresh feed.
- The runtime sends `nosniff`, framing protection, a no-referrer policy and the
  production browser policies described below. Preserve them at the proxy.
- `SIGINT` and `SIGTERM` stop new connections and allow active responses to finish,
  with a 10-second shutdown deadline. Use a process supervisor to restart after
  unexpected exits.

## Browser security policies

The production server includes an enforced Content Security Policy. Scripts,
stylesheet elements, fonts, images and API connections stay same-origin. Inline
scripts, script event handlers and `eval` are not allowed. Objects, frames,
framing, base-URL changes and form submissions are disabled. Local font files
remain compatible without an external font allowlist.

React's dynamic bar widths use style attributes, so `style-src-attr` allows
inline styles while `style-src-elem` permits only same-origin stylesheets. The
`style-src` fallback also allows inline styles for browsers without the more
specific CSP directives; this exception does **not** allow inline scripts.
Review the policy when introducing a legitimate new resource origin rather
than weakening it with a wildcard. Vite development and HMR are unaffected.

Permissions Policy disables camera, microphone, geolocation, payment and USB
access. Same-origin clipboard writes remain allowed for Copy Brief. Browser
support varies; these policies complement, rather than replace, safe code and
HTTPS. TLS/HSTS are the responsibility of the deployment ingress.

Policy references: [Content Security Policy](https://www.w3.org/TR/CSP3/)
and [Permissions Policy](https://w3c.github.io/webappsec-permissions-policy/).

## Route and security checks

Only `GET` and `HEAD` are supported. Unknown API paths return JSON `404`; other
methods return `405`. Static files are resolved within the real build directory,
including symlink checks. Malformed encodings, traversal and hidden file requests
are rejected. Missing assets stay `404`; only extensionless requests accepting
HTML can fall back to the SPA page.
Encoded slash and backslash separators are rejected rather than treated as route
aliases, avoiding disagreement with an upstream proxy's path normalization.
Reserved Windows device names such as `NUL`, `CON`, and `COM1`, including names
with extensions, are rejected on every platform for consistent deployment behavior.
Fallback requires an explicit `text/html` media type with a nonzero valid
quality value; `text/html;q=0` and wildcard-only requests keep their `404`.
Directory requests are not listed or automatically mapped to nested index files;
only `/` maps directly to the application's `index.html`.
Read requests with nonempty bodies or transfer encodings receive `400` and close
the connection. No endpoint accepts an upload or uses a request body.

Static responses include a weak, file-metadata `ETag`. Browsers can revalidate
with `If-None-Match`; matching `GET` and `HEAD` requests return a bodyless `304`.
These validators are cache hints, not content-integrity hashes. Dynamic API
responses do not use static validators and remain `no-store`.

Vite's content-hashed JS, CSS, font and image filenames under `/assets/` receive
`public, max-age=31536000, immutable`. The resolved file must also be a hashed
asset, so an alias cannot give `index.html` an immutable policy. HTML, SPA
fallbacks and non-hashed public files use `no-cache` and must revalidate. Keep
hashed filenames immutable; deploy changed assets under their new build hashes.

```sh
npm test
npm run build
npm start
```

Check `/`, `/favicon.svg`, and `/api/live-intel`. Confirm `/api/missing` and
`/assets/missing.js` return `404` rather than HTML. The runtime tests use an
ephemeral local server and mocked intelligence handler, so they do not depend on
public-source availability.

For rollback, redeploy the previous known-good application tree and restart the
process. There is no database migration or persisted incident state to reverse.

References: [Node's native TypeScript support](https://nodejs.org/api/typescript.html)
and [HTTP server shutdown](https://nodejs.org/api/http.html#serverclosecallback).
