# Appendix C — Design Review Reference

Use this reference for Audit mode or the critique pass after implementation.

## Evidence classes

A finding may be based on:

- **Rendered evidence**: visible in an inspected screenshot or browser state
- **Runtime evidence**: console, network, DOM, computed style, focus behavior
- **Source evidence**: code, tokens, markup, component logic
- **Inference**: likely issue not yet reproduced

Label inference honestly.

## Severity

### Critical

Prevents task completion, hides essential content, breaks navigation, creates severe accessibility failure, or causes destructive behavior.

### High

Major hierarchy, responsive, interaction, readability, or state problem that materially damages use.

### Medium

Noticeable inconsistency, density, alignment, copy, or component problem that reduces quality but does not block the task.

### Low

Polish issue with limited impact.

## Review order

### 1. Product purpose

- Is the primary job obvious?
- Is the primary action visible at the correct moment?
- Does the page prioritize real user decisions?

### 2. Information hierarchy

- Is there one clear first focal point?
- Are heading levels and text roles distinct?
- Is supporting content visually subordinate?
- Is proof placed near the claim it supports?

### 3. Layout and rhythm

- Are alignment rules consistent?
- Does spacing reflect semantic relationships?
- Are sections paced intentionally?
- Are content widths readable?
- Are open areas and dense areas balanced?

### 4. Typography

- Is body text readable?
- Are line lengths controlled?
- Do headings wrap intentionally?
- Are labels distinguishable from content?
- Is muted text still legible?

### 5. Color and contrast

- Are accents role-based?
- Are action, status, and decoration distinguishable?
- Are text and controls sufficiently contrasted?
- Does dark mode, if present, preserve hierarchy rather than invert colors mechanically?

### 6. Components and states

- Do repeated components follow shared rules?
- Are loading, empty, error, success, selected, disabled, hover, and focus states present where needed?
- Are destructive actions differentiated?
- Do forms expose validation clearly?

### 7. Interaction

- Are click targets obvious?
- Is feedback immediate?
- Do overlays remain within the viewport?
- Can keyboard users reach and operate controls?
- Is motion purposeful and interruptible?

### 8. Responsive behavior

- Does the hierarchy survive each breakpoint?
- Do controls transform rather than merely shrink?
- Are tables, charts, and dense regions handled intentionally?
- Is there horizontal scrolling?
- Do sticky elements collide?

### 9. Specificity and restraint

- Does the design belong to this product?
- Are generic AI patterns present?
- Does every prominent effect earn its place?
- Can anything be removed?

## Finding format

```text
[Severity] Short finding title
Evidence:
Location:
Why it matters:
Recommended correction:
Verification:
```

For source findings, include `file:line` when available.

For rendered findings, include route, state, viewport, and screenshot identifier.

## Audit handoff

Summarize:

- overall design read
- strongest successful decisions
- critical/high findings first
- repeated systemic issues
- quick wins
- deeper redesign opportunities
- verification gaps

---
