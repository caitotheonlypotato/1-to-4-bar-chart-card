// Register card with Home Assistant UI Card Picker
window.customCards = window.customCards || [];
if (!window.customCards.some(card => card.type === "one-to-four-bar-chart")) {
  window.customCards.push({
    type: "one-to-four-bar-chart",
    name: "1 to 4 Bar Chart",
    description: "A custom multi-entity bar chart card (vertical or horizontal) with GUI config editor.",
    preview: true,
  });
}

class OneToFourBarChartCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = {};
    this._hass = null;
    this._historyData = {};
    this._fetchedHistory = false;
    // Resolved numeric min/max (from number, entity_id, or Jinja template)
    this._resolvedMin = null;
    this._resolvedMax = null;
    this._boundUnsubs = [];
    this._boundSourceKey = '';
    // One-time delegation — survives full SVG re-renders
    this.shadowRoot.addEventListener('click', (ev) => this._onBarActivate(ev));
    this.shadowRoot.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') this._onBarActivate(ev);
    });
  }

  disconnectedCallback() {
    this._clearBoundSubscriptions();
  }

  // Mandatory static method for HA Editor link
  static getConfigElement() {
    return document.createElement('one-to-four-bar-chart-editor');
  }

  // Mandatory static method for HA Default Stub Config
  static getStubConfig() {
    return {
      title: "Bar Chart Comparison",
      icon: "",
      entities: [
        { entity: "sensor.temperature", name: "Temp 1", color: "#3B82F6", color_negative: "", color_mode: "solid", color_end: "", color_end_negative: "", unit: "", factor: 1 },
        { entity: "sensor.temperature_2", name: "Temp 2", color: "#10B981", color_negative: "", color_mode: "solid", color_end: "", color_end_negative: "", unit: "", factor: 1 }
      ],
      orientation: "vertical", // vertical | horizontal
      value_label_position: "top", // top, bottom, both, none
      value_label_trigger: "always", // always, hover, tap
      decimals: 1, // decimal places for value + bound labels
      scale_mode: "auto", // auto, fixed, history_24h
      min_value: null, // fixed scale limit OR optional lower bound override (auto/24h)
      max_value: null, // fixed scale limit OR optional upper bound override (auto/24h)
      show_zero_line: true,
      show_upper_bound: false,
      show_lower_bound: false,
      label_upper_bound: false,
      label_lower_bound: false,
      show_y_labels: false,
      y_label_above: "",
      y_label_below: "",
      height_scale: 1,
      background_type: "solid", // solid, gradient, image
      bg_color: "var(--ha-card-background, #1c1c1e)",
      bg_gradient_start: "#1f2937",
      bg_gradient_end: "#111827",
      bg_image_url: "",
      bg_image_fit: "cover", // cover, contain, fill, center
      bg_opacity: 0.2
    };
  }

  set hass(hass) {
    const oldHass = this._hass;
    this._hass = hass;

    // Fetch history if needed (will render when data arrives)
    if (this._config.scale_mode === 'history_24h' && (!oldHass || this.shouldFetchHistory(oldHass, hass))) {
      this.fetch24hHistory();
    }

    // Keep entity-based min/max in sync; templates update via subscription
    this._syncEntityBounds();

    // (Re)subscribe templates when hass first arrives
    if (!oldHass && hass) {
      this._setupBoundResolvers();
    }

    // Skip full DOM rebuild if none of our watched states changed
    if (!this._entityStatesChanged(oldHass, hass)) {
      return;
    }

    this.render();
  }

  _entityStatesChanged(oldHass, newHass) {
    if (!oldHass || !this._config) return true;
    const ids = [];
    for (const item of this._config.entities || []) {
      if (item.entity) ids.push(item.entity);
    }
    // Also watch entity_ids used as min/max bounds
    for (const key of ['min_value', 'max_value']) {
      const v = this._config[key];
      if (v != null && this._isEntityId(String(v))) ids.push(String(v).trim());
    }
    for (const id of ids) {
      const a = oldHass.states[id];
      const b = newHass.states[id];
      if (!a && !b) continue;
      if (!a || !b) return true;
      if (a.state !== b.state) return true;
    }
    return false;
  }

  setConfig(config) {
    if (!config.entities || !Array.isArray(config.entities)) {
      throw new Error("Please define entities array");
    }
    this._config = {
      title: "Bar Chart",
      icon: "",
      entities: [],
      orientation: "vertical",
      value_label_position: "top",
      value_label_trigger: "always",
      decimals: 1,
      scale_mode: "auto",
      min_value: null,
      max_value: null,
      show_zero_line: true,
      show_upper_bound: false,
      show_lower_bound: false,
      label_upper_bound: false,
      label_lower_bound: false,
      show_y_labels: false,
      y_label_above: "",
      y_label_below: "",
      height_scale: 1,
      background_type: "solid",
      bg_color: "var(--ha-card-background, #1c1c1e)",
      bg_gradient_start: "#1f2937",
      bg_gradient_end: "#111827",
      bg_image_url: "",
      bg_image_fit: "cover",
      bg_opacity: 0.2,
      ...config
    };
    // (Re)fetch 24h history when that scale mode is active
    if (this._config.scale_mode === 'history_24h' && this._hass) {
      this._fetchedHistory = false;
      this.fetch24hHistory();
    }
    this._setupBoundResolvers();
    this.render();
  }

  shouldFetchHistory(oldHass, newHass) {
    if (!this._fetchedHistory) return true;
    // Refresh history if state changes occur
    for (const item of this._config.entities) {
      if (item.entity && oldHass.states[item.entity] !== newHass.states[item.entity]) {
        return true;
      }
    }
    return false;
  }

  async fetch24hHistory() {
    if (!this._hass || !this._config.entities) return;
    const entityIds = this._config.entities.map(e => e.entity).filter(Boolean);
    if (entityIds.length === 0) return;

    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - 24 * 60 * 60 * 1000);

    try {
      const history = await this._hass.callWS({
        type: 'history/history_during_period',
        start_time: startTime.toISOString(),
        end_time: endTime.toISOString(),
        entity_ids: entityIds,
        include_start_time_state: true,
        no_attributes: true
      });

      this._historyData = history;
      this._fetchedHistory = true;
      this.render();
    } catch (err) {
      console.warn("Failed to fetch history for 1-to-4-bar-chart:", err);
    }
  }

  /** True if config has a non-empty min/max expression (number, entity, or template) */
  _hasBoundConfig(v) {
    return v !== null && v !== undefined && String(v).trim() !== '';
  }

  _isTemplate(v) {
    const s = String(v);
    return s.includes('{{') || s.includes('{%');
  }

  _isEntityId(v) {
    return /^[a-z0-9_]+\.[a-z0-9_]+$/i.test(String(v).trim());
  }

  _parseNumericResult(raw) {
    if (raw === null || raw === undefined) return null;
    const n = parseFloat(typeof raw === 'object' && raw !== null && 'result' in raw ? raw.result : raw);
    return Number.isFinite(n) ? n : null;
  }

  _clearBoundSubscriptions() {
    (this._boundUnsubs || []).forEach((unsub) => {
      try {
        if (typeof unsub === 'function') unsub();
      } catch (e) { /* ignore */ }
    });
    this._boundUnsubs = [];
    this._boundSourceKey = '';
  }

  /**
   * Resolve min_value / max_value which may be:
   *  - static number: "100"
   *  - entity_id: "sensor.foo"
   *  - Jinja: "{{ states('sensor.foo') | float }}"
   */
  _setupBoundResolvers() {
    const minRaw = this._config?.min_value;
    const maxRaw = this._config?.max_value;
    const sourceKey = `${minRaw ?? ''}|${maxRaw ?? ''}`;
    // Avoid resubscribing if expressions unchanged and already wired
    if (sourceKey === this._boundSourceKey && this._boundUnsubs.length) {
      this._syncEntityBounds(null, this._hass);
      return;
    }
    this._clearBoundSubscriptions();
    this._boundSourceKey = sourceKey;

    this._resolvedMin = this._resolveBoundSyncFor(minRaw, null);
    this._resolvedMax = this._resolveBoundSyncFor(maxRaw, null);

    if (this._hass) {
      this._subscribeBoundTemplate('min_value', 'min');
      this._subscribeBoundTemplate('max_value', 'max');
    }
  }

  _resolveBoundSyncFor(raw, previous) {
    if (!this._hasBoundConfig(raw)) return null;
    const str = String(raw).trim();
    if (this._isTemplate(str)) return previous; // templates arrive async via subscription
    if (this._isEntityId(str)) {
      if (!this._hass || !this._hass.states[str]) return previous;
      const n = this._parseNumericResult(this._hass.states[str].state);
      return n === null ? previous : n;
    }
    return this._parseNumericResult(str);
  }

  _syncEntityBounds() {
    if (!this._config) return;
    if (!this._isTemplate(String(this._config.min_value ?? ''))) {
      this._resolvedMin = this._resolveBoundSyncFor(this._config.min_value, this._resolvedMin);
    }
    if (!this._isTemplate(String(this._config.max_value ?? ''))) {
      this._resolvedMax = this._resolveBoundSyncFor(this._config.max_value, this._resolvedMax);
    }
  }

  _subscribeBoundTemplate(configKey, which) {
    const raw = this._config[configKey];
    if (!this._hasBoundConfig(raw) || !this._isTemplate(String(raw)) || !this._hass?.connection) {
      return;
    }
    const template = String(raw).trim();
    try {
      const unsubPromise = this._hass.connection.subscribeMessage(
        (msg) => {
          const n = this._parseNumericResult(msg);
          if (which === 'min') this._resolvedMin = n;
          else this._resolvedMax = n;
          this.render();
        },
        { type: 'render_template', template }
      );
      Promise.resolve(unsubPromise).then((unsub) => {
        if (typeof unsub === 'function') this._boundUnsubs.push(unsub);
      }).catch((err) => {
        console.warn('1-to-4-bar-chart: template subscribe failed', configKey, err);
      });
    } catch (err) {
      console.warn('1-to-4-bar-chart: template subscribe error', configKey, err);
    }
  }

  /** Format a number with configured decimals; trim trailing zeros */
  formatNumber(v) {
    const decimals = Math.max(0, Math.min(6, Number(this._config.decimals ?? 1)));
    const n = Number(v);
    if (isNaN(n)) return String(v);
    const fixed = n.toFixed(decimals);
    if (decimals === 0) return fixed;
    return fixed.replace(/\.?0+$/, '');
  }

  /** Resolve bar fill (solid or gradient id) for a series */
  _barFill(d, idx, isHorizontal) {
    const isNeg = d.val < 0;
    const c1 = isNeg ? (d.colorNegative || d.color) : d.color;
    const c2 = isNeg
      ? (d.colorEndNegative || d.colorEnd || c1)
      : (d.colorEnd || c1);
    if (d.colorMode === 'gradient' && c2 && c2 !== c1) {
      return { fill: `url(#bar-grad-${idx})`, c1, c2, isNeg };
    }
    return { fill: c1, c1, c2: c1, isNeg };
  }

  _gradientDef(idx, c1, c2, isHorizontal, isNeg) {
    // Gradient runs from baseline → tip of the bar
    let x1 = 0, y1 = 0, x2 = 0, y2 = 0;
    if (isHorizontal) {
      if (isNeg) { x1 = 1; x2 = 0; }
      else { x1 = 0; x2 = 1; }
    } else {
      if (isNeg) { y1 = 0; y2 = 1; }
      else { y1 = 1; y2 = 0; }
    }
    return `<linearGradient id="bar-grad-${idx}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">
      <stop offset="0%" stop-color="${c1}"/>
      <stop offset="100%" stop-color="${c2}"/>
    </linearGradient>`;
  }

  getMinMaxValues(barValues, entityFactors = {}) {
    let min = 0;
    let max = 100;
    const mode = this._config.scale_mode || 'auto';
    // Resolved from number / entity_id / Jinja
    const resolvedMin = this._resolvedMin;
    const resolvedMax = this._resolvedMax;
    const hasMin = resolvedMin !== null && Number.isFinite(resolvedMin);
    const hasMax = resolvedMax !== null && Number.isFinite(resolvedMax);

    if (mode === 'fixed') {
      min = hasMin ? resolvedMin : 0;
      max = hasMax ? resolvedMax : 100;
    } else if (mode === 'history_24h' && Object.keys(this._historyData).length > 0) {
      let allHistVals = [];
      Object.entries(this._historyData).forEach(([entityId, entries]) => {
        const factor = entityFactors[entityId] ?? 1;
        const list = Array.isArray(entries) ? entries : [];
        list.forEach(entry => {
          if (!entry) return;
          const raw = entry.s !== undefined ? entry.s : entry.state;
          const val = parseFloat(raw);
          if (!isNaN(val)) allHistVals.push(val * factor);
        });
      });
      if (allHistVals.length > 0) {
        min = Math.min(...allHistVals, ...barValues);
        max = Math.max(...allHistVals, ...barValues);
        if (min < 0) min = min * 1.05;
        if (max > 0) max = max * 1.05;
      } else if (barValues.length > 0) {
        min = Math.min(...barValues, 0);
        max = Math.max(...barValues, 10);
      }
    } else {
      // Auto: current values
      if (barValues.length > 0) {
        const valMin = Math.min(...barValues);
        const valMax = Math.max(...barValues);
        min = valMin < 0 ? valMin * 1.1 : 0;
        max = valMax > 0 ? valMax * 1.15 : 10;
      }
    }

    // Optional bound overrides expand auto/24h scale so lines always sit on-plot
    if (mode !== 'fixed') {
      if (this._config.show_upper_bound && hasMax) {
        max = Math.max(max, resolvedMax);
      }
      if (this._config.show_lower_bound && hasMin) {
        min = Math.min(min, resolvedMin);
      }
    }

    if (min === max) {
      max = min + 10;
    }

    // Line positions: explicit override if set, else the scale edge (computed or fixed)
    let upperBound = null;
    let lowerBound = null;
    if (this._config.show_upper_bound) {
      if (mode === 'fixed') {
        upperBound = max;
      } else if (hasMax) {
        upperBound = resolvedMax;
      } else {
        upperBound = max; // peak of auto/history scale
      }
    }
    if (this._config.show_lower_bound) {
      if (mode === 'fixed') {
        lowerBound = min;
      } else if (hasMin) {
        lowerBound = resolvedMin;
      } else {
        lowerBound = min;
      }
    }

    return { min, max, upperBound, lowerBound };
  }

  render() {
    if (!this._config || !this.shadowRoot) return;

    const entitiesConfig = (this._config.entities || []).slice(0, 4);

    // Extract data (apply per-entity factor for unit conversion e.g. W→kW)
    const entityFactors = {};
    const barData = entitiesConfig.map((item, idx) => {
      const entityId = item.entity;
      const stateObj = this._hass && entityId ? this._hass.states[entityId] : null;
      const rawVal = stateObj ? parseFloat(stateObj.state) : NaN;
      const factor = Number(item.factor ?? 1) || 1;
      if (entityId) entityFactors[entityId] = factor;
      const val = isNaN(rawVal) ? 0 : rawVal * factor;
      const unit = item.unit || (stateObj && stateObj.attributes.unit_of_measurement) || "";
      const name = item.name || (stateObj && stateObj.attributes.friendly_name) || entityId || `Bar ${idx + 1}`;
      const color = item.color || ["#3B82F6", "#10B981", "#F59E0B", "#EF4444"][idx];
      const nameColor = item.name_color || "";
      const colorNegative = item.color_negative || "";
      const colorMode = item.color_mode === 'gradient' ? 'gradient' : 'solid';
      const colorEnd = item.color_end || "";
      const colorEndNegative = item.color_end_negative || "";

      return {
        val, unit, name, color, nameColor, entityId, stateObj, factor,
        colorNegative, colorMode, colorEnd, colorEndNegative,
      };
    });

    const values = barData.map(d => d.val);
    const { min, max, upperBound, lowerBound } = this.getMinMaxValues(values, entityFactors);
    // Unit for bound labels: first series custom unit or entity unit
    const boundUnit = (barData[0] && barData[0].unit) ? ` ${barData[0].unit}` : '';

    // Dynamic background styles
    let bgStyle = "";
    if (this._config.background_type === "gradient") {
      bgStyle = `background: linear-gradient(135deg, ${this._config.bg_gradient_start}, ${this._config.bg_gradient_end});`;
    } else if (this._config.background_type === "image" && this._config.bg_image_url) {
      bgStyle = `background-image: url('${this._config.bg_image_url}'); background-size: ${this._config.bg_image_fit}; background-position: center;`;
    } else {
      bgStyle = `background: ${this._config.bg_color};`;
    }

    // Orientation + dimensions
    const isHorizontal = (this._config.orientation || 'vertical') === 'horizontal';
    const heightScale = Math.max(0.5, Math.min(3, Number(this._config.height_scale ?? 1) || 1));
    const svgWidth = 400;
    // Horizontal mode benefits from a bit more height per bar row
    const baseH = isHorizontal ? 200 : 220;
    const svgHeight = Math.round(baseH * heightScale);
    const showYLabels = !!this._config.show_y_labels &&
      (!!this._config.y_label_above || !!this._config.y_label_below);

    const posSetting = this._config.value_label_position || 'top';
    // "top" = outer end of bar; "bottom" = near baseline (both orientations)
    const showOuter = posSetting === 'top' || posSetting === 'both';
    const showInner = posSetting === 'bottom' || posSetting === 'both';

    const crossesZero = min < 0 && max > 0;
    const hasZeroLine = this._config.show_zero_line && crossesZero;
    const range = (max - min) || 1;

    const valFontSize = heightScale < 0.85 ? 9 : 11;
    const axisFontSize = heightScale < 0.85 ? 9 : 11;
    const numBars = barData.length;
    const triggerSetting = this._config.value_label_trigger;
    const triggerClass = triggerSetting === 'hover' ? 'show-hover' : (triggerSetting === 'tap' ? 'show-tap' : 'show-always');

    const formatBound = (v) => `${this.formatNumber(v)}${boundUnit}`;

    let padding, chartW, chartH, refLinesSVG = '', regionLabelsSVG = '', barsSVG = '';
    let gradientDefs = '';

    if (isHorizontal) {
      // --- HORIZONTAL LAYOUT ---
      // Category labels on left; bars grow left↔right; value labels at bar ends; zero line vertical
      const catLabelSpace = 78;
      const valueLabelSpace = showOuter ? 48 : 16;
      const regionLabelSpace = showYLabels ? 18 : 8;
      padding = {
        top: regionLabelSpace + 8,
        bottom: 12,
        left: catLabelSpace,
        right: valueLabelSpace,
      };
      chartW = svgWidth - padding.left - padding.right;
      chartH = Math.max(24, svgHeight - padding.top - padding.bottom);

      const slotH = chartH / Math.max(numBars, 1);
      const barH = Math.min(slotH * 0.55, 36);
      const minBarW = Math.max(2, Math.round(4 * heightScale));
      const labelGap = Math.max(6, Math.round(8 * heightScale));

      const baselineVal = crossesZero ? 0 : (min >= 0 ? min : max);
      const baseX = padding.left + ((baselineVal - min) / range) * chartW;
      const zeroX = padding.left + ((0 - min) / range) * chartW;

      if (hasZeroLine) {
        refLinesSVG += `<line x1="${zeroX}" y1="${padding.top}" x2="${zeroX}" y2="${padding.top + chartH}" class="zero-line" />`;
      }
      if (upperBound !== null && upperBound >= min && upperBound <= max) {
        const ux = padding.left + ((upperBound - min) / range) * chartW;
        refLinesSVG += `<line x1="${ux}" y1="${padding.top}" x2="${ux}" y2="${padding.top + chartH}" class="bound-line" />`;
        if (this._config.label_upper_bound) {
          refLinesSVG += `<text x="${ux}" y="${padding.top - 4}" text-anchor="middle" class="bound-label">${formatBound(upperBound)}</text>`;
        }
      }
      if (lowerBound !== null && lowerBound >= min && lowerBound <= max) {
        const lx = padding.left + ((lowerBound - min) / range) * chartW;
        refLinesSVG += `<line x1="${lx}" y1="${padding.top}" x2="${lx}" y2="${padding.top + chartH}" class="bound-line" />`;
        if (this._config.label_lower_bound) {
          refLinesSVG += `<text x="${lx}" y="${padding.top - 4}" text-anchor="middle" class="bound-label">${formatBound(lowerBound)}</text>`;
        }
      }

      // Region labels (Export / Import) sit above the value axis, upright
      if (showYLabels) {
        const aboveText = this._config.y_label_above || '';
        const belowText = this._config.y_label_below || '';
        const labelY = Math.max(axisFontSize + 2, padding.top - 6);
        if (crossesZero) {
          if (aboveText) {
            const midPos = (zeroX + padding.left + chartW) / 2;
            regionLabelsSVG += `<text x="${midPos}" y="${labelY}" text-anchor="middle" class="y-axis-label">${this._escapeHtml(aboveText)}</text>`;
          }
          if (belowText) {
            const midNeg = (padding.left + zeroX) / 2;
            regionLabelsSVG += `<text x="${midNeg}" y="${labelY}" text-anchor="middle" class="y-axis-label">${this._escapeHtml(belowText)}</text>`;
          }
        } else if (min >= 0 && aboveText) {
          regionLabelsSVG += `<text x="${padding.left + chartW / 2}" y="${labelY}" text-anchor="middle" class="y-axis-label">${this._escapeHtml(aboveText)}</text>`;
        } else if (max <= 0 && belowText) {
          regionLabelsSVG += `<text x="${padding.left + chartW / 2}" y="${labelY}" text-anchor="middle" class="y-axis-label">${this._escapeHtml(belowText)}</text>`;
        } else if (aboveText) {
          regionLabelsSVG += `<text x="${padding.left + chartW / 2}" y="${labelY}" text-anchor="middle" class="y-axis-label">${this._escapeHtml(aboveText)}</text>`;
        }
      }

      barsSVG = barData.map((d, i) => {
        const centerY = padding.top + slotH * i + slotH / 2;
        const y = centerY - barH / 2;
        const targetX = padding.left + ((d.val - min) / range) * chartW;
        const x = Math.min(baseX, targetX);
        const w = Math.max(Math.abs(baseX - targetX), minBarW);

        // Outer = far end of bar; inner = near baseline
        const growsRight = targetX >= baseX;
        let outerX = growsRight ? x + w + labelGap : x - labelGap;
        let outerAnchor = growsRight ? 'start' : 'end';
        let innerX = growsRight ? x - labelGap : x + w + labelGap;
        let innerAnchor = growsRight ? 'end' : 'start';

        // Clamp into viewBox
        const minLX = 4;
        const maxLX = svgWidth - 4;
        outerX = Math.max(minLX, Math.min(maxLX, outerX));
        innerX = Math.max(minLX, Math.min(maxLX, innerX));

        const valText = `${this.formatNumber(d.val)}${d.unit ? ' ' + d.unit : ''}`;
        const fillInfo = this._barFill(d, i, true);
        if (fillInfo.fill.startsWith('url(')) {
          gradientDefs += this._gradientDef(i, fillInfo.c1, fillInfo.c2, true, fillInfo.isNeg);
        }

        return `
          <g class="bar-group ${triggerClass}" tabindex="0" role="button" data-entity="${this._escapeHtml(d.entityId || '')}">
            <rect x="${x}" y="${y}" width="${w}" height="${barH}" rx="4" ry="4" fill="${fillInfo.fill}" class="bar-rect" />
            ${showOuter ? `
              <text x="${outerX}" y="${centerY}" dominant-baseline="middle" text-anchor="${outerAnchor}" class="val-label" font-size="${valFontSize}">${valText}</text>
            ` : ''}
            ${showInner ? `
              <text x="${innerX}" y="${centerY}" dominant-baseline="middle" text-anchor="${innerAnchor}" class="val-label" font-size="${valFontSize}">${valText}</text>
            ` : ''}
            <text x="${padding.left - 8}" y="${centerY}" dominant-baseline="middle" text-anchor="end" class="axis-label" font-size="${axisFontSize}"${d.nameColor ? ` style="fill:${this._escapeHtml(d.nameColor)}"` : ''}>${this._escapeHtml(d.name)}</text>
            <!-- Full-width hit target including left labels -->
            <rect class="bar-hit" x="0" y="${padding.top + slotH * i}" width="${svgWidth}" height="${slotH}" />
          </g>
        `;
      }).join('');
    } else {
      // --- VERTICAL LAYOUT (existing behaviour) ---
      const labelGapTop = Math.max(6, Math.round(10 * heightScale));
      const labelGapBottom = Math.max(8, Math.round(14 * heightScale));
      const axisLabelSpace = Math.max(14, Math.round(18 * Math.min(heightScale, 1)));
      const padTop = Math.max(
        showOuter ? labelGapTop + 12 : 12,
        Math.round(28 * heightScale)
      );
      const padBottom = Math.max(
        axisLabelSpace + (showInner ? labelGapBottom : 0),
        Math.round(36 * heightScale)
      );
      const boundLabelRight = (this._config.label_upper_bound || this._config.label_lower_bound) ? 36 : 0;
      padding = {
        top: padTop,
        bottom: padBottom,
        left: showYLabels ? 52 : 35,
        right: 20 + boundLabelRight,
      };
      chartW = svgWidth - padding.left - padding.right;
      chartH = Math.max(20, svgHeight - padding.top - padding.bottom);

      const zeroY = padding.top + chartH - ((0 - min) / range) * chartH;
      if (hasZeroLine) {
        refLinesSVG += `<line x1="${padding.left}" y1="${zeroY}" x2="${svgWidth - padding.right}" y2="${zeroY}" class="zero-line" />`;
      }
      if (upperBound !== null && upperBound >= min && upperBound <= max) {
        const uy = padding.top + chartH - ((upperBound - min) / range) * chartH;
        refLinesSVG += `<line x1="${padding.left}" y1="${uy}" x2="${svgWidth - padding.right}" y2="${uy}" class="bound-line" />`;
        if (this._config.label_upper_bound) {
          refLinesSVG += `<text x="${svgWidth - padding.right + 4}" y="${uy}" dominant-baseline="middle" text-anchor="start" class="bound-label">${formatBound(upperBound)}</text>`;
        }
      }
      if (lowerBound !== null && lowerBound >= min && lowerBound <= max) {
        const ly = padding.top + chartH - ((lowerBound - min) / range) * chartH;
        refLinesSVG += `<line x1="${padding.left}" y1="${ly}" x2="${svgWidth - padding.right}" y2="${ly}" class="bound-line" />`;
        if (this._config.label_lower_bound) {
          refLinesSVG += `<text x="${svgWidth - padding.right + 4}" y="${ly}" dominant-baseline="middle" text-anchor="start" class="bound-label">${formatBound(lowerBound)}</text>`;
        }
      }

      const slotW = chartW / Math.max(numBars, 1);
      const barW = Math.min(slotW * 0.55, 45);
      const minBarH = Math.max(2, Math.round(4 * heightScale));
      const topLabelMinY = valFontSize + 2;
      const bottomLabelMaxY = svgHeight - axisLabelSpace - 2;

      const baselineVal = crossesZero ? 0 : (min >= 0 ? min : max);
      const baseY = padding.top + chartH - ((baselineVal - min) / range) * chartH;

      barsSVG = barData.map((d, i) => {
        const centerX = padding.left + slotW * i + slotW / 2;
        const x = centerX - barW / 2;
        const targetY = padding.top + chartH - ((d.val - min) / range) * chartH;
        const y = Math.min(baseY, targetY);
        const h = Math.max(Math.abs(baseY - targetY), minBarH);

        let outerLabelY = y - labelGapTop;
        if (outerLabelY < topLabelMinY) outerLabelY = topLabelMinY;

        let innerLabelY = y + h + labelGapBottom;
        if (innerLabelY > bottomLabelMaxY) innerLabelY = bottomLabelMaxY;
        if (showInner && innerLabelY < y + h + 4) {
          innerLabelY = Math.min(y + h + Math.max(4, labelGapBottom * 0.6), bottomLabelMaxY);
        }

        const valText = `${this.formatNumber(d.val)}${d.unit ? ' ' + d.unit : ''}`;
        const fillInfo = this._barFill(d, i, false);
        if (fillInfo.fill.startsWith('url(')) {
          gradientDefs += this._gradientDef(i, fillInfo.c1, fillInfo.c2, false, fillInfo.isNeg);
        }

        return `
          <g class="bar-group ${triggerClass}" tabindex="0" role="button" data-entity="${this._escapeHtml(d.entityId || '')}">
            <rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="4" ry="4" fill="${fillInfo.fill}" class="bar-rect" />
            ${showOuter ? `
              <text x="${centerX}" y="${outerLabelY}" text-anchor="middle" class="val-label" font-size="${valFontSize}">${valText}</text>
            ` : ''}
            ${showInner ? `
              <text x="${centerX}" y="${innerLabelY}" text-anchor="middle" class="val-label" font-size="${valFontSize}">${valText}</text>
            ` : ''}
            <text x="${centerX}" y="${svgHeight - Math.max(4, Math.round(6 * heightScale))}" text-anchor="middle" class="axis-label" font-size="${axisFontSize}"${d.nameColor ? ` style="fill:${this._escapeHtml(d.nameColor)}"` : ''}>
              ${this._escapeHtml(d.name)}
            </text>
            <!-- Full-column hit target including bottom labels -->
            <rect class="bar-hit" x="${padding.left + slotW * i}" y="0" width="${slotW}" height="${svgHeight}" />
          </g>
        `;
      }).join('');

      // Left-side region labels (rotated)
      if (showYLabels) {
        const labelX = 14;
        const aboveText = this._config.y_label_above || '';
        const belowText = this._config.y_label_below || '';
        if (crossesZero) {
          if (aboveText) {
            const midAbove = (padding.top + zeroY) / 2;
            regionLabelsSVG += `
              <text x="${labelX}" y="${midAbove}" text-anchor="middle" class="y-axis-label"
                transform="rotate(-90, ${labelX}, ${midAbove})">${this._escapeHtml(aboveText)}</text>`;
          }
          if (belowText) {
            const midBelow = (zeroY + padding.top + chartH) / 2;
            regionLabelsSVG += `
              <text x="${labelX}" y="${midBelow}" text-anchor="middle" class="y-axis-label"
                transform="rotate(-90, ${labelX}, ${midBelow})">${this._escapeHtml(belowText)}</text>`;
          }
        } else if (min >= 0 && aboveText) {
          const mid = padding.top + chartH / 2;
          regionLabelsSVG += `
            <text x="${labelX}" y="${mid}" text-anchor="middle" class="y-axis-label"
              transform="rotate(-90, ${labelX}, ${mid})">${this._escapeHtml(aboveText)}</text>`;
        } else if (max <= 0 && belowText) {
          const mid = padding.top + chartH / 2;
          regionLabelsSVG += `
            <text x="${labelX}" y="${mid}" text-anchor="middle" class="y-axis-label"
              transform="rotate(-90, ${labelX}, ${mid})">${this._escapeHtml(belowText)}</text>`;
        } else if (aboveText) {
          const mid = padding.top + chartH / 2;
          regionLabelsSVG += `
            <text x="${labelX}" y="${mid}" text-anchor="middle" class="y-axis-label"
              transform="rotate(-90, ${labelX}, ${mid})">${this._escapeHtml(aboveText)}</text>`;
        }
      }
    }

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
        }
        ha-card {
          position: relative;
          overflow: hidden;
          padding: 16px;
          border-radius: var(--ha-card-border-radius, 12px);
          color: var(--primary-text-color, #fff);
          ${bgStyle}
        }
        .bg-overlay {
          position: absolute;
          inset: 0;
          background: rgba(0, 0, 0, ${this._config.bg_opacity ?? 0.2});
          pointer-events: none;
          z-index: 1;
        }
        .content {
          position: relative;
          z-index: 2;
        }
        .card-header {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 6px;
          margin-bottom: 12px;
        }
        .card-title {
          font-size: 1.1rem;
          font-weight: 600;
          color: var(--primary-text-color, #ffffff);
          line-height: 1.3;
        }
        .card-icon {
          --mdc-icon-size: 28px;
          color: var(--primary-text-color, #ffffff);
          opacity: 0.9;
        }
        svg {
          width: 100%;
          height: auto;
          overflow: visible;
        }
        .zero-line, .bound-line {
          stroke: rgba(255, 255, 255, 0.35);
          stroke-dasharray: 4,4;
          stroke-width: 1.5;
        }
        .bound-label {
          fill: var(--secondary-text-color, #9ca3af);
          font-size: ${axisFontSize}px;
          font-weight: 600;
        }
        .axis-label {
          fill: var(--secondary-text-color, #9ca3af);
          font-size: ${axisFontSize}px;
          font-weight: 500;
        }
        .y-axis-label {
          fill: var(--secondary-text-color, #9ca3af);
          font-size: ${axisFontSize}px;
          font-weight: 600;
          letter-spacing: 0.5px;
        }
        .val-label {
          fill: var(--primary-text-color, #ffffff);
          font-size: ${valFontSize}px;
          font-weight: 700;
          transition: opacity 0.2s ease-in-out;
        }
        .bar-rect {
          pointer-events: none;
          transition: height 0.4s ease, width 0.4s ease, y 0.4s ease, x 0.4s ease;
        }
        .val-label, .axis-label {
          pointer-events: none;
        }
        /* Transparent hit layer on top of bar + labels — receives all clicks */
        .bar-hit {
          fill: transparent;
          cursor: pointer;
          pointer-events: all;
        }
        .bar-group:hover .bar-hit, .bar-group:focus .bar-hit {
          fill: rgba(255, 255, 255, 0.06);
        }

        /* Label Triggers */
        .show-always .val-label { opacity: 1; }
        
        .show-hover .val-label { opacity: 0; }
        .show-hover:hover .val-label { opacity: 1; }

        .show-tap .val-label { opacity: 0; }
        .show-tap:focus .val-label, .show-tap:active .val-label { opacity: 1; }
      </style>

      <ha-card>
        ${this._config.background_type === 'image' ? '<div class="bg-overlay"></div>' : ''}
        <div class="content">
          ${(this._config.title || this._config.icon) ? `
            <div class="card-header">
              ${this._config.title ? `<div class="card-title">${this._escapeHtml(this._config.title)}</div>` : ''}
              ${this._config.icon ? `<ha-icon class="card-icon" icon="${this._escapeHtml(this._config.icon)}"></ha-icon>` : ''}
            </div>
          ` : ''}
          <svg viewBox="0 0 ${svgWidth} ${svgHeight}">
            ${gradientDefs ? `<defs>${gradientDefs}</defs>` : ''}
            ${refLinesSVG}
            ${regionLabelsSVG}
            ${barsSVG}
          </svg>
        </div>
      </ha-card>
    `;
  }

  _onBarActivate(ev) {
    // Walk up from target (works for SVG nodes) to find data-entity
    let el = ev.target;
    while (el && el !== this.shadowRoot) {
      if (el.getAttribute) {
        const entityId = el.getAttribute('data-entity');
        if (entityId) {
          ev.preventDefault();
          ev.stopPropagation();
          this._openMoreInfo(entityId);
          return;
        }
      }
      el = el.parentElement || el.parentNode;
    }
  }

  _openMoreInfo(entityId) {
    if (!entityId) return;
    const event = new CustomEvent('hass-more-info', {
      detail: { entityId },
      bubbles: true,
      composed: true,
    });
    this.dispatchEvent(event);
  }

  _escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}

class OneToFourBarChartEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = {};
    this._hass = null;
    this._rendered = false;
    this._lastStructureKey = null;
    this._helpersLoaded = false;
  }

  set hass(hass) {
    this._hass = hass;
    // Only re-render if structure changed or first time; otherwise just update pickers
    if (this._rendered) {
      this._updateEntityPickers();
    } else {
      this.render();
    }
  }

  setConfig(config) {
    const prevEntitiesLen = (this._config.entities || []).length;
    const newEntitiesLen = (config.entities || []).length;
    const structureKey = this._getStructureKey(config);

    this._config = config;

    // Full re-render only when the form structure itself changes
    if (
      !this._rendered ||
      structureKey !== this._lastStructureKey ||
      prevEntitiesLen !== newEntitiesLen
    ) {
      this._lastStructureKey = structureKey;
      this.render();
    } else {
      // Structure same → just sync values into existing inputs (keeps focus)
      this._syncValues();
    }
  }

  _getStructureKey(config) {
    return [
      config.scale_mode || 'auto',
      config.background_type || 'solid',
      config.orientation || 'vertical',
      !!config.show_y_labels,
      (config.entities || []).length,
    ].join('|');
  }

  configChanged(newConfig) {
    const event = new CustomEvent('config-changed', {
      detail: { config: newConfig },
      bubbles: true,
      composed: true,
    });
    this.dispatchEvent(event);
  }

  async _ensureHelpers() {
    if (this._helpersLoaded) return;
    // Force-load HA editor components (entity + icon pickers)
    try {
      if (!customElements.get('ha-entity-picker') || !customElements.get('ha-icon-picker')) {
        const entitiesCard = customElements.get('hui-entities-card');
        if (entitiesCard && entitiesCard.getConfigElement) {
          await entitiesCard.getConfigElement();
        }
        // Button / entity card editors also pull in ha-icon-picker
        const buttonCard = customElements.get('hui-button-card');
        if (buttonCard && buttonCard.getConfigElement) {
          await buttonCard.getConfigElement();
        }
      }
      await Promise.all([
        customElements.whenDefined('ha-entity-picker').catch(() => {}),
        customElements.whenDefined('ha-icon-picker').catch(() => {}),
      ]);
    } catch (e) {
      console.warn('Could not pre-load HA pickers', e);
    }
    this._helpersLoaded = true;
  }

  _handleFieldChange(ev) {
    if (!this._config) return;
    const target = ev.target;
    const field = target.dataset.field;
    const index = target.dataset.index;

    // HA pickers expose .value; native inputs use target.value / checked
    let value;
    if (target.tagName === 'HA-ENTITY-PICKER' || target.tagName === 'HA-ICON-PICKER') {
      value = target.value;
    } else if (target.type === 'checkbox') {
      value = target.checked;
    } else if (target.type === 'number') {
      value = target.value === '' ? null : Number(target.value);
    } else {
      value = target.value;
    }

    // Min/Max: empty → null; keep strings for entity_id / Jinja
    if ((field === 'min_value' || field === 'max_value') && (value === '' || value === null || value === undefined)) {
      value = null;
    }

    const updatedConfig = JSON.parse(JSON.stringify(this._config));

    if (index !== undefined) {
      const idx = parseInt(index, 10);
      updatedConfig.entities = updatedConfig.entities || [];
      if (!updatedConfig.entities[idx]) updatedConfig.entities[idx] = {};
      updatedConfig.entities[idx][field] = value;
    } else {
      updatedConfig[field] = value;
    }

    this.configChanged(updatedConfig);
  }

  _addEntity() {
    const updatedConfig = JSON.parse(JSON.stringify(this._config));
    updatedConfig.entities = updatedConfig.entities || [];
    if (updatedConfig.entities.length < 4) {
      updatedConfig.entities.push({
        entity: '',
        name: `Bar ${updatedConfig.entities.length + 1}`,
        color: ['#3B82F6', '#10B981', '#F59E0B', '#EF4444'][updatedConfig.entities.length],
        color_negative: '',
        color_mode: 'solid',
        color_end: '',
        color_end_negative: '',
        name_color: '',
        unit: '',
        factor: 1,
      });
      this.configChanged(updatedConfig);
    }
  }

  _removeEntity(ev) {
    const idx = parseInt(ev.currentTarget.dataset.index, 10);
    const updatedConfig = JSON.parse(JSON.stringify(this._config));
    updatedConfig.entities.splice(idx, 1);
    this.configChanged(updatedConfig);
  }

  /** Sync current config values into already-rendered inputs without destroying focus */
  _syncValues() {
    if (!this.shadowRoot) return;
    const cfg = this._config;

    // Title
    const titleInput = this.shadowRoot.querySelector('[data-field="title"]');
    if (titleInput && titleInput.value !== (cfg.title || '')) {
      titleInput.value = cfg.title || '';
    }

    // Icon picker
    const iconPicker = this.shadowRoot.querySelector('ha-icon-picker[data-field="icon"]');
    if (iconPicker && iconPicker.value !== (cfg.icon || '')) {
      iconPicker.value = cfg.icon || '';
    }

    // Root selects / checkboxes / numbers (and text fallback for icon)
    this.shadowRoot.querySelectorAll('[data-field]:not([data-index])').forEach((el) => {
      const field = el.dataset.field;
      if (field === 'title') return;
      if (field === 'icon' && el.tagName === 'HA-ICON-PICKER') return;
      const val = cfg[field];
      if (el.type === 'checkbox') {
        el.checked = !!val;
      } else if (el.tagName === 'SELECT' || el.type === 'text' || el.type === 'number' || el.type === 'color') {
        if (String(el.value) !== String(val ?? '')) {
          el.value = val ?? '';
        }
      }
    });

    // Entity-related fields
    (cfg.entities || []).forEach((item, idx) => {
      const entityPicker = this.shadowRoot.querySelector(`ha-entity-picker[data-index="${idx}"]`);
      if (entityPicker && entityPicker.value !== (item.entity || '')) {
        entityPicker.value = item.entity || '';
      }
      ['name', 'color', 'color_negative', 'color_mode', 'color_end', 'color_end_negative', 'name_color', 'unit', 'factor'].forEach((f) => {
        const input = this.shadowRoot.querySelector(`[data-field="${f}"][data-index="${idx}"]`);
        if (input) {
          let expected;
          if (f === 'factor') expected = item[f] ?? 1;
          else if (f === 'name_color') expected = item[f] || '#9ca3af';
          else if (f === 'color_mode') expected = item[f] || 'solid';
          else if (f === 'color_negative' || f === 'color_end' || f === 'color_end_negative') expected = item[f] || '#888888';
          else expected = item[f] ?? '';
          if (String(input.value) !== String(expected)) {
            input.value = expected;
          }
        }
      });
    });
  }

  _updateEntityPickers() {
    if (!this._hass || !this.shadowRoot) return;
    this.shadowRoot.querySelectorAll('ha-entity-picker').forEach((picker) => {
      picker.hass = this._hass;
    });
  }

  async render() {
    if (!this.shadowRoot) return;
    await this._ensureHelpers();

    const entities = this._config.entities || [];
    const hasEntityPicker = !!customElements.get('ha-entity-picker');
    const hasIconPicker = !!customElements.get('ha-icon-picker');

    this.shadowRoot.innerHTML = `
      <style>
        .form {
          display: flex;
          flex-direction: column;
          gap: 14px;
          padding: 8px;
          font-family: var(--paper-font-body1_-_font-family, sans-serif);
          color: var(--primary-text-color, #fff);
        }
        .section-title {
          font-weight: 600;
          font-size: 14px;
          border-bottom: 1px solid var(--divider-color, #374151);
          padding-bottom: 4px;
          margin-top: 8px;
        }
        .row {
          display: flex;
          gap: 10px;
          align-items: center;
        }
        .field {
          display: flex;
          flex-direction: column;
          gap: 4px;
          flex: 1;
        }
        label {
          font-size: 12px;
          color: var(--secondary-text-color, #9ca3af);
        }
        input, select {
          padding: 8px;
          border-radius: 6px;
          border: 1px solid var(--divider-color, #4b5563);
          background: var(--card-background-color, #1f2937);
          color: var(--primary-text-color, #fff);
          font-size: 13px;
          box-sizing: border-box;
          width: 100%;
        }
        input[type="color"] {
          padding: 2px;
          height: 36px;
        }
        button {
          cursor: pointer;
          padding: 8px 12px;
          border-radius: 6px;
          border: none;
          background: var(--primary-color, #2563eb);
          color: white;
          font-weight: 600;
        }
        .btn-danger {
          background: #ef4444;
          padding: 4px 8px;
          font-size: 12px;
        }
        .entity-box {
          border: 1px dashed var(--divider-color, #4b5563);
          padding: 10px;
          border-radius: 8px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        ha-entity-picker,
        ha-icon-picker {
          display: block;
          width: 100%;
        }
      </style>

      <div class="form">
        <!-- Title -->
        <div class="field">
          <label>Card Title</label>
          <input type="text" data-field="title" value="${this._escape(this._config.title || '')}" />
        </div>

        <!-- Icon -->
        <div class="field">
          <label>Card Icon</label>
          ${hasIconPicker
            ? `<ha-icon-picker data-field="icon" label="" placeholder="mdi:chart-bar"></ha-icon-picker>`
            : `<input type="text" data-field="icon" value="${this._escape(this._config.icon || '')}" placeholder="mdi:chart-bar" />`
          }
        </div>

        <!-- Entities Section -->
        <div class="section-title">Entities (Up to 4)</div>
        ${entities.map((item, idx) => `
          <div class="entity-box">
            <div class="row" style="justify-content: space-between;">
              <strong>Bar #${idx + 1}</strong>
              <button type="button" class="btn-danger" data-index="${idx}">Remove</button>
            </div>
            <div class="field">
              <label>Entity</label>
              ${hasEntityPicker
                ? `<ha-entity-picker
                      data-field="entity"
                      data-index="${idx}"
                      allow-custom-entity
                    ></ha-entity-picker>`
                : `<input type="text" data-field="entity" data-index="${idx}"
                      value="${this._escape(item.entity || '')}"
                      placeholder="sensor.my_sensor" />`
              }
            </div>
            <div class="row">
              <div class="field">
                <label>Label</label>
                <input type="text" data-field="name" data-index="${idx}" value="${this._escape(item.name || '')}" />
              </div>
              <div class="field">
                <label>Label color</label>
                <input type="color" data-field="name_color" data-index="${idx}" value="${item.name_color || '#9ca3af'}" title="Series name colour" />
              </div>
              <div class="field">
                <label>Custom Unit</label>
                <input type="text" data-field="unit" data-index="${idx}" value="${this._escape(item.unit || '')}" placeholder="Auto" />
              </div>
              <div class="field">
                <label>Factor</label>
                <input type="number" step="any" data-field="factor" data-index="${idx}" value="${item.factor ?? 1}" title="e.g. 0.001 for W→kW" />
              </div>
            </div>
            <div class="row">
              <div class="field">
                <label>Fill mode</label>
                <select data-field="color_mode" data-index="${idx}">
                  <option value="solid" ${(item.color_mode || 'solid') === 'solid' ? 'selected' : ''}>Solid</option>
                  <option value="gradient" ${item.color_mode === 'gradient' ? 'selected' : ''}>Gradient</option>
                </select>
              </div>
              <div class="field">
                <label>Bar +</label>
                <input type="color" data-field="color" data-index="${idx}" value="${item.color || '#3B82F6'}" title="Positive value colour" />
              </div>
              <div class="field">
                <label>Bar −</label>
                <input type="color" data-field="color_negative" data-index="${idx}" value="${item.color_negative || '#EF4444'}" title="Negative value colour (optional)" />
              </div>
              <div class="field">
                <label>Grad end +</label>
                <input type="color" data-field="color_end" data-index="${idx}" value="${item.color_end || item.color || '#93C5FD'}" title="Gradient end (positive)" />
              </div>
              <div class="field">
                <label>Grad end −</label>
                <input type="color" data-field="color_end_negative" data-index="${idx}" value="${item.color_end_negative || item.color_negative || '#FCA5A5'}" title="Gradient end (negative)" />
              </div>
            </div>
          </div>
        `).join('')}

        ${entities.length < 4 ? `<button type="button" id="add-btn">+ Add Entity</button>` : ''}

        <!-- Display Options -->
        <div class="section-title">Label & Scale Options</div>
        <div class="row">
          <div class="field">
            <label>Orientation</label>
            <select data-field="orientation">
              <option value="vertical" ${(this._config.orientation || 'vertical') === 'vertical' ? 'selected' : ''}>Vertical bars</option>
              <option value="horizontal" ${this._config.orientation === 'horizontal' ? 'selected' : ''}>Horizontal bars</option>
            </select>
          </div>
          <div class="field">
            <label>Value Label Position</label>
            <select data-field="value_label_position">
              <option value="top" ${this._config.value_label_position === 'top' ? 'selected' : ''}>Outer end (top / far)</option>
              <option value="bottom" ${this._config.value_label_position === 'bottom' ? 'selected' : ''}>Near baseline</option>
              <option value="both" ${this._config.value_label_position === 'both' ? 'selected' : ''}>Both</option>
              <option value="none" ${this._config.value_label_position === 'none' ? 'selected' : ''}>None</option>
            </select>
          </div>
        </div>
        <div class="row">
          <div class="field">
            <label>Trigger</label>
            <select data-field="value_label_trigger">
              <option value="always" ${this._config.value_label_trigger === 'always' ? 'selected' : ''}>Always</option>
              <option value="hover" ${this._config.value_label_trigger === 'hover' ? 'selected' : ''}>Hover</option>
              <option value="tap" ${this._config.value_label_trigger === 'tap' ? 'selected' : ''}>Tap</option>
            </select>
          </div>
        </div>

        <div class="row">
          <div class="field">
            <label>Scale Mode</label>
            <select data-field="scale_mode">
              <option value="auto" ${this._config.scale_mode === 'auto' ? 'selected' : ''}>Auto Current</option>
              <option value="fixed" ${this._config.scale_mode === 'fixed' ? 'selected' : ''}>Fixed Bounds</option>
              <option value="history_24h" ${this._config.scale_mode === 'history_24h' ? 'selected' : ''}>24h History Scale</option>
            </select>
          </div>
          <div class="field">
            <label>${this._config.scale_mode === 'fixed' ? 'Min (scale)' : 'Min (optional bound)'}</label>
            <input type="text" data-field="min_value" value="${this._escape(this._config.min_value ?? '')}" placeholder="0 | sensor.x | {{ ... }}" />
          </div>
          <div class="field">
            <label>${this._config.scale_mode === 'fixed' ? 'Max (scale)' : 'Max (optional bound)'}</label>
            <input type="text" data-field="max_value" value="${this._escape(this._config.max_value ?? '')}" placeholder="100 | sensor.x | {{ ... }}" />
          </div>
        </div>
        <div style="font-size:11px;color:var(--secondary-text-color,#9ca3af);margin-top:-6px;">
          Min/Max accept a number, an entity_id, or a Jinja template (e.g. &#123;&#123; states('sensor.cap') | float &#125;&#125;).
        </div>

        <div class="row">
          <label class="row" style="cursor: pointer;">
            <input type="checkbox" data-field="show_zero_line" ${this._config.show_zero_line ? 'checked' : ''} />
            Show Zero Line (if min &lt; 0 &lt; max)
          </label>
        </div>

        <div class="section-title">Reference lines</div>
        <div class="row">
          <label class="row" style="cursor: pointer;">
            <input type="checkbox" data-field="show_upper_bound" ${this._config.show_upper_bound ? 'checked' : ''} />
            Show upper bound line
          </label>
          <label class="row" style="cursor: pointer;">
            <input type="checkbox" data-field="label_upper_bound" ${this._config.label_upper_bound ? 'checked' : ''} />
            Label upper value
          </label>
        </div>
        <div class="row">
          <label class="row" style="cursor: pointer;">
            <input type="checkbox" data-field="show_lower_bound" ${this._config.show_lower_bound ? 'checked' : ''} />
            Show lower bound line
          </label>
          <label class="row" style="cursor: pointer;">
            <input type="checkbox" data-field="label_lower_bound" ${this._config.label_lower_bound ? 'checked' : ''} />
            Label lower value
          </label>
        </div>
        <div style="font-size:11px;color:var(--secondary-text-color,#9ca3af);margin-top:-6px;">
          Fixed: lines use Min/Max. Auto/24h: use Max/Min if set, otherwise the computed scale edge (e.g. 24h peak).
        </div>

        <div class="row">
          <label class="row" style="cursor: pointer;">
            <input type="checkbox" data-field="show_y_labels" ${this._config.show_y_labels ? 'checked' : ''} />
            Show Y-axis labels (left side)
          </label>
        </div>
        ${this._config.show_y_labels ? `
          <div class="row">
            <div class="field">
              <label>Label above zero</label>
              <input type="text" data-field="y_label_above" value="${this._escape(this._config.y_label_above || '')}" placeholder="e.g. Export" />
            </div>
            <div class="field">
              <label>Label below zero</label>
              <input type="text" data-field="y_label_below" value="${this._escape(this._config.y_label_below || '')}" placeholder="e.g. Import" />
            </div>
          </div>
        ` : ''}

        <div class="row">
          <div class="field">
            <label>Height scale (1 = default)</label>
            <input type="number" step="0.1" min="0.5" max="3" data-field="height_scale" value="${this._config.height_scale ?? 1}" title="1 = normal, 1.5 = 50% taller, 0.75 = more compact" />
          </div>
          <div class="field">
            <label>Decimals</label>
            <input type="number" step="1" min="0" max="6" data-field="decimals" value="${this._config.decimals ?? 1}" title="Decimal places for value and bound labels" />
          </div>
        </div>

        <!-- Background Options -->
        <div class="section-title">Background Styling</div>
        <div class="field">
          <label>Background Type</label>
          <select data-field="background_type">
            <option value="solid" ${this._config.background_type === 'solid' ? 'selected' : ''}>Solid Color</option>
            <option value="gradient" ${this._config.background_type === 'gradient' ? 'selected' : ''}>Gradient</option>
            <option value="image" ${this._config.background_type === 'image' ? 'selected' : ''}>Image</option>
          </select>
        </div>

        ${this._config.background_type === 'solid' ? `
          <div class="row">
            <div class="field">
              <label>Background Color</label>
              <input type="color" data-field="bg_color" value="${(this._config.bg_color || '#1c1c1e').startsWith('#') ? this._config.bg_color : '#1c1c1e'}" />
            </div>
            <div class="field">
              <label>Or CSS value / variable</label>
              <input type="text" data-field="bg_color" value="${this._escape(this._config.bg_color || 'var(--ha-card-background, #1c1c1e)')}" placeholder="var(--ha-card-background) or #1c1c1e" />
            </div>
          </div>
        ` : ''}

        ${this._config.background_type === 'gradient' ? `
          <div class="row">
            <div class="field">
              <label>Gradient Start</label>
              <input type="color" data-field="bg_gradient_start" value="${this._config.bg_gradient_start || '#1f2937'}" />
            </div>
            <div class="field">
              <label>Gradient End</label>
              <input type="color" data-field="bg_gradient_end" value="${this._config.bg_gradient_end || '#111827'}" />
            </div>
          </div>
        ` : ''}

        ${this._config.background_type === 'image' ? `
          <div class="field">
            <label>Image URL</label>
            <input type="text" data-field="bg_image_url" value="${this._escape(this._config.bg_image_url || '')}" />
          </div>
          <div class="row">
            <div class="field">
              <label>Fit</label>
              <select data-field="bg_image_fit">
                <option value="cover" ${this._config.bg_image_fit === 'cover' ? 'selected' : ''}>Cover</option>
                <option value="contain" ${this._config.bg_image_fit === 'contain' ? 'selected' : ''}>Contain</option>
                <option value="fill" ${this._config.bg_image_fit === 'fill' ? 'selected' : ''}>Fill</option>
                <option value="center" ${this._config.bg_image_fit === 'center' ? 'selected' : ''}>Center</option>
              </select>
            </div>
            <div class="field">
              <label>Overlay Opacity</label>
              <input type="number" step="0.1" min="0" max="1" data-field="bg_opacity" value="${this._config.bg_opacity ?? 0.2}" />
            </div>
          </div>
        ` : ''}
      </div>
    `;

    // Attach event listeners (only after full render)
    this.shadowRoot.querySelectorAll('input, select').forEach((input) => {
      // Use 'change' so we only push config on blur / selection change → keeps focus while typing
      input.addEventListener('change', (e) => this._handleFieldChange(e));
    });

    // Entity pickers need special handling
    this.shadowRoot.querySelectorAll('ha-entity-picker').forEach((picker) => {
      picker.hass = this._hass;
      const idx = picker.dataset.index;
      const item = entities[idx];
      if (item) picker.value = item.entity || '';
      picker.addEventListener('value-changed', (e) => {
        // ha-entity-picker fires value-changed
        const fakeEv = {
          target: {
            tagName: 'HA-ENTITY-PICKER',
            dataset: { field: 'entity', index: idx },
            value: e.detail?.value ?? picker.value,
          },
        };
        this._handleFieldChange(fakeEv);
      });
    });

    // Icon picker
    this.shadowRoot.querySelectorAll('ha-icon-picker').forEach((picker) => {
      if (this._hass) picker.hass = this._hass;
      picker.value = this._config.icon || '';
      picker.addEventListener('value-changed', (e) => {
        const fakeEv = {
          target: {
            tagName: 'HA-ICON-PICKER',
            dataset: { field: 'icon' },
            value: e.detail?.value ?? picker.value,
          },
        };
        this._handleFieldChange(fakeEv);
      });
    });

    this.shadowRoot.querySelectorAll('.btn-danger').forEach((btn) => {
      btn.addEventListener('click', (e) => this._removeEntity(e));
    });

    const addBtn = this.shadowRoot.querySelector('#add-btn');
    if (addBtn) {
      addBtn.addEventListener('click', () => this._addEntity());
    }

    this._rendered = true;
  }

  _escape(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}

// Define Web Components
customElements.define('one-to-four-bar-chart', OneToFourBarChartCard);
customElements.define('one-to-four-bar-chart-editor', OneToFourBarChartEditor);
