---
"lavs-runtime": patch
---

Fix: `lavs-runtime serve` / `serve-registry` crashed on any endpoint declaring `schema.input` ("inputSchema must be a Zod schema or raw shape"). Endpoints now convert JSON Schema to Zod properly (string/number/integer/boolean/null/array/object, enum, anyOf/oneOf; unknown → `z.any()`), honouring `required` and keeping descriptions.
