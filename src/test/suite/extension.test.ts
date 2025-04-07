import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import * as path from 'path';
import * as fs from 'fs-extra';
import { 
  createMockExtensionContext, 
  createMockTextDocument, 
  samplePolicyDefinition,
  resetStubs
} from './test-helpers';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as myExtension from '../../extension';

suite('Extension Test Suite', () => {
  let context: vscode.ExtensionContext;
  
  setup(() => {
    // Create a mock extension context
    context = createMockExtensionContext();
    
    // Reset all stubs before each test
    resetStubs();
  });
  
  teardown(() => {
    // Clean up after each test
    resetStubs();
  });
  
  test('Extension should activate', async () => {
    // Mock the validation engine's initialize method
    const initializeStub = sinon.stub().resolves();
    const validateDocumentStub = sinon.stub().resolves({ valid: true, errors: [] });
    const disposeStub = sinon.stub();
    
    // Create a mock for the ValidationEngine
    const ValidationEngineMock = sinon.stub().returns({
      initialize: initializeStub,
      validateDocument: validateDocumentStub,
      dispose: disposeStub
    });
    
    // Create a mock validation module instead of trying to replace just the ValidationEngine
    const validationModuleMock = {
      ValidationEngine: ValidationEngineMock,
      // Include other exports that might be used
      DiagnosticProvider: {
        getInstance: sinon.stub().returns({
          clearDiagnostics: sinon.stub(),
          updateDiagnostics: sinon.stub()
        })
      }
    };
    
    // Mock the utils module
    const utilsModule = require('../../utils');
    const mockUtils = { ...utilsModule };
    mockUtils.isPolicyDocument = async () => true;
    
    // Use proxyquire to replace both the validation and utils modules
    const proxyquire = require('proxyquire').noCallThru();
    const myExtensionProxy = proxyquire('../../extension', {
      './utils': mockUtils,
      './validation': validationModuleMock
    });
    
    // Mock the registerCommands function
    const registerCommandsStub = sinon.stub();
    const originalRegisterCommands = require('../../commands').registerCommands;
    require('../../commands').registerCommands = registerCommandsStub;
    
    // Mock the Logger
    const loggerStub = {
      info: sinon.stub(),
      debug: sinon.stub(),
      error: sinon.stub(),
      warn: sinon.stub()
    };
    const getInstanceStub = sinon.stub().returns(loggerStub);
    const originalLogger = require('../../logging').Logger;
    require('../../logging').Logger.getInstance = getInstanceStub;
    
    // Mock vscode.window.showInformationMessage
    const showInfoStub = sinon.stub(vscode.window, 'showInformationMessage').resolves();
    
    try {
      // Activate the extension
      await myExtensionProxy.activate(context);
      
      // Verify that the validation engine was initialized
      assert.strictEqual(initializeStub.calledOnce, true, 'ValidationEngine.initialize should be called once');
      
      // Verify that commands were registered
      assert.strictEqual(registerCommandsStub.calledOnce, true, 'registerCommands should be called once');
      assert.strictEqual(registerCommandsStub.firstCall.args[0], context, 'registerCommands should be called with context');
      
      // Verify that the extension activated successfully
      assert.strictEqual(showInfoStub.calledOnce, true, 'showInformationMessage should be called once');
      assert.strictEqual(showInfoStub.firstCall.args[0], 'ePacMan extension activated', 'Activation message should be shown');
      
      // Verify that the logger was used
      assert.strictEqual(loggerStub.info.called, true, 'Logger.info should be called');
      assert.strictEqual(loggerStub.debug.called, true, 'Logger.debug should be called');
    } finally {
      // Restore the original functions
      require('../../commands').registerCommands = originalRegisterCommands;
      require('../../logging').Logger.getInstance = originalLogger.getInstance;
      
      // Restore stubs
      showInfoStub.restore();
    }
  });
  
  test('Extension should deactivate', async () => {
    // Mock the GitHubComparisonService
    const disposeStub = sinon.stub();
    const getInstanceStub = sinon.stub().returns({
      dispose: disposeStub
    });
    
    const originalGitHubComparisonService = require('../../github').GitHubComparisonService;
    require('../../github').GitHubComparisonService.getInstance = getInstanceStub;
    
    // Mock the Logger
    const loggerStub = {
      info: sinon.stub(),
      debug: sinon.stub(),
      error: sinon.stub(),
      warn: sinon.stub()
    };
    const loggerGetInstanceStub = sinon.stub().returns(loggerStub);
    const originalLogger = require('../../logging').Logger;
    require('../../logging').Logger.getInstance = loggerGetInstanceStub;
    
    // Mock vscode.commands.executeCommand
    const executeCommandStub = sinon.stub(vscode.commands, 'executeCommand').resolves();
    
    try {
      // Deactivate the extension
      myExtension.deactivate();
      
      // Verify that the GitHubComparisonService was disposed
      assert.strictEqual(disposeStub.calledOnce, true, 'GitHubComparisonService.dispose should be called once');
      
      // Verify that the context was updated
      assert.strictEqual(executeCommandStub.calledOnce, true, 'executeCommand should be called once');
      assert.strictEqual(executeCommandStub.firstCall.args[0], 'setContext', 'executeCommand should be called with setContext');
      assert.strictEqual(executeCommandStub.firstCall.args[1], 'epacman.isCustomPolicy', 'executeCommand should be called with epacman.isCustomPolicy');
      assert.strictEqual(executeCommandStub.firstCall.args[2], false, 'executeCommand should be called with false');
      
      // Verify that the logger was used
      assert.strictEqual(loggerStub.info.called, true, 'Logger.info should be called');
    } finally {
      // Restore the original functions
      require('../../github').GitHubComparisonService.getInstance = originalGitHubComparisonService.getInstance;
      require('../../logging').Logger.getInstance = originalLogger.getInstance;
      
      // Restore stubs
      executeCommandStub.restore();
    }
  });
});