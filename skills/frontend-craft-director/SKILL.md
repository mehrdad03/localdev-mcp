---
name: frontend-craft-director
description: A self-contained frontend design, redesign, audit, implementation, anti-AI-slop, and rendered visual-QA skill for use directly inside a ChatGPT conversation or through a local MCP-accessible project.
---

# Frontend Craft Director — Chat All-in-One

This is the self-contained edition. All required rules and references are included in this single file.

## Mandatory usage rule

Before any frontend design, redesign, implementation, audit, responsive fix, UI polish, or visual-QA task:

1. Read this entire file.
2. Inspect the real project before changing files.
3. Preserve the existing architecture, routes, APIs, forms, permissions, analytics hooks, SEO-critical content, and working behavior unless the user explicitly asks to change them.
4. Select a concrete design direction before writing UI code.
5. Reject generic AI-looking patterns.
6. Validate the rendered result at relevant viewports before claiming completion.
7. Do not install packages or replace the stack without explicit approval.

---


# Frontend Craft Director

Create interfaces that feel intentionally designed for their product, audience, and content—not assembled from common AI defaults.

This skill governs four modes:

- **Build**: create a new page or interface.
- **Redesign**: improve an existing interface without breaking product behavior.
- **Audit**: inspect an implementation and report prioritized visual/UX defects.
- **Study**: analyze a reference image, page, or design system and extract reusable principles without cloning it.

## Non-negotiable contract

1. Inspect before editing.
2. Preserve working architecture and product behavior.
3. Choose a clear design direction before writing UI code.
4. Use real product content and real interface states when available.
5. Prefer structural differentiation over decorative novelty.
6. Validate the rendered result, not only the source code.
7. Never claim visual success without evidence.
8. Do not install packages, replace the stack, rewrite routes, or change APIs unless the user explicitly approves it.
9. Do not invent metrics, testimonials, customers, notifications, pricing, or product capabilities.
10. Do not copy a reference page literally; extract its design logic and adapt it.

## Included supporting references

The detailed design-direction, anti-AI, audit, visual-QA, and project design-contract rules are embedded later in this same file.

---

# Phase 1 — Inspect the real project

Before proposing or changing UI, inspect the smallest relevant set of files:

- package manifest and frontend framework configuration
- app shell, layout, routing, and entry points
- global CSS, theme variables, Tailwind/config tokens, or component-library theme
- the target page and nearby pages
- reusable components already used by the project
- fonts, icons, image assets, logos, and brand files
- API/data contracts used by the page
- existing loading, empty, error, success, disabled, and permission states
- available lint, type-check, test, build, and browser commands

Determine and record:

- framework and rendering model
- styling approach
- component system
- current visual language
- breakpoint strategy
- accessibility conventions
- constraints that must not change

Do not assume React, Vue, Nuxt, Next, Tailwind, shadcn, Bootstrap, or any other stack. Detect it.

If the repository already has a design system, treat it as the default authority. Do not introduce a second design system casually.

---

# Phase 2 — Produce a Design Read

Before implementation, summarize the design problem in one compact block:

```text
Page type:
Primary audience:
Primary job:
Primary action:
Content priority:
Existing visual language:
Required states:
Primary constraint:
Desired emotional quality:
```

Infer missing details from the repository and the user’s request. Ask only when a missing fact materially blocks a correct implementation.

Then write one sentence:

```text
Design read: This interface should feel [qualities] because [product/user reason], while avoiding [specific failure mode].
```

Avoid empty adjectives such as “modern,” “clean,” or “premium” unless translated into concrete decisions.

---

# Phase 3 — Select the design strategy

Choose exactly one strategy:

## A. Extend the existing system

Use when the project already has stable tokens, components, patterns, or approved screens.

Rules:

- reuse the established spacing, type, color, radius, depth, and interaction language
- introduce new primitives only when the existing system cannot express the requirement
- keep the new page recognizable as part of the same product

## B. Map to an established system

Use when the product clearly belongs to a familiar application class and an established system improves usability.

Examples include productivity software, enterprise admin tools, mobile platform patterns, or content-heavy products.

Rules:

- adapt principles, not branded replicas
- preserve product identity
- do not mix several unrelated systems

## C. Create a custom direction

Use when the product needs a distinctive public-facing experience or has no coherent design system.

Define:

- **Structure variance**: 1–10
- **Motion intensity**: 1–10
- **Information density**: 1–10
- one named macrostructure
- one signature visual move
- one explicit anti-goal

