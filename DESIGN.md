---
color:
  background:
    $value: '#b15959'
    $type: color
    $description: Default page background
  foreground:
    $value: oklch(0.15 0 0)
    $type: color
    $description: Default text color
  brand:
    '50':
      $value: oklch(0.97 0.02 250)
      $type: color
    '500':
      $value: oklch(0.65 0.18 250)
      $type: color
      $description: Primary brand color
    '900':
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
spacing:
  '1':
    $value: 0.25rem
    $type: dimension
  '2':
    $value: 0.5rem
    $type: dimension
  '4':
    $value: 1rem
    $type: dimension
  '6':
    $value: 1.5rem
    $type: dimension
  '8':
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
---

# designmd-live — Design System

This is the working design system for the `designmd-live` tool itself. It serves both as our own brand and as the dogfood fixture for development.

## Brand

**Voice:** technical, opinionated, dev-tool first. Think Storybook + Linear, not corporate SaaS.

**Color:** neutral grays anchored on `brand.500` for accents only. No gradients, no decoration.

## Usage

- `color.foreground` for body copy.
- `color.brand.500` reserved for primary CTAs and active states.
- Spacing scale follows a 0.25rem base — never use raw pixels.
