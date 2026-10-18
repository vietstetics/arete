# Exercise-selection overlap & coverage

A planning aid. It shows whether the exercises chosen for a session train the
same target in the same way, or cover it differently, and whether they cover
what the user intends to train. It does not judge any exercise or workout.
"Repeated coverage" means that selections cover the same thing. It does not
mean sets are wasted or that growth is reduced.

## Files

| File | Role |
|---|---|
| `data/catalogue.js` | `EXERCISES` (non-machine records) and `EQUIVALENCES`. Both still **empty**. |
| `index.js` | Builds the live catalogue: one record per machine mode from `features/machines`, plus `EXERCISES`. |
| `services/catalogue.js` | Action catalogue, per-target comparison spec, record validation, lookup. |
| `services/overlap.js` | Comparison, grouping and scoring within one session. |
| `services/coverage.js` | Session coverage against intended targets; weekly planned coverage. |
| `ui/overlapPanel.js` | HTML for the plan wizard (pure string builders). |
| `__tests__/` | Tests. `fixtures.js` is **synthetic** (`syn-` ids) and is never loaded by the app. |

The foundation is `features/muscles`, which is generated from
`Muscle_Actions_Updated_Profiles.csv`. This module reads it and never
modifies it.

**Records come from the machine database** (`features/machines`). That gives
1,039 records: one per machine mode, plus one "unrecorded" record for each
station, and for each use a machine's recorded action doesn't cover. Each
record's contributions are its **confirmed targets** only. Regions the
machine's action can't confirm travel as `candidates` and are never scored.
See `features/machines/README.md`.

## Data structure

```js
{
  id: 'ex-…',                     // stable; matching never uses names
  name: 'Display name',
  equipment: { id, name, category },   // category: machine | cable | free-weight | bodyweight | other
  variant: { id, name } | null,        // a meaningful setup variation
  notes: '…',                          // descriptive only, not compared
  contributions: [{
    target:  '<muscle-action entry id>',   // e.g. 'gluteus-maximus-lower'
    action:  '<action id>',                // e.g. 'hip-extension'
    profile: 'ASCENDING' | 'DESCENDING' | 'MID-RANGE' | 'BELL-SHAPED' | 'CONSTANT' | 'N/A' | 'Not specified',
    profileDetail: 'raw wording' | null,  // shown when the profile can't be compared
    rom:     { joint, start, end } | null, // degrees
    setup:   { attribute: value, … },      // only attributes that discriminate; null = not recorded
  }],
  candidates: [{ target, atom, label, kind, reason }],  // machine records: regions not confirmed
  unrecorded: true | undefined,                          // machine records with no usable action
}
```

- **Targets** are the 34 entry ids from the muscle specification.
- **Actions** use stable ids taken from the specification's own wording. For example, "Hip extension" is one action across three regions, and "Hip extension with hip rotated inwards" is a separate action.
- **Profile** describes *this exercise*. It is not the muscle-level spec. `IRRELEVANT` is a statement the spec makes about a muscle, so a record can't carry it.
- Several contributions per exercise are allowed, including several actions for one target.
- **Equivalences** take the form `{ a, b, target|null, relation: 'same'|'different', note, reviewed: true }`. Only `reviewed: true` entries are used. They override the automatic comparison for that pair. Nothing is merged automatically.
- Invalid records are excluded and reported in `catalogue.issues`. They are never repaired.

Planner rows in a routine carry an optional `machine` snapshot and its
`catalogId` (`machineId` or `machineId#mode`). Routines carry optional
`targets` (intended entry ids). All are optional fields. Saved plans, history
and logged sessions written before them still work.

Machine contributions record the machine's own movement as
`setup.movement`, plus any detail your muscle list uses to separate regions
of that movement (`hip position`, `knee position`, `foot rotation`, `shoulder
position`, `grip`, `hip rotation`). Those details are set to `null` because
the machine rows never state them.

## Grouping rules

For one session, each target is analysed separately.

1. **Selections.** Each planner row is one selection. Set counts are dropped before analysis.
2. **Contribution to a target.** All of a selection's contributions with that target are collected. Exact duplicates are removed, so duplicate tags count once.
3. **Assessable?** A contribution is *not assessable* when:
   - its action is missing, or
   - the spec treats the profile as relevant and the record says `Not specified`, or
   - the record says `N/A` where the spec treats the profile as relevant. This needs review.

   Unassessable selections are listed under "Insufficient information" and left out of N.
