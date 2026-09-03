# GAA PREDICTION MASTER PROMPT v1.1 — implementation notes

Implemented in `engine/gaa_engine.js`, `engine/gaa_data.js`, `engine/gaa_writer.js`, `engine/gaa_card.js`.

Scoring: Odds 30 (missing → 10 + flag), Form 25 (+5 competition, ±3 margin, <3 results cap 10), H2H 20 (missing 5), Standing 15, Stage+venue 10 (+3 home, +2 provincial home).

Step 3 Full / Small / Skip. Two gaps cap Full at Small. Draws flagged when form and H2H sit even.

Writer: 40–70 words, unique openers, no digits / links / venues / player names. Summary table + responsible gambling.

Hurling: Limerick / Kilkenny pedigree lean when those county names are the sides.
