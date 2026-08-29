---
name: MindGains V2026
description: MindGains' actual production design system (milky-white surfaces, single teal accent) — the source of truth for every screen, not a per-screen reinvention.
colors:
  primary: "#00D4C7"
  primaryGlow: "rgba(0, 212, 199, 0.4)"
  primaryDeep: "#0BA79E"
  background: "#F8FAFC"
  surface: "#FFFFFF"
  text: "#0F172A"
  textMuted: "#64748B"
  textFaint: "#9AA7BC"
  glass: "rgba(255, 255, 255, 0.85)"
  border: "rgba(0, 0, 0, 0.05)"
  error: "#E5484D"
typography:
  headline:
    fontFamily: "Poppins-Bold"
    fontSize: 26
    letterSpacing: -0.5
  title:
    fontFamily: "Poppins-SemiBold"
    fontSize: 18
    letterSpacing: -0.2
  body:
    fontFamily: "Inter-Medium"
    fontSize: 14
    lineHeight: 20
  bodyRegular:
    fontFamily: "Inter-Regular"
    fontSize: 14
    lineHeight: 20
  label:
    fontFamily: "Inter-SemiBold"
    fontSize: 13
  caption:
    fontFamily: "Inter-Regular"
    fontSize: 12
    lineHeight: 17
rounded:
  sm: 12
  md: 20
  lg: 28
  xl: 36
  full: 9999
spacing:
  xs: 4
  sm: 8
  md: 16
  lg: 24
  xl: 32
  xxl: 48
components:
  primaryButton:
    background: "{colors.primary}"
    text: "{colors.surface}"
    rounded: "{rounded.full}"
  card:
    background: "{colors.glass}"
    rounded: "{rounded.lg}"
    border: "{colors.border}"
---

## Overview

MindGains is a milky-white, single-accent teal design language — the opposite
of a busy multi-color consumer app. One primary color (`#00D4C7`) does all the
interactive/brand work; everything else is a neutral slate scale. This file
is the actual source of truth (derived from `theme/v2026-tokens.ts`, already
used across Profile, Streak, and the Daily Usage panel) — it exists so every
future redesign pulls from the same tokens instead of a new session inventing
a new palette from scratch, which is exactly what happened across several
auth-screen rewrites before this file existed.

## Colors

One accent, everything else neutral. `primary` is used for the single most
important action on a screen (usually one button) and small state indicators
(a filled input border, a focused ring). It is never used as a background
wash covering large areas — large areas stay `background` or `surface`.
`textMuted` and `textFaint` carry the visual hierarchy for secondary text,
not additional hues.

## Typography

Six roles, no ad hoc sizes outside them: `headline` (screen titles),
`title` (section/card headers), `body`/`bodyRegular` (primary reading text),
`label` (buttons, form field values), `caption` (legal text, timestamps,
helper copy). Poppins carries weight/emphasis (headline, title, buttons);
Inter carries everything read at length (body, labels, captions).

## Layout

Generous whitespace over dense information. A screen should read as 3-5
distinct groups, not a wall of stacked elements. Prefer one clear primary
action per screen over multiple competing CTAs.

## Elevation & Depth

Elevation is shown with soft, low-opacity shadows (`shadows.milky` /
`shadows.primary` in the token file) on surfaces that float above the
background — never with a hard 1-2px border as the primary way to separate
an element from its background. A border may appear only as a brief,
temporary state indicator (e.g. a filled/focused form field), not as a
permanent outline on every interactive element by default.

## Shapes

Rounded, consistently: `sm` (12) for small chips/icon badges, `md` (20) for
inputs and secondary buttons, `lg` (28) for cards and sheets, `full` for
primary pill buttons. Never mix an unrelated one-off radius into a screen
that isn't one of these five values.

## Components

- **Primary button**: `full` radius, `surface`-colored label text,
  `shadows.primary` for lift. Fill is normally solid `primary`; a horizontal
  `primary`→`#22B8F0` gradient is an accepted variant when a screen wants a
  bit more shine (e.g. auth CTAs) — pick one treatment per screen, don't mix.
  One per screen, reserved for the single most important action.
- **Secondary button**: `surface` background, no border by default, `shadows.milky`
  for lift, `text` colored label.
- **Card / sheet**: `surface` or `glass` background, `lg` radius,
  `shadows.milky`, `border` only as an optional 1px hairline, not a heavy
  outline.
- **Form field**: `surface` or a very light neutral fill, `md` radius,
  `shadows.milky` for lift instead of a border; a `primary`-colored border
  appears only while focused or filled, as a state, not a default.

## Do's and Don'ts

- Do reuse `theme/v2026-tokens.ts` (`V2026.colors` / `V2026.spacing` /
  `V2026.radius` / `V2026.shadows`) directly in code — do not redeclare local
  color constants that duplicate or drift from these values.
- Do use exactly one accent color per screen. Do not introduce a second or
  third saturated hue "for variety."
- Do not add decorative elements that don't carry real information (sparkle/
  twinkle animations, filler icons) — every visual element should earn its
  place.
- Do not put a visible border on every input/button by default — use shadow-
  based elevation and reserve borders for temporary state only.
- Do not invent a new border-radius value outside the five defined in
  `rounded` — pick the closest existing one.
- Do keep exactly one primary (filled, full-radius) button per screen; every
  other action is secondary/text-level.