4. **Comparing two parts** (same target):
   - Different action → **different**.
   - Profile, when the spec treats it as relevant: different → **different**.
   - Angle range at the same joint:
     - identical → no objection
     - ranges don't overlap → **different**
     - ranges partly overlap → **possible**
     - recorded for different joints, or for only one → **possible**
     - recorded for neither, while the spec gives an angle range for this target → **possible**
   - Setup attribute present in both with different values → **different**. Present in only one, or `null` (not recorded) in both → **possible**.
   - Equipment and variant names are never compared. Different names neither prove nor rule out overlap.
   - The **same record** selected twice is **same**, whatever is unrecorded. It is the same machine, used the same way.
5. **Comparing two selections:**
   - **Same** only if every part of each has a confirmed same partner in the other.
   - If anything is shared or uncertain without a full match → **possible / partial**. This is never counted.
   - Otherwise → **different**.
6. **Groups.** A selection joins a group only if it is confirmed the same as *every* member. Possible links never merge groups.
7. **Score.** N = assessable selections, U = groups.
   - Overlap % = (N − U) / N × 100
   - Repeated selections = N − U
   - N = 0 shows **Insufficient information**, never 0%.
   - N = 1 gives 0%, with a note that this says nothing about completeness.
8. **Compound exercises** get one verdict per target (`bySelection`). An exercise is never labelled as a whole.
9. **Unresolved regions.** A record's `candidates` are grouped by action ("Elbow flexion → Elbow flexors") and shown as **region not recorded**. With two or more selections, it reads **possible overlap**. They never enter N or U.
10. **Not assessed at all.** These are listed with their reason and left out:
    - selections with no machine;
    - stations (no recorded action);
    - uses a machine's action doesn't cover.

    Targets where nothing could be assessed share one "Insufficient information" card.

### Special profile values

| Spec value | Effect |
|---|---|
| `ASCENDING` / `DESCENDING` / `MID-RANGE` | The record's profile must be known and must match. |
| `IRRELEVANT` (incl. `IRRELEVANT; ASCENDING preferred`) | The profile is not compared or required. The rest is compared. |
| `N/A` | Same as above: not applicable, so not compared. |
| `Not specified` | Unknown, so the profile is still treated as relevant (conservative). |
| `… preferred` | Display only. Never scored or penalised. |

## Coverage

Coverage is separate from overlap.

- A **planned target** is a specification entry: a region together with its action.
  - It is **covered** when a linked selection contributes that target with that action. Any profile counts.
  - It is **cannot be determined** when it isn't covered and:
    - a selection lists it as a region not recorded, or
    - some selection has no machine or no recorded action, or
    - a contribution for it lacks its action.
  - Otherwise it is **missing**.
- With no intended targets, the panel shows **observed** coverage only. It makes no complete or incomplete claim.
- **Weekly planned coverage** is the union of the sessions' targets. It shows which sessions cover each target and how many times a week, based on the plan's first full week. Repeating an exercise on another day is frequency, not overlap. There is no global quality score and no weighting.

## Open questions

These rules affect results. Each is handled conservatively and flagged here
rather than settled:

1. **Angle tolerance.** Ranges count as the same only when they are identical. Any partial overlap is "possible". No numeric tolerance was given.
2. **Joint and angle conventions.** Ranges are compared only when recorded for the same `joint` id. The squat pattern's 30–70° range has no stated reference joint in the source, so records for it must state one.
3. **Which setup attributes are meaningful.** Every attribute in `contribution.setup` is treated as meaningful. Descriptive details belong in `notes`. The data supplier decides which is which.
4. **Spec `Not specified`** (rectus femoris, upper region) is treated as profile-relevant. If profile should not discriminate there, the spec needs a value.
5. **A record profile of `N/A` on a profile-relevant target** is treated as a contradiction and not assessed.
6. **Reviewed equivalences only apply between assessable selections.** A review doesn't fill in missing data.
7. **Coverage is matched by region + action, using the specification's action for that region.** A contribution to a region with a different action does not cover the planned entry.
8. **`features/muscles/repositories/exerciseLinks.js`** (muscle → exercise id links) predates this module and is still unused. Machine records are now the source of target data. Decide whether to remove that store or derive it from the machines.
9. **Unrecorded details as `null`.** When your muscle list separates a movement's regions by a detail the machine rows don't state, two different machines sharing that movement are only a *possible* overlap. Recording seated/lying/standing etc. per machine would let them be confirmed.
