# Baseline — 19 November 2026

The project contained only the goal, approved design/plan and chat attachments. No v0.1 source or build existed. New feature branch initialized in place.

Observed runtimes: Node 26.13.0, npm 11.20.0, Python 3.13.14, macOS arm64. Vite's official guide requires Node 20.19+/22.12+; installation accepted current runtime. Exact resolved packages are in the npm and Python lockfiles. No cloud token or service purchase required.

Tests were run against stub implementations before logic: 9 normalization failures and 6 freshness-boundary failures. Null/invalid input cases already rejected by the stub are subsequently checked with valid-neighbor cases.
