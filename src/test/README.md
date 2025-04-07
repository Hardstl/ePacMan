# ePacMan Extension Tests

This directory contains tests for the ePacMan VSCode extension. The tests are organized into unit tests and integration tests.

## Test Structure

- `runTest.ts`: Entry point for running the extension tests in a VSCode environment
- `suite/index.ts`: Test suite runner that discovers and runs all tests
- `suite/test-helpers.ts`: Helper functions and mocks for testing
- `suite/extension.test.ts`: Tests for extension activation and deactivation
- `suite/commands.test.ts`: Tests for the extension commands
- `suite/utils.test.ts`: Tests for utility functions

## Running Tests

### Running All Tests

To run all tests, use the following command:

```bash
npm test
```

This will compile the extension and tests, and then run the tests in a VSCode environment.

### Running Unit Tests Only

To run only the unit tests (faster, but doesn't test VSCode integration):

```bash
npm run test:unit
```

### Generating Test Coverage

To generate test coverage reports:

```bash
npm run test:coverage
```

This will generate a coverage report in the `coverage` directory.

## Test Coverage

The tests cover the following components:

1. **Extension Activation/Deactivation**
   - Extension activation
   - Extension deactivation
   - Context initialization

3. **Commands**
   - Command registration
   - Command execution
   - Error handling

4. **Utility Functions**
   - File operations
   - JSON parsing
   - Policy document identification
   - VSCode integration utilities

## Adding New Tests

When adding new features to the extension, please add corresponding tests. Follow these guidelines:

1. Create unit tests for individual components
2. Create integration tests for component interactions
3. Use mocks for VSCode API and external services
4. Ensure proper cleanup in teardown functions
5. Aim for high test coverage

## Mocking Strategy

The tests use Sinon.js for mocking. The `test-helpers.ts` file provides mock implementations for:

- VSCode ExtensionContext
- VSCode TextDocument
- VSCode window/workspace/commands APIs
- File system operations

When testing components that interact with VSCode APIs, use these mocks to isolate the component being tested.