Example:

```text
Structure variance: 7
Motion intensity: 3
Information density: 5
Macrostructure: editorial split narrative
Signature move: conversation trail becoming workflow stages
Anti-goal: generic hero followed by three equal feature cards
```

Do not start coding until these choices are internally consistent.

---

# Phase 4 — Establish the design contract

Use an existing project design document when present. Otherwise create or update `DESIGN.md` from `templates/DESIGN.md` only when the task is substantial enough to justify it.

The contract must define concrete decisions:

- color roles, not merely color values
- typography roles and hierarchy
- content width and grid behavior
- section rhythm and density
- border-radius rules
- border and shadow logic
- icon source and icon treatment
- image treatment
- responsive transformations
- motion principles
- component reuse rules
- explicit do/don’t rules

Every visual decision must support at least one of:

- hierarchy
- comprehension
- navigation
- interaction
- feedback
- trust
- brand recognition

Remove decoration that serves none of these.

---

# Phase 5 — Plan the whole-page structure

Choose the page’s macrostructure before styling individual cards.

For marketing and editorial pages, determine:

- opening composition
- narrative progression
- proof placement
- feature explanation pattern
- conversion path
- closing structure
- navigation and footer relationship

For application interfaces, determine:

- global navigation
- page-level navigation
- main workspace
- secondary context
- actions and status feedback
- empty and failure states
- density changes across breakpoints

Structural differentiation must come from information architecture and composition—not only colors, gradients, shadows, or border radius.

Do not repeatedly default to:

```text
centered hero
→ logo row
→ three equal cards
→ alternating feature rows
→ testimonials
→ final CTA
```

Use that sequence only when the content genuinely requires it.

Navigation and footer are part of the composition, not generic wrappers added at the end.

---

# Phase 6 — Implement safely

## Preserve

Unless explicitly asked otherwise, preserve:

- routes and route names
- API requests and response shapes
- form fields and validation behavior
- navigation items
- permissions
- analytics hooks
- legal text
- brand name and logo
- SEO-critical content
- working component behavior

## Build with the existing stack

- follow local naming, folder, and component conventions
- reuse existing primitives before creating replacements
- keep components focused and composable
- avoid premature abstraction
- avoid one-off magic values when a project token exists
- use semantic HTML
- retain keyboard operation and visible focus
- preserve reduced-motion support when motion is added
- avoid layout shifts and distorted media
- use the project’s existing icon library; do not substitute emoji

## Implement complete states

For interactive or data-driven UI, account for applicable states:

- initial/loading
- empty
- populated
- error
- success
- disabled
- active/selected
- hover
- focus-visible
- validation
- permission-restricted
- offline or retry, when relevant

Do not design only the ideal populated screenshot.

## Use real content

Prefer repository content, product copy, fixture data, or user-provided examples.

When placeholders are unavoidable:

- label them clearly
- keep them plausible
- do not fabricate business claims
- avoid repetitive generic copy
- preserve realistic text lengths

---

# Phase 7 — Anti-AI-slop gate

Before visual QA, inspect the interface against `references/anti-ai-patterns.md`.

At minimum, reject or revise the design when:

- the page could belong to almost any SaaS product after changing the logo
- most content is trapped inside interchangeable rounded cards
- typography depends entirely on a default sans-serif without deliberate hierarchy
- visual interest comes mainly from purple/blue gradients, glows, blobs, or glass
- every section is centered, symmetrical, and equally spaced
- three equal feature cards appear without a content-based reason
- the mobile version is only the desktop layout stacked vertically
- decorative UI competes with the primary task
- fake data is used to make the page look complete
- every component has the same radius, shadow, and density regardless of role
- the interface imitates a reference instead of adapting its principles
- the design direction cannot be described without vague adjectives

A successful design should have a recognizable structural fingerprint.

---

# Phase 8 — Source-level validation

Run only commands already supported by the repository, such as:

```bash
npm run lint
npm run type-check
npm run test
npm run build
```

Use the project’s actual package manager and scripts. Do not invent commands.

Check:

- no build or type errors
- no obvious console errors
- no broken imports
- no missing assets
- no new dependency without approval
- no unintended route or API changes
- no accessibility regression detectable from code
- no overflow-prone fixed widths
- no duplicate or dead styling introduced by the change

A successful build is necessary but not sufficient.

---

# Phase 9 — Rendered visual QA

