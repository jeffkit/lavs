"""
LAVS Validator.

Validates endpoint inputs and outputs against JSON Schema definitions.
Uses jsonschema library for validation.
"""

from __future__ import annotations

from typing import Any

import jsonschema
from jsonschema import Draft7Validator, ValidationError as JsonSchemaValidationError

from lavs_types import Endpoint, LAVSError, LAVSErrorCode
from lavs_types.models import JSONSchema


class ValidationErrorDetail:
    """Individual validation error detail."""

    def __init__(
        self,
        path: str,
        message: str,
        keyword: str,
        params: dict[str, Any] | None = None,
    ) -> None:
        self.path = path
        self.message = message
        self.keyword = keyword
        self.params = params or {}


class ValidationResult:
    """Validation result."""

    def __init__(
        self,
        valid: bool,
        errors: list[ValidationErrorDetail] | None = None,
    ) -> None:
        self.valid = valid
        self.errors = errors or []


class LAVSValidator:
    """
    LAVS Validator - validates endpoint inputs and outputs against JSON Schema.

    Caches compiled validators for performance.
    """

    def __init__(self) -> None:
        """Initialize validator with empty cache."""
        self._input_validators: dict[str, Draft7Validator] = {}
        self._output_validators: dict[str, Draft7Validator] = {}

    def validate_input(
        self,
        endpoint: Endpoint,
        input_data: Any,
        types: dict[str, JSONSchema] | None = None,
    ) -> ValidationResult:
        """
        Validate endpoint input against schema.input.

        If no schema.input is defined, validation passes.

        Args:
            endpoint: Endpoint definition containing schema.
            input_data: Input data to validate.
            types: Optional types map from manifest for resolving $ref.

        Returns:
            Validation result.
        """
        if not endpoint.endpoint_schema or not endpoint.endpoint_schema.input:
            return ValidationResult(valid=True)

        cache_key = f"input:{endpoint.id}"
        schema = self._resolve_schema(endpoint.endpoint_schema.input, types)
        validator = self._get_or_compile_validator(
            cache_key, schema, self._input_validators
        )

        try:
            validator.validate(input_data)
            return ValidationResult(valid=True)
        except JsonSchemaValidationError as e:
            return ValidationResult(
                valid=False,
                errors=self._format_errors(e),
            )

    def validate_output(
        self,
        endpoint: Endpoint,
        output: Any,
        types: dict[str, JSONSchema] | None = None,
    ) -> ValidationResult:
        """
        Validate endpoint output against schema.output.

        If no schema.output is defined, validation passes.

        Args:
            endpoint: Endpoint definition containing schema.
            output: Output data to validate.
            types: Optional types map from manifest for resolving $ref.

        Returns:
            Validation result.
        """
        if not endpoint.endpoint_schema or not endpoint.endpoint_schema.output:
            return ValidationResult(valid=True)

        cache_key = f"output:{endpoint.id}"
        schema = self._resolve_schema(endpoint.endpoint_schema.output, types)
        validator = self._get_or_compile_validator(
            cache_key, schema, self._output_validators
        )

        try:
            validator.validate(output)
            return ValidationResult(valid=True)
        except JsonSchemaValidationError as e:
            return ValidationResult(
                valid=False,
                errors=self._format_errors(e),
            )

    def assert_valid_input(
        self,
        endpoint: Endpoint,
        input_data: Any,
        types: dict[str, JSONSchema] | None = None,
    ) -> None:
        """
        Validate input and raise LAVSError if invalid.

        Args:
            endpoint: Endpoint definition.
            input_data: Input data to validate.
            types: Optional types map.

        Raises:
            LAVSError: With code InvalidParams if validation fails.
        """
        result = self.validate_input(endpoint, input_data, types)
        if not result.valid:
            raise LAVSError(
                LAVSErrorCode.InvalidParams,
                f"Invalid input for endpoint '{endpoint.id}': {self._summarize_errors(result.errors)}",
                {"validation_errors": [vars(e) for e in result.errors]},
            )

    def assert_valid_output(
        self,
        endpoint: Endpoint,
        output: Any,
        types: dict[str, JSONSchema] | None = None,
    ) -> None:
        """
        Validate output and raise LAVSError if invalid.

        Args:
            endpoint: Endpoint definition.
            output: Output data to validate.
            types: Optional types map.

        Raises:
            LAVSError: With code InternalError if validation fails.
        """
        result = self.validate_output(endpoint, output, types)
        if not result.valid:
            raise LAVSError(
                LAVSErrorCode.InternalError,
                f"Invalid output from endpoint '{endpoint.id}': handler returned data that does not match schema",
                {"validation_errors": [vars(e) for e in result.errors]},
            )

    def _resolve_schema(
        self,
        schema: JSONSchema,
        types: dict[str, JSONSchema] | None,
    ) -> dict[str, Any]:
        """Merge types into schema for $ref resolution."""
        if not types or not self._has_type_refs(schema):
            return schema

        resolved = dict(schema)
        if "types" not in resolved:
            resolved["types"] = {}
        resolved["types"].update(types)
        return resolved

    def _has_type_refs(self, obj: Any) -> bool:
        """Check if schema contains $ref references to #/types/."""
        if not obj or not isinstance(obj, dict):
            return False
        if isinstance(obj.get("$ref"), str) and obj["$ref"].startswith("#/types/"):
            return True
        for value in obj.values():
            if self._has_type_refs(value):
                return True
        return False

    def _get_or_compile_validator(
        self,
        cache_key: str,
        schema: dict[str, Any],
        cache: dict[str, Draft7Validator],
    ) -> Draft7Validator:
        """Get or compile a JSON Schema validator."""
        if cache_key not in cache:
            try:
                cache[cache_key] = Draft7Validator(schema)
            except jsonschema.SchemaError as e:
                raise LAVSError(
                    LAVSErrorCode.InternalError,
                    f"Failed to compile JSON Schema for {cache_key}: {e}",
                ) from e
        return cache[cache_key]

    def _format_errors(self, error: JsonSchemaValidationError) -> list[ValidationErrorDetail]:
        """Format jsonschema errors into ValidationErrorDetail list."""
        errors: list[ValidationErrorDetail] = []
        for e in error.context or [error]:
            path_parts = getattr(e, "absolute_path", None) or getattr(e, "path", None) or []
            path_str = "/" + "/".join(str(p) for p in path_parts) if path_parts else "/"
            errors.append(
                ValidationErrorDetail(
                    path=path_str,
                    message=e.message or "Validation failed",
                    keyword=e.validator or "unknown",
                    params={},
                )
            )
        return errors

    def _summarize_errors(self, errors: list[ValidationErrorDetail]) -> str:
        """Create human-readable summary from validation errors."""
        if not errors:
            return "Unknown validation error"
        if len(errors) == 1:
            e = errors[0]
            return f"{e.path} {e.message}"
        return "; ".join(f"{e.path} {e.message}" for e in errors)

    def clear_cache(self) -> None:
        """Clear all cached validators. Useful when schemas change."""
        self._input_validators.clear()
        self._output_validators.clear()
