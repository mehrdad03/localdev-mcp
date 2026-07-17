# Appendix D — Rendered Visual QA Reference

Visual QA evaluates what users actually see. A successful build, valid DOM, or unopened screenshot is not proof of visual correctness.

## Default scope

Audit the smallest complete matrix that proves the requested change:

- affected routes
- affected user states
- affected breakpoints
- overlays or interactive states changed by the work
- lower-page regions, not only the first viewport

Expand scope when a shared component or global token changed.

## Evidence levels

- **A — Directly verified**: exact route, state, viewport, and latest implementation were inspected
- **B — Closely verified**: same component and state were inspected in a representative context
- **C — Source-supported**: code suggests correctness, but rendered state was not inspected
- **D — Unverified/blocked**: evidence is unavailable

Only Level A supports the word “Verified” for a specific route/state/viewport.

## Required workflow

### 1. Establish the target

Record:

```text
Route:
State:
Viewport:
Expected primary content:
Expected primary action:
Known reference, if any:
```

### 2. Prove the state

Before judging visuals, confirm the correct route and state are rendered.

Check:

- route/path
- active navigation
- page heading
- expected data or fixture
- modal/dropdown/tab state
- authentication/permission state
- loading or error state when applicable

### 3. Capture and inspect

Do not merely produce screenshots. Open and inspect them.

Review in three passes:

#### Macro pass

- page composition
- hierarchy
- section order
- density
- focal point
- balance
- vertical rhythm

#### Local pass

- type rendering
- spacing
- borders
- icon alignment
- controls
- wrapping
- image crop
- overlays
- state styling

#### Responsive pass

Compare breakpoints for intentional transformation:

- order changes
- navigation changes
- density changes
- control behavior
- table/chart strategy
- sticky behavior
- overflow
- touch targets

### 4. Inspect beyond the first viewport

Scroll through:

- middle sections
- lower sections
- footer
- long data states
- long text
- empty or error states
- sticky transitions

### 5. Runtime checks

When tools allow, inspect:

- console errors
- failed network requests
- missing assets
- layout shifts
- horizontal overflow
- focus order
- computed styles for ambiguous defects

### 6. Fix and repeat exactly

After a fix, re-run the same:

- route
- state
- viewport
- content/data condition

Old evidence does not verify new code.

## Default viewport matrix

Use project-specific breakpoints when available. Otherwise:

| Target | Width |
|---|---:|
| Desktop | 1440 |
| Compact desktop/tablet landscape | 1024 |
| Tablet | 768 |
| Mobile | 390 |

Height should be sufficient to inspect the initial composition, followed by full-page or scrolled captures.

## Completion gate

Do not mark visual QA complete unless:

- the exact target is identified
- screenshots were personally inspected
- required breakpoints were reviewed
- lower-page content was reviewed
- critical states were reviewed
- obvious console/runtime errors were checked
- fixes were re-verified after the latest change

Report one status:

### Verified

All required evidence inspected after the latest code change.

### Partial

Some routes, states, or breakpoints were not inspected. List them.

### Blocked

Rendering, authentication, data, or tooling prevented meaningful inspection. State the blocker and what was still verified.

---
