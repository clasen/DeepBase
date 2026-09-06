# deepbase/plugins/links

Explicit, portable links included in DeepBase. Links are stored as versioned
strings and normal `get()` calls return the link unchanged.

## Installation

```bash
npm install deepbase
```

## Usage

```javascript
import DeepBase from 'deepbase';
import { linkedData } from 'deepbase/plugins/links';

const links = linkedData({ maxDepth: 32 });
const db = new DeepBase(driver).use(links);

await db.set('nodes', 'root', { label: 'Root' });
await db.set('aliases', 'home', links.to('nodes', 'root'));

console.log(await db.get('aliases', 'home'));
// deepbase:link:v1:...

console.log(await links.resolve('aliases', 'home'));
// { label: 'Root' }
```

`maxDepth` is required and must be a positive integer. `resolve()` follows link
chains until it reaches a normal value and throws `DeepBaseLinkError` with one
of these codes when it cannot finish:

- `LINK_TARGET_MISSING`
- `LINK_CYCLE`
- `LINK_MAX_DEPTH`
- `LINK_MALFORMED`
- `LINK_INVALID_PATH`

This entry point does not load the Node.js encryption plugin. CommonJS is also
supported:

```javascript
const { linkedData } = require('deepbase/plugins/links');
```

Use `isLink(value)` to test a value and `parse(value)` to recover its path.
String and numeric path segments, including Unicode and reserved URL
characters, round-trip without loss.

Links may point to missing values and deletions are unrestricted. Because
DeepBase returns `null` for missing data, a link to a stored `null` value is also
reported as missing. Links remain ordinary strings for schema validation;
strict entity relationships continue to use `schema.ref`.