Follow `references/visual-qa.md`.

Default viewport matrix, unless the project defines another:

- 1440 px desktop
- 1024 px compact desktop/tablet landscape
- 768 px tablet
- 390 px mobile

For each relevant route and state:

1. Open the exact route.
2. Confirm the intended state is actually rendered.
3. Capture evidence.
4. Inspect the image yourself.
5. Review the full page, including lower sections.
6. Review local details at useful zoom.
7. Compare breakpoints for deliberate transformation.
8. Fix visible defects.
9. Re-run the same route, state, and viewport.
10. Do not rely on an old screenshot after code changes.

Inspect for:

- hierarchy and focal point
- alignment and spacing
- line length and wrapping
- clipped or overflowing content
- density and whitespace rhythm
- component consistency
- action prominence
- responsive transformation
- sticky/fixed element collisions
- modal, dropdown, and tooltip boundaries
- image cropping and aspect ratio
- loading/empty/error state quality
- contrast and visible focus
- browser console errors
- horizontal scroll

Evidence status must be one of:

- **Verified**: the exact route/state/viewport was inspected after the latest change
- **Partial**: some required routes, states, or viewports were not verified
- **Blocked**: rendering or tooling prevented meaningful inspection

Never upgrade Partial or Blocked to Verified by inference.

---

# Phase 10 — Final critique

Before handoff, score the result from 1–5 on:

- product specificity
- information hierarchy
- structural distinctiveness
- restraint
- consistency
- responsive behavior
- state completeness
- accessibility
- rendered evidence

Any score below 4 requires either a fix or an explicit limitation in the report.

Ask internally:

- What is the first thing the user sees?
- Is that the correct thing?
- Could another product use this design unchanged?
- Which element is the signature of this page?
- What can be removed without losing meaning?
- Does mobile feel designed rather than collapsed?
- Does every prominent element earn its prominence?
- Did the final screenshot come after the final code change?

---

# Handoff format

Report:

```text
Mode:
Design read:
Strategy:
Macrostructure:
Signature move:
Changed files:
Preserved contracts:
Validation commands:
Visual QA status:
Verified routes/states/viewports:
Remaining limitations:
```

For audit mode, do not modify files unless the user asked for fixes. Report findings by severity:

- Critical
- High
- Medium
- Low

Include file and line references where possible, plus visual evidence for rendered defects.

Do not say “done,” “pixel-perfect,” “fully responsive,” or “production-ready” unless the evidence supports that claim.

---

# Appendix A — Anti-AI Pattern Reference

Use this reference as a rejection checklist, not as a recipe for adding more decoration.

## 1. Structural sameness

Common failure:

- centered headline and two buttons
- floating product mockup
- logo strip
- three equal cards
- alternating two-column features
- testimonial cards
- final gradient CTA

This sequence is not forbidden. It is forbidden as an unexamined default.

Correction:

- start from the product story and user decision path
- choose a named macrostructure
- vary grouping, pacing, scale, and information density
- make navigation, opening, proof, and closing part of one composition
- use asymmetric or editorial structure only when it improves hierarchy

## 2. Card inflation

Common failure:

Every sentence, number, icon, and feature receives its own rounded container.

Correction:

Use a card only when it represents a real unit with at least one of these properties:

- independent action
- distinct state
- repeated comparable object
- selectable option
- separable data record
- meaningful boundary

Prefer open composition, dividers, type hierarchy, alignment, and whitespace when content does not need a container.

## 3. Decorative AI defaults

Watch for:

- blue-purple gradients used without brand reason
- glowing orbs
- blurred blobs
- glass panels
- excessive pills and badges
- random sparkles
- gradient text
- decorative grids
- floating cards with no interaction
- device mockups used only to fill the hero
- oversized rounded rectangles everywhere

Correction:

Keep only effects that reinforce hierarchy, interaction, brand, or content meaning.

## 4. Typography without a point of view

Common failure:

A default sans-serif at several arbitrary weights, with centered headings and muted gray body text.

Correction:

- define display, heading, body, label, and data roles
- control line length and wrapping deliberately
- choose contrast through scale, weight, width, case, and spacing
- use a distinctive display treatment only when appropriate
- avoid excessive tiny uppercase labels
- do not use novelty type where reading speed matters

## 5. False completeness

Common failure:

Invented customers, statistics, alerts, charts, messages, and testimonials make the mockup look polished but misrepresent the product.

Correction:

