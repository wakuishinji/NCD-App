(function(){
  const DEFAULT_API_BASE = "https://ncd-app.altry.workers.dev";

  function resolveApiBase() {
    if (typeof window !== 'undefined' && typeof window.API_BASE_OVERRIDE === 'string') {
      const override = window.API_BASE_OVERRIDE.trim();
      if (override) {
        return override.replace(/\/$/, '');
      }
    }
    try {
      const stored = localStorage.getItem('ncdApiBase') || localStorage.getItem('ncdApiBaseUrl');
      if (typeof stored === 'string' && stored.trim()) {
        return stored.trim().replace(/\/$/, '');
      }
    } catch (_) {}
    return DEFAULT_API_BASE;
  }

  const API_BASE = resolveApiBase();
  window.NCD_API_BASE = API_BASE;

  function apiUrl(path) {
    const normalized = path.startsWith('/') ? path : `/${path}`;
    return API_BASE ? `${API_BASE}${normalized}` : normalized;
  }

  const PERSONAL_CLASSIFICATIONS = ["医師", "看護", "コメディカル", "事務", "その他"];
  const EXPLANATION_STATUS_OPTIONS = ['draft', 'published', 'archived'];

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function normalizeString(value) {
    const trimmed = (value ?? '').trim();
    return trimmed.length ? trimmed : '';
  }

  function debounce(fn, delay = 250) {
    let timer = null;
    return function debounced(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  function parseCsv(text) {
    const rows = [];
    let current = [];
    let field = '';
    let inQuotes = false;
    let i = 0;
    while (i < text.length) {
      const char = text[i];
      if (inQuotes) {
        if (char === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          }
          inQuotes = false;
          i += 1;
          continue;
        }
        field += char;
        i += 1;
        continue;
      }
      if (char === '"') {
        inQuotes = true;
        i += 1;
        continue;
      }
      if (char === ',') {
        current.push(field);
        field = '';
        i += 1;
        continue;
      }
      if (char === '\n') {
        current.push(field);
        rows.push(current);
        current = [];
        field = '';
        i += 1;
        if (text[i] === '\r') i += 1;
        continue;
      }
      if (char === '\r') {
        current.push(field);
        rows.push(current);
        current = [];
        field = '';
        i += 1;
        if (text[i] === '\n') i += 1;
        continue;
      }
      field += char;
      i += 1;
    }
    current.push(field);
    rows.push(current);
    return rows.filter(row => row.length);
  }

  const STATUS_CLASS_MAP = {
    approved: ['bg-green-50', 'text-green-700', 'border-green-300'],
    candidate: ['bg-amber-50', 'text-amber-700', 'border-amber-300'],
    archived: ['bg-gray-100', 'text-gray-600', 'border-gray-300']
  };

  function applyStatusAppearance(select) {
    if (!select) return;
    const allClasses = Object.values(STATUS_CLASS_MAP).flat();
    select.classList.remove(...allClasses);
    const classes = STATUS_CLASS_MAP[select.value];
    if (classes) {
      select.classList.add(...classes);
    }
  }

  function bindStatusAppearance(select) {
    if (!select) return;
    applyStatusAppearance(select);
    select.addEventListener('change', () => applyStatusAppearance(select));
  }

  class MasterPage {
    constructor(config) {
      this.config = config;
      this.type = config.type;
      this.categoryType = config.categoryType || this.type;
      this.elements = config.elements;
      this.showCategory = config.showCategory !== false;
      this.defaultCategory = typeof config.defaultCategory === 'string' ? config.defaultCategory : '';
      this.enableCategoryFilter = this.showCategory && Boolean(config.enableCategoryFilter);
      this.enableCsvImport = Boolean(config.enableCsvImport);
      this.showDescription = config.showDescription !== false;
      this.showClassification = Boolean(config.showClassification);
      this.showNotes = Boolean(config.showNotes);
      this.manualAdd = Boolean(config.enableManualAdd);
      this.allowFreeCategory = this.showCategory && (config.allowFreeCategory !== undefined ? Boolean(config.allowFreeCategory) : true);
      this.notesProp = config.notesProp || 'notes';
      this.notesLabel = config.notesLabel || '備考';
      this.notesPlaceholder = config.notesPlaceholder || '備考を入力';
      this.notesDatalistId = config.notesDatalistId || null;
      this.enableNotesFilter = Boolean(config.enableNotesFilter);
      this.useStaticCategoryOptions = this.showCategory && Array.isArray(config.categoryOptions) && config.categoryOptions.length > 0;
      this.categoryOptions = this.useStaticCategoryOptions ? Array.from(new Set(config.categoryOptions)) : [];
      this.notesOptions = Array.isArray(config.notesOptions) ? Array.from(new Set(config.notesOptions.filter(Boolean))) : [];
      this.allowFreeNotes = config.allowFreeNotes !== undefined ? Boolean(config.allowFreeNotes) : true;
      this.autoCollectNotesOptions = config.autoCollectNotesOptions !== false;
      this.groupBy = config.groupBy || (this.enableCategoryFilter ? 'category' : 'none');
      this.cache = null;
      this.inFlight = null;
      this.currentItems = [];
      this.bindHandlers();
    }

    bindHandlers() {
      const {
        reloadButton,
        statusSelect,
        searchInput,
        categorySelect,
        notesFilter,
        csvButton,
        csvInput,
        addForm,
        addCategory,
        addCategoryManual,
        addStatus,
        addNotes,
        addNotesManual
      } = this.elements;
      if (reloadButton) reloadButton.addEventListener('click', () => this.reload({ force: true }));
      if (statusSelect) statusSelect.addEventListener('change', () => this.reload());
      bindStatusAppearance(statusSelect);
      if (this.showCategory && categorySelect) categorySelect.addEventListener('change', () => this.reload({ skipFetch: true }));
      if (notesFilter) notesFilter.addEventListener('change', () => this.reload({ skipFetch: true }));
      if (searchInput) searchInput.addEventListener('input', debounce(() => this.reload({ skipFetch: true }), 300));
      if (csvButton && csvInput && this.enableCsvImport) {
        csvButton.addEventListener('click', () => csvInput.click());
        csvInput.addEventListener('change', event => {
          const file = event.target.files?.[0];
          if (file) {
            this.importCsv(file);
          }
          csvInput.value = '';
        });
      }
      if (addForm && this.manualAdd) {
        addForm.addEventListener('submit', event => {
          event.preventDefault();
          this.handleAdd();
        });
        if (this.showCategory && addCategory && addCategory.tagName === 'SELECT' && addCategoryManual) {
          addCategory.addEventListener('change', () => {
            if (addCategory.value === '__direct') {
              addCategoryManual.classList.remove('hidden');
            } else {
              addCategoryManual.classList.add('hidden');
            }
          });
        }
        bindStatusAppearance(addStatus);
      }
      if (addNotes && addNotes.tagName === 'SELECT') {
        addNotes.addEventListener('change', () => {
          if (addNotes.value === '__direct') {
            addNotesManual?.classList.remove('hidden');
          } else {
            if (addNotesManual) {
              addNotesManual.classList.add('hidden');
              addNotesManual.value = '';
            }
          }
        });
      } else if (addNotes) {
        if (this.notesPlaceholder) addNotes.setAttribute('placeholder', this.notesPlaceholder);
        if (this.notesDatalistId) addNotes.setAttribute('list', this.notesDatalistId);
      }
    }

    async init() {
      if (this.showCategory) {
        if ((this.enableCategoryFilter || this.manualAdd) && !this.useStaticCategoryOptions) {
          await this.loadCategories();
        } else {
          this.syncCategoryControls();
        }
      }
      if (this.enableNotesFilter || this.manualAdd) {
        this.syncNotesControls();
      }
      await this.reload();
    }

    async withLoading(message, fn) {
      if (typeof window.wrapWithLoading === 'function') {
        return window.wrapWithLoading(fn, message, this.elements.panel);
      }
      const result = await fn();
      return result;
    }

    async loadCategories() {
      if (!this.showCategory) {
        this.categoryOptions = [];
        return;
      }
      if (this.useStaticCategoryOptions) {
        this.syncCategoryControls();
        return;
      }
      try {
        const categoryType = this.categoryType || this.type;
        const res = await fetch(apiUrl(`/api/listCategories?type=${categoryType}`));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        this.categoryOptions = Array.isArray(data.categories) ? data.categories : [];
        this.syncCategoryControls();
      } catch (err) {
        console.error('failed to load categories', err);
        this.categoryOptions = [];
        this.syncCategoryControls();
      }
    }

    syncCategoryControls() {
      if (!this.showCategory) return;
      const { categorySelect } = this.elements;
      if (categorySelect) {
        const current = categorySelect.value;
        categorySelect.innerHTML = '<option value="">全ての分類</option>' + this.categoryOptions.map(opt => `<option value="${escapeHtml(opt)}">${escapeHtml(opt)}</option>`).join('');
        if (this.categoryOptions.includes(current)) {
          categorySelect.value = current;
        }
      }
      if (this.elements.addCategory && this.elements.addCategory.tagName === 'SELECT') {
        const select = this.elements.addCategory;
        const placeholder = this.allowFreeCategory ? '<option value="">（直接入力）</option>' : '<option value="">分類を選択</option>';
        select.innerHTML = placeholder + this.categoryOptions.map(opt => `<option value="${escapeHtml(opt)}">${escapeHtml(opt)}</option>`).join('') + (this.allowFreeCategory ? '<option value="__direct">直接入力</option>' : '');
      }
    }

    syncNotesControls() {
      const { addNotes, addNotesManual, notesFilter } = this.elements;
      const options = this.notesOptions.slice().sort((a, b) => a.localeCompare(b, 'ja'));
      if (addNotes && addNotes.tagName === 'SELECT') {
        const placeholder = '<option value="">医療分野を選択</option>';
        const manualOption = this.allowFreeNotes ? '<option value="__direct">直接入力</option>' : '';
        addNotes.innerHTML = placeholder + options.map(opt => `<option value="${escapeHtml(opt)}">${escapeHtml(opt)}</option>`).join('') + manualOption;
        if (addNotesManual) {
          addNotesManual.classList.add('hidden');
          addNotesManual.value = '';
        }
      } else if (addNotes) {
        if (this.notesPlaceholder) addNotes.setAttribute('placeholder', this.notesPlaceholder);
        if (this.notesDatalistId) addNotes.setAttribute('list', this.notesDatalistId);
      }
      if (notesFilter) {
        const current = notesFilter.value;
        notesFilter.innerHTML = '<option value="">全ての医療分野</option>' + options.map(opt => `<option value="${escapeHtml(opt)}">${escapeHtml(opt)}</option>`).join('');
        if (options.includes(current)) {
          notesFilter.value = current;
        }
      }
    }

    async reload({ force = false, skipFetch = false } = {}) {
      const status = this.elements.statusSelect?.value || '';
      const keywordRaw = this.elements.searchInput?.value || '';
      const keyword = keywordRaw.trim().toLowerCase();
      const categoryFilter = this.showCategory ? (this.elements.categorySelect?.value || '') : '';
      let notesFilterValue = this.elements.notesFilter?.value || '';

      if (!skipFetch || force || !this.cache) {
        await this.withLoading(this.config.loadingMessage || 'マスターを読み込み中...', async () => {
          const controller = new AbortController();
          if (this.inFlight) {
            this.inFlight.abort();
          }
          this.inFlight = controller;
          try {
            const url = new URL(apiUrl('/api/listMaster'), window.location.origin);
            url.searchParams.set('type', this.type);
            if (status) url.searchParams.set('status', status);
            url.searchParams.set('includeSimilar', 'true');
            const res = await fetch(url, { signal: controller.signal });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            this.cache = Array.isArray(data.items) ? data.items : [];
          } finally {
            if (this.inFlight === controller) {
              this.inFlight = null;
            }
          }
        });
      }

      if ((this.showNotes || this.notesProp !== 'notes') && this.autoCollectNotesOptions) {
        const uniqueNotes = new Set(this.notesOptions);
        const sourceItems = Array.isArray(this.cache) ? this.cache : [];
        sourceItems.forEach(item => {
          const value = this.getItemNoteValue(item);
          if (value) uniqueNotes.add(value);
        });
        this.notesOptions = Array.from(uniqueNotes).filter(Boolean).sort((a, b) => a.localeCompare(b, 'ja'));
        if (this.enableNotesFilter || this.manualAdd) {
          this.syncNotesControls();
        }
        notesFilterValue = this.elements.notesFilter?.value || '';
      }

      let items = Array.isArray(this.cache) ? [...this.cache] : [];
      if (this.showCategory && categoryFilter) {
        items = items.filter(item => (item.category || '') === categoryFilter);
      }
      if (notesFilterValue) {
        items = items.filter(item => (this.getItemNoteValue(item) || '') === notesFilterValue);
      }
      if (keyword) {
        items = items.filter(item => {
          const noteValue = this.getItemNoteValue(item);
          const target = `${item.category || ''} ${item.name || ''} ${item.canonical_name || ''} ${item.desc || ''} ${noteValue || ''}`.toLowerCase();
          return target.includes(keyword);
        });
      }
      this.currentItems = items;
      this.renderList();
    }

    buildCategoryInput(item) {
      if (!this.showCategory) return '';
      const category = item.category || '';
      if (!this.categoryOptions.length || this.allowFreeCategory) {
        const selectOptions = this.categoryOptions.map(opt => `<option value="${escapeHtml(opt)}" ${opt === category ? 'selected' : ''}>${escapeHtml(opt)}</option>`).join('');
        const select = this.categoryOptions.length ? `<select class="w-full border rounded px-2 py-1" data-field="category">
          <option value="">分類を選択</option>
          ${selectOptions}
          <option value="__direct">直接入力</option>
        </select>` : '';
        const needsManual = !this.categoryOptions.length || !this.categoryOptions.includes(category);
        const manual = `<input class="w-full border rounded px-2 py-1 mt-2 ${needsManual ? '' : 'hidden'}" data-field="category-manual" placeholder="分類を入力" value="${escapeHtml(category)}">`;
        if (!this.categoryOptions.length) {
          return `<input class="w-full border rounded px-2 py-1" data-field="category" value="${escapeHtml(category)}" placeholder="分類を入力">`;
        }
        return select + manual;
      }

      const options = this.categoryOptions.map(opt => `<option value="${escapeHtml(opt)}" ${opt === category ? 'selected' : ''}>${escapeHtml(opt)}</option>`).join('');
      return `<select class="w-full border rounded px-2 py-1" data-field="category">
        <option value="">分類を選択</option>
        ${options}
      </select>`;
    }

    buildNotesInput(value) {
      const noteValue = value || '';
      const placeholder = escapeHtml(this.notesPlaceholder || '医療分野を入力');
      if (!this.notesOptions.length || this.allowFreeNotes) {
        if (!this.notesOptions.length) {
          return `<input class="w-full border rounded px-2 py-1" data-field="notes" value="${escapeHtml(noteValue)}" placeholder="${placeholder}">`;
        }
        const options = this.notesOptions.map(opt => `<option value="${escapeHtml(opt)}" ${opt === noteValue ? 'selected' : ''}>${escapeHtml(opt)}</option>`).join('');
        const directSelected = noteValue && !this.notesOptions.includes(noteValue) ? ' selected' : '';
        const select = `<select class="w-full border rounded px-2 py-1" data-field="notes">
          <option value="">医療分野を選択</option>
          ${options}
          <option value="__direct"${directSelected}>直接入力</option>
        </select>`;
        const needsManual = !!noteValue && !this.notesOptions.includes(noteValue);
        const manualClasses = ['w-full border rounded px-2 py-1 mt-2', needsManual ? '' : 'hidden'].filter(Boolean).join(' ');
        const manualValue = needsManual ? noteValue : '';
        const manualInput = `<input class="${manualClasses}" data-field="notes-manual" placeholder="${placeholder}" value="${escapeHtml(manualValue)}">`;
        return select + manualInput;
      }

      const options = this.notesOptions.map(opt => `<option value="${escapeHtml(opt)}" ${opt === noteValue ? 'selected' : ''}>${escapeHtml(opt)}</option>`).join('');
      const extra = noteValue && !this.notesOptions.includes(noteValue)
        ? `<option value="${escapeHtml(noteValue)}" selected>${escapeHtml(noteValue)}</option>`
        : '';
      return `<select class="w-full border rounded px-2 py-1" data-field="notes">
        <option value="">医療分野を選択</option>
        ${options}${extra}
      </select>`;
    }

    classificationOptions(current) {
      const options = PERSONAL_CLASSIFICATIONS.map(opt => `<option value="${escapeHtml(opt)}" ${opt === current ? 'selected' : ''}>${escapeHtml(opt)}</option>`).join('');
      let extra = '';
      if (current && !PERSONAL_CLASSIFICATIONS.includes(current)) {
        extra = `<option value="${escapeHtml(current)}" selected>${escapeHtml(current)}</option>`;
      }
      return `<select class="w-full border rounded px-2 py-1" data-field="classification">
        ${options}
        ${extra}
      </select>`;
    }

    renderList() {
      const container = this.elements.list;
      container.innerHTML = '';
      if (!this.currentItems.length) {
        container.innerHTML = '<div class="rounded border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">該当するデータがありません</div>';
        return;
      }

      const fragment = document.createDocumentFragment();
      const groups = new Map();
      this.currentItems.forEach(item => {
        let key = '';
        switch (this.groupBy) {
          case 'category':
            key = item.category || 'その他';
            break;
          case 'notes':
          case 'medicalField':
            key = this.getItemNoteValue(item) || '未分類';
            break;
          default:
            key = '';
        }
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(item);
      });

      const sortedGroups = Array.from(groups.entries()).sort((a, b) => {
        const ga = a[0] || '';
        const gb = b[0] || '';
        return ga.localeCompare(gb, 'ja');
      });

      for (const [group, items] of sortedGroups) {
        const wrapper = document.createElement('section');
        wrapper.className = 'mb-6';
        if (group && group !== 'undefined') {
          const heading = document.createElement('h3');
          heading.className = 'mb-3 text-sm font-semibold text-slate-600';
          heading.textContent = group;
          wrapper.appendChild(heading);
        }

        items.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ja'));

        items.forEach(item => {
          const card = document.createElement('article');
          card.className = 'mb-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm';
          card.dataset.category = item.category || '';
          card.dataset.name = item.name || '';

          const showDesc = this.showDescription || (typeof item.desc === 'string' && item.desc);
          const noteValue = this.getItemNoteValue(item);
          const showNotes = this.showNotes || (typeof noteValue === 'string' && noteValue && noteValue !== item.desc);
          const showClassification = this.showClassification;

          const gridCols = this.type === 'department'
            ? 'md:grid-cols-[2fr,1fr,1fr]'
            : 'md:grid-cols-4';
          const descCols = this.type === 'department'
            ? 'md:col-span-3'
            : 'md:col-span-4';
          const notesCols = this.type === 'department'
            ? 'md:col-span-3'
            : (showDesc ? 'md:col-span-2' : 'md:col-span-4');
          const nameColClass = this.type === 'department'
            ? 'md:col-span-1'
            : (this.showCategory ? 'md:col-span-2 lg:col-span-3' : 'md:col-span-2 lg:col-span-2');

          const notesLabel = escapeHtml(this.notesLabel);

          card.innerHTML = `
            <div class="grid gap-2 ${gridCols} items-start text-sm">
              ${this.showCategory ? `
              <div class="${this.type === 'department' ? 'md:col-span-1' : 'md:col-span-1'}">
                <label class="block text-xs text-slate-500">分類</label>
                ${this.buildCategoryInput(item)}
              </div>` : ''}
              <div class="${nameColClass}">
                <label class="block text-xs text-slate-500">名称</label>
                <input class="w-full border rounded px-2 py-1" data-field="name" value="${escapeHtml(item.name || '')}" placeholder="名称を入力">
              </div>
              ${showClassification ? `
              <div class="md:col-span-1">
                <label class="block text-xs text-slate-500">分類（医師/看護 等）</label>
                ${this.classificationOptions(item.classification || PERSONAL_CLASSIFICATIONS[0])}
              </div>` : ''}
              <div class="${this.type === 'department' ? 'md:col-span-1' : 'md:col-span-1'}">
                <label class="block text-xs text-slate-500">ステータス</label>
                <select class="w-full border rounded px-2 py-1" data-field="status">
                  ${['candidate','approved','archived'].map(s => `<option value="${s}" ${s === (item.status || '') ? 'selected' : ''}>${s}</option>`).join('')}
                </select>
              </div>
              <div class="${this.type === 'department' ? 'hidden' : 'md:col-span-1'}">
                <label class="block text-xs text-slate-500">canonical_name</label>
                <input class="w-full border rounded px-2 py-1" data-field="canonical" value="${escapeHtml(item.canonical_name || '')}" placeholder="正規化名称 (任意)">
              </div>
              ${showDesc ? `
              <div class="${descCols}">
                <label class="block text-xs text-slate-500">説明</label>
                <textarea class="w-full border rounded px-2 py-1 text-sm" rows="2" data-field="desc" placeholder="説明や備考">${escapeHtml(item.desc || '')}</textarea>
              </div>` : ''}
              ${showNotes ? `
              <div class="${notesCols}">
                <label class="block text-xs text-slate-500">${notesLabel}</label>
                ${this.buildNotesInput(noteValue)}
              </div>` : ''}
            </div>
            <div class="mt-3 space-y-3" data-explanation-section></div>
            <div class="mt-2 flex flex-wrap gap-2 text-sm">
              <button class="bg-blue-600 px-3 py-1 font-semibold text-white rounded disabled:opacity-40" data-action="update" disabled>更新</button>
              <button class="bg-red-600 px-3 py-1 font-semibold text-white rounded" data-action="delete">削除</button>
              <span class="ml-auto text-xs text-slate-500">count: ${item.count || 0}</span>
            </div>
            <div class="mt-1 text-xs text-slate-500">sources: ${(item.sources || []).join(', ')}</div>
            <div class="mt-1 space-y-1" data-similar></div>
          `;

          this.renderExplanationSection(card, item);
          this.attachCardHandlers(card, item);
          this.renderSimilar(card, item);
          wrapper.appendChild(card);
        });

        fragment.appendChild(wrapper);
      }

      container.appendChild(fragment);
    }

    renderSimilar(card, item) {
      const container = card.querySelector('[data-similar]');
      container.innerHTML = '';
      if (!Array.isArray(item.similarMatches) || !item.similarMatches.length) return;
      const title = document.createElement('div');
      title.className = 'font-semibold text-xs text-slate-500';
      title.textContent = '類似候補';
      container.appendChild(title);
      item.similarMatches.forEach(match => {
        const row = document.createElement('div');
        row.className = 'rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800';
        row.textContent = `${match.name} (status: ${match.status || '-'}, similarity: ${match.similarity})`;
        container.appendChild(row);
      });
    }

    renderExplanationSection(card, item) {
      const host = card.querySelector('[data-explanation-section]');
      if (!host) return;
      if (!['service', 'test'].includes(this.type)) {
        host.remove();
        return;
      }
      host.innerHTML = '';

      const header = document.createElement('div');
      header.className = 'flex items-center justify-between text-xs text-slate-500';
      header.innerHTML = `
        <span>説明候補 (${Array.isArray(item.explanations) ? item.explanations.length : 0}件)</span>
        <button type="button" class="text-blue-600 hover:text-blue-800" data-action="add-explanation">説明を追加</button>
      `;
      host.appendChild(header);

      const list = document.createElement('div');
      list.className = 'space-y-3';
      list.dataset.explanationList = '1';
      host.appendChild(list);

      const explanations = Array.isArray(item.explanations) ? item.explanations : [];
      if (!explanations.length) {
        const empty = document.createElement('div');
        empty.className = 'rounded border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500';
        empty.dataset.explanationPlaceholder = '1';
        empty.textContent = '登録済みの説明はありません。';
        list.appendChild(empty);
        return;
      }

      explanations.forEach(ex => {
        const row = this.createExplanationRow(ex);
        list.appendChild(row);
      });
    }

    createExplanationRow(explanation = {}) {
      const row = document.createElement('div');
      row.className = 'rounded border border-slate-200 bg-white p-3 shadow-sm space-y-2';
      row.dataset.explanationItem = '1';
      if (explanation.id) row.dataset.explanationId = explanation.id;
      if (Number.isFinite(Number(explanation.createdAt))) {
        row.dataset.createdAt = String(explanation.createdAt);
      }
      if (Number.isFinite(Number(explanation.updatedAt))) {
        row.dataset.updatedAt = String(explanation.updatedAt);
      }

      const textArea = document.createElement('textarea');
      textArea.className = 'w-full border rounded px-2 py-1 text-sm';
      textArea.rows = 3;
      textArea.placeholder = '説明本文を入力';
      textArea.dataset.explanationText = '1';
      textArea.value = explanation.text || '';
      row.appendChild(textArea);

      const metaRow = document.createElement('div');
      metaRow.className = 'flex flex-col gap-2 md:flex-row md:items-center';

      const statusSelect = document.createElement('select');
      statusSelect.className = 'w-full md:w-auto border rounded px-2 py-1 text-sm';
      statusSelect.dataset.explanationStatus = '1';
      EXPLANATION_STATUS_OPTIONS.forEach(option => {
        const opt = document.createElement('option');
        opt.value = option;
        opt.textContent = option;
        if ((explanation.status || 'draft') === option) {
          opt.selected = true;
        }
        statusSelect.appendChild(opt);
      });
      metaRow.appendChild(statusSelect);

      const audienceInput = document.createElement('input');
      audienceInput.type = 'text';
      audienceInput.className = 'w-full md:flex-1 border rounded px-2 py-1 text-sm';
      audienceInput.placeholder = '対象（例: 患者向け）';
      audienceInput.dataset.explanationAudience = '1';
      audienceInput.value = explanation.audience || '';
      metaRow.appendChild(audienceInput);

      const contextInput = document.createElement('input');
      contextInput.type = 'text';
      contextInput.className = 'w-full md:flex-1 border rounded px-2 py-1 text-sm';
      contextInput.placeholder = '用途（例: 説明資料）';
      contextInput.dataset.explanationContext = '1';
      contextInput.value = explanation.context || '';
      metaRow.appendChild(contextInput);

      row.appendChild(metaRow);

      const footer = document.createElement('div');
      footer.className = 'flex flex-wrap items-center justify-between text-xs text-slate-500';
      const timestampPieces = [];
      if (Number.isFinite(Number(explanation.createdAt))) {
        const d = new Date(Number(explanation.createdAt) * 1000);
        if (!Number.isNaN(d.getTime())) {
          timestampPieces.push(`作成: ${d.toLocaleString('ja-JP', { hour12: false })}`);
        }
      }
      if (Number.isFinite(Number(explanation.updatedAt))) {
        const d = new Date(Number(explanation.updatedAt) * 1000);
        if (!Number.isNaN(d.getTime())) {
          timestampPieces.push(`更新: ${d.toLocaleString('ja-JP', { hour12: false })}`);
        }
      }
      footer.innerHTML = `
        <span>${timestampPieces.join(' / ') || ''}</span>
        <button type="button" class="text-red-600 hover:text-red-800" data-action="remove-explanation">削除</button>
      `;
      row.appendChild(footer);

      return row;
    }

    canonicalizeExplanations(list) {
      const normalized = Array.isArray(list) ? list : [];
      return JSON.stringify(normalized.map(entry => ({
        id: entry.id || '',
        text: typeof entry.text === 'string' ? entry.text.trim() : '',
        status: entry.status || 'draft',
        audience: entry.audience || '',
        context: entry.context || ''
      })));
    }

    attachCardHandlers(card, item) {
      const updateBtn = card.querySelector('[data-action="update"]');
      const deleteBtn = card.querySelector('[data-action="delete"]');
      const inputs = Array.from(card.querySelectorAll('[data-field]'));
      const statusSelect = card.querySelector('[data-field="status"]');
      bindStatusAppearance(statusSelect);
      const categorySelect = card.querySelector('[data-field="category"]');
      const categoryManual = card.querySelector('[data-field="category-manual"]');
      const notesManual = card.querySelector('[data-field="notes-manual"]');
      if (categorySelect && categorySelect.tagName === 'SELECT' && categoryManual) {
        if (categorySelect.value === '__direct') {
          categoryManual.classList.remove('hidden');
        }
      }

      const getCurrentCategory = () => {
        const select = card.querySelector('[data-field="category"]');
        const manual = card.querySelector('[data-field="category-manual"]');
        if (!select) {
          return normalizeString(manual ? manual.value : '');
        }
        if (select.tagName === 'SELECT') {
          if (select.value === '__direct') {
            manual?.classList.remove('hidden');
            return normalizeString(manual?.value || '');
          }
          manual?.classList.add('hidden');
          if (select.value) return select.value;
          return normalizeString(manual?.value || '');
        }
        return normalizeString(select.value);
      };

      const original = {
        category: item.category || '',
        name: item.name || '',
        desc: item.desc || '',
        canonical: item.canonical_name || '',
        status: item.status || '',
        classification: item.classification || PERSONAL_CLASSIFICATIONS[0],
        notes: this.getItemNoteValue(item),
        explanationsSignature: this.canonicalizeExplanations(item.explanations)
      };

      const evaluateChanges = () => {
        const current = this.collectCardValues(card, item);
        const keys = ['category', 'name', 'desc', 'canonical', 'status', 'classification', 'notes', 'explanationsSignature'];
        const changed = keys.some(key => (current[key] ?? '') !== (original[key] ?? ''));
        updateBtn.disabled = !changed;
      };

      inputs.forEach(input => {
        const field = input.dataset.field;
        if (field === 'category') {
          input.addEventListener('change', () => {
            if (input.tagName === 'SELECT' && categoryManual) {
              if (input.value === '__direct') {
                categoryManual.classList.remove('hidden');
              } else if (this.categoryOptions.includes(input.value)) {
                categoryManual.classList.add('hidden');
                categoryManual.value = '';
              } else if (!input.value) {
                categoryManual.classList.add('hidden');
                categoryManual.value = '';
              } else {
                categoryManual.classList.remove('hidden');
              }
            }
            evaluateChanges();
          });
        } else if (field === 'notes') {
          const handler = () => {
            if (input.tagName === 'SELECT' && notesManual) {
              if (input.value === '__direct') {
                notesManual.classList.remove('hidden');
              } else if (this.notesOptions.includes(input.value)) {
                notesManual.classList.add('hidden');
                notesManual.value = '';
              } else if (!input.value) {
                notesManual.classList.add('hidden');
                notesManual.value = '';
              } else {
                notesManual.classList.remove('hidden');
              }
            }
            evaluateChanges();
          };
          if (input.tagName === 'SELECT') {
            input.addEventListener('change', handler);
          } else {
            input.addEventListener('input', handler);
          }
        } else if (field === 'status') {
          input.addEventListener('change', () => {
            applyStatusAppearance(input);
            evaluateChanges();
          });
        } else {
          const eventName = input.tagName === 'SELECT' ? 'change' : 'input';
          input.addEventListener(eventName, () => evaluateChanges());
        }
      });

      const explanationSection = card.querySelector('[data-explanation-section]');
      if (explanationSection) {
        explanationSection.addEventListener('input', event => {
          const target = event.target;
          if (target.matches('[data-explanation-text], [data-explanation-audience], [data-explanation-context]')) {
            evaluateChanges();
          }
        });
        explanationSection.addEventListener('change', event => {
          if (event.target.matches('[data-explanation-status]')) {
            evaluateChanges();
          }
        });
        explanationSection.addEventListener('click', event => {
          const addBtn = event.target.closest('[data-action="add-explanation"]');
          if (addBtn) {
            const list = explanationSection.querySelector('[data-explanation-list]');
            if (list) {
              const placeholder = list.querySelector('[data-explanation-placeholder]');
              if (placeholder) placeholder.remove();
              list.appendChild(this.createExplanationRow());
              evaluateChanges();
            }
            event.preventDefault();
            return;
          }
          const removeBtn = event.target.closest('[data-action="remove-explanation"]');
          if (removeBtn) {
            const itemEl = removeBtn.closest('[data-explanation-item]');
            const list = explanationSection.querySelector('[data-explanation-list]');
            if (itemEl) {
              itemEl.remove();
              if (list && !list.querySelector('[data-explanation-item]')) {
                const empty = document.createElement('div');
                empty.className = 'rounded border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500';
                empty.dataset.explanationPlaceholder = '1';
                empty.textContent = '登録済みの説明はありません。';
                list.appendChild(empty);
              }
              evaluateChanges();
            }
            event.preventDefault();
          }
        });
      }

      if (deleteBtn) {
        deleteBtn.addEventListener('click', () => this.handleDelete(item));
      }
      if (updateBtn) {
        updateBtn.addEventListener('click', () => this.handleUpdate(card, item, updateBtn));
      }
    }

    collectCardValues(card, item) {
      const category = this.showCategory ? this.getCardCategory(card) : (item.category || this.defaultCategory || '');
      const name = normalizeString(card.querySelector('[data-field="name"]').value);
      const descField = card.querySelector('[data-field="desc"]');
      const notesField = card.querySelector('[data-field="notes"]');
      const canonical = normalizeString(card.querySelector('[data-field="canonical"]').value);
      const status = card.querySelector('[data-field="status"]').value;
      const classificationEl = card.querySelector('[data-field="classification"]');
      const desc = descField ? descField.value : '';
      let notes = '';
      if (notesField) {
        if (notesField.tagName === 'SELECT') {
          const manual = card.querySelector('[data-field="notes-manual"]');
          if (notesField.value === '__direct') {
            notes = normalizeString(manual?.value || '');
          } else if (notesField.value) {
            notes = normalizeString(notesField.value);
          } else {
            notes = '';
          }
        } else {
          notes = normalizeString(notesField.value);
        }
      } else if (this.notesProp === 'notes') {
        notes = normalizeString(desc);
      }
      const classification = classificationEl ? classificationEl.value : item.classification || '';

      const explanationRows = Array.from(card.querySelectorAll('[data-explanation-item]'));
      const explanationRaw = explanationRows.map(row => {
        const text = row.querySelector('[data-explanation-text]')?.value ?? '';
        const status = row.querySelector('[data-explanation-status]')?.value ?? 'draft';
        const audience = row.querySelector('[data-explanation-audience]')?.value ?? '';
        const context = row.querySelector('[data-explanation-context]')?.value ?? '';
        const createdAt = Number(row.dataset.createdAt);
        const updatedAt = Number(row.dataset.updatedAt);
        return {
          id: row.dataset.explanationId || undefined,
          text: text,
          status,
          audience,
          context,
          createdAt: Number.isFinite(createdAt) ? createdAt : undefined,
          updatedAt: Number.isFinite(updatedAt) ? updatedAt : undefined,
        };
      });
      const explanations = explanationRaw
        .map(entry => ({
          ...entry,
          text: entry.text.trim(),
          audience: typeof entry.audience === 'string' ? entry.audience.trim() : '',
          context: typeof entry.context === 'string' ? entry.context.trim() : '',
        }))
        .filter(entry => entry.text);
      const explanationsSignature = this.canonicalizeExplanations(explanationRaw);

      return {
        category,
        name,
        desc,
        canonical,
        status,
        classification,
        notes,
        explanations,
        explanationsSignature
      };
    }

    getCardCategory(card) {
      if (!this.showCategory) {
        return this.defaultCategory;
      }
      const select = card.querySelector('[data-field="category"]');
      const manual = card.querySelector('[data-field="category-manual"]');
      if (!select) {
        return normalizeString(manual ? manual.value : '');
      }
      if (select.tagName === 'SELECT') {
        if (select.value === '__direct') {
          return normalizeString(manual?.value || '');
        }
        return select.value || normalizeString(manual?.value || '');
      }
      return normalizeString(select.value);
    }

    getItemNoteValue(item) {
      if (!item || typeof item !== 'object') return '';
      const prop = this.notesProp || 'notes';
      const value = item[prop];
      if (value === undefined && prop !== 'notes') {
        return item.notes || '';
      }
      return value || '';
    }

    upsertCacheItem(updated) {
      if (!updated || typeof updated !== 'object') return;
      if (!Array.isArray(this.cache)) {
        this.cache = [];
      }
      if (!Array.isArray(this.currentItems)) {
        this.currentItems = [];
      }
      const targetId = updated.id ? String(updated.id) : null;
      const targetCategory = normalizeString(updated.category);
      const targetName = normalizeString(updated.name);
      const matcher = (candidate) => {
        if (!candidate || typeof candidate !== 'object') return false;
        const cid = candidate.id ? String(candidate.id) : null;
        if (targetId && cid && cid === targetId) {
          return true;
        }
        return normalizeString(candidate.category) === targetCategory && normalizeString(candidate.name) === targetName;
      };

      const mergeItem = (candidate) => ({ ...candidate, ...updated });

      const apply = (list) => {
        if (!Array.isArray(list)) return;
        const index = list.findIndex(matcher);
        if (index >= 0) {
          list[index] = mergeItem(list[index]);
        } else {
          list.push({ ...updated });
        }
      };

      apply(this.cache);
      apply(this.currentItems);
    }

    async handleUpdate(card, item, button) {
      const values = this.collectCardValues(card, item);
      if (!values.category || !values.name) {
        alert('分類と名称は必須です');
        return;
      }

      const payload = {
        type: this.type,
        category: item.category,
        name: item.name,
        newCategory: values.category,
        newName: values.name,
        status: values.status,
        canonical_name: values.canonical,
        desc: values.desc
      };
      if (this.showClassification) {
        payload.classification = values.classification;
      }
      if (this.showNotes || this.notesProp !== 'notes') {
        payload[this.notesProp] = values.notes;
      } else if (!this.showDescription) {
        payload[this.notesProp] = values.notes;
      }

      if (['service', 'test'].includes(this.type)) {
        payload.explanations = values.explanations;
        if (!payload.desc && Array.isArray(values.explanations) && values.explanations.length) {
          payload.desc = values.explanations[0].text;
        }
      }

      button.disabled = true;
      try {
        await this.withLoading('項目を更新しています...', async () => {
          const res = await fetch(apiUrl('/api/updateMasterItem'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          if (!res.ok) {
            const text = await res.text();
            throw new Error(`更新に失敗しました: ${res.status} ${text}`);
          }
          let data = null;
          try {
            data = await res.json();
          } catch (_) {}
          if (data?.item) {
            this.upsertCacheItem(data.item);
            this.renderList();
            window.setTimeout(() => {
              this.reload({ force: true }).catch(() => {});
            }, 500);
          } else {
            await this.reload({ force: true });
          }
        });
      } catch (err) {
        console.error(err);
        alert(err.message);
      } finally {
        button.disabled = false;
      }
    }

    async handleDelete(item) {
      if (!confirm(`「${item.name}」を削除しますか？`)) return;
      await this.withLoading('項目を削除しています...', async () => {
        const res = await fetch(apiUrl('/api/deleteMasterItem'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: this.type, category: item.category, name: item.name })
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`削除に失敗しました: ${res.status} ${text}`);
        }
        await this.reload({ force: true });
      }).catch(err => {
        console.error(err);
        alert(err.message);
      });
    }

    async importCsv(file) {
      const text = await file.text();
      const rows = parseCsv(text);
      if (!rows.length) {
        alert('CSVにデータがありません');
        return;
      }
      let start = 0;
      const header = rows[0].map(cell => String(cell).trim());
      if (header[0] === '分類' && header[1] === '名称') {
        start = 1;
      }
      const targets = rows.slice(start).map(row => row.map(cell => String(cell).trim())).filter(row => row[0] && row[1]);
      if (!targets.length) {
        alert('分類と名称が確認できません');
        return;
      }
      let success = 0;
      let failure = 0;
      await this.withLoading('CSVを取り込んでいます...', async () => {
        for (const row of targets) {
          const [category, name, desc = ''] = row;
          try {
            const payload = { type: this.type, category, name, desc, status: 'approved', source: 'admin.csv' };
            if (this.showNotes && !this.showDescription) {
              payload.notes = desc;
            }
            const res = await fetch(apiUrl('/api/addMasterItem'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            success += 1;
          } catch (err) {
            console.warn('CSV行の登録に失敗しました', row, err);
            failure += 1;
          }
        }
      });
      await this.reload({ force: true });
      alert(`CSV取込が完了しました。成功: ${success} / 失敗: ${failure}`);
    }

    async handleAdd() {
      const categoryControl = this.elements.addCategory;
      const manualCategoryInput = this.elements.addCategoryManual;
      let resolvedCategory = '';
      if (categoryControl) {
        if (categoryControl.tagName === 'SELECT') {
          if (categoryControl.value === '__direct') {
            resolvedCategory = normalizeString(manualCategoryInput?.value);
          } else {
            resolvedCategory = normalizeString(categoryControl.value);
          }
        } else {
          resolvedCategory = normalizeString(categoryControl.value);
        }
      }
      if (!resolvedCategory) {
        resolvedCategory = this.showCategory ? normalizeString(manualCategoryInput?.value) : this.defaultCategory;
      }
      const name = normalizeString(this.elements.addName.value);
      const desc = this.elements.addDesc ? this.elements.addDesc.value : '';
      const classification = this.elements.addClassification ? this.elements.addClassification.value : PERSONAL_CLASSIFICATIONS[0];
      const notesControl = this.elements.addNotes;
      const manualNotesInput = this.elements.addNotesManual;
      let notes = '';
      if (notesControl) {
        if (notesControl.tagName === 'SELECT') {
          if (notesControl.value === '__direct') {
            notes = normalizeString(manualNotesInput?.value);
          } else {
            notes = normalizeString(notesControl.value);
          }
        } else {
          notes = normalizeString(notesControl.value);
        }
      } else if (this.notesProp === 'notes') {
        notes = normalizeString(desc);
      }
      const status = this.elements.addStatus ? this.elements.addStatus.value : 'approved';
      if (!name) {
        alert('名称を入力してください');
        return;
      }
      const payload = {
        type: this.type,
        category: resolvedCategory,
        name,
        desc,
        status,
        source: 'admin.manual'
      };
      if (this.showClassification) {
        payload.classification = classification;
      }
      if (this.showNotes || this.notesProp !== 'notes') {
        payload[this.notesProp] = notes;
      } else if (!this.showDescription) {
        payload[this.notesProp] = notes;
      }
      await this.withLoading('項目を追加しています...', async () => {
      const res = await fetch(apiUrl('/api/addMasterItem'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`追加に失敗しました: ${res.status} ${text}`);
        }
      }).catch(err => {
        console.error(err);
        alert(err.message);
      });
      if (this.elements.addCategory && this.elements.addCategory.tagName === 'SELECT') {
        this.elements.addCategory.value = '';
      }
      if (manualCategoryInput) {
        manualCategoryInput.value = '';
        manualCategoryInput.classList.add('hidden');
      }
      this.elements.addName.value = '';
      if (this.elements.addDesc) this.elements.addDesc.value = '';
      if (notesControl) {
        if (notesControl.tagName === 'SELECT') {
          notesControl.value = '';
        } else {
          notesControl.value = '';
        }
      }
      if (manualNotesInput) {
        manualNotesInput.value = '';
        manualNotesInput.classList.add('hidden');
      }
      await this.reload({ force: true });
    }
  }

  function initMasterPage(config) {
    const page = new MasterPage(config);
    page.init();
    return page;
  }

  window.initMasterPage = initMasterPage;
})();
