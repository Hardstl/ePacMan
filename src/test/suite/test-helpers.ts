import * as vscode from 'vscode';
import * as sinon from 'sinon';
import * as assert from 'assert';
import * as fs from 'fs-extra';
import * as path from 'path';

/**
 * Mock for VSCode's ExtensionContext
 */
export function createMockExtensionContext(): vscode.ExtensionContext {
  const extensionPath = path.resolve(__dirname, '../../../');
  
  return {
    subscriptions: [],
    workspaceState: {
      get: sinon.stub(),
      update: sinon.stub().resolves(),
      keys: sinon.stub().returns([])
    } as any,
    globalState: {
      get: sinon.stub(),
      update: sinon.stub().resolves(),
      setKeysForSync: sinon.stub(),
      keys: sinon.stub().returns([])
    } as any,
    extensionPath,
    storagePath: path.join(extensionPath, 'storage'),
    globalStoragePath: path.join(extensionPath, 'globalStorage'),
    logPath: path.join(extensionPath, 'logs'),
    asAbsolutePath: (relativePath: string) => path.join(extensionPath, relativePath),
    extensionUri: vscode.Uri.file(extensionPath),
    environmentVariableCollection: {} as any,
    extensionMode: vscode.ExtensionMode.Test,
    globalStorageUri: vscode.Uri.file(path.join(extensionPath, 'globalStorage')),
    logUri: vscode.Uri.file(path.join(extensionPath, 'logs')),
    storageUri: vscode.Uri.file(path.join(extensionPath, 'storage')),
    secrets: {
      get: sinon.stub().resolves(''),
      store: sinon.stub().resolves(),
      delete: sinon.stub().resolves(),
      onDidChange: sinon.stub().returns({ dispose: sinon.stub() })
    },
    extension: {} as any,
    languageModelAccessInformation: {} as any
  };
}

/**
 * Mock for VSCode's TextDocument
 */
export function createMockTextDocument(content: string, fileName: string = 'test.json', languageId: string = 'json'): vscode.TextDocument {
  const uri = vscode.Uri.file(fileName);
  
  return {
    uri,
    fileName,
    isUntitled: false,
    languageId,
    version: 1,
    isDirty: false,
    isClosed: false,
    save: sinon.stub().resolves(true),
    eol: vscode.EndOfLine.LF,
    lineCount: content.split('\n').length,
    lineAt: function(lineOrPosition: number | vscode.Position): vscode.TextLine {
      const line = typeof lineOrPosition === 'number'
        ? lineOrPosition
        : lineOrPosition.line;
      
      const lineContent = content.split('\n')[line] || '';
      return {
        lineNumber: line,
        text: lineContent,
        range: new vscode.Range(line, 0, line, lineContent.length),
        rangeIncludingLineBreak: new vscode.Range(line, 0, line, lineContent.length + 1),
        firstNonWhitespaceCharacterIndex: lineContent.search(/\S/),
        isEmptyOrWhitespace: lineContent.trim().length === 0
      };
    },
    offsetAt: (position: vscode.Position) => {
      const lines = content.split('\n');
      let offset = 0;
      for (let i = 0; i < position.line; i++) {
        offset += lines[i].length + 1; // +1 for the newline character
      }
      return offset + position.character;
    },
    positionAt: (offset: number) => {
      const lines = content.split('\n');
      let currentOffset = 0;
      let lineNumber = 0;
      
      for (const line of lines) {
        const lineLength = line.length + 1; // +1 for the newline character
        if (currentOffset + lineLength > offset) {
          return new vscode.Position(lineNumber, offset - currentOffset);
        }
        currentOffset += lineLength;
        lineNumber++;
      }
      
      return new vscode.Position(lines.length - 1, lines[lines.length - 1].length);
    },
    getText: (range?: vscode.Range) => {
      if (!range) {
        return content;
      }
      
      const lines = content.split('\n');
      let result = '';
      
      for (let i = range.start.line; i <= range.end.line; i++) {
        const line = lines[i] || '';
        if (i === range.start.line && i === range.end.line) {
          result += line.substring(range.start.character, range.end.character);
        } else if (i === range.start.line) {
          result += line.substring(range.start.character) + '\n';
        } else if (i === range.end.line) {
          result += line.substring(0, range.end.character);
        } else {
          result += line + '\n';
        }
      }
      
      return result;
    },
    getWordRangeAtPosition: () => undefined,
    validateRange: (range: vscode.Range) => range,
    validatePosition: (position: vscode.Position) => position
  };
}

