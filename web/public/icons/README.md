# Header / navigation icons

Raster icon set for the top bar, rendered by `web/src/components/ui/NavIcon.tsx`
(`<NavIcon name="home" size={18} />`). Each file is a **256x256 RGBA PNG, black
strokes on a transparent ground**; the component uses it as a CSS mask and paints
it with `currentColor`, so the same file works in the light and dark themes.

Style: monochrome line icon, single uniform stroke (~21 px at 256 = a 2 px stroke
on a 24-point grid), rounded caps and joins, no fill, Lucide/Feather feel.

| name       | subject                                   |
| ---------- | ----------------------------------------- |
| `home`     | house outline with a door                 |
| `friends`  | two people (large + small, "users")       |
| `projects` | 2x2 grid of rounded tiles ("layout-grid") |
| `settings` | gear with eight teeth + centre circle     |
| `user`     | single person                             |
| `logout`   | open door frame with an exit arrow        |
| `inbox`    | notifications bell                        |
| `sun`      | circle with eight rays (light theme)      |
| `moon`     | crescent (dark theme)                     |

## Provenance

- Generated **2026-09-04** through the QCAI (quadcode-mcp) image pipeline, project
  `Q` (`C:\Users\User1\AppData\Roaming\QuadcodeAI\apps\Q`).
- Template: `gen_or_edit_image_gptimage_with_refs` — `UTILITY: gpt_image`
  (gpt-image default version 2.0), `QUALITY: high`, 1024x1024, black strokes on
  pure white, one prompt per icon sharing a single style block.
- Meta sections (prompt source of truth): `Q/meta/files/images/vibehub_icons/<name>_png.md`
  (section ids `files.images.vibehub_icons.<name>_png`).
- Raw 1024 px generations: `Q/images/vibehub_icons/<name>.png`. Earlier hairline
  pass kept as `Q/images/vibehub_icons/v1_thin/`. `projects` and `friends` are
  third-pass generations (wider tile gap / non-touching figures); the other seven
  are second-pass (bold line-weight block added).
- Post-processing, deterministic, identical for all nine (QCAI `image_edit`):
  1. `filter blur method=gaussian radius=12` — uniform stroke thickening
     (raw strokes were ~45 px; final ~80 px at 1024).
  2. `filter make_color_transparent color=white delta=26 blur_delta=21` — key the
     white ground to alpha.
  3. `filter tint mode=solid color=#000000 blend=replace` — force stroke RGB to
     pure black (only alpha matters for the mask).
  4. `resize 256,256` — final size. Finals live in `Q/images/vibehub_icons/out/`
     and are copied here unchanged.

To regenerate one icon: edit its meta section in Q, run `resource_generate` with
the section id, repeat the four post steps, copy the 256 px result here.
