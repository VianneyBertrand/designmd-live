---
color:
  background:
    $value: oklch(1 0 0)
    $type: color
    $description: Default page background
  foreground:
    $value: oklch(0.15 0 0)
    $type: color
    $description: Default text color
  brand:
    50:
      $value: oklch(0.97 0.02 250)
      $type: color
    500:
      $value: oklch(0.65 0.18 250)
      $type: color
      $description: Primary brand color
    900:
      $value: oklch(0.25 0.12 250)
      $type: color
  muted:
    $value: oklch(0.96 0 0)
    $type: color
  border:
    $value: oklch(0.92 0 0)
    $type: color

typography:
  family:
    sans:
      $value:
        - Inter
        - system-ui
        - sans-serif
      $type: fontFamily
    mono:
      $value:
        - JetBrains Mono
        - ui-monospace
        - monospace
      $type: fontFamily
  size:
    sm:
      $value: 0.875rem
      $type: fontSize
    base:
      $value: 1rem
      $type: fontSize
    lg:
      $value: 1.125rem
      $type: fontSize
    xl:
      $value: 1.5rem
      $type: fontSize
    2xl:
      $value: 2.25rem
      $type: fontSize
  weight:
    regular:
      $value: 400
      $type: fontWeight
    medium:
      $value: 500
      $type: fontWeight
    semibold:
      $value: 600
      $type: fontWeight

spacing:
  1:
    $value: 0.25rem
    $type: dimension
  2:
    $value: 0.5rem
    $type: dimension
  4:
    $value: 1rem
    $type: dimension
  6:
    $value: 1.5rem
    $type: dimension
  8:
    $value: 2rem
    $type: dimension

radius:
  sm:
    $value: 0.25rem
    $type: dimension
  md:
    $value: 0.5rem
    $type: dimension
  lg:
    $value: 0.75rem
    $type: dimension

shadow:
  sm:
    $value: 0 1px 2px 0 rgb(0 0 0 / 0.05)
    $type: shadow
  md:
    $value: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)
    $type: shadow
  lg:
    $value: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)
    $type: shadow

opacity:
  subtle:
    $value: 0.5
    $type: opacity
  faint:
    $value: 0.1
    $type: opacity

duration:
  fast:
    $value: 150ms
    $type: duration
  base:
    $value: 250ms
    $type: duration
  slow:
    $value: 500ms
    $type: duration
---

# designmd-live — Design System

The working design system for the `designmd-live` tool itself.

## Brand

**Voice:** technical, opinionated, dev-tool first. Storybook + Linear, not corporate SaaS.

**Color:** neutral grays anchored on `brand.500`. No gradients, no decoration.

## Usage

- `color.foreground` for body copy.
- `color.brand.500` reserved for primary CTAs and active states.
- Spacing scale follows a 0.25rem base — never use raw pixels.
