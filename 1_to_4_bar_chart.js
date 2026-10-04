// Register card with Home Assistant UI Card Picker
window.customCards = window.customCards || [];
if (!window.customCards.some(card => card.type === "one-to-four-bar-chart")) {
  window.customCards.push({
    type: "one-to-four-bar-chart",
    name: "1 to 4 Bar Chart",
    description: "A custom multi-entity vertical bar chart card with GUI config flow editor.",
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
  }

  // Mandatory static method for HA Editor link
  static getConfigElement() {
    return document.createElement('one-to-four-bar-chart-editor');
  }

  // Mandatory static method for HA Default Stub Config
  static getStubConfig() {
    return {
      title: "Bar Chart Comparison",
      entities: [
        { entity: "sensor.temperature", name: "Temp 1", color: "#3B82F6", unit: "", factor: 1 },
        { entity: "sensor.temperature_2", name: "Temp 2", color: "#10B981", unit: "", factor: 1 }
      ],
      value_label_position: "top", // top, bottom, both, none
      value_label_trigger: "always", // always, hover, tap
      scale_mode: "auto", // auto, fixed, history_24h
      min_value: 0,
      max_value: 100,
      show_zero_line: true,
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

    // Fetch history if needed
    if (this._config.scale_mode === 'history_24h' && (!oldHass || this.shouldFetchHistory(oldHass, hass))) {
      this.fetch24hHistory();
    }

    this.render();
  }

  setConfig(config) {
    if (!config.entities || !Array.isArray(config.entities)) {
      throw new Error("Please define entities array");
    }
    this._config = {
      title: "Bar Chart",
      entities: [],
      value_label_position: "top",
      value_label_trigger: "always",
      scale_mode: "auto",
      min_value: 0,
      max_value: 100,
      show_zero_line: true,
      background_type: "solid",
      bg_color: "var(--ha-card-background, #1c1c1e)",
      bg_gradient_start: "#1f2937",
      bg_gradient_end: "#111827",
      bg_image_url: "",
      bg_image_fit: "cover",
      bg_opacity: 0.2,
      ...config
    };
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

  getMinMaxValues(barValues, entityFactors = {}) {
    let min = 0;
    let max = 100;

    if (this._config.scale_mode === 'fixed') {
      min = Number(this._config.min_value ?? 0);
      max = Number(this._config.max_value ?? 100);
    } else if (this._config.scale_mode === 'history_24h' && Object.keys(this._historyData).length > 0) {
      let allHistVals = [];
      Object.entries(this._historyData).forEach(([entityId, entries]) => {
        const factor = entityFactors[entityId] ?? 1;
        entries.forEach(entry => {
          const val = parseFloat(entry.s);
          if (!isNaN(val)) allHistVals.push(val * factor);
        });
      });
      if (allHistVals.length > 0) {
        min = Math.min(...allHistVals, ...barValues);
        max = Math.max(...allHistVals, ...barValues);
      } else {
        min = Math.min(...barValues, 0);
        max = Math.max(...barValues, 10);
      }
    } else {
      // Auto mode based on current values
      if (barValues.length > 0) {
        const valMin = Math.min(...barValues);
        const valMax = Math.max(...barValues);
        min = valMin < 0 ? valMin * 1.1 : 0;
        max = valMax > 0 ? valMax * 1.15 : 10;
      }
    }

    if (min === max) {
      max = min + 10;
    }

    return { min, max };
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

      return { val, unit, name, color, entityId, stateObj, factor };
    });

    const values = barData.map(d => d.val);
    const { min, max } = this.getMinMaxValues(values, entityFactors);

    // Dynamic background styles
    let bgStyle = "";
    if (this._config.background_type === "gradient") {
      bgStyle = `background: linear-gradient(135deg, ${this._config.bg_gradient_start}, ${this._config.bg_gradient_end});`;
    } else if (this._config.background_type === "image" && this._config.bg_image_url) {
      bgStyle = `background-image: url('${this._config.bg_image_url}'); background-size: ${this._config.bg_image_fit}; background-position: center;`;
    } else {
      bgStyle = `background: ${this._config.bg_color};`;
    }

    // Chart Dimensions
    const svgWidth = 400;
    const svgHeight = 220;
    const padding = { top: 30, bottom: 40, left: 35, right: 20 };
    const chartW = svgWidth - padding.left - padding.right;
    const chartH = svgHeight - padding.top - padding.bottom;

    // Zero Line calculation
    const zeroY = padding.top + chartH - ((0 - min) / (max - min)) * chartH;
    const hasZeroLine = this._config.show_zero_line && min < 0 && max > 0;

    // Render SVG Bars
    const numBars = barData.length;
    const slotW = chartW / Math.max(numBars, 1);
    const barW = Math.min(slotW * 0.55, 45);

    const barsSVG = barData.map((d, i) => {
      const centerX = padding.left + slotW * i + slotW / 2;
      const x = centerX - barW / 2;

      // Height logic relative to baseline or zero
      const baselineVal = (min < 0 && max > 0) ? 0 : (min >= 0 ? min : max);
      const baseY = padding.top + chartH - ((baselineVal - min) / (max - min)) * chartH;
      const targetY = padding.top + chartH - ((d.val - min) / (max - min)) * chartH;

      const y = Math.min(baseY, targetY);
      const h = Math.max(Math.abs(baseY - targetY), 4); // Min 4px height visibility

      const posSetting = this._config.value_label_position;
      const triggerSetting = this._config.value_label_trigger;

      const showTop = posSetting === 'top' || posSetting === 'both';
      const showBottom = posSetting === 'bottom' || posSetting === 'both';

      const triggerClass = triggerSetting === 'hover' ? 'show-hover' : (triggerSetting === 'tap' ? 'show-tap' : 'show-always');

      return `
        <g class="bar-group ${triggerClass}" tabindex="0">
          <!-- Background interactive slot area -->
          <rect x="${padding.left + slotW * i}" y="${padding.top}" width="${slotW}" height="${chartH}" fill="transparent" />

          <!-- Bar Rect -->
          <rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="4" ry="4" fill="${d.color}" class="bar-rect" />

          <!-- Top Label -->
          ${showTop ? `
            <text x="${centerX}" y="${y - 8}" text-anchor="middle" class="val-label top-label">
              ${d.val}${d.unit ? ' ' + d.unit : ''}
            </text>
          ` : ''}

          <!-- Bottom Label -->
          ${showBottom ? `
            <text x="${centerX}" y="${y + h + 16}" text-anchor="middle" class="val-label bottom-label">
              ${d.val}${d.unit ? ' ' + d.unit : ''}
            </text>
          ` : ''}

          <!-- X-Axis Label -->
          <text x="${centerX}" y="${svgHeight - 12}" text-anchor="middle" class="axis-label">
            ${d.name}
          </text>
        </g>
      `;
    }).join('');

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
        .card-title {
          font-size: 1.1rem;
          font-weight: 600;
          margin-bottom: 12px;
          color: var(--primary-text-color, #ffffff);
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        svg {
          width: 100%;
          height: auto;
          overflow: visible;
        }
        .zero-line {
          stroke: rgba(255, 255, 255, 0.35);
          stroke-dasharray: 4,4;
          stroke-width: 1.5;
        }
        .axis-label {
          fill: var(--secondary-text-color, #9ca3af);
          font-size: 11px;
          font-weight: 500;
        }
        .val-label {
          fill: var(--primary-text-color, #ffffff);
          font-size: 11px;
          font-weight: 700;
          transition: opacity 0.2s ease-in-out;
        }
        .bar-rect {
          transition: height 0.4s ease, y 0.4s ease, filter 0.2s ease;
        }
        .bar-group:hover .bar-rect, .bar-group:focus .bar-rect {
          filter: brightness(1.2);
          cursor: pointer;
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
          ${this._config.title ? `<div class="card-title">${this._config.title}</div>` : ''}
          <svg viewBox="0 0 ${svgWidth} ${svgHeight}">
            ${hasZeroLine ? `<line x1="${padding.left}" y1="${zeroY}" x2="${svgWidth - padding.right}" y2="${zeroY}" class="zero-line" />` : ''}
            ${barsSVG}
          </svg>
        </div>
      </ha-card>
    `;
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
    // Force-load HA editor components so ha-entity-picker becomes available
    try {
      if (!customElements.get('ha-entity-picker')) {
        const entitiesCard = customElements.get('hui-entities-card');
        if (entitiesCard && entitiesCard.getConfigElement) {
          await entitiesCard.getConfigElement();
        }
      }
      // Extra safety: wait a tick for the element to register
      await customElements.whenDefined('ha-entity-picker').catch(() => {});
    } catch (e) {
      console.warn('Could not pre-load ha-entity-picker', e);
    }
    this._helpersLoaded = true;
  }

  _handleFieldChange(ev) {
    if (!this._config) return;
    const target = ev.target;
    const field = target.dataset.field;
    const index = target.dataset.index;

    // For ha-entity-picker the value lives on .value
    let value;
    if (target.tagName === 'HA-ENTITY-PICKER') {
      value = target.value;
    } else if (target.type === 'checkbox') {
      value = target.checked;
    } else if (target.type === 'number') {
      value = target.value === '' ? null : Number(target.value);
    } else {
      value = target.value;
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

    // Root selects / checkboxes / numbers
    this.shadowRoot.querySelectorAll('[data-field]:not([data-index])').forEach((el) => {
      const field = el.dataset.field;
      if (field === 'title') return;
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
      ['name', 'color', 'unit', 'factor'].forEach((f) => {
        const input = this.shadowRoot.querySelector(`[data-field="${f}"][data-index="${idx}"]`);
        if (input) {
          const expected = f === 'factor' ? (item[f] ?? 1) : (item[f] ?? '');
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
        ha-entity-picker {
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
                <label>Color</label>
                <input type="color" data-field="color" data-index="${idx}" value="${item.color || '#3B82F6'}" />
              </div>
              <div class="field">
                <label>Custom Unit</label>
                <input type="text" data-field="unit" data-index="${idx}" value="${this._escape(item.unit || '')}" placeholder="Auto" />
              </div>
            </div>
            <div class="row">
              <div class="field">
                <label>Factor (multiplier)</label>
                <input type="number" step="any" data-field="factor" data-index="${idx}" value="${item.factor ?? 1}" title="e.g. 0.001 for W→kW, 1000 for kW→W" />
              </div>
            </div>
          </div>
        `).join('')}

        ${entities.length < 4 ? `<button type="button" id="add-btn">+ Add Entity</button>` : ''}

        <!-- Display Options -->
        <div class="section-title">Label & Scale Options</div>
        <div class="row">
          <div class="field">
            <label>Value Label Position</label>
            <select data-field="value_label_position">
              <option value="top" ${this._config.value_label_position === 'top' ? 'selected' : ''}>Top</option>
              <option value="bottom" ${this._config.value_label_position === 'bottom' ? 'selected' : ''}>Bottom</option>
              <option value="both" ${this._config.value_label_position === 'both' ? 'selected' : ''}>Both</option>
              <option value="none" ${this._config.value_label_position === 'none' ? 'selected' : ''}>None</option>
            </select>
          </div>
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
          ${this._config.scale_mode === 'fixed' ? `
            <div class="field">
              <label>Min</label>
              <input type="number" data-field="min_value" value="${this._config.min_value ?? 0}" />
            </div>
            <div class="field">
              <label>Max</label>
              <input type="number" data-field="max_value" value="${this._config.max_value ?? 100}" />
            </div>
          ` : ''}
        </div>

        <div class="row">
          <label class="row" style="cursor: pointer;">
            <input type="checkbox" data-field="show_zero_line" ${this._config.show_zero_line ? 'checked' : ''} />
            Show Zero Line (if min &lt; 0 &lt; max)
          </label>
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
