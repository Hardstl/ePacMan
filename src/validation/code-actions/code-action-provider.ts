import * as vscode from 'vscode';
import { ValidationIssue, ValidationResult } from '../core/validator-framework';

/**
 * Provides code actions for validation issues
 */
export class CodeActionProvider implements vscode.CodeActionProvider {
  /**
   * Provide code actions for the given document and range
   */
  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<(vscode.CodeAction | vscode.Command)[]> {
    // Don't provide actions if the range doesn't contain any diagnostics
    if (!context.diagnostics || context.diagnostics.length === 0) {
      return [];
    }
    
    // Don't provide actions if none of the diagnostics are from our extension
    const ourDiagnostics = context.diagnostics.filter(diagnostic => 
      diagnostic.source === 'ePacMan' || 
      diagnostic.source === 'ePacMan Policy' || 
      diagnostic.source === 'ePacMan Schema'
    );
    
    if (ourDiagnostics.length === 0) {
      return [];
    }
    
    const actions: vscode.CodeAction[] = [];
    
    // Process each diagnostic
    for (const diagnostic of ourDiagnostics) {
      // Only process diagnostics with a code
      if (!diagnostic.code) {
        continue;
      }
      
      const code = diagnostic.code.toString();
      
      // Create quickfix actions based on diagnostic code
      switch (code) {
        case 'POLICY_MISSING_EFFECT_PARAMETER':
          this.addFixAction(
            document, 
            diagnostic, 
            'Add effect parameter', 
            code, 
            actions
          );
          break;
          
        case 'POLICY_INCORRECT_EFFECT_REFERENCE':
          this.addFixAction(
            document, 
            diagnostic, 
            'Use effect parameter reference', 
            code, 
            actions
          );
          break;
          
        case 'POLICY_ASSIGNMENT_NAME_LENGTH':
          this.addFixAction(
            document, 
            diagnostic, 
            'Truncate name to 24 characters', 
            code, 
            actions
          );
          break;
          
        case 'POLICY_ASSIGNMENT_MISSING_SCOPE':
          this.addFixAction(
            document, 
            diagnostic, 
            'Add scope property', 
            code, 
            actions
          );
          break;
          
        case 'POLICY_MISSING_REFERENCE_ID':
          this.addFixAction(
            document, 
            diagnostic, 
            'Add reference ID', 
            code, 
            actions
          );
          break;
          
        case 'POLICY_DUPLICATE_REFERENCE_ID':
          this.addFixAction(
            document, 
            diagnostic, 
            'Make reference ID unique', 
            code, 
            actions
          );
          break;
          
        case 'POLICY_SET_MISSING_DEFINITION_ID':
          this.addFixAction(
            document, 
            diagnostic, 
            'Add policy definition ID', 
            code, 
            actions
          );
          break;
          
        case 'POLICY_SET_EMPTY_DEFINITIONS':
          this.addFixAction(
            document, 
            diagnostic, 
            'Add policy definition reference', 
            code, 
            actions
          );
          break;
          
        case 'POLICY_ASSIGNMENT_MISSING_POLICY_REFERENCE':
          this.addFixAction(
            document, 
            diagnostic, 
            'Add policy reference', 
            code, 
            actions
          );
          break;
      }
    }
    
    return actions;
  }
  
  /**
   * Add a fix action for the given diagnostic
   * @param document The document
   * @param diagnostic The diagnostic to fix
   * @param title The title of the action
   * @param code The diagnostic code
   * @param actions The array to add the action to
   */
  private addFixAction(
    document: vscode.TextDocument,
    diagnostic: vscode.Diagnostic,
    title: string,
    code: string,
    actions: vscode.CodeAction[]
  ): void {
    const action = new vscode.CodeAction(
      title,
      vscode.CodeActionKind.QuickFix
    );
    
    action.diagnostics = [diagnostic];
    action.isPreferred = true;
    
    action.command = {
      title: title,
      command: 'epacman.fixIssue',
      arguments: [document.uri, code, diagnostic.range, diagnostic.message]
    };
    
    actions.push(action);
  }
}