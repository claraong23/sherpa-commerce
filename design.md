# Design system

Light theme, four-colour palette, conversational-commerce visual language.

Sections 1–4 are **implemented**. Section 5 onward is the landing-page direction
drawn from the five reference UIs in `sherpa_assets/`.

---

## 1. The constraint everything hangs on

The four supplied colours are bright and mid-luminance. Measured against white:

| Colour | Hex | On white | Verdict |
|---|---|---:|---|
| Wisteria Blue | `#809FE4` | **2.63:1** | fill only |
| Strong Cyan | `#1BC0BA` | **2.26:1** | fill only |
| Wild Strawberry | `#F94680` | **3.38:1** | large text / borders |
| Amber Gold | `#FEBD17` | **1.68:1** | fill only, never text |

> **The four colours are fills carrying dark text.** Never white text on them,
> never the colour itself as body text. Where a coloured label is needed, a
> 600/700 shade does the work.

Against `slate-900` the same four score 5.04–10.14:1, so dark-on-colour is
comfortable everywhere.

Text-safe shades: `brand-600 #3F60BC` (5.82:1), `ok-600 #0E7C78` (5.03:1),
`berry-600 #C11555` (5.99:1), `warn-700 #7A5804` (6.51:1).

Danger is a conventional red from outside the palette — `bad-600 #D32424`, which
is 5.19:1 *both* as text on white and with white text on it, so it serves as
label and as fill. A payment decline has to read as a hard stop.

---

## 2. Palette

| Role | Token | 50 | 100 | 200 | 400 (base) | 600 | 700 |
|---|---|---|---|---|---|---|---|
| Primary — Wisteria | `brand-*` | `#F2F5FC` | `#E3EAF9` | `#C6D4F2` | **`#809FE4`** | `#3F60BC` | `#2C4791` |
| Success — Cyan | `ok-*` | `#EAFBFA` | `#D0F5F3` | `#9BE9E5` | **`#1BC0BA`** | `#0E7C78` | `#095B58` |
| Pending — Amber | `warn-*` `gold-*` | `#FFF9E6` | `#FFF1C2` | `#FEE283` | **`#FEBD17`** | `#A97A05` | `#7A5804` |
| Danger — Red | `bad-*` | `#FEF2F2` | `#FEE2E2` | `#FECACA` | `#F05252` | **`#D32424`** | `#A31515` |
| Highlight — Strawberry | `berry-*` | `#FFF0F5` | `#FFDCE7` | `#FEB6CB` | **`#F94680`** | `#C11555` | `#8E0F3E` |

Neutrals run `slate-25 #FBFCFE` → `slate-900 #171C28`. Body text `slate-700`
(10.31:1), secondary `slate-600` (7.10:1), headings `slate-900`. `slate-500`
(4.41:1) is for labels ≥18px, icons and borders only — it does not clear AA for
normal text.

Visa navy `#1A1F71` is reserved and used only where a real Visa card is drawn.

---

## 3. Semantic mapping

| Meaning | Colour |
|---|---|
| Primary action, brand, links | Wisteria |
| Success, verified, in stock, approved | Cyan |
| Danger, decline, out of stock | Red |
| Pending, sealed, rank 1 | Amber |
| Secondary highlight | Strawberry |

**Merchant accents:** Sherpa `220` (Wisteria), Bizgram `178` (Cyan),
Challenger `340` (Strawberry). Amber is deliberately unassigned so it stays
unambiguous as "pending / rank 1" in the exchange lane, where all three merchant
colours appear at once.

---

## 4. Surfaces

| Level | Background | Border | Shadow |
|---|---|---|---|
| Canvas | `slate-25` | — | — |
| Card | `#FFFFFF` | `slate-200` | none |
| Raised | `#FFFFFF` | `slate-200` | `0 8px 24px rgb(23 28 40 / .08)` |
| Sunken | `slate-50` | `slate-200` | — |

Borders do the work. Shadows are reserved for things that genuinely float.

---

## 5. Visual language — from the five references

| Ref | What it contributes |
|---|---|
| **UI_1** Sendbird bot | Periwinkle agent bubbles; outlined pill quick-replies with one filled primary; small centred system lines; dotted connectors for agent handoff |
| **UI_2** ChatGPT workspace | Centred hero moment; abstract gradient orb; a two-line heading whose lines are styled differently; large rounded composer with inline pill controls and a circular send |
| **UI_3** aoura commerce | Pastel multi-stop gradient canvas; floating rounded app window; agent replies as plain text with a small check icon rather than a bubble; horizontal product carousel with rating chips and circular add buttons |
| **UI_4** HOLO | Full-bleed gradient hero; **glassmorphic pill nav**; **connector line and dot linking a glass callout card to the hero object**; floating icon chips |
| **UI_5** 1SEC | Vertical gradient canvas; one generous white card floating on it; big two-line heading; **pill CTA with a circular arrow**; rendered object floating opposite the card |