- use real repository data
- use neutral placeholders with explicit labels
- leave optional proof sections out when proof is unavailable
- do not imply capabilities that do not exist

## 6. Uniformity disguised as consistency

Common failure:

Every element uses the same radius, shadow, spacing, icon size, and surface color.

Correction:

Consistency means shared rules, not identical treatment.

Different roles may require:

- different density
- different elevation
- different emphasis
- different radius
- different interaction affordance

Define a small system and apply it by role.

## 7. Mobile as collapsed desktop

Common failure:

All desktop columns become one vertical stack with no change in order, controls, density, or navigation.

Correction:

On smaller screens, deliberately decide:

- what comes first
- what becomes compact
- what becomes horizontally scrollable
- what becomes a disclosure
- what becomes sticky
- what disappears
- which actions remain persistent
- how tables or complex data transform

## 8. Motion as decoration

Common failure:

Every card floats, fades, scales, or follows the pointer.

Correction:

Motion should clarify:

- cause and effect
- navigation
- status change
- spatial relationship
- focus
- progress

Keep duration and distance modest. Respect reduced motion.

## 9. Reference cloning

Common failure:

The output reproduces the reference’s layout, copy rhythm, visual signature, and component shapes.

Correction:

Extract:

- hierarchy
- pacing
- density
- grid logic
- type contrast
- interaction principles

Then rebuild those principles for the project’s own content and identity.

## 10. Generic copy creates generic design

Common failure:

“Unlock your potential,” “Seamless experience,” “Powerful insights,” and similarly abstract text provide no information architecture.

Correction:

Use concrete product language:

- what happens
- for whom
- what changes
- what the next action is
- what evidence supports the claim

## Fast rejection questions

Reject or revise when two or more answers are “yes”:

1. Could the same page sell five unrelated SaaS products?
2. Is the main composition a collection of cards?
3. Does the page rely on purple/blue glow for personality?
4. Are three equal columns used because they were easy to generate?
5. Is every section centered?
6. Is most secondary text low-contrast gray?
7. Are there fake numbers or fake social proof?
8. Does mobile merely stack everything?
9. Is the design direction described only as modern/clean/premium?
10. Would removing the gradients erase most of the identity?

---

# Appendix B — Design Direction Reference

Use this reference during Build and Redesign modes.

## Design read

Identify:

- product category
- page kind
- audience and expertise level
- primary task
- decision the page must support
- trust requirements
- content volume
- brand maturity
- existing assets and constraints

Translate emotional goals into design behavior.

Examples:

| Vague request | Concrete interpretation |
|---|---|
| Premium | controlled density, disciplined type scale, restrained accents, high-quality imagery, few effects |
| Friendly | plain language, softer geometry, warm spacing, visible guidance, forgiving states |
| Technical | precise data hierarchy, compact controls, explicit status, monospaced details used selectively |
| Fast | short paths, immediate feedback, persistent primary action, reduced visual noise |
| Trustworthy | clear ownership, realistic proof, stable layout, readable contrast, transparent state |

## The three dials

### Structure variance

- 1–3: conventional, predictable, utility-first
- 4–6: selective asymmetry and varied section patterns
- 7–8: distinctive editorial or narrative composition
- 9–10: experimental; use only when usability and brand allow it

### Motion intensity

- 1–2: state feedback only
- 3–4: purposeful transitions and restrained reveals
- 5–6: motion supports storytelling
- 7–8: motion is a major part of the experience
- 9–10: experimental; avoid for ordinary product work

### Information density

- 1–3: spacious, focused, few decisions
- 4–6: balanced product or marketing density
- 7–8: operational dashboard or expert workspace
- 9–10: highly compressed professional tool

Do not maximize all three.

## Macrostructure library

Choose one named shape and adapt it.

### Editorial split narrative

Strong opening statement paired with a changing visual narrative. Suitable for differentiated product stories.

### Product walkthrough spine

A continuous vertical or horizontal flow showing one product journey from input to outcome.

### Proof-first landing page

Begins with credible evidence, then explains mechanism and conversion. Suitable when trust is the primary barrier.

### Use-case switchboard

Organizes the page around distinct audiences or workflows without repeating identical cards.

### Immersive product canvas

The product interface becomes the main composition; explanatory content attaches to it.

### Layered system map

Shows relationships among actors, steps, data, or automations. Suitable for platform products.

### Command workspace

Dense application shell with primary work area, supporting context, and clear action/status zones.

### Record-detail flow

