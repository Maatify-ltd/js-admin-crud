/**
 * Regression cover for the stored-XSS sinks in `legacy/kernel/`.
 *
 * `legacy/kernel/` is not only a historical baseline: it is the tree that ships
 * verbatim into the Athar admin panel under
 * `public/admin/assets/maatify/admin-kernel/js/`. The defects listed in
 * DESIGN.md §3.1 were closed in `src/`, but the legacy copy kept them until
 * these fixes landed. Every assertion below drives the real kernel script in a
 * real DOM and reads the *parsed* result, so a value that is re-interpolated
 * raw shows up as an element or an attribute, not as a substring match.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM, VirtualConsole } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KERNEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../legacy/kernel');

/** Breaks out of element content. */
const SCRIPT_PAYLOAD = '<img src=x onerror=alert(1)>';
/** Breaks out of a double-quoted attribute value. */
const ATTRIBUTE_PAYLOAD = 'x" onerror="alert(1)';

const warnings = [];

/**
 * Load kernel scripts into a fresh window. The legacy files are global-scope
 * scripts, not modules, so each group gets its own window: `data_table.js` and
 * `callback_handler.js` both declare a global `showAlert`.
 */
function loadKernel(files, { body = '' } = {}) {
  const virtualConsole = new VirtualConsole();
  const dom = new JSDOM(`<!doctype html><html><body>${body}</body></html>`, {
    runScripts: 'outside-only',
    url: 'https://admin.test/',
    virtualConsole,
  });
  const { window } = dom;
  const noop = () => {};
  window.console = {
    log: noop,
    info: noop,
    debug: noop,
    error: noop,
    group: noop,
    groupEnd: noop,
    table: noop,
    warn: (...args) => warnings.push(args.join(' ')),
  };
  for (const file of files) {
    window.eval(fs.readFileSync(path.join(KERNEL, file), 'utf8'));
  }
  return window;
}

/** The markup a table needs before `TableComponent` takes over the container. */
const TABLE_BODY = '<div id="table-container"></div>';

/** Render one row through the default (non-custom) cell path. */
function renderTable(window, row, { columns = ['Value'], keys = ['value'], pagination = {} } = {}) {
  window.TableComponent([row], columns, keys, { page: 1, total: 1, ...pagination });
  return window.document.querySelector('#table-container');
}

beforeEach(() => {
  warnings.length = 0;
});

// ---------------------------------------------------------------------------
// data_table.js — row rendering
// ---------------------------------------------------------------------------

