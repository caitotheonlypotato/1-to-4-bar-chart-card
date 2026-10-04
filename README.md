# 1 to 4 Bar Chart

A custom **Home Assistant Lovelace card** that displays **1–4 entities** as a vertical or horizontal bar chart, with a full GUI configuration editor.

**Card type:** `custom:one-to-four-bar-chart`  
**Resource file:** `1_to_4_bar_chart.js`

![Card screenshot](screenshot.jpg)

---

## What it’s for

Use this card when you want a compact comparison of a few related sensors on a dashboard, for example:

- Battery / Powerwall state of charge (SOC) side by side  
- Solar production (house vs shed vs total)  
- Grid import vs export  
- AC voltage per phase (with warning thresholds)  
- Temperatures, loads, or any numeric sensors  

It is **not** a multi-hour history graph. Bars show **current values** (optionally scaled against a 24h history range or fixed limits).

---

## Features overview

| Area | Capabilities |
|------|----------------|
| **Series** | 1–4 entities, custom labels, units, colour, ± colours, gradients |
| **Layout** | Vertical or horizontal bars |
| **Scale** | Auto, fixed min/max, or 24h history extremes |
| **Bounds** | Optional upper/lower reference lines with labels and **custom colours** |
| **Warnings** | Warn-if-above / warn-if-below thresholds; hazard stripes on out-of-spec bar segments; optional warning lines with **custom colours** |
| **Min/Max / warnings input** | Static number, `entity_id`, or Jinja template |
| **Units** | Per-series factor (e.g. W → kW) and optional custom unit text |
| **Labels** | Value labels (position + hover/tap/always), series name colours, optional Y-region labels with **custom colour** |
| **Interaction** | Click bar or series name → entity **more-info** dialog |
| **Appearance** | Title, icon, height scale, decimals, solid/gradient/image background |
| **Editor** | Full UI editor (entity picker, icon picker, colour pickers for bounds / warnings / Y labels, etc.) |

---

## Installation

1. Copy `1_to_4_bar_chart.js` to your HA config, e.g.  
   `config/www/1_to_4_bar_chart.js`
2. Add a Lovelace resource (Dashboard → ⋮ → Resources, or YAML):

```yaml
url: /local/1_to_4_bar_chart.js
type: module
```

3. Reload resources / refresh the browser (hard refresh if needed).
4. Add card → search **“1 to 4 Bar Chart”**, or use YAML:

```yaml
type: custom:one-to-four-bar-chart
title: Powerwall Batteries SOC
entities:
  - entity: sensor.battery_1_soc
    name: Batt 1
    color: "#3B82F6"
```

