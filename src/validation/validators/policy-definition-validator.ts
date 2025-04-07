import * as vscode from 'vscode';
import { AbstractValidator, ValidationIssue, ValidationSeverity } from '../core/validator-framework';
import { JsonParser, JsonParseResult } from '../core/json-parser';
import { SchemaManager } from '../core/schema-manager';

/**
 * Policy Definition Validator
 * Validates Azure Policy Definition documents
 */
export class PolicyDefinitionValidator extends AbstractValidator {
  private parser: JsonParser;
  private schemaManager: SchemaManager;
  
  /**
   * Constructor
   */
  constructor(schemaManager: SchemaManager) {
    super('policy-definition');
    this.parser = new JsonParser();
    this.schemaManager = schemaManager;
    
    // Register policy definition specific rules
    this.registerPolicyDefinitionRules();
  }
  
  /**
   * Check if this validator can validate the document
   */
  async canValidate(document: vscode.TextDocument): Promise<boolean> {
    if (!document) return false;
    
    try {
      const text = document.getText();
      
      // Quick check if this might be a policy definition
      if (!text.includes('"policyRule"') || !text.includes('"then"') || !text.includes('"if"')) {
        return false;
      }
      
      // Try to parse the document
      const parseResult = await this.parser.parse(document);
      if (!parseResult) return false;
      
      // Check if it has the characteristics of a policy definition
      return this.checkForPolicyDefinition(parseResult.content);
    } catch (error) {
      return false;
    }
  }
  
  /**
   * Check if content appears to be a policy definition
   */
  private checkForPolicyDefinition(content: any): boolean {
    // Check type if available
    if (content.type === 'Microsoft.Authorization/policyDefinitions') {
      return true;
    }
    
    // Check for policy definition structure
    const hasPolicyRule = content.properties && content.properties.policyRule;
    const hasIfThenBlock = hasPolicyRule && 
                           content.properties.policyRule.if && 
                           content.properties.policyRule.then;
                           
    return hasPolicyRule && hasIfThenBlock;
  }
  
  /**
   * Parse the document
   */
  async parseDocument(document: vscode.TextDocument): Promise<JsonParseResult | null> {
    return this.parser.parse(document);
  }
  
  /**
   * Determine document type
   */
  protected determineDocumentType(parseResult: any): string {
    return 'policy-definition';
  }
  
