# GitHub Pages Implementation Plan

> Execute inline with one final review. The user explicitly requested commit, push and GitHub Pages publication.

**Goal:** Publish the Cesium interface on GitHub Pages with correct project-relative assets and a safe connection to an independently hosted live backend when available.

**Architecture:** Keep local behavior unchanged. A Pages build bundles airport geometry and explicitly synthetic demo fixtures. Asset paths use Vite's base URL. A public backend URL may be configured separately; credentials never enter the browser. Without a backend, the Pages build clearly offers the demo and disables live mode. Repository creation/push are authorized; separate backend hosting choice is pending with the user.

**Tech Stack:** Existing Vite/React/Cesium and FastAPI, GitHub Actions/Pages. No new runtime dependencies.

**Spec:** User request and hosting clarification in this conversation.

## Constraints / review focus
- Preserve local live tracker and private provider configuration.
- No keys in current files, Git history, bundles, workflows or public artifacts.
- All Cesium assets/models and static data must load under `/sg-real-time-flights/`.
- Demo remains explicitly synthetic; no silent substitution for live outages.
- Public live requests require a separate configured HTTPS backend, never browser-held provider keys.

## Tasks
- [x] Verify and commit existing provider integrations (89 backend, 28 frontend tests).
- [x] Write failing URL/hosting-mode tests, implement base-aware assets and optional backend URL.
- [x] Export static geometry/demo, add Pages workflow and verify the Pages build in a browser.
- [ ] Review, scan secrets, commit and push to the user's GitHub repository.
- [ ] Deploy Pages, verify its public URL and report live/demo hosting state accurately.

## Hosting decision
Asked whether to include a separate free live backend or publish demo first. Pages preparation and repository work proceed independently while awaiting the answer.

- Final review identified an unnecessary configure-pages step without read permission; removed it because no outputs are consumed. Corrected outdated local-only deployment wording in README. Repository created publicly under Perryong; private source/history/artifact scans passed.

- Verification before publication: 89 backend, 32 frontend, 13 live-app browser and one Pages browser checks passed (135 total). Both production builds passed; existing Cesium bundle-size advisory remains. No runtime provider credentials are configured in GitHub or Pages.
