import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import * as path from 'path';
import * as fs from 'fs-extra';
import { 
  createMockTextDocument, 
  samplePolicyDefinition,
  samplePolicySetDefinition,
  samplePolicyAssignment,
  createTempFile,
  cleanupTempFiles,
  resetStubs
} from './test-helpers';

// Import the utility functions
import { 
  getWorkspaceFolder, 
  findFiles, 
  readFile, 
  writeFile, 
  parseJsonFile, 
  getRelativePath,
  openFileInEditor,
  showInformationMessage,
  showErrorMessage,
  showWarningMessage
} from '../../utils';

// Import document utilities
import {
  parseJsonContent,
  getPolicyDocumentType,
  identifyPolicyDocument,
  isPolicyDocument,
  PolicyDocumentType
} from '../../utils/document-utils';

suite('Utils Test Suite', () => {
  setup(() => {
    // Reset all stubs before each test
    resetStubs();
  });
  
  teardown(async () => {
    // Clean up after each test
    resetStubs();
    await cleanupTempFiles();
  });
  
  test('getWorkspaceFolder should return the workspace folder', () => {
    // Mock vscode.workspace.getWorkspaceFolder
    const getWorkspaceFolderStub = sinon.stub(vscode.workspace, 'getWorkspaceFolder').returns({
      uri: vscode.Uri.file('/workspace'),
      name: 'workspace',
      index: 0
    });
    
    // Create a URI
    const uri = vscode.Uri.file('/workspace/test.json');
    
    // Get the workspace folder
    const result = getWorkspaceFolder(uri);
    
    // Verify the result
    assert.ok(result, 'Workspace folder should not be undefined');
    assert.strictEqual(path.normalize(result.uri.fsPath), path.normalize('/workspace'), 'Workspace folder should be returned');
    
    // Verify that getWorkspaceFolder was called
    assert.strictEqual(getWorkspaceFolderStub.calledOnce, true, 'getWorkspaceFolder should be called once');
    assert.strictEqual(getWorkspaceFolderStub.firstCall.args[0], uri, 'getWorkspaceFolder should be called with the URI');
    
    // Restore the stub
    getWorkspaceFolderStub.restore();
  });
  
  test('findFiles should find files in the workspace', async () => {
    // Mock vscode.workspace.findFiles
    const findFilesStub = sinon.stub(vscode.workspace, 'findFiles').resolves([
      vscode.Uri.file('/workspace/test1.json'),
      vscode.Uri.file('/workspace/test2.json')
    ]);
    
    // Find files
    const result = await findFiles('**/*.json');
    
    // Verify the result
    assert.strictEqual(result.length, 2, 'Two files should be found');
    assert.strictEqual(path.normalize(result[0].fsPath), path.normalize('/workspace/test1.json'), 'First file should be test1.json');
    assert.strictEqual(path.normalize(result[1].fsPath), path.normalize('/workspace/test2.json'), 'Second file should be test2.json');
    
    // Verify that findFiles was called
    assert.strictEqual(findFilesStub.calledOnce, true, 'findFiles should be called once');
    assert.strictEqual(findFilesStub.firstCall.args[0], '**/*.json', 'findFiles should be called with the pattern');
    
    // Restore the stub
    findFilesStub.restore();
  });
  
  test('readFile should read a file', async () => {
    // Create a temporary file
    const uri = await createTempFile('test content', 'test.txt');
    
    // Read the file
    const content = await readFile(uri);
    
    // Verify the result
    assert.strictEqual(content, 'test content', 'File content should be read');
  });
  
  test('writeFile should write a file', async () => {
    // Create a URI for a new file
    const uri = vscode.Uri.file(path.join(__dirname, '../../temp/test-write.txt'));
    
    // Write the file
    await writeFile(uri, 'test content');
    
    // Read the file to verify
    const content = await fs.readFile(uri.fsPath, 'utf8');
    
    // Verify the result
    assert.strictEqual(content, 'test content', 'File content should be written');
  });
  
  test('parseJsonFile should parse a JSON file', async () => {
    // Create a temporary file with JSON content
    const uri = await createTempFile(JSON.stringify(samplePolicyDefinition, null, 2), 'test.json');
    
    // Parse the file
    const result = await parseJsonFile(uri);
    
    // Verify the result
    assert.deepStrictEqual(result, samplePolicyDefinition, 'JSON should be parsed correctly');
  });
  
  test('parseJsonFile should throw an error for invalid JSON', async () => {
    // Create a temporary file with invalid JSON content
    const uri = await createTempFile('{ "name": "test", "properties": { "mode": "All", }', 'invalid.json');
    
    // Parse the file
    try {
      await parseJsonFile(uri);
      assert.fail('parseJsonFile should throw an error for invalid JSON');
    } catch (error) {
      assert.strictEqual(error instanceof Error, true, 'Error should be thrown');
      assert.strictEqual((error as Error).message.includes('Invalid JSON'), true, 'Error message should mention invalid JSON');
    }
  });
  
  test('getRelativePath should return the relative path', () => {
    // Mock vscode.workspace.getWorkspaceFolder
    const getWorkspaceFolderStub = sinon.stub(vscode.workspace, 'getWorkspaceFolder').returns({
      uri: vscode.Uri.file('/workspace'),
      name: 'workspace',
      index: 0
    });
    
    // Create a URI
    const uri = vscode.Uri.file('/workspace/folder/test.json');
    
    // Get the relative path
    const result = getRelativePath(uri);
    
    // Verify the result
    assert.strictEqual(result.replace(/\\/g, '/'), 'folder/test.json', 'Relative path should be returned');
    
    // Restore the stub
    getWorkspaceFolderStub.restore();
  });
  
  test('openFileInEditor should open a file in the editor', async () => {
    // Mock vscode.window.showTextDocument
    const showTextDocumentStub = sinon.stub(vscode.window, 'showTextDocument').resolves({} as any);
    
    // Create a URI
    const uri = vscode.Uri.file('/workspace/test.json');
    
    // Open the file
    await openFileInEditor(uri);
    
    // Verify that showTextDocument was called
    assert.strictEqual(showTextDocumentStub.calledOnce, true, 'showTextDocument should be called once');
    assert.strictEqual(showTextDocumentStub.firstCall.args[0], uri, 'showTextDocument should be called with the URI');
    
    // Restore the stub
    showTextDocumentStub.restore();
  });
  
  test('showInformationMessage should show an information message', async () => {
    // Mock vscode.window.showInformationMessage
    const showInformationMessageStub = sinon.stub(vscode.window, 'showInformationMessage').resolves({ title: 'OK' });
    
    // Show the message
    const result = await showInformationMessage('Test message', 'OK', 'Cancel');
    
    // Verify the result
    assert.deepStrictEqual(result, { title: 'OK' }, 'Result should be the selected option');
    
    // Verify that showInformationMessage was called
    assert.strictEqual(showInformationMessageStub.calledOnce, true, 'showInformationMessage should be called once');
    assert.strictEqual(showInformationMessageStub.firstCall.args[0], 'Test message', 'showInformationMessage should be called with the message');
    assert.strictEqual(showInformationMessageStub.firstCall.args[1], 'OK', 'showInformationMessage should be called with the first option');
    assert.strictEqual(showInformationMessageStub.firstCall.args[2], 'Cancel', 'showInformationMessage should be called with the second option');
    
    // Restore the stub
    showInformationMessageStub.restore();
  });
  
  test('parseJsonContent should parse JSON content', () => {
    // Create JSON content
    const content = JSON.stringify(samplePolicyDefinition, null, 2);
    
    // Parse the content
    const result = parseJsonContent(content);
    
    // Verify the result
    assert.deepStrictEqual(result.json, samplePolicyDefinition, 'JSON should be parsed correctly');
    assert.strictEqual(result.errors.length, 0, 'There should be no errors');
  });
  
  test('parseJsonContent should handle invalid JSON', () => {
    // Create invalid JSON content
    const content = '{ "name": "test", "properties": { "mode": "All", }';
    
    // Parse the content
    const result = parseJsonContent(content);
    
    // Verify the result
    assert.strictEqual(result.errors.length > 0, true, 'There should be errors');
  });
  
  test('getPolicyDocumentType should identify policy definition', () => {
    // Get the document type
    const result = getPolicyDocumentType(samplePolicyDefinition);
    
    // Verify the result
    assert.strictEqual(result, PolicyDocumentType.PolicyDefinition, 'Document should be identified as a policy definition');
  });
  
  test('getPolicyDocumentType should identify policy set definition', () => {
    // Get the document type
    const result = getPolicyDocumentType(samplePolicySetDefinition);
    
    // Verify the result
    assert.strictEqual(result, PolicyDocumentType.PolicySetDefinition, 'Document should be identified as a policy set definition');
  });
  
  test('getPolicyDocumentType should identify policy assignment', () => {
    // Get the document type
    const result = getPolicyDocumentType(samplePolicyAssignment);
    
    // Verify the result
    assert.strictEqual(result, PolicyDocumentType.PolicyAssignment, 'Document should be identified as a policy assignment');
  });
  
  test('identifyPolicyDocument should identify policy document', async () => {
    // Create a mock document
    const document = createMockTextDocument(JSON.stringify(samplePolicyDefinition, null, 2));
    
    // Identify the document
    const result = await identifyPolicyDocument(document);
    
    // Verify the result
    assert.strictEqual(result, PolicyDocumentType.PolicyDefinition, 'Document should be identified as a policy definition');
  });
  
  test('isPolicyDocument should return true for policy document', async () => {
    // Create a mock document
    const document = createMockTextDocument(JSON.stringify(samplePolicyDefinition, null, 2));
    
    // Check if it's a policy document
    const result = await isPolicyDocument(document);
    
    // Verify the result
    assert.strictEqual(result, true, 'Document should be identified as a policy document');
  });
  
  test('isPolicyDocument should return false for non-policy document', async () => {
    // Create a mock document
    const document = createMockTextDocument('{ "name": "test" }');
    
    // Check if it's a policy document
    const result = await isPolicyDocument(document);
    
    // Verify the result
    assert.strictEqual(result, false, 'Document should not be identified as a policy document');
  });
});