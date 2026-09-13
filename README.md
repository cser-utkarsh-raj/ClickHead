<div align="center">

# ⚡ CLICKHEAD

### HTTP Traffic Testing & Load Diagnostics

Controlled request pacing, configurable concurrency, live telemetry, a standalone test bench, and an optional browser-based analytics verification mode.

<p align="center">
  <a href="#features">Features</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#load-profiles">Load Profiles</a> •
  <a href="#architecture">Architecture</a> •
  <a href="#test-bench">Test Bench</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Runtime-Node.js%2022-07110C?style=for-the-badge&logo=node.js&logoColor=B4F82C" alt="Node.js 22" />
  <img src="https://img.shields.io/badge/Telemetry-P50%20%2F%20P95%20%2F%20P99-07110C?style=for-the-badge&logo=prometheus&logoColor=B4F82C" alt="Telemetry" />
  <img src="https://img.shields.io/badge/UI-React%2019-07110C?style=for-the-badge&logo=react&logoColor=B4F82C" alt="React 19" />
</p>

</div>

---

## Overview

**ClickHead** is a focused HTTP traffic-testing and diagnostics tool for developers and operators who need to understand how an authorized website or service behaves under controlled request volume.

It supports configurable request counts, concurrency, pacing, jitter, multi-path journeys, latency percentiles, graceful cancellation, live SSE telemetry, a standalone request counter, and browser-based analytics verification through a cloud Chromium session.

> Use it only against systems you own or are explicitly authorized to test.

## Features

- **Controlled pacing** — base delay plus configurable jitter, including zero-delay tests when explicitly selected.
- **Concurrency limits** — bounded worker-pool execution.
- **Multi-page journeys** — distribute requests across configured paths with public-host validation.
- **Request telemetry** — status, latency, bytes, success/failure, RPS and P50/P90/P95/P99.
- **Safe redirects** — redirects are followed manually and every destination is revalidated before the next request.
- **Graceful shutdown** — stop active tests without leaving the server-side session registered.
- **Browser QA** — optional real Chromium verification of browser-side Jetpack, Google Analytics and other supported analytics requests.
- **Standalone test bench** — verify that requests reach a controlled endpoint without pretending to be human traffic.
- **Go client source** — the UI can generate Go client source for users who want to run the request engine independently.

## Quick Start

### Web dashboard

```bash
npm install
npm run dev
```

Open the local development URL shown by Vite.

### Production build

```bash
npm run build
npm run start
```

### Browser analytics verification

Browser verification requires a Browserbase connection in the deployed Vercel project. The Vercel Browserbase integration provides `BROWSERBASE_API_KEY` and `BROWSERBASE_PROJECT_ID` to the server runtime.

The browser mode is for **verification**, not view inflation: it opens the page in Chromium, executes its JavaScript, observes network requests, and reports what analytics actually fired. A browser test does not guarantee that an analytics provider will count the session as a human view.

## Load Profiles

ClickHead ships with conservative profiles for different testing goals:

| Profile | Purpose |
| --- | --- |
| **Quick Verify** | Fast confirmation that an authorized endpoint responds |
| **15-Min Spread** | Small sustained request stream |
| **1-Hour Flow** | Controlled steady pacing |
| **6-Hour Daytime** | Extended diagnostic window |
| **24-Hour Diurnal** | Long-running diagnostics with a daily pacing curve |

All profiles are configurable before execution.

## HTTP Test API

The deployed app exposes a streaming endpoint for the dashboard:

```text
GET /api/traffic/stream
```

Important query parameters include:

| Parameter | Default | Description |
| :--- | ---: | :--- |
| `targetUrl` | — | Authorized HTTP/HTTPS target |
| `totalRequests` | `20` | Number of requests, up to 2000 |
| `concurrency` | `3` | Parallel workers, up to 50 |
| `delayMs` | `1000` | Base delay between requests per worker |
| `jitterMs` | `500` | Maximum randomized delay added to pacing |
| `timeoutSeconds` | `10` | Per-request timeout, up to 120 seconds |
| `enableMultiPage` | `false` | Enable configured path selection |
| `subPaths` | `/` | Comma-separated relative or absolute public paths |

A value of `0` for `delayMs` or `jitterMs` is preserved as zero; it is not treated as a missing parameter.

## Test Bench

ClickHead includes a controlled local/deployed test bench for validating request counters and telemetry:

- `/test-page`
- `/api/test/visit`
- `/api/test/stats`
- `/api/test/batch-visit`

The test bench explicitly identifies its traffic as synthetic test traffic. It is not an analytics-view simulator and does not attempt to disguise automated requests as human activity.

## Architecture

```text
[ React Dashboard ]
        │
        ├── HTTP traffic configuration
        ├── Live SSE telemetry
        └── Browser QA / analytics verification
                 │
                 ▼
          [ Express API ]
                 │
        ┌────────┴────────┐
        ▼                 ▼
 [ HTTP Test Workers ]  [ Browserbase ]
        │                 │
        ▼                 ▼
 [ Target Service ]   [ Real Chromium ]
```

The production API runs as a Vercel function. Browser verification uses Browserbase for the cloud Chromium runtime, while ordinary HTTP tests use server-side `fetch` with bounded concurrency, timeouts and redirect validation.

## Project Structure

```text
ClickHead/
├── api/                 # Production Express/Vercel API
│   └── index.ts         # HTTP test bench + browser verification
├── src/                 # React dashboard
│   ├── components/      # UI, diagnostics and telemetry views
│   ├── data/             # presets and Go source generator
│   └── utils/             # scheduling and traffic helpers
├── public/              # static assets
├── server.ts            # local development server
├── vercel.json          # Vercel routing/function configuration
└── package.json
```

## Safety & Use

ClickHead is intended for legitimate performance testing, diagnostics, development, QA, and infrastructure validation. Always obtain authorization before generating load against a system you do not control.

The browser verification feature reports analytics requests observed in a real browser session. It does not spoof fingerprints, manufacture human identity, bypass anti-bot systems, or guarantee provider-side view counting.

---

<div align="center">

**ClickHead** · A `.dot` microtool

</div>
