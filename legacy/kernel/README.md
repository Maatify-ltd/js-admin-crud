# `legacy/kernel/` — shipped baseline, not dead code

This directory holds the original Athar admin kernel scripts that `src/` was
extracted from. Two things about it are easy to get wrong:

1. **It is not only a historical reference.** This tree is copied verbatim into
   the Athar admin panel at `public/admin/assets/maatify/admin-kernel/js/`.
   Whatever lands here is what runs in an administrator's browser.
2. **It is not the modern implementation.** `src/` is escape-by-default
   (`escapeHtml`, `html`, `safeUrl` in `src/core/dom.js`). These files are not,
   and they are not part of the published npm package (`files` in
   `package.json` covers `dist` and `src` only).

## The escaping contract these files must keep

The stored-XSS sinks listed in [`../../docs/DESIGN.md`](../../docs/DESIGN.md)
§3.1 were closed here by the upstream port of the consumer fix
(`Maatify/athar-platform` PR #1178, issue #1184). The rules:

- `data_table.js` escapes every default-path cell through `tableEscapeHtml`
  (text, status labels, `img src`, the session `title`, the checkbox `value`,
  the load-failure message, and the Excel export). The name is prefixed because
  this file runs in the global scope and page scripts declare their own
  `escapeHtml`; a bare `const escapeHtml` here collides with a page's
  `function escapeHtml` and kills the page with a `SyntaxError`.
- Pagination numbers are coerced with `Number()` before they reach an
  attribute.
- PDF printing builds nodes with `createElement`/`textContent`. Do not
  reintroduce `document.write`.
- Alerts in `data_table.js`, `api_handler.js` and `callback_handler.js` are
  built with `createElement`/`textContent`, and close buttons are wired with
  `addEventListener`. Do not reintroduce inline `onclick`.
- `select2.js` sets option labels with `textContent`.
- `admin-ui-components.js` escapes the text and attribute values of its
  builders, and validates `data-*` attribute *names* against an allow-list
  rather than escaping them. `renderSvgIcon` resolves names with
  `hasOwnProperty`, so `constructor` and `__proto__` do not reach the registry.

**Deliberately still trusted markup, by documented contract:** `customRenderers`
output in `data_table.js`, and the `icon`, `content`, `footer` and `fallbackSvg`
arguments of `admin-ui-components.js`. Each is marked in its own docblock. The
shared builders carry the escaping burden so that a page does not have to
remember; a page that concatenates raw markup on its own is outside this
contract.

## Guard

[`../../test/legacy-kernel-xss.test.js`](../../test/legacy-kernel-xss.test.js)
drives these scripts in a real DOM and asserts on the parsed result. Reverting
any of the rules above fails it: with this tree frozen at `963845e5`, 28 of its
30 assertions fail.

Run it with `npm test`. **The repository has no CI workflow yet**, so nothing
runs it automatically — until one exists, `npm test` before publishing or
copying this tree is the only thing standing between an edit here and a stored
XSS in an administrator's browser.

## Updating the Athar copy

There is no build step and no sync script for this tree — the copy is manual:

```
cp legacy/kernel/*.js <athar-platform>/public/admin/assets/maatify/admin-kernel/js/
```

The Athar copy additionally carries a consumer-local `options`
(`clientSideSorting`, `perPage`) parameter on `TableComponent` in
`data_table.js` that does not exist here, plus a `pages/` directory that has no
upstream equivalent. **Diff before copying**; a blind overwrite drops that
parameter. After copying, raise `ADMIN_ASSET_VERSION` per the Athar
`DEPLOYMENT.md`.
