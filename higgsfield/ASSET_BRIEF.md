# Higgsfield asset brief

What to generate, why, and the exact specs. Written against the real gaps in
the seed catalogue, not a wishlist.

## The gap

| Merchant | Hue | Products | Have photos | Have hero cut-out |
|---|---:|---:|---:|---:|
| Sherpa Computers | 220 | 6 | 4 | 1 |
| Bizgram | 178 | 6 | **0** | **0** |
| Challenger | 340 | 6 | **0** | **0** |

14 of 18 products fall back to the generated SVG placeholder at
`/product-image/<sku>.svg`. Two of three storefronts have no cut-out, so
`pickHero()` in `app/storefront/[merchantId]/page.tsx` drops them into the
text-forward hero branch — the split hero layout only ever renders for Sherpa.

Closing the hero gap is worth far more than closing the photo gap: it is 2
assets instead of 14, and it is what makes the storefront look designed rather
than templated when a judge clicks between merchants.

## Priority 1 — hero cut-outs (2 assets)

Transparent PNG, three-quarter view, lid open, screen dark and off. These sit
on the page's own coloured glow, so **any baked background ruins them**.

| File | Merchant | Stands in for | Character |
|---|---|---|---|
| `hero-bizgram.png` | Bizgram (hue 178, cyan) | ROG Zephyrus G14 slot | thin-bezel 14", magnesium-grey, business-clean |
| `hero-challenger.png` | Challenger (hue 340, strawberry) | Legion Pro 5 16 slot | 16" performance chassis, matte black, subtle vent detail |

Specs: 1600×1600, transparent, product centred with ~8% margin, lit from upper
left, soft contact shadow **on the laptop only** (never a ground plane — the
page supplies its own drop-shadow at `drop-shadow-[0_28px_50px_rgba(0,0,0,0.65)]`).

Wire-up is one line each in `HERO_IMAGES` in `packages/core/src/seed/products.ts`.

## Priority 2 — product tiles (14 assets)

Only if P1 lands well. 320×200 equivalent, laptop on a flat `#f4f7fb` field
(matching the placeholder tile so mixed rows stay coherent), lid open, screen
off, straight-on three-quarter. No props, no desk scene, no bokeh.

## Explicitly NOT generating

- **The landing hero.** `app/HeroDiagram.tsx` is a deliberate choice recorded in
  `design.md` §6: "We sell infrastructure — so the hero device is the
  architecture." A generated object would contradict that and compete with
  `/customer`, which is the real live visualisation.
- **Anything with a visible brand mark.** See the open question below.

## Open question — branded or generic

The catalogue names real products (ThinkPad E14 Gen 6, ROG Zephyrus G14). Two
options:

1. **Generic, unbranded renders** (recommended). No logos, no model badges, no
   distinctive real-product silhouettes. Honest with the existing footer
   ("product data is fabricated for this prototype"), and avoids shipping
   synthetic imagery that impersonates a real manufacturer's product.
2. **Model-accurate renders.** Better demo realism, but generates fake
   photographs of real branded hardware.

The prompts in `prompts.md` are written for option 1. Say the word and I will
rewrite for option 2.

## Palette to hold

Merchant hues 178 / 220 / 340. Neutrals `#f4f7fb` → `#171c28`. Nothing warm —
the whole app is a cool light theme. Full rationale in `design.md`.
