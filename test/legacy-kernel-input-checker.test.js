/**
 * Input_checker.js builds its validation message with insertAdjacentHTML, from
 * two DOM-sourced values: the field's `placeholder` (or `select-title`) and the
 * element `id`. The browser returns both already decoded, so re-inserting them
 * as markup is a DOM-based re-injection of whatever the page rendered into those
 * attributes. Both are escaped now.
 */

import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KERNEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../legacy/kernel');

function load(body) {
  const dom = new JSDOM(`<!doctype html><html><body>${body}</body></html>`, {
    runScripts: 'outside-only',
    url: 'https://admin.test/',
  });
  dom.window.eval(fs.readFileSync(path.join(KERNEL, 'Input_checker.js'), 'utf8'));
  return dom.window;
}

const PAYLOADS = [
  ['an element', '<img src=x onerror=alert(1)>'],
  ['an attribute breakout', 'x" onerror="alert(1)'],
  ['an svg handler', '<svg onload="alert(1)"></svg>'],
  ['a closing tag', '</p><script>alert(1)</script>'],
];

describe('Input_checker validation message', () => {
  for (const [label, payload] of PAYLOADS) {
    it(`renders ${label} in the placeholder as text`, () => {
      const window = load(`<form><input id="f1" placeholder="${payload.replace(/"/g, '&quot;')}"></form>`);
      const input = window.document.getElementById('f1');
      window.checkRegCodeAndEmpty([input]);

      const added = window.document.querySelector('.input-error');
      expect(added, 'the error message should be inserted').not.toBeNull();
      const handlers = [...window.document.querySelectorAll('*')]
        .flatMap((n) => [...n.attributes].map((a) => a.name))
        .filter((n) => n.startsWith('on'));
      expect(handlers).toEqual([]);
      expect(window.document.querySelectorAll('script, svg').length).toBe(0);
      expect(added.textContent).toContain(payload);
    });
  }

  it('escapes the element id before it reaches the error id attribute', () => {
    const window = load('<form><input placeholder="Name"></form>');
    const input = window.document.querySelector('input');
    Object.defineProperty(input, 'id', { value: 'x" onerror="alert(1)', configurable: true });
    window.checkRegCodeAndEmpty([input]);

    const handlers = [...window.document.querySelectorAll('*')]
      .flatMap((n) => [...n.attributes].map((a) => a.name))
      .filter((n) => n.startsWith('on'));
    expect(handlers).toEqual([]);
  });

  it('still shows an ordinary message, and clears it once valid', () => {
    const window = load('<form><input id="f2" placeholder="Full name"></form>');
    const input = window.document.getElementById('f2');

    expect(window.checkRegCodeAndEmpty([input])).toBe(false);
    expect(window.document.querySelector('.input-error').textContent).toContain('Full name');

    input.value = 'Mohamed';
    expect(window.checkRegCodeAndEmpty([input])).toBe(true);
    expect(window.document.querySelector('.input-error')).toBeNull();
  });
});