Optimized for reviewing, editing, and acting on one entity while retaining history and related context.

### Queue-and-inspector

List or queue on one side, focused detail on the other. Suitable for inboxes, operations, and review tools.

### Guided task sequence

Progressive steps with validation and state recovery. Suitable for onboarding, creation, and configuration.

Do not treat this list as templates. Change sequence, emphasis, and behavior based on content.

## Signature move

Select one memorable decision. It may be:

- a content-driven transition
- an unusual but usable composition
- a meaningful visualization
- a distinctive type relationship
- a product interaction exposed as storytelling
- a brand-specific shape or image treatment

One strong signature is better than many weak effects.

## Palette roles

Define roles rather than a bag of colors:

- canvas
- raised surface
- primary text
- secondary text
- border/divider
- primary action
- secondary action
- status colors
- highlight/accent
- data visualization sequence

Use accent color with discipline. Avoid rotating accents arbitrarily across sections.

## Typography roles

Define:

- display
- section heading
- body
- supporting text
- label
- control
- data/code

Specify expected line length, wrapping behavior, and mobile scale changes.

## Shape and depth

Define a limited hierarchy:

- flat
- separated by border
- raised
- overlay

Do not apply shadows to everything. Elevation should communicate layering or interactivity.

## Responsive transformation

For each major region, decide:

- order
- width behavior
- collapse behavior
- control density
- navigation change
- overflow strategy
- persistent action
- touch target behavior

Record these decisions before implementation.

---

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

# Appendix E — Project DESIGN.md Template

> Keep this file concise and authoritative. Update it when an approved design decision changes.

## Product

- Product:
- Audience:
- Primary jobs:
- Brand traits:
- Trust requirements:

## Design read

- Page/application type:
- Desired emotional quality:
- Primary anti-goal:
- Accessibility constraints:

## Design dials

- Structure variance: /10
- Motion intensity: /10
- Information density: /10

## Macrostructure

- Named structure:
- Why it fits:
- Signature move:
- Navigation behavior:
- Closing/footer behavior:

## Color roles

| Role | Token/value | Usage |
|---|---|---|
| Canvas | | |
| Raised surface | | |
| Primary text | | |
| Secondary text | | |
| Border/divider | | |
| Primary action | | |
| Accent | | |
| Success | | |
| Warning | | |
| Error | | |

## Typography roles

| Role | Family | Size/scale | Weight | Line-height | Usage |
|---|---|---|---|---|---|
| Display | | | | | |
| Heading | | | | | |
| Body | | | | | |
| Supporting | | | | | |
| Label/control | | | | | |
| Data/code | | | | | |

## Layout

- Content max width:
- Grid:
- Section rhythm:
- Standard gaps:
- Dense regions:
- Open regions:

## Shape and depth

- Radius scale:
- Border rules:
- Shadow/elevation rules:
- Overlay rules:

## Components

- Existing primitives to reuse:
- New primitives allowed:
- Icon source:
- Image treatment:
- Data visualization rules:

## Responsive behavior

| Region | Desktop | Tablet | Mobile |
|---|---|---|---|
| Navigation | | | |
| Main composition | | | |
| Primary action | | | |
| Dense data | | | |
| Secondary context | | | |

## Motion

- Purpose:
- Allowed transitions:
- Maximum intensity:
- Reduced-motion behavior:

## States

- Loading:
- Empty:
- Error:
- Success:
- Disabled:
- Selected:
- Permission-restricted:

## Do

-
-
-

## Don’t

-
-
-

## Approved references

-

## Validation matrix

- Routes:
- States:
- Viewports:
- Commands:

---

# Chat invocation contract

When this file is supplied directly in a ChatGPT conversation, treat it as the governing frontend workflow for that conversation.

When LocalDev MCP is used:

- use LocalDev MCP to inspect and edit the Windows project
- do not assume the MCP can read ChatGPT attachments
- if the file is only attached to the conversation, read it from the conversation context
- if the user says “only use LocalDev MCP,” this file must instead exist inside an MCP-approved project path

Recommended invocation:

```text
Use the attached frontend-craft-director-chat-all-in-one.md as the mandatory frontend skill for this task.

First read the entire skill.
Then use LocalDev MCP to inspect the selected Windows project.
Do not modify files until the inspection and Design Read are complete.
Preserve all existing routes, APIs, data contracts, and behavior.
Do not install packages without my approval.
Complete rendered visual QA before reporting completion.
```
