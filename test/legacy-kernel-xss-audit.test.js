/**
 * Second-pass offensive audit of `legacy/kernel/`, after the sinks closed in #42.
 *
 * Two surfaces survived that pass because the first review traced only the
 * values that reach a cell:
 *
 *   S-01  getPaginationInfo() returns `{ total, info }` and `info` is spliced
 *         straight into the table's innerHTML. The callback is page-supplied,
 *         but the numbers it formats come from the API response, and the
 *         custom branch never ran the Number() coercion #42 added to the
 *         default branch.
 *   S-02  Column labels are interpolated into the <th> text and into
 *         data-key="..." with no escaping at all.
 *
 * Neither had an exploitable call site in Athar at audit time, so these are
 * defence-in-depth: the library must not depend on every caller passing it
 * developer-authored constants.
 */

import { describe, it, expect } from 'vitest';
import { JSDOM, VirtualConsole } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KERNEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../legacy/kernel');

const SCRIPT_PAYLOAD = '<img src=x onerror=alert(1)>';
const ATTRIBUTE_PAYLOAD = 'x" onerror="alert(1)';

function loadKernel(files, { body = '' } = {}) {
  const dom = new JSDOM(`<!doctype html><html><body>${body}</body></html>`, {
    runScripts: 'outside-only',
    url: 'https://admin.test/',
    virtualConsole: new VirtualConsole(),
  });
  const { window } = dom;
  const noop = () => {};
  window.console = { log: noop, info: noop, debug: noop, error: noop, warn: noop, group: noop, groupEnd: noop, table: noop };
  for (const file of files) window.eval(fs.readFileSync(path.join(KERNEL, file), 'utf8'));
  return window;
}

const TABLE_BODY = '<div id="table-container"></div>';

/** Call TableComponent with a page-supplied getPaginationInfo callback. */
function renderWithPaginationInfo(window, callback, pagination = { page: 1, total: 1 }) {
  window.TableComponent(
    [{ value: 'ok' }],
    ['Value'],
    ['value'],
    pagination,
    '',
    false,
    'id',
    null,
    {},
    null,
    callback,
  );
  return window.document.querySelector('#table-container');
}

// ---------------------------------------------------------------------------
// S-01 — the pagination info channel
// ---------------------------------------------------------------------------

describe('S-01 getPaginationInfo result', () => {
  it('renders the safe `text` channel as text, not markup', () => {
    const window = loadKernel(['data_table.js'], { body: TABLE_BODY });
    const container = renderWithPaginationInfo(window, () => ({ total: 1, text: SCRIPT_PAYLOAD }));

    const footer = container.querySelector('footer');
    expect(footer.querySelector('img')).toBeNull();
    expect(footer.textContent).toContain(SCRIPT_PAYLOAD);
  });

  it('escapes the `text` channel in an attribute-breaking shape too', () => {
    const window = loadKernel(['data_table.js'], { body: TABLE_BODY });
    const container = renderWithPaginationInfo(window, () => ({ total: 1, text: ATTRIBUTE_PAYLOAD }));

    const footer = container.querySelector('footer');
    expect(footer.querySelector('[onerror]')).toBeNull();
    expect(footer.textContent).toContain(ATTRIBUTE_PAYLOAD);
  });

  it('prefers `text` over `info` when a callback supplies both', () => {
    const window = loadKernel(['data_table.js'], { body: TABLE_BODY });
    const container = renderWithPaginationInfo(window, () => ({
      total: 1,
      text: 'plain',
      info: '<b data-trusted>markup</b>',
    }));

    const footer = container.querySelector('footer');
    expect(footer.textContent).toContain('plain');
    expect(footer.querySelector('[data-trusted]')).toBeNull();
  });

  it('coerces a non-numeric custom total so it cannot reach pagination attributes', () => {
    const window = loadKernel(['data_table.js'], { body: TABLE_BODY });
    const container = renderWithPaginationInfo(
      window,
      () => ({ total: '500" onload="alert(1)', text: 'x' }),
      { page: 1, total: 500, per_page: 10 },
    );

    expect(container.querySelector('[onload]')).toBeNull();
    const jump = container.querySelector('#pagination input[type="number"]');
    if (jump) expect(Number.isNaN(Number(jump.getAttribute('max')))).toBe(false);
  });

  it('still honours `info` as the documented trusted-HTML escape hatch', () => {
    const window = loadKernel(['data_table.js'], { body: TABLE_BODY });
    const container = renderWithPaginationInfo(window, () => ({
      total: 42,
      info: '<span data-legacy>1 to 10</span> of <span>42</span>',
    }));

    expect(container.querySelector('[data-legacy]').textContent).toBe('1 to 10');
  });

  it('still renders the built-in info when no callback is supplied', () => {
    const window = loadKernel(['data_table.js'], { body: TABLE_BODY });
    window.TableComponent([{ value: 'ok' }], ['Value'], ['value'], { page: 1, total: 1 });

    expect(window.document.querySelector('#table-container footer').textContent).toContain('of');
  });
});

// ---------------------------------------------------------------------------
// S-02 — column labels
// ---------------------------------------------------------------------------

describe('S-02 column labels', () => {
  function renderColumns(window, columns) {
    window.TableComponent([{ value: 'ok' }], columns, ['value'], { page: 1, total: 1 });
    return window.document.querySelector('#table-container');
  }

  it('renders a column label as text, not markup', () => {
    const window = loadKernel(['data_table.js'], { body: TABLE_BODY });
    const container = renderColumns(window, [SCRIPT_PAYLOAD]);

    const th = container.querySelector('thead th');
    expect(th.querySelector('img')).toBeNull();
    expect(th.textContent).toContain(SCRIPT_PAYLOAD);
  });

  it('does not let a column label break out of the data-key attribute', () => {
    const window = loadKernel(['data_table.js'], { body: TABLE_BODY });
    const container = renderColumns(window, [ATTRIBUTE_PAYLOAD]);

    const th = container.querySelector('thead th');
    expect(th.hasAttribute('onerror')).toBe(false);
    // The parsed attribute must still be the lower-cased label, so sorting keeps working.
    expect(th.getAttribute('data-key')).toBe(ATTRIBUTE_PAYLOAD.toLowerCase());
  });

  it('keeps data-key usable as the sort key for ordinary labels', () => {
    const window = loadKernel(['data_table.js'], { body: TABLE_BODY });
    const container = renderColumns(window, ['Display Name']);

    const th = container.querySelector('thead th');
    expect(th.getAttribute('data-key')).toBe('display name');
    expect(th.textContent).toContain('Display Name');
  });

  it('escapes a column label exactly once', () => {
    const window = loadKernel(['data_table.js'], { body: TABLE_BODY });
    const container = renderColumns(window, ['Tom &amp; Jerry']);

    expect(container.querySelector('thead th').textContent).toContain('Tom &amp; Jerry');
  });

  it('escapes column labels in the Excel export as well', () => {
    const window = loadKernel(['data_table.js'], { body: TABLE_BODY });
    let captured = '';
    window.Blob = class {
      constructor(parts) {
        captured = parts.join('');
      }
    };
    window.URL.createObjectURL = () => 'blob:captured';
    window.URL.revokeObjectURL = () => {};

    renderColumns(window, [SCRIPT_PAYLOAD]);
    window.document.querySelector('#export-excel').click();

    const parsed = JSDOM.fragment(captured);
    expect(parsed.querySelector('img')).toBeNull();
    expect(parsed.querySelector('th').textContent).toBe(SCRIPT_PAYLOAD);
  });
});