### The five rules that fall out

1. **Gradient canvas, not flat white.** Multi-stop pastel built from the palette
   at very low saturation. Content floats on it.

   **Amended for merchant-accented surfaces.** A wash derived from
   `merchant.logoHue` may vary in *intensity*, never in *hue*. The storefront
   originally layered two radials at `hue` and `hue + 30`, which pushed Sherpa's
   blue into violet and Challenger's pink into orange — the accent stopped
   identifying the merchant, and a two-stop blue-to-purple field is the single
   most recognisable generated-UI signature there is. Merchant surfaces now use
   one radial at `hue` only. Fills follow the same rule: the header mark and the
   storefront CTA are flat `hsl(hue 58% 44%)`, not gradients.
2. **Pills everywhere.** Nav, chips, buttons, composer. `rounded-full` by
   default, `rounded-2xl` for cards.
3. **Glass for chrome, solid white for content.** Nav and callouts are
   translucent with `backdrop-blur`; anything that must be read is opaque.
4. **Two-line headings with contrasting treatment.** Line one `slate-900`, line
   two `brand-600` — carries the brand without a coloured wash behind text.
5. **Connector lines that explain.** UI_4 links a callout to the product with a
   line and a dot. Our product *is* a system, so this becomes the mechanism for
   explaining it rather than decoration.

### Deliberately not adopted

- **Glass behind body text.** UI_4 sets white text over a photograph. Our
  contrast budget cannot afford it, so glass stays chrome-only.
- **A decorative 3D render.** UI_4 and UI_5 float a product because they sell an
  object. We sell infrastructure — so the hero device is the architecture.
- **Icon-rail navigation.** UI_2 and UI_3 have one because they are apps with
  persistent sections. This is a three-route demo; a rail would be pretence.

---

## 6. Landing page — `/`

The first page a judge opens. It has to state the thesis, show the mechanism,
and route to the three demos, in that order.

```text
┌────────────────────────────────────────────────────────────┐
│  gradient canvas — Wisteria → Cyan → Strawberry, ~6% sat   │
│                                                            │
│  ⬤ glass pill nav — brand mark · live integration chips    │
│                                                            │
│  Turn any merchant into           ╭─ glass callout ─╮      │
│  an AI-native seller.   ←─────────┤ merchant agent  │      │
│                             │     ╰─────────────────╯      │
│  subtitle                   │                              │
│                        [ hero diagram ]                    │
│  ▸ pill CTA  glass CTA      │                              │
│                             │     ╭─ glass callout ─╮      │
│  ◦ chip ◦ chip ◦ chip  ←────┴─────┤ customer agent  │      │
│                                   ╰─────────────────╯      │
├────────────────────────────────────────────────────────────┤
│  three white cards — the demo routes                       │
├────────────────────────────────────────────────────────────┤
│  honesty panel — real vs simulated                         │
└────────────────────────────────────────────────────────────┘
```

### Hero device

Not an orb. A **static architecture diagram**: three merchant-agent nodes in
their own accents feeding a sealed exchange, resolving to one customer agent and
a Visa authorization. SVG, so it stays crisp and takes palette tokens.

Two glass callout cards attach with a connector line and dot (UI_4), labelling
the two agent roles — the single idea the page must land.

### Heading

Two lines, contrasting treatment: line one `slate-900` `font-extrabold`
`tracking-[-0.035em]`, line two `brand-600`.

### Chips

Floating pill chips (UI_4) carrying **real integration status** — merchant and
product counts, database mode, model mode, Visa mode. Status, not decoration.

### CTAs

Primary is a **pill with a circular arrow** (UI_5) in `brand-400` with
`slate-900` text — the palette rule, not white-on-colour. Secondary is a glass
pill.

### Demo cards

Three white `rounded-2xl` cards on the gradient (UI_5's treatment), each with a
rule in its own merchant accent, a number, title, description and capability
chips.

---

## 7. Risks

- **Gradient banding.** Wide low-saturation gradients band on 8-bit displays.
  Keep stops close in luminance and layer two radials rather than one linear.
- **Glass over a busy backdrop.** `backdrop-blur` over the gradient is fine;
  over the diagram it is not. Callouts sit on flat regions only.
- **Contrast on the gradient.** The canvas must stay above roughly 95% lightness
  so `slate-700` body copy keeps its ~10:1. Checked per stop, not assumed.
- **The diagram must not look live.** It is a static explanatory graphic. If it
  implies running state it competes with `/customer`, which is the real thing.
