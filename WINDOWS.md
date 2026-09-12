# Native Windows development

OSIRIS can run directly on Windows 10/11 with Node.js. WSL, Docker, Hyper-V,
VirtualBox and other virtualization layers are not required for the web app.

## Requirements

- Windows 10 or 11 (64-bit)
- Node.js 20 or newer (Node.js 22 LTS recommended)
- Git for Windows
- A modern Chromium/Firefox browser with WebGL enabled

## First run (PowerShell)

```powershell
git clone https://github.com/master7xx/osiris.git
cd osiris
npm ci
npm run doctor
Copy-Item .env.example .env.local
npm run dev:windows
```

Open http://localhost:3000.

Most feeds do not require API keys. RECON scanner features remain optional and
need SCANNER_URL/SCANNER_KEY. ASTRA is also an optional external service.

## Production-like local run

```powershell
npm ci
npm run build
npm start
```

## Live tests

`npm run test:live` is cross-platform. Do not use the POSIX-only
`RUN_LIVE_TESTS=1 command` form in PowerShell.

## Analytics

Native installs do not attempt to resolve Docker service names. Analytics are
disabled unless `UMAMI_BASE_URL` is explicitly set. Docker deployments that
want the existing Umami service can use:

```text
UMAMI_BASE_URL=http://umami-umami-1:3000
```

## Debug overlay

Press **Ctrl+Shift+D** (or click the DEBUG button in the lower-right corner).
The overlay records same-origin `/api/*` browser requests and shows status,
duration, time since the previous call to the same endpoint, correlation ID,
errors, and Server-Timing when present. It keeps a bounded in-memory history
and can export a sanitized JSON snapshot.

Query strings are intentionally stripped from the display/export so API keys,
targets and other sensitive parameters are not copied into debug logs.


## Server-side upstream timings

In `npm run dev:windows`, upstream fetch instrumentation is enabled automatically.
Each browser `/api/*` request receives a correlation ID; the overlay then attaches
the external fetches performed by that route and displays their host/path, HTTP
status, duration, timeout/abort state, and error.

For a production-like `npm start` session, server-side collection is deliberately
off by default. Enable it temporarily in PowerShell with:

```powershell
$env:OSIRIS_DEBUG = "1"
npm start
```

Do not enable `OSIRIS_DEBUG=1` on an internet-facing production instance unless
you intentionally want the diagnostic endpoint available. The collector never
stores query strings, bodies, request headers, cookies, or authorization values.
