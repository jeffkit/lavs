# lavs-runtime

## 0.1.1

### Patch Changes

- b51ae88: fix(tool-generator): pass manifest types to validator for $ref resolution, make output validation non-blocking

  - Pass `manifest.types` to `assertValidInput` and `assertValidOutput` so that `$ref: "#/types/Todo"` style references can be resolved by ajv
  - Wrap output validation in try-catch: log warnings on schema mismatch instead of throwing, ensuring tools still return data even if output has minor schema deviations (e.g. missing timezone designator in date-time fields)

- 9168541: chore: test automated release flow with changesets
