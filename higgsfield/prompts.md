# Prompts

Written for unbranded renders (option 1 in `ASSET_BRIEF.md`). Generated files
land in `higgsfield/out/`, then get copied to `public/products/`.

## hero-bizgram.png

> Studio product render of a thin 14-inch laptop, lid open at about 105
> degrees, screen completely off and matte black. Magnesium-grey aluminium
> unibody, minimal thin bezels, no logos or brand marks anywhere. Three-quarter
> view from slightly above, rotated about 20 degrees to the left. Soft key light
> from upper left, cool neutral fill, gentle specular roll-off along the lid
> edge. Fully transparent background, no ground plane, no reflection, no cast
> shadow on any surface. Centred with even margin. Clean commercial catalogue
> photography.

Negative: background, desk, table, reflection, floor shadow, logo, brand,
sticker, text on screen, wallpaper, hands, plant, coffee, warm tones.

## hero-challenger.png

> Studio product render of a 16-inch performance laptop, lid open at about 105
> degrees, screen completely off and matte black. Matte black chassis with
> subtle angular rear vent detail and a slightly thicker profile, no logos or
> brand marks anywhere, no RGB lighting. Three-quarter view from slightly
> above, rotated about 20 degrees to the right. Soft key light from upper left,
> cool neutral fill. Fully transparent background, no ground plane, no
> reflection, no cast shadow on any surface. Centred with even margin. Clean
> commercial catalogue photography.

Negative: background, desk, reflection, floor shadow, logo, brand, RGB glow,
neon, gamer aesthetic, text on screen, warm tones.

## Product tiles (template)

Substitute size and finish per SKU.

> Studio product photograph of a {SIZE}-inch laptop, lid open, screen off and
> matte black, {FINISH} finish, no logos or brand marks. Straight-on
> three-quarter view. Flat pale cool-grey background, colour #f4f7fb, evenly
> lit, no vignette. Soft even lighting, minimal shadow. Clean e-commerce
> catalogue style.

Negative: desk scene, props, bokeh, dramatic lighting, logo, brand, text,
people, warm tones, gradient background.

## After generating

1. Check the cut-outs really have an alpha channel — a white-background PNG
   reads as a white box on the coloured hero glow.
2. Downsample to ~1600px on the long edge before committing.
3. Register in `packages/core/src/seed/products.ts`:
   - `HERO_IMAGES['BIZ-ZEPH-G14'] = '/products/hero-bizgram.png'`
   - `HERO_IMAGES['CHA-LEGION-PRO-5'] = '/products/hero-challenger.png'`
4. Restart the dev server — the seed store is pinned to `globalThis` and does
   not pick up seed edits on hot reload.