  /**
   * Register policy definition specific rules
   */
  private registerPolicyDefinitionRules(): void {
    // Rule: Schema Validation
    this.registerRule({
      id: 'policy-definition-schema',
      name: 'Schema Validation',
      description: 'Validate policy definition against JSON schema',
      enabled: true,
      severity: ValidationSeverity.Error,
      async validate(document, content, context) {
        // Get the schema URI from the document if available
        let schemaUrl = content.$schema;
        
        // Get the schema manager from context
        const schemaManager = context.schemaManager;
        
        // Validate using the appropriate schema
        const result = schemaManager.validateSchema(
          schemaUrl || 'policy-definition',
          content,
          document,
          context.parseResult
        );
        
        return result.errors;
      }
    });
    
    // Rule: Effect Parameter Validation
    this.registerRule({
      id: 'policy-definition-effect-parameter',
      name: 'Effect Parameter Validation',
      description: 'Validate effect parameter exists and is correctly referenced',
      enabled: true,
      severity: ValidationSeverity.Error,
      async validate(document, content, context) {
        const issues: ValidationIssue[] = [];
        
        // Initialize range with a default value covering the first line
        let range = new vscode.Range(0, 0, 0, document.lineAt(0).text.length);
        
        // Check if we have a policyRule and properties
        if (!content.properties || !content.properties.policyRule) {
          return issues;
        }
        
        // Check if we have a 'then' block with an effect
        const policyRule = content.properties.policyRule;
        if (!policyRule.then || !policyRule.then.effect) {
          return issues;
        }
        
        // Check for effect parameter
        const hasEffectParam = content.properties.parameters && 
                               content.properties.parameters.effect;
        
        // Check if effect references a parameter
        const effectValue = policyRule.then.effect;
        const isParamRef = typeof effectValue === 'string' && 
                          effectValue.includes('[parameters(');
        
        // Validate parameter exists
        if (isParamRef && !hasEffectParam) {
          // Try to find the position of the effect in the then block
          try {
            const effectLineMatch = /\s*"effect"\s*:/g;
            const text = document.getText();
            let match: RegExpExecArray | null;
            
            while ((match = effectLineMatch.exec(text)) !== null) {
              // Found a match, get the line number
              const pos = document.positionAt(match.index);
              range = new vscode.Range(pos.line, 0, pos.line, document.lineAt(pos.line).text.length);
              
              // Use this match if it's near the "then" block
              const prevLines = text.substring(0, match.index);
              if (prevLines.lastIndexOf('"then"') > prevLines.lastIndexOf('"if"')) {
                break;
              }
            }
          } catch (error) {
            // Keep the default range if there's an error
          }
          
          issues.push({
            code: 'POLICY_MISSING_EFFECT_PARAMETER',
            message: 'Effect references parameter but "effect" parameter is not defined',
            severity: ValidationSeverity.Error,
            range,
            source: 'ePacMan Policy',
            rule: 'policy-definition-effect-parameter'
          });
        }
        
        // Validate the effect value references the parameter correctly
        if (hasEffectParam && !effectValue.includes('[parameters(\'effect\')]')) {
          // Initialize range with default value
          range = new vscode.Range(0, 0, 0, document.lineAt(0).text.length);
          
          // Try to find the position of the effect in the then block
          try {
            const effectLineMatch = /\s*"effect"\s*:\s*"[^"]+"/g;
            const text = document.getText();
            let match: RegExpExecArray | null;
            
            while ((match = effectLineMatch.exec(text)) !== null) {
              // Found a match, get the line number
              const pos = document.positionAt(match.index);
              range = new vscode.Range(pos.line, 0, pos.line, document.lineAt(pos.line).text.length);
              
              // Use this match if it's near the "then" block
              const prevLines = text.substring(0, match.index);
              if (prevLines.lastIndexOf('"then"') > prevLines.lastIndexOf('"if"')) {
                break;
              }
            }
          } catch (error) {
            // Keep the default range if there's an error
          }
          
          issues.push({
            code: 'POLICY_INCORRECT_EFFECT_REFERENCE',
            message: 'Effect should reference the "effect" parameter as "[parameters(\'effect\')]"',
            severity: ValidationSeverity.Error,
            range,
            source: 'ePacMan Policy',
            rule: 'policy-definition-effect-parameter'
          });
        }
        
        return issues;
      },
      canFix(issue) {
        return issue.code === 'POLICY_MISSING_EFFECT_PARAMETER' || 
               issue.code === 'POLICY_INCORRECT_EFFECT_REFERENCE';
      },
      async fix(document, issue) {
        const edit = new vscode.WorkspaceEdit();
        
        if (issue.code === 'POLICY_MISSING_EFFECT_PARAMETER') {
          // Fix by adding the effect parameter
          // We need to find the parameters section or create it
          const text = document.getText();
          const parametersMatch = /"parameters"\s*:\s*{/g;
          
          // Find the right position to add the parameter
          let match = parametersMatch.exec(text);
          if (match) {
            // Parameters section exists, add to it
            const pos = document.positionAt(match.index + match[0].length);
            const effectParam = `\n    "effect": {\n      "type": "String",\n      "metadata": {\n        "displayName": "Effect",\n        "description": "Enable or disable the execution of the policy"\n      },\n      "allowedValues": [\n        "Audit",\n        "Deny",\n        "Disabled"\n      ],\n      "defaultValue": "Audit"\n    }`;
            
            // Check if there are existing parameters to add comma
            const hasExistingParams = text.substring(match.index + match[0].length).trim().startsWith('"');
            const insert = hasExistingParams ? `${effectParam},` : effectParam;
            
            edit.insert(document.uri, pos, insert);
          } else {
            // Need to create parameters section
            // Find properties section
            const propertiesMatch = /"properties"\s*:\s*{/g;
            match = propertiesMatch.exec(text);
            
            if (match) {
              const pos = document.positionAt(match.index + match[0].length);
              const effectParamSection = `\n    "parameters": {\n      "effect": {\n        "type": "String",\n        "metadata": {\n          "displayName": "Effect",\n          "description": "Enable or disable the execution of the policy"\n        },\n        "allowedValues": [\n          "Audit",\n          "Deny",\n          "Disabled"\n        ],\n        "defaultValue": "Audit"\n      }\n    },`;
              
              edit.insert(document.uri, pos, effectParamSection);
            }
          }
        } else if (issue.code === 'POLICY_INCORRECT_EFFECT_REFERENCE') {
          // Fix by updating the effect reference
          // Find the current effect value in the then block
          const text = document.getText();
          const effectMatch = /"effect"\s*:\s*"[^"]+"/g;
          
          // Find the effect in the then section
          let match: RegExpExecArray | null;
          let thenIndex = text.indexOf('"then"');
          let effectInThen = false;
          
          while ((match = effectMatch.exec(text)) !== null) {
            // Check if this effect is in the then block
            if (match.index > thenIndex) {
              effectInThen = true;
              const range = new vscode.Range(
                document.positionAt(match.index),
                document.positionAt(match.index + match[0].length)
              );
              
              edit.replace(document.uri, range, '"effect": "[parameters(\'effect\')]"');
              break;
            }
          }
        }
        
        return edit;
      }
    });
  }
}