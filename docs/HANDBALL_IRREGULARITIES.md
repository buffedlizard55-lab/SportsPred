# Handball Irregularity Register

This document records edge cases, data limitations, and architectural safeguards in the Handball model.

---

### HB-IR-01: OLBG Server-Rendered HTML Odds Format
- **Observation:** OLBG displays tip counts, percentages, and market labels in server HTML, but does not include structured odds fields without JavaScript interaction.
- **Handling:** Market lines and tip consensus are extracted directly from OLBG event pages. Moneyline prices are cross-referenced with public consensus and validated against bookmaker odds bands. Missing prices are marked as missing and penalized in confidence scoring.

### HB-IR-02: Early-Season Goal Averages for Promoted Teams
- **Observation:** In the opening weeks of domestic seasons (e.g., September), newly promoted teams have smaller single-tier samples.
- **Handling:** The engine incorporates full 12-month form records, goal differentials, and historical head-to-head records with higher recency weighting rather than raw 1-game averages.

### HB-IR-03: Two-Legged European Knockout Context
- **Observation:** In EHF European knockout ties, aggregate lead management alters late-game pace and risk tolerance.
- **Handling:** When competition stage is marked as `knockout` or `two_legged`, aggregate margin context is factored into spread and total confidence scoring.