The script **self-registers** with Home Assistant’s card picker via `window.customCards` (see [Self-registration](#self-registration) below). You do not need a separate `card-tools` dependency.

---

## Self-registration

On load, the file:

1. Pushes a card definition into `window.customCards` so it appears in the **Add card** UI  
2. Defines two custom elements:
   - `one-to-four-bar-chart` — the card  
   - `one-to-four-bar-chart-editor` — the visual editor  

```js
window.customCards.push({
  type: "one-to-four-bar-chart",
  name: "1 to 4 Bar Chart",
  description: "...",
  preview: true,
});

customElements.define('one-to-four-bar-chart', OneToFourBarChartCard);
customElements.define('one-to-four-bar-chart-editor', OneToFourBarChartEditor);
```

Static methods on the card class:

| Method | Purpose |
|--------|---------|
| `getConfigElement()` | Returns the editor element for the GUI config flow |
| `getStubConfig()` | Default config when you add a new card from the picker |

---

## Configuration reference

### Top-level options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `title` | string | — | Card title |
| `icon` | string | — | MDI icon under the title (e.g. `mdi:battery`) |
| `entities` | array | **required** | 1–4 series configs (see below) |
| `orientation` | `vertical` \| `horizontal` | `vertical` | Bar direction |
| `value_label_position` | `top` \| `bottom` \| `both` \| `none` | `top` | Where value text sits relative to the bar (`top` = outer end, `bottom` = near baseline) |
| `value_label_trigger` | `always` \| `hover` \| `tap` | `always` | When value labels are visible |
| `decimals` | number 0–6 | `1` | Decimal places for value, bound, and warning labels (trailing zeros trimmed) |
| `scale_mode` | `auto` \| `fixed` \| `history_24h` | `auto` | How min/max of the chart are chosen |
| `min_value` | number \| entity_id \| Jinja \| null | `null` | Scale minimum and/or lower bound source |
| `max_value` | number \| entity_id \| Jinja \| null | `null` | Scale maximum and/or upper bound source |
| `show_zero_line` | boolean | `true` | Dashed zero line when scale crosses 0 |
| `show_upper_bound` | boolean | `false` | Draw upper reference line |
| `show_lower_bound` | boolean | `false` | Draw lower reference line |
| `label_upper_bound` | boolean | `false` | Show numeric label on upper bound line |
| `label_lower_bound` | boolean | `false` | Show numeric label on lower bound line |
| `upper_bound_color` | string (hex) | `#ffffff` | Colour of the upper bound line **and** its label |
| `lower_bound_color` | string (hex) | `#ffffff` | Colour of the lower bound line **and** its label |
| `warn_above` | number \| entity_id \| Jinja \| null | `null` | Warn if value is **above** this threshold |
| `warn_below` | number \| entity_id \| Jinja \| null | `null` | Warn if value is **below** this threshold |
| `show_warning_lines` | boolean | `true` | Draw dashed lines at warning thresholds |
| `label_warning_lines` | boolean | `false` | Show numeric labels on warning lines |
| `warn_above_color` | string (hex) | `#EAB308` | Colour of the upper warning line **and** its label |
| `warn_below_color` | string (hex) | `#EAB308` | Colour of the lower warning line **and** its label |
| `show_y_labels` | boolean | `false` | Region labels (e.g. Export / Import) |
| `y_label_above` | string | — | Label for positive side of zero |
| `y_label_below` | string | — | Label for negative side of zero |
| `y_label_color` | string (hex) | `#9ca3af` | Colour of the Y-axis region labels |
| `height_scale` | number | `1` | Multiplier for chart height (~0.5–3) |
| `background_type` | `solid` \| `gradient` \| `image` | `solid` | Card background style |
| `bg_color` | string | theme / dark grey | Solid background (hex or CSS variable) |
| `bg_gradient_start` / `bg_gradient_end` | string | — | Gradient colours |
| `bg_image_url` | string | — | Background image URL |
| `bg_image_fit` | `cover` \| `contain` \| `fill` \| `center` | `cover` | Image sizing |
| `bg_opacity` | number | `0.2` | Dark overlay when using an image |

### Per-entity (`entities[]`) options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `entity` | string | — | Home Assistant entity id |
| `name` | string | friendly name | Series label on the chart |
| `name_color` | string | theme secondary | Colour of the series name |
| `unit` | string | entity unit | Override unit text on labels |
| `factor` | number | `1` | Multiplier applied to live state **and** 24h history (e.g. `0.001` for W→kW) |
| `color` | string | palette | Bar colour when value ≥ 0 |
| `color_negative` | string | — | Bar colour when value &lt; 0 |
| `color_mode` | `solid` \| `gradient` | `solid` | Fill style |
| `color_end` | string | — | Gradient end colour (positive) |
| `color_end_negative` | string | — | Gradient end colour (negative) |

---

## Scale modes

### Auto (`auto`)
Min/max derived from **current** bar values (with light padding). All-positive data typically floors at 0. Warning thresholds (if set) are included so their lines stay on the plot.

### Fixed (`fixed`)
Scale uses resolved **Min** and **Max**. Those values are also used for bound lines when those options are enabled.

### 24h history (`history_24h`)
Fetches 24 hours of history via the WebSocket API (`history/history_during_period`), applies each series’ **factor**, and sets scale from the combined history + current values. Warning thresholds are included in the range when set. Useful so a short bar still sits in a meaningful daily context.

---

## Min / Max / warnings: numbers, entities, and templates

`min_value`, `max_value`, `warn_above`, and `warn_below` all accept:

| Kind | Example |
|------|---------|
| Static number | `100` |
| Entity id | `sensor.battery_capacity` |
| Jinja template | `{{ states('sensor.a') \| float(0) * 1.1 }}` |

**Resolution order**

1. Looks like Jinja (`{{` or `{%`) → HA `render_template` subscription (live updates)  
2. Looks like `domain.object_id` → entity state  
3. Otherwise → parsed as a number  

**How Min/Max interact with scale and bound lines**

| Mode | Role of Min/Max |
|------|------------------|
| **Fixed** | Define the scale; bound lines sit on those limits when enabled |
| **Auto / 24h** | Optional overrides: if set and bound lines are on, scale **expands** so the bound is always on the plot; if Min/Max empty but “show bound line” is on, the line marks the **computed** scale edge (e.g. 24h peak) |

Leave Min/Max empty in auto/24h when you only want data-driven scaling with no override.

---

## Reference lines

- **Zero line** — only when min &lt; 0 &lt; max and `show_zero_line` is true  
- **Upper / lower bounds** — dashed lines; optional value labels (respecting **Decimals** and the first series’ unit when set). Colour controlled by `upper_bound_color` / `lower_bound_color` (applies to both the line and its label).  
- **Warning lines** — dashed lines at `warn_above` / `warn_below` when configured and `show_warning_lines` is true. Colour controlled independently by `warn_above_color` / `warn_below_color` (applies to both the line and its label).  

---

## Warning thresholds

Card-level operational limits (separate from scale bound lines).

| Setting | Meaning |
|---------|---------|
| `warn_above` | Values **above** this are out of spec |
| `warn_below` | Values **below** this are out of spec |

**Bar styling**

- Value inside the safe band → normal solid/gradient fill  
- Value **above** `warn_above` → solid up to the threshold, **yellow/black hazard stripes** on the excess tip  
- Value **below** `warn_below` → hazard stripes on the out-of-spec segment, solid for the rest  

Works for **vertical and horizontal** orientation. Only the out-of-spec portion is striped, so you can see how far past the limit the value is.

**Example (AC voltage 170–270, warn outside 208–253)**

```yaml
scale_mode: fixed
min_value: 170
max_value: 270
warn_below: 208
warn_above: 253
show_warning_lines: true
label_warning_lines: true
warn_above_color: "#EAB308"
warn_below_color: "#EF4444"
```

| Value | Appearance |
|-------|------------|
| 240 | Fully normal colour |
| 259 | Solid to 253, striped tip 253→259 |
| 200 | Striped on the portion below 208 |

---

## Orientation

- **Vertical** — classic columns; series names under bars; zero/bounds/warnings horizontal  
- **Horizontal** — bars grow left/right; series names on the left; zero/bounds/warnings vertical  

Y-region labels (`y_label_above` / `y_label_below`) adapt: rotated on the left in vertical mode; upright above the value axis in horizontal mode. Colour is controlled by `y_label_color`.

---

## Interaction

- **Click** a bar or its series label → `hass-more-info` for that entity  
- **Keyboard** — focus the bar group (Tab) and press Enter or Space  

Clicks use a full column/row hit target so more-info works reliably on the bar and the label. The card only fully re-renders when watched entity states change, which avoids flicker and broken clicks on live sensors.

---

## Card behaviour (runtime)

### Lifecycle

| Step | What happens |
|------|----------------|
| `setConfig(config)` | Merges defaults, validates `entities`, sets up min/max/warn resolvers, optional history fetch, renders |
| `set hass(hass)` | Updates entity data; skips full re-render if watched states are unchanged (reduces flicker); refreshes entity-based bounds/warnings |
| `disconnectedCallback` | Unsubscribes Jinja template listeners |

### Rendering pipeline (simplified)

1. Read up to 4 entities → apply **factor** → build bar values  
2. Resolve scale via `getMinMaxValues` (auto / fixed / history + bound & warning range)  
3. Split each bar into solid + optional warning-stripe segments  
4. Build SVG: bars, labels, zero/bound/warning lines (with configured colours), patterns, optional gradients  
5. Apply background, title, icon  

### Performance notes

- Full SVG rebuild only when a **watched entity state** changes (series entities + entity-type min/max/warnings)  
- Template fields update via subscription and trigger their own render  
- Hover styles avoid CSS `filter` on bars (that caused unreliable clicks / flicker in SVG)  

---

## GUI editor

Opened from the standard Lovelace **Configure card** UI (`getConfigElement()`).

### Editor capabilities

- **Card title** (text)  
- **Card icon** (`ha-icon-picker` when available, else text)  
- **Entities** (up to 4):
  - `ha-entity-picker` when HA components load successfully  
  - Label, label colour, unit, factor  
  - Fill mode (solid/gradient), bar + / − colours, gradient ends  
  - Add / remove series  
- **Orientation**, value label position & trigger  
- **Scale mode**, Min/Max (text — number / entity / template)  
- Zero line, reference line toggles + labels + **colour pickers** for upper/lower bounds  
- **Warning thresholds** (warn if below / above, show lines, label lines) + **separate colour pickers** for above/below warning lines  
- Y-axis region labels + **colour picker**  
- Height scale & decimals  
- Background type and related colour / image fields  

### Editor UX details

- Uses **`change`** events (not `input`) so typing in text fields does not steal focus  
- Structural changes (scale mode, background type, entity count, etc.) re-render the form; value-only changes **sync in place** where possible  
- Loads `ha-entity-picker` / `ha-icon-picker` by invoking known HA card config elements when needed  
- Colour pickers for bounds, warnings, and Y labels sit next to their related checkboxes so the form stays organised  

---

## YAML examples

### SOC with 100% ceiling

```yaml
type: custom:one-to-four-bar-chart
title: Powerwall Batteries SOC
icon: mdi:home-battery
orientation: vertical
scale_mode: auto
max_value: 100
show_upper_bound: true
label_upper_bound: true
upper_bound_color: "#94a3b8"
decimals: 1
entities:
  - entity: sensor.pw_batt_1_soc
    name: Batt 1
    color: "#3B82F6"
    unit: "%"
  - entity: sensor.pw_batt_2_soc
    name: Batt 2
    color: "#10B981"
    unit: "%"
```

### Power in kW with factor and ± colours

```yaml
type: custom:one-to-four-bar-chart
title: Grid
orientation: horizontal
scale_mode: history_24h
show_zero_line: true
show_y_labels: true
y_label_above: Export
y_label_below: Import
y_label_color: "#e2e8f0"
entities:
  - entity: sensor.grid_power_w
    name: Grid
    factor: 0.001
    unit: kW
    color: "#3B82F6"
    color_negative: "#EF4444"
```

### AC voltage with warning band and custom colours

```yaml
type: custom:one-to-four-bar-chart
title: AC Voltage
orientation: horizontal
scale_mode: fixed
min_value: 170
max_value: 270
warn_below: 208
warn_above: 253
show_warning_lines: true
label_warning_lines: true
warn_above_color: "#EAB308"
warn_below_color: "#EF4444"
upper_bound_color: "#64748b"
lower_bound_color: "#64748b"
decimals: 0
entities:
  - entity: sensor.phase_a_voltage
    name: Phase A
    unit: V
    color: "#3B82F6"
  - entity: sensor.phase_b_voltage
    name: Phase B
    unit: V
    color: "#3B82F6"
  - entity: sensor.phase_c_voltage
    name: Phase C
    unit: V
    color: "#3B82F6"
```

### Dynamic max from template

```yaml
type: custom:one-to-four-bar-chart
title: Load vs capacity
scale_mode: fixed
min_value: 0
max_value: "{{ states('sensor.inverter_max_w') | float(0) * 0.001 }}"
show_upper_bound: true
label_upper_bound: true
upper_bound_color: "#f59e0b"
entities:
  - entity: sensor.house_load_w
    name: House
    factor: 0.001
    unit: kW
    color: "#F59E0B"
```

### Background image

```yaml
type: custom:one-to-four-bar-chart
title: House / Shed Solar
background_type: image
bg_image_url: /local/images/solar_bg.png
bg_image_fit: cover
bg_opacity: 0.35
orientation: horizontal
entities:
  - entity: sensor.house_solar_kw
    name: House
    color: "#F59E0B"
  - entity: sensor.shed_solar_kw
    name: Shed
    color: "#EF4444"
```

---

## Troubleshooting

| Symptom | Things to check |
|---------|------------------|
| Card missing from picker | Resource URL, `type: module`, hard refresh |
| Entity picker missing in editor | HA version / frontend load; fallback text field still works |
| Colour pickers missing in editor | Hard-refresh the browser; ensure you have the latest `1_to_4_bar_chart.js` |
| 24h scale looks wrong | Recorder enabled for those entities; **factor** applied to history and live values |
| Bound line missing | Enable show upper/lower; ensure resolved min/max is valid; fixed mode needs Min/Max set |
| Warning stripes not showing | Value must be outside `warn_above` / `warn_below`; thresholds must resolve to numbers |
| Warning lines missing | Set thresholds; ensure `show_warning_lines` is true; value must fall within current scale (fixed min/max or auto expansion) |
| Bound / warning / Y label colours not applied | Confirm the colour options are set (hex values); hard-refresh after updating the resource |
| Template min/max/warn not updating | Valid Jinja; entity available; check browser console for subscribe errors |
| more-info unreliable | Use latest file (hit target + render gating); click bar or series label |
| Flickering bars | Ensure you have the version that only re-renders on relevant state changes |

---

## File map (code structure)

| Class / area | Role |
|--------------|------|
| `OneToFourBarChartCard` | Card element: config, hass, history, scale, SVG render, more-info |
| `OneToFourBarChartEditor` | Shadow-DOM form editor, config-changed events |
| Bound resolvers | Number / entity / Jinja for `min_value`, `max_value`, `warn_above`, `warn_below` |
| `getMinMaxValues` | Scale + bound line positions |
| `_barSegments` | Split bar into solid + warning-stripe segments |
| `formatNumber` | Shared decimal formatting |
| `_barFill` / `_gradientDef` | Solid vs gradient fills, ± colours |
| Colour options | `upper_bound_color`, `lower_bound_color`, `warn_above_color`, `warn_below_color`, `y_label_color` applied to lines and labels |

---

## Requirements

- Home Assistant with Lovelace  
- For **24h history scale**: Recorder (or equivalent history) for the selected entities  
- For **Jinja** min/max/warnings: standard HA template engine (frontend WebSocket)  
- Modern browser with ES module support  

---

## License / usage

Provide and maintain this file as part of your own HA config or share it as you prefer. No external npm package is required; it is a single self-contained module.