/**
 * Create a temporary file with the given content
 */
export async function createTempFile(content: string, fileName: string): Promise<vscode.Uri> {
  const tempDir = path.join(__dirname, '../../temp');
  await fs.ensureDir(tempDir);
  
  const filePath = path.join(tempDir, fileName);
  await fs.writeFile(filePath, content, 'utf8');
  
  return vscode.Uri.file(filePath);
}

/**
 * Clean up temporary files
 */
export async function cleanupTempFiles(): Promise<void> {
  const tempDir = path.join(__dirname, '../../temp');
  if (await fs.pathExists(tempDir)) {
    await fs.remove(tempDir);
  }
}

/**
 * Create a mock for the VSCode window
 */
export function createMockVSCodeWindow(): void {
  const showInformationMessageStub = sinon.stub();
  const showWarningMessageStub = sinon.stub();
  const showErrorMessageStub = sinon.stub();
  const showInputBoxStub = sinon.stub();
  
  sinon.replace(vscode.window, 'showInformationMessage', showInformationMessageStub);
  sinon.replace(vscode.window, 'showWarningMessage', showWarningMessageStub);
  sinon.replace(vscode.window, 'showErrorMessage', showErrorMessageStub);
  sinon.replace(vscode.window, 'showInputBox', showInputBoxStub);
  
  // Default behavior
  showInformationMessageStub.resolves('');
  showWarningMessageStub.resolves('');
  showErrorMessageStub.resolves('');
  showInputBoxStub.resolves('');
}

/**
 * Create a mock for the VSCode workspace
 */
export function createMockVSCodeWorkspace(): void {
  const findFilesStub = sinon.stub();
  const getConfigurationStub = sinon.stub();
  
  sinon.replace(vscode.workspace, 'findFiles', findFilesStub);
  sinon.replace(vscode.workspace, 'getConfiguration', getConfigurationStub);
  
  // Default behavior
  findFilesStub.resolves([]);
  getConfigurationStub.returns({
    get: sinon.stub().returns(null),
    has: sinon.stub().returns(false),
    update: sinon.stub().resolves(),
    inspect: sinon.stub().returns(null)
  });
}

/**
 * Create a mock for the VSCode commands
 */
export function createMockVSCodeCommands(): void {
  const executeCommandStub = sinon.stub();
  const registerCommandStub = sinon.stub();
  
  sinon.replace(vscode.commands, 'executeCommand', executeCommandStub);
  sinon.replace(vscode.commands, 'registerCommand', registerCommandStub);
  
  // Default behavior
  executeCommandStub.resolves();
  registerCommandStub.returns({ dispose: sinon.stub() });
}

/**
 * Reset all stubs
 */
export function resetStubs(): void {
  sinon.restore();
}

/**
 * Sample policy definition JSON
 */
export const samplePolicyDefinition = {
  "name": "test-policy",
  "properties": {
    "displayName": "Test Policy",
    "description": "A test policy definition",
    "mode": "All",
    "policyRule": {
      "if": {
        "field": "type",
        "equals": "Microsoft.Compute/virtualMachines"
      },
      "then": {
        "effect": "audit"
      }
    }
  }
};

/**
 * Sample policy set definition JSON
 */
export const samplePolicySetDefinition = {
  "name": "test-policy-set",
  "properties": {
    "displayName": "Test Policy Set",
    "description": "A test policy set definition",
    "policyDefinitions": [
      {
        "policyDefinitionId": "/providers/Microsoft.Authorization/policyDefinitions/test-policy",
        "parameters": {}
      }
    ]
  }
};

/**
 * Sample policy assignment JSON
 */
export const samplePolicyAssignment = {
  "nodeName": "test-assignment",
  "$schema": "https://raw.githubusercontent.com/Azure/enterprise-azure-policy-as-code/main/Schemas/policy-assignment-schema.json",
  "name": "test-assignment",
  "properties": {
    "displayName": "Test Assignment",
    "description": "A test policy assignment",
    "policyDefinitionId": "/providers/Microsoft.Authorization/policyDefinitions/test-policy",
    "parameters": {}
  }
};