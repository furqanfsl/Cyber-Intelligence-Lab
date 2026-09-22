# Session Memory

- 2026-09-22: Created a new standalone project at `D:\CyberIntelligenceLab` for a CV-worthy cybersecurity portfolio concept named **Cyber Intelligence Lab**. The previous Finance Tracker in `D:\First_Project` was left safe and untouched.
- Stack: Vite + React 19 + TypeScript + CSS, with `@playwright/test` as a dev dependency for browser QA.
- Design direction: dark tactical telemetry / SOC console / declassified intelligence report, sharp 90-degree grid, near-black substrate, phosphor white typography, aviation red threat accent, minimal green success cues, subtle CRT scanlines and map arcs.
- Image-first workflow: generated four design references for hero, threat operations, incident response, and case studies; copied them into `public/design-reference-*.png` for project continuity.
- Implemented sections: sticky nav, cinematic hero, live threat map, packet stream, system log, top threat actors, severity-filtered incident queue, selected alert details, related IOCs, containment checklist, incident response timeline, AI triage report, forensic artifact viewer, case-study table, skills matrix, and footer.
- Interactions: live attack counter ticks upward, severity filter updates the incident queue and selected alert, alert rows are selectable, Copy Brief writes a defensive summary to the clipboard and gives visual feedback, nav anchors scroll to sections.
- QA passed: `npm run build`, `npm run lint`, Playwright/Edge desktop and mobile screenshots/checks. No console errors, failed requests, horizontal overflow, clipped hero headline, or Vite starter copy. Screenshots saved under `%TEMP%\cyber_intelligence_lab_qa\`.
