"""Tests for LAVSValidator."""

import pytest

from lavs_runtime import LAVSValidator, ValidationResult
from lavs_types import Endpoint, Schema, ScriptHandler, LAVSError, LAVSErrorCode


@pytest.fixture
def endpoint_with_input_schema() -> Endpoint:
    """Endpoint with input schema."""
    return Endpoint(
        id="addTodo",
        method="mutation",
        handler=ScriptHandler(command="node", args=["add.js"]),
        schema=Schema(
            input={
                "type": "object",
                "properties": {
                    "text": {"type": "string"},
                    "priority": {"type": "number", "default": 0},
                },
                "required": ["text"],
            },
        ),
    )


@pytest.fixture
def endpoint_with_output_schema() -> Endpoint:
    """Endpoint with output schema."""
    return Endpoint(
        id="getTodo",
        method="query",
        handler=ScriptHandler(command="node", args=["get.js"]),
        schema=Schema(
            output={
                "type": "object",
                "properties": {
                    "id": {"type": "number"},
                    "text": {"type": "string"},
                    "done": {"type": "boolean"},
                },
                "required": ["id", "text", "done"],
            },
        ),
    )


def test_validate_input_success(endpoint_with_input_schema: Endpoint) -> None:
    """Test successful input validation."""
    validator = LAVSValidator()
    result = validator.validate_input(
        endpoint_with_input_schema,
        {"text": "Buy milk", "priority": 1},
    )
    assert result.valid is True
    assert len(result.errors) == 0


def test_validate_input_missing_required(endpoint_with_input_schema: Endpoint) -> None:
    """Test input validation fails when required field missing."""
    validator = LAVSValidator()
    result = validator.validate_input(endpoint_with_input_schema, {})
    assert result.valid is False
    assert len(result.errors) > 0


def test_validate_input_wrong_type(endpoint_with_input_schema: Endpoint) -> None:
    """Test input validation fails on wrong type."""
    validator = LAVSValidator()
    result = validator.validate_input(
        endpoint_with_input_schema,
        {"text": 123},  # Should be string
    )
    assert result.valid is False


def test_validate_output_success(endpoint_with_output_schema: Endpoint) -> None:
    """Test successful output validation."""
    validator = LAVSValidator()
    result = validator.validate_output(
        endpoint_with_output_schema,
        {"id": 1, "text": "Task", "done": False},
    )
    assert result.valid is True


def test_validate_output_fails(endpoint_with_output_schema: Endpoint) -> None:
    """Test output validation fails on invalid data."""
    validator = LAVSValidator()
    result = validator.validate_output(
        endpoint_with_output_schema,
        {"id": "not-a-number", "text": "Task", "done": False},
    )
    assert result.valid is False


def test_validate_no_schema_passes() -> None:
    """Test validation passes when no schema defined."""
    endpoint = Endpoint(
        id="noSchema",
        method="query",
        handler=ScriptHandler(command="echo"),
    )
    validator = LAVSValidator()
    result = validator.validate_input(endpoint, {"anything": "goes"})
    assert result.valid is True


def test_assert_valid_input_raises(endpoint_with_input_schema: Endpoint) -> None:
    """Test assert_valid_input raises LAVSError on invalid input."""
    validator = LAVSValidator()
    with pytest.raises(LAVSError) as exc_info:
        validator.assert_valid_input(endpoint_with_input_schema, {})
    assert exc_info.value.code == LAVSErrorCode.InvalidParams


def test_assert_valid_output_raises(endpoint_with_output_schema: Endpoint) -> None:
    """Test assert_valid_output raises LAVSError on invalid output."""
    validator = LAVSValidator()
    with pytest.raises(LAVSError) as exc_info:
        validator.assert_valid_output(
            endpoint_with_output_schema,
            {"invalid": "output"},
        )
    assert exc_info.value.code == LAVSErrorCode.InternalError


def test_clear_cache() -> None:
    """Test validator cache can be cleared."""
    endpoint = Endpoint(
        id="cached",
        method="query",
        handler=ScriptHandler(command="echo"),
        schema=Schema(input={"type": "object", "properties": {"x": {"type": "string"}}}),
    )
    validator = LAVSValidator()
    validator.validate_input(endpoint, {"x": "ok"})
    validator.clear_cache()
    # Should still work after clear
    result = validator.validate_input(endpoint, {"x": "ok"})
    assert result.valid is True
