# Championship League Snooker — irregularities register

Everything that did not check out cleanly while implementing the
[CHAMPIONSHIP LEAGUE SNOOKER PREDICTION MASTER PROMPT v1.0](CLS_SNOOKER_MASTER_PROMPT.md).
Each entry states what was found, what it does to output, and how to verify it
by hand. Nothing here is worked around silently.

The generic snooker register is separate:
[`SNOOKER_IRREGULARITIES.md`](SNOOKER_IRREGULARITIES.md). Entries there
(notably IR-SNOOKER-01, no price feed) still apply to this competition.

---

## IR-CLS-01 — No free, key-less price feed for this competition (high, open)

**Finding.** The Odds and Value category is worth fifteen of the hundred points
in MATCH RESULT. No free key-less source publishes Championship League prices.
OLBG's server-rendered HTML for the snooker index carries tipster vote shares
and tip counts but **no prices**; WST and snooker.org publish no odds;
`api.snooker.org` returns HTTP 401.5 and requires authorisation; the ESPN
public API has no snooker coverage at all.

**Effect on output.** The odds component is recorded as **missing** and scores
zero on every card, live and historical. Because fifteen points are
permanently unavailable, a large share of match-result reads never reach the
fifty-point MEDIUM floor and correctly resolve to SKIP. In the walk-forward
backtest only 4 of 253 match-result rows were graded — the rest were skipped.
That is the honest consequence of a missing input, not a bug, and it is
reported on the page rather than hidden by lowering the threshold.

No value flag is ever raised on price, because there is no price. A value
candidate is only flagged when the model rates a side clearly above the field
on sourced evidence alone.

**Verify:** <https://www.olbg.com/betting-tips/Snooker/8> (view source — no
price attributes) · <https://api.snooker.org/?t=5&s=2026> (401.5)

---

## IR-CLS-02 — Only the highest break per group is published (medium, open)

**Finding.** Break-building is worth fifteen points in MATCH RESULT and fifteen
in GROUP WINNER, and highest break is a published tiebreak that actually
decided group placings in 2026 (Groups 4, 10, 14, 19, 23, 25, 29, 31 and GG).
But the public record gives **one highest break per player per group**, not a
break per match. Per-frame and per-match break data is not published anywhere
key-less.

**Effect on output.** Break-building is scored from the published per-group
highest break only. Every table row carries `hb_source: "published_table"` so
the provenance is explicit, and the value is never derived from a scoreline —
a 3-0 tells you nothing about how the frames were won. Where no highest break
is published the component is recorded missing and scores zero. A player's
break ceiling is therefore a coarse measure here, and the docs say so rather
than implying frame-level knowledge the model does not have.

**Verify:** the published group tables at
<https://en.wikipedia.org/w/index.php?title=2026_Championship_League_(ranking)&oldid=1364748219>
— the HB column is per group, not per match.

---

## IR-CLS-03 — An expunged result: Kyren Wilson v Haydon Pinhey (high, resolved)

**Finding.** The first build of `data/snooker_cls.json` **failed**, with nine
field mismatches, all inside Stage One Group 3. The cause: Kyren Wilson played
and won one match, 3-0 against Haydon Pinhey on 22 June 2026, then withdrew
from the tournament after a burglary at his home. His result was **struck from
the published standings**, and Dylan Emery went through. The played result and
the published table genuinely disagree — the recomputation was right and the
tape was incomplete.

This is exactly the class of error the verification step exists to catch. Had
the tables not been recomputed from the scorelines, the discrepancy would have
passed unnoticed and Group 3 would have been scored from a match the
competition had erased.

**Effect on output.** The match is retained in the tape with `expunged: true`
so the historical record is not falsified, and it is excluded from every table
computation, form profile, head-to-head and group projection. After this
change all 42 groups reproduce exactly: 253 matches, 168 rows, zero problems.

**Verify:** run `node scripts/build_cls_snooker.mjs --check`; the Group 3 note
at the source revision above.

---

## IR-CLS-04 — Two different events share one name (medium, mitigated)

