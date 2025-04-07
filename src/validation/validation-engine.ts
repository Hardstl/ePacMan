import * as vscode from 'vscode';
import { Logger } from '../logging';
import { ValidationIssue, ValidationResult } from './core/validator-framework';
import { SchemaManager } from './core/schema-manager';
import { PolicyDefinitionValidator } from './validators/policy-definition-validator';
import { PolicySetDefinitionValidator } from './validators/policy-set-definition-validator';
import { PolicyAssignmentValidator } from './validators/policy-assignment-validator';
import { CodeActionProvider } from './code-actions/code-action-provider';
import { DiagnosticProvider } from './diagnostic-provider';

/**
 * Main Validation Engine
 */
export class ValidationEngine {
  private validators: any[] = [];
  private logger = Logger.getInstance();
  private schemaManager: SchemaManager;
  private codeActionProvider: CodeActionProvider;
  private diagnosticProvider: DiagnosticProvider;
  private validatorDisposables: vscode.Disposable[] = [];
  private isInitialized = false;
  private documentCache = new Map<string, {
    version: number,
    result: ValidationResult
  }>();
  
  /**
   * Constructor
   */
  constructor(context: vscode.ExtensionContext) {
    this.schemaManager = new SchemaManager(context.extensionPath);
    this.codeActionProvider = new CodeActionProvider();
    this.diagnosticProvider = DiagnosticProvider.getInstance();
  }
  
  /**
   * Initialize the validation engine
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }
    
    try {
      // Initialize schema manager
      await this.schemaManager.initialize();
      
      // Create validators
      this.validators = [
        new PolicyDefinitionValidator(this.schemaManager),
        new PolicySetDefinitionValidator(this.schemaManager),
        new PolicyAssignmentValidator(this.schemaManager)
      ];
      
      // Register code action provider for quick fixes
      this.validatorDisposables.push(
        vscode.languages.registerCodeActionsProvider(
          [{ language: 'json' }, { language: 'jsonc' }],
          this.codeActionProvider,
          {
            providedCodeActionKinds: [vscode.CodeActionKind.QuickFix]
          }
        )
      );
      
      // Register the fixIssue command to handle quick fixes
      this.validatorDisposables.push(
        vscode.commands.registerCommand('epacman.fixIssue', this.fixIssue.bind(this))
      );
      
      // Set up validation throttling
      const throttleValidator = this.createThrottledValidator();
      
      // Register for document change events (auto-validation)
      this.validatorDisposables.push(
        vscode.workspace.onDidChangeTextDocument(event => {
          throttleValidator(event.document);
        })
      );
      
      this.isInitialized = true;
      this.logger.info('Validation engine initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize validation engine', error);
      throw error;
    }
  }
  
  /**
   * Create a throttled validator function
   */
  private createThrottledValidator(): (document: vscode.TextDocument) => void {
    const pendingValidations = new Map<string, NodeJS.Timeout>();
    
    return (document: vscode.TextDocument) => {
      const key = document.uri.toString();
      
      // Cancel any pending validation for this document
      if (pendingValidations.has(key)) {
        clearTimeout(pendingValidations.get(key));
        pendingValidations.delete(key);
      }
      
      // Schedule a new validation
      const timeout = setTimeout(() => {
        pendingValidations.delete(key);
        this.validateDocument(document).catch(error => {
          this.logger.error('Error in throttled validation', error);
        });
      }, 500);
      
      pendingValidations.set(key, timeout);
    };
  }
  
  /**
   * Validate a document
   */
  async validateDocument(document: vscode.TextDocument): Promise<ValidationResult | undefined> {
    if (!document) {
      return undefined;
    }
    
    const uri = document.uri.toString();
    
    // Check cache
    const cached = this.documentCache.get(uri);
    if (cached && cached.version === document.version) {
      return cached.result;
    }
    
    try {
      this.logger.debug(`Validating document: ${uri}`);
      
      // Find a validator that can handle this document
      for (const validator of this.validators) {
        if (await validator.canValidate(document)) {
          // Create a validation context with schema manager
          const issues: ValidationIssue[] = await validator.validate(document, this.schemaManager);
          
          // Create a validation result
          const result: ValidationResult = {
            documentUri: document.uri,
            issues: issues || [],
            valid: !issues || issues.length === 0
          };
          
          // Update diagnostics to show validation issues
          this.diagnosticProvider.updateDiagnostics(document, issues);
          
          // Cache the result
          this.documentCache.set(uri, {
            version: document.version,
            result
          });
          
          return result;
        }
      }
      
      // Clear diagnostics if no validator can handle this document
      this.diagnosticProvider.clearDiagnostics(document);
      
      this.logger.debug(`No validator found for document: ${uri}`);
      return undefined;
    } catch (error) {
      this.logger.error(`Error validating document: ${uri}`, error);
      return undefined;
    }
  }
  
  /**
   * Fix an issue using the appropriate validator
   */
  private async fixIssue(
    documentUri: vscode.Uri,
    issueCode: string,
    range: vscode.Range
  ): Promise<void> {
    try {
      const document = await vscode.workspace.openTextDocument(documentUri);
      
      // Find the validator that can handle this document
      for (const validator of this.validators) {
        if (await validator.canValidate(document)) {
          // Get all rules that can fix this issue
          for (const rule of validator.getRules()) {
            // Check if this rule can fix the issue
            if (rule.canFix && rule.fix && rule.canFix({ code: issueCode, range } as any)) {
              // Apply the fix
              const edit = await rule.fix(document, { 
                code: issueCode, 
                range,
                // Add other required properties with dummy values
                message: '',
                severity: 0,
                source: 'ePacMan Policy',
                rule: rule.id
              } as any);
              
              if (edit) {
                // Apply the edit
                const success = await vscode.workspace.applyEdit(edit);
                
                if (success) {
                  // Re-validate the document
                  await this.validateDocument(document);
                  return;
                }
              }
            }
          }
        }
      }
      
      this.logger.warn(`No validator found that can fix issue: ${issueCode}`);
    } catch (error) {
      this.logger.error(`Error fixing issue: ${issueCode}`, error);
      vscode.window.showErrorMessage(`Failed to fix issue: ${error}`);
    }
  }
  
  /**
   * Dispose resources
   */
  dispose(): void {
    // Dispose validators
    for (const validator of this.validators) {
      validator.dispose();
    }
    
    // Dispose other registered disposables
    for (const disposable of this.validatorDisposables) {
      disposable.dispose();
    }
    
    // Clear cache
    this.documentCache.clear();
    
    this.logger.debug('Validation engine disposed');
  }
}