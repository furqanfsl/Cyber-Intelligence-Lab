# Cyber Intelligence Lab

A cinematic cybersecurity operations portfolio project built with React, TypeScript, and Vite.

## What it shows

- Live-style global threat operations console
- Real public cyber OSINT feed from CISA KEV and Hacker News Algolia
- Responsible automatic refresh through a local `/api/live-intel` proxy
- Severity filtering and selectable incident queue
- Incident response timeline with AI triage report
- Forensic artifact viewer and containment checklist
- Cybersecurity case studies for CV/portfolio storytelling
- Responsive tactical telemetry visual system

All threat data is simulated and defensive. The project does not run real scans, target real systems, or include exploit code.
The live OSINT section reads public internet sources only. It does not monitor private traffic or "everything" on the internet.

## Run locally

```powershell
npm install
npm run dev
```

Then open the local URL printed by Vite.

## Build

```powershell
npm run build
```

## Live intelligence automation

When the Vite dev or preview server is running, `/api/live-intel` fetches:

- CISA Known Exploited Vulnerabilities catalog
- Hacker News Algolia cybersecurity/ransomware/vulnerability story search

The server caches source responses for 60 seconds so the UI can stay current without hammering public services.

## Design direction

The interface uses a dark tactical telemetry aesthetic inspired by SOC consoles, declassified intelligence reports, Swiss industrial grids, and high-contrast cybersecurity visualization.

Generated visual references are stored in `public/design-reference-*.png` so the art direction stays attached to the project.