describe('data_table.js default cell rendering', () => {
  it('renders an untrusted value as text, never as markup', () => {
    const window = loadKernel(['data_table.js'], { body: TABLE_BODY });
    const container = renderTable(window, { value: SCRIPT_PAYLOAD });

    const cell = container.querySelector('tbody td');
    expect(cell.querySelector('img')).toBeNull();
    expect(cell.textContent).toContain(SCRIPT_PAYLOAD);
  });

  it('escapes a status label instead of letting it close its own span', () => {
    const window = loadKernel(['data_table.js'], { body: TABLE_BODY });
    const container = renderTable(
      window,
      { status: SCRIPT_PAYLOAD },
      { columns: ['Status'], keys: ['status'] },
    );

    const cell = container.querySelector('tbody td');
    expect(cell.querySelector('img')).toBeNull();
    expect(cell.querySelector('span').textContent).toBe(SCRIPT_PAYLOAD);
  });

  it('keeps an image URL inside its src attribute and injects no event handler', () => {
    const window = loadKernel(['data_table.js'], { body: TABLE_BODY });
    const container = renderTable(
      window,
      { image: '/media/a.png" onerror="alert(1)' },
      { columns: ['Image'], keys: ['image'] },
    );

    const img = container.querySelector('tbody img');
    // Escaping keeps the whole value inside the attribute, handler and all.
    expect(img.getAttribute('src')).toBe('/media/a.png" onerror="alert(1)');
    expect(img.hasAttribute('onerror')).toBe(false);
  });

  it('refuses an image value that carries no allowed URL scheme', () => {
    // Behaviour change from S-03: tableSafeUrl() now drops a value whose scheme is
    // not http(s), protocol-relative, root-relative or data:image. The old build
    // escaped it and still emitted it; the attribute is now empty instead.
    const window = loadKernel(['data_table.js'], { body: TABLE_BODY });
    const container = renderTable(
      window,
      { image: ATTRIBUTE_PAYLOAD },
      { columns: ['Image'], keys: ['image'] },
    );

    const img = container.querySelector('tbody img');
    expect(img.getAttribute('src')).toBe('');
    expect(img.hasAttribute('onerror')).toBe(false);
  });

  it('escapes the title attribute on a truncated session value', () => {
    const window = loadKernel(['data_table.js'], { body: TABLE_BODY });
    const sessionValue = `${ATTRIBUTE_PAYLOAD} padding to pass the length gate`;
    const container = renderTable(
      window,
      { session_id: sessionValue },
      { columns: ['Session'], keys: ['session_id'] },
    );

    const cell = container.querySelector('tbody td');
    expect(cell.getAttribute('title')).toBe(sessionValue);
    expect(cell.hasAttribute('onerror')).toBe(false);
  });

  it('escapes a row id before it reaches the checkbox value attribute', () => {
    const window = loadKernel(['data_table.js'], { body: TABLE_BODY });
    window.TableComponent(
      [{ id: ATTRIBUTE_PAYLOAD, value: 'ok' }],
      ['Value'],
      ['value'],
      { page: 1, total: 1 },
      '',
      true,
    );

    const checkbox = window.document.querySelector('tbody input.row-checkbox');
    expect(checkbox.getAttribute('value')).toBe(ATTRIBUTE_PAYLOAD);
    expect(checkbox.hasAttribute('onerror')).toBe(false);
  });

  it('escapes exactly once, so a literal entity is not double encoded', () => {
    const window = loadKernel(['data_table.js'], { body: TABLE_BODY });
    const container = renderTable(window, { value: 'Tom &amp; Jerry' });

    expect(container.querySelector('tbody td').textContent).toBe('Tom &amp; Jerry');
  });

  it('still renders ordinary values and honours a custom renderer contract', () => {
    const window = loadKernel(['data_table.js'], { body: TABLE_BODY });
    window.TableComponent(
      [{ value: 'plain text' }],
      ['Value'],
      ['value'],
      { page: 1, total: 1 },
      '',
      false,
      'id',
      null,
      { value: (v) => `<b data-custom>${v}</b>` },
    );

    const cell = window.document.querySelector('tbody td');
    expect(cell.querySelector('[data-custom]').textContent).toBe('plain text');
  });

  it('coerces pagination numbers so they cannot break out of an attribute', () => {
    const window = loadKernel(['data_table.js'], { body: TABLE_BODY });
    renderTable(
      window,
      { value: 'ok' },
      { pagination: { page: '1" onload="alert(1)', total: 500, per_page: 10 } },
    );

    const jump = window.document.querySelector('#pagination input[type="number"]');
    expect(jump.hasAttribute('onload')).toBe(false);
    expect(Number.isNaN(Number(jump.getAttribute('value')))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// data_table.js — alerts, error surface and exports
// ---------------------------------------------------------------------------

describe('data_table.js alerts and error surface', () => {
  it('shows an alert message as text and closes it without an inline handler', () => {
    const window = loadKernel(['data_table.js']);
    window.showAlert('danger', SCRIPT_PAYLOAD);

    const alert = window.document.body.lastElementChild;
    expect(alert.querySelector('img')).toBeNull();
    expect(alert.querySelector('span').textContent).toBe(SCRIPT_PAYLOAD);

    const close = alert.querySelector('button');
    expect(close.hasAttribute('onclick')).toBe(false);
    close.click();
    expect(window.document.body.contains(alert)).toBe(false);
  });

  it('escapes an API error message on the load-failure panel and drops the inline onclick', async () => {
    const window = loadKernel(['data_table.js'], { body: TABLE_BODY });
    window.fetch = () => Promise.reject(new Error(SCRIPT_PAYLOAD));

    const result = await window.createTable('rows', { page: 1 }, ['Value'], ['value']);
    expect(result.success).toBe(false);

    const panel = window.document.querySelector('#table-container');
    expect(panel.querySelector('img')).toBeNull();
    expect(panel.querySelector('p').textContent).toBe(SCRIPT_PAYLOAD);

    const retry = panel.querySelector('button');
    expect(retry.hasAttribute('onclick')).toBe(false);
    expect(retry.className).toContain('table-retry-btn');
  });

  it('escapes cell values in the Excel export workbook', () => {
    const window = loadKernel(['data_table.js'], { body: TABLE_BODY });
    let captured = '';
    window.Blob = class {
      constructor(parts) {
        captured = parts.join('');
      }
    };
    window.URL.createObjectURL = () => 'blob:captured';
    window.URL.revokeObjectURL = () => {};

    renderTable(window, { value: SCRIPT_PAYLOAD });
    window.document.querySelector('#export-excel').click();

    const parsed = JSDOM.fragment(captured);
    expect(parsed.querySelector('img')).toBeNull();
    expect(parsed.querySelector('td').textContent).toBe(SCRIPT_PAYLOAD);
  });

  it('prints through DOM nodes, never through document.write', () => {
    const window = loadKernel(['data_table.js'], { body: TABLE_BODY });

    const printDom = new JSDOM('<!doctype html><html><head></head><body></body></html>');
    const printWindow = printDom.window;
    let wroteViaDocumentWrite = false;
    printWindow.document.write = () => {
      wroteViaDocumentWrite = true;
    };
    let printed = 0;
    printWindow.print = () => {
      printed += 1;
    };
    window.open = () => printWindow;

    renderTable(window, { value: SCRIPT_PAYLOAD });
    window.document.querySelector('#export-pdf').click();

    expect(wroteViaDocumentWrite).toBe(false);
    expect(printed).toBe(1);
    expect(printWindow.document.querySelector('img')).toBeNull();
    expect(printWindow.document.querySelector('tbody td').textContent).toBe(SCRIPT_PAYLOAD);
  });

  it('warns through an alert instead of dereferencing a blocked print window', () => {
    const window = loadKernel(['data_table.js'], { body: TABLE_BODY });
    window.open = () => null;

    renderTable(window, { value: 'ok' });
    window.document.querySelector('#export-pdf').click();

    // Before the fix this path threw on `w.document`, so no alert was ever shown.
    const alert = window.document.body.lastElementChild;
    expect(alert.textContent).toContain('Allow pop-ups');
  });
});

// ---------------------------------------------------------------------------
// api_handler.js / callback_handler.js — the other two showAlert copies
// ---------------------------------------------------------------------------

describe('api_handler.js alerts', () => {
  it('renders the message as text and wires the close button without onclick', () => {
    const window = loadKernel(['api_handler.js']);
    window.ApiHandler.showAlert('danger', SCRIPT_PAYLOAD, 0);

    const alert = window.document.body.lastElementChild;
    expect(alert.querySelector('img')).toBeNull();
    expect(alert.querySelector('span').textContent).toBe(SCRIPT_PAYLOAD);
    expect(alert.querySelector('button').hasAttribute('onclick')).toBe(false);
  });
});

describe('callback_handler.js alerts', () => {
  it('renders the container alert as text', () => {
    const window = loadKernel(['callback_handler.js'], {
      body: '<div id="alert-container"></div>',
    });
    window.showAlert('d', SCRIPT_PAYLOAD);

    const container = window.document.querySelector('#alert-container');
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('span').textContent).toBe(SCRIPT_PAYLOAD);
    expect(container.querySelector('strong').textContent).toBe('Error:');
  });

  it('writes into an existing alert paragraph as text', () => {
    // No #alert-container, so showAlert falls back to the legacy .alert-* markup.
    const window = loadKernel(['callback_handler.js'], {
      body: '<div class="alert-error"><p></p></div>',
    });
    window.showAlert('d', SCRIPT_PAYLOAD);

    const paragraph = window.document.querySelector('.alert-error p');
    expect(paragraph.querySelector('img')).toBeNull();
    expect(paragraph.textContent).toBe(SCRIPT_PAYLOAD);
  });
});

// ---------------------------------------------------------------------------
// select2.js
// ---------------------------------------------------------------------------

describe('select2.js option list', () => {
  const MARKUP = `
    <div id="sel">
      <div class="js-select-box"><input class="js-select-input"></div>
      <div class="js-dropdown">
        <input class="js-search-input">
        <ul class="js-select-list"></ul>
      </div>
    </div>`;

  it('renders an option label as text', () => {
    const window = loadKernel(['select2.js'], { body: MARKUP });
    window.Select2('#sel', [{ value: '1', label: SCRIPT_PAYLOAD }]);

    const option = window.document.querySelector('.js-select-list li');
    expect(option.querySelector('img')).toBeNull();
    expect(option.textContent).toBe(SCRIPT_PAYLOAD);
  });

  it('still marks the selected option with a checkmark', () => {
    const window = loadKernel(['select2.js'], { body: MARKUP });
    // The default value is applied after the first render; opening re-renders.
    window.Select2('#sel', [{ value: '1', label: 'One' }], { defaultValue: '1' }).open();

    const option = window.document.querySelector('.js-select-list li');
    expect(option.textContent).toContain('One');
    expect(option.textContent).toContain('✓');
  });
});

// ---------------------------------------------------------------------------
// admin-ui-components.js
// ---------------------------------------------------------------------------

describe('admin-ui-components.js builders', () => {
  /** Parse a builder's HTML string the way the browser would. */
  function parse(html) {
    return JSDOM.fragment(html);
  }

  function components() {
    return loadKernel(['admin-ui-components.js']).AdminUIComponents;
  }

  it('escapes the status badge label and entity id', () => {
    const fragment = parse(
      components().renderStatusBadge(true, {
        clickable: true,
        entityId: ATTRIBUTE_PAYLOAD,
        activeText: SCRIPT_PAYLOAD,
      }),
    );

    const button = fragment.querySelector('button');
    expect(button.getAttribute('data-entity-id')).toBe(ATTRIBUTE_PAYLOAD);
    expect(button.hasAttribute('onerror')).toBe(false);
    expect(fragment.querySelector('img')).toBeNull();
    expect(button.textContent).toContain(SCRIPT_PAYLOAD);
  });

  it('refuses a data attribute name that is not a plain data-* name', () => {
    const fragment = parse(
      components().renderStatusBadge(true, {
        clickable: true,
        entityId: '7',
        dataAttribute: 'data-x" onclick="alert(1)',
      }),
    );

    const button = fragment.querySelector('button');
    expect(button.hasAttribute('onclick')).toBe(false);
    expect(button.getAttribute('data-entity-id')).toBe('7');
    expect(warnings.join(' ')).toContain('invalid data attribute name');
  });

  it('escapes action button text, title and data attribute values', () => {
    const fragment = parse(
      components().buildActionButton({
        text: SCRIPT_PAYLOAD,
        title: ATTRIBUTE_PAYLOAD,
        entityId: ATTRIBUTE_PAYLOAD,
        dataAttributes: { code: ATTRIBUTE_PAYLOAD },
      }),
    );

    const button = fragment.querySelector('button');
    expect(fragment.querySelector('img')).toBeNull();
    expect(button.textContent).toContain(SCRIPT_PAYLOAD);
    expect(button.getAttribute('title')).toBe(ATTRIBUTE_PAYLOAD);
    expect(button.getAttribute('data-entity-id')).toBe(ATTRIBUTE_PAYLOAD);
    expect(button.getAttribute('data-code')).toBe(ATTRIBUTE_PAYLOAD);
    expect(button.hasAttribute('onerror')).toBe(false);
  });

  it('skips a data attribute whose name would smuggle a second attribute', () => {
    const fragment = parse(
      components().buildActionButton({
        text: 'Edit',
        dataAttributes: { 'x" onclick="alert(1)': '1' },
      }),
    );

    const button = fragment.querySelector('button');
    expect(button.hasAttribute('onclick')).toBe(false);
    expect(warnings.join(' ')).toContain('invalid data attribute name');
  });

  it('escapes exactly once, so an action button does not double encode', () => {
    const fragment = parse(components().buildActionButton({ text: 'Tom &amp; Jerry' }));
    expect(fragment.querySelector('button').textContent).toContain('Tom &amp; Jerry');
  });

  it('escapes a dynamic icon value', () => {
    const fragment = parse(components().renderIcon(SCRIPT_PAYLOAD));
    expect(fragment.querySelector('img')).toBeNull();
    expect(fragment.querySelector('span').textContent).toBe(SCRIPT_PAYLOAD);
  });

  it('escapes the code badge value and its colour token', () => {
    const fragment = parse(
      components().renderCodeBadge(SCRIPT_PAYLOAD, { uppercase: false, color: ATTRIBUTE_PAYLOAD }),
    );
    expect(fragment.querySelector('img')).toBeNull();
    expect(fragment.querySelector('span').textContent).toBe(SCRIPT_PAYLOAD);
  });

  it('resolves icon names only from the registry, not the prototype chain', () => {
    const ui = components();
    expect(ui.icon('constructor')).toBe('');
    expect(ui.icon('__proto__')).toBe('');
    expect(ui.icon('toString')).toBe('');
  });

  it('still renders a known icon, and escapes its title and style', () => {
    const ui = components();
    const svg = ui.icon('download', { title: ATTRIBUTE_PAYLOAD, style: ATTRIBUTE_PAYLOAD });
    expect(svg).toContain('<svg');

    const fragment = parse(svg);
    const element = fragment.firstElementChild;
    expect(element.hasAttribute('onerror')).toBe(false);
    expect(element.getAttribute('style')).toBe(ATTRIBUTE_PAYLOAD);
  });

  it('escapes the modal title while keeping content trusted by contract', () => {
    const fragment = parse(
      components().buildModalTemplate({
        id: 'm1',
        title: SCRIPT_PAYLOAD,
        content: '<p data-trusted>body</p>',
      }),
    );

    expect(fragment.querySelector('h3 img')).toBeNull();
    expect(fragment.querySelector('h3').textContent).toContain(SCRIPT_PAYLOAD);
    expect(fragment.querySelector('[data-trusted]')).not.toBeNull();
  });

  it('escapes the modal footer button labels', () => {
    const fragment = parse(
      components().buildModalFooter({ cancelText: SCRIPT_PAYLOAD, submitText: SCRIPT_PAYLOAD }),
    );
    expect(fragment.querySelector('img')).toBeNull();
    expect(fragment.querySelectorAll('button')[0].textContent.trim()).toBe(SCRIPT_PAYLOAD);
  });

  it('exports escapeHtml so page scripts can reuse the library definition', () => {
    expect(components().escapeHtml(SCRIPT_PAYLOAD)).toBe(
      '&lt;img src=x onerror=alert(1)&gt;',
    );
  });
});