**Finding.** "Championship League Snooker" refers to two tournaments with
different formats in the same season — a January–February invitational and a
June–July ranking event. Several secondary sources describe one format while
naming the other, and Wikipedia has no article at the bare title
`Championship League (snooker)`; only the year-and-edition titles exist.

**Effect on output.** The edition is a hard gate: `editionFor()` throws unless
the caller states `ranking` or `invitational`, and the correct-score outcome
set and draw modifier switch with it. The page makes the choice explicit and
states that the committed tape is the ranking edition, so scoring it under
invitational rules tests the ruleset rather than the results.

**Verify:** <https://en.wikipedia.org/wiki/2026_Championship_League_(ranking)>
· <https://en.wikipedia.org/wiki/2026_Championship_League_(invitational)>

---

## IR-CLS-05 — Group winners genuinely undecidable on sourced data (medium, open)

**Finding.** In a four-player group where every match is the best of four, the
table is routinely settled on frame difference or highest break between
players the public record cannot separate. When the fifteen-point clearance
rule is applied honestly, most groups are *too open to call*: only 2 of 42
produced a named selection in the backtest.

An earlier version produced 8 named group winners, but that number was an
artefact — players who were level on every sourced measure were being split by
JavaScript's array sort order, which is not evidence. Assigning tied players a
shared rank removed the phantom separation and the count fell to 2.

**Effect on output.** Groups inside the clearance margin print "too open to
call" with no selection. Two named picks with a defensible basis is the
correct output; eight picks resting on sort order was not.

**Verify:** `node --test tests/snooker_cls_engine.test.mjs` — see *players
level on every sourced measure share a strength tier*.

---

## IR-CLS-06 — Amateur entrants and mid-event replacements (low, handled)

**Finding.** The 2026 ranking event included amateurs marked `(a)` and several
replacements: Jeff Cundy for Mark Williams (G2), Luke Pinches for Sam Craigie
(G5), George Pragnell for Tom Ford (G26), Dylan Smith for Anthony McGill
(G28); Mark Joyce and Dean Young entered Stage 2 as amateurs. Amateurs have no
seed number.

**Effect on output.** The twenty-point ranking-and-seeding component is
recorded missing and scores zero when either player has no published seed —
which, per IR-CLS-08, is currently every player. No
"giant-killing" or "shock" narrative is ever generated — the absence of a
ranking is reported as an absence, not spun into a story.

**Verify:** the entrant lists at the source revision above.

---

## IR-CLS-07 — Walkovers carry no playing information (low, handled)

**Finding.** Several fixtures are recorded as walkovers following a withdrawal.
A walkover awards points but contains no frames, no breaks and no evidence
about form.

**Effect on output.** Walkovers are flagged `walkover: true`, counted for
points so the recomputed table matches the published one, and excluded from
form profiles, scoreline-tendency reads and break-building. A walkover can
never make a player look in form.

**Verify:** `grep WALKOVER data/raw/cls2026_matches.txt`

---

## IR-CLS-08 — No seed numbers transcribed, so the ranking gap never scores (high, open)

**Finding.** The published group tables carry position, played, won, drawn,
lost, frames for and against, highest break and points — but **no seed or
ranking number**. The source describes the seeding rule in prose (the top
thirty-two players are distributed one per group by ranking number) without
printing each player's number in a machine-readable column, and amateurs have
no ranking number at all. No seed values were transcribed, so
`data/snooker_cls.json` currently contains none.

**Effect on output.** `seedFor()` returns nothing for every player, so the
twenty-point Ranking and Seeding Gap component is recorded **missing** on every
match card, and the seeding half of the thirty-five-point group-strength
measure contributes nothing. Combined with IR-CLS-01, thirty-five of the
hundred MATCH RESULT points are structurally unavailable, which is the main
reason match result skips so heavily.

This is a gap in the data layer, not a modelling choice, and it is fixable:
transcribing the official ranking snapshot for the tournament date and joining
it by player name would restore both components. Until that is done the
component reports missing rather than substituting a proxy, because inferring
a seed from group position would be circular — position is the thing being
predicted.

**Verify:** `node -e "const d=require('./data/snooker_cls.json');
console.log(d.tables.filter(r => r.seed).length)"` → `0`.
