import * as vscode from 'vscode';
import { AbstractValidator, ValidationIssue, ValidationSeverity } from '../core/validator-framework';
import { JsonParser, JsonParseResult } from '../core/json-parser';
import { SchemaManager } from '../core/schema-manager';

/**
 * Policy Set Definition Validator
 * Validates Azure Policy Set Definition (Initiative) documents
 */
export class PolicySetDefinitionValidator extends AbstractValidator {
  private parser: JsonParser;
  private schemaManager: SchemaManager;
  
  /**
   * Constructor
   */
  constructor(schemaManager: SchemaManager) {
    super('policy-set-definition');
    this.parser = new JsonParser();
    this.schemaManager = schemaManager;
    
    // Register policy set definition specific rules
    this.registerPolicySetDefinitionRules();
  }
  
  /**
   * Check if this validator can validate the document
   */
  async canValidate(document: vscode.TextDocument): Promise<boolean> {
    if (!document) return false;
    
    try {
      const text = document.getText();
      
      // Quick check if this might be a policy set definition
      if (!text.includes('"policyDefinitions"')) {
        return false;
      }
      
      // Try to parse the document
      const parseResult = await this.parser.parse(document);
      if (!parseResult) return false;
      
      // Check if it has the characteristics of a policy set definition
      return this.checkForPolicySetDefinition(parseResult.content);
    } catch (error) {
      return false;
    }
  }
  
  /**
   * Check if content appears to be a policy set definition
   */
  private checkForPolicySetDefinition(content: any): boolean {
    // Check type if available
    if (content.type === 'Microsoft.Authorization/policySetDefinitions') {
      return true;
    }
    
    // Check for policy set definition structure
    const hasPolicyDefinitions = content.properties && 
                                 Array.isArray(content.properties.policyDefinitions);
                           
    return hasPolicyDefinitions;
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
    return 'policy-set-definition';
  }
  
  /**
   * Register policy set definition specific rules
   */
  private registerPolicySetDefinitionRules(): void {
    // Rule: Schema Validation
    this.registerRule({
      id: 'policy-set-definition-schema',
      name: 'Schema Validation',
      description: 'Validate policy set definition against JSON schema',
      enabled: true,
      severity: ValidationSeverity.Error,
      async validate(document, content, context) {
        // Get the schema URI from the document if available
        let schemaUrl = content.$schema;
        
        // Get the schema manager from context
        const schemaManager = context.schemaManager;
        
        // Validate using the appropriate schema
        const result = schemaManager.validateSchema(
          schemaUrl || 'policy-set-definition',
          content,
          document,
          context.parseResult
        );
        
        return result.errors;
      }
    });
    
    // Rule: Policy Definition References
    this.registerRule({
      id: 'policy-set-definition-references',
      name: 'Policy Definition References Validation',
      description: 'Validate policy definition references in initiative',
      enabled: true,
      severity: ValidationSeverity.Error,
      async validate(document, content, context) {
        const issues: ValidationIssue[] = [];
        
        // Initialize range with a default value covering the first line
        let range = new vscode.Range(0, 0, 0, document.lineAt(0).text.length);
        
        // Check if we have policyDefinitions
        if (!content.properties || !content.properties.policyDefinitions || 
            !Array.isArray(content.properties.policyDefinitions)) {
          return issues;
        }
        
        const policyDefs = content.properties.policyDefinitions;
        
        // Check for empty policy definitions array
        if (policyDefs.length === 0) {
          // Try to find the position of the policyDefinitions array
          try {
            const policyDefsMatch = /"policyDefinitions"\s*:\s*\[\s*\]/g;
            const text = document.getText();
            const match = policyDefsMatch.exec(text);
            
            if (match) {
              const pos = document.positionAt(match.index);
              range = new vscode.Range(pos.line, 0, pos.line, document.lineAt(pos.line).text.length);
            }
          } catch (error) {
            // Keep the default range if there's an error
          }
          
          issues.push({
            code: 'POLICY_SET_EMPTY_DEFINITIONS',
            message: 'Policy set definition contains no policy definitions',
            severity: ValidationSeverity.Warning,
            range,
            source: 'ePacMan Policy',
            rule: 'policy-set-definition-references'
          });
        }
        
        // Check for duplicate policy definition references
        const policyIds = new Map<string, number>();
        let index = 0;
        
        for (const policyDef of policyDefs) {
          if (!policyDef.policyDefinitionId && !policyDef.policyDefinitionName) {
            // Improved position detection for missing policy definition ID/name
            try {
              // Look for any properties in this policy definition object to anchor the position
              const keys = Object.keys(policyDef);
              let foundPosition = false;
              
              if (keys.length > 0) {
                // Try to find the position using an existing property
                for (const key of keys) {
                  if (typeof policyDef[key] === 'string') {
                    const searchPattern = `"${key}"\\s*:\\s*"${policyDef[key].replace(/[\\/\-\[\]\{\}\(\)\*\+\?\.\\\^\$\|]/g, '\\$&')}"`;
                    const regex = new RegExp(searchPattern);
                    const text = document.getText();
                    const match = regex.exec(text);
                    
                    if (match) {
                      // Find the beginning of the object containing this property
                      let startPos = match.index;
                      while (startPos > 0 && text[startPos] !== '{') {
                        startPos--;
                      }
                      
                      if (startPos >= 0) {
                        const pos = document.positionAt(startPos);
                        range = new vscode.Range(pos.line, 0, pos.line, document.lineAt(pos.line).text.length);
                        foundPosition = true;
                        break;
                      }
                    }
                  }
                }
              }
              
              // If we couldn't find a position using properties, try to find the object by index
              if (!foundPosition) {
                // Find the nth policy definition object in the array
                const text = document.getText();
                const policyDefsMatch = /"policyDefinitions"\s*:\s*\[/g;
                const policyDefsResult = policyDefsMatch.exec(text);
                
                if (policyDefsResult) {
                  let arrayStart = policyDefsResult.index + policyDefsResult[0].length;
                  let objectCount = 0;
                  let openBraces = 0;
                  
                  // Skip whitespace
                  while (arrayStart < text.length && /\s/.test(text[arrayStart])) {
                    arrayStart++;
                  }
                  
                  // Find the nth object
                  for (let i = arrayStart; i < text.length; i++) {
                    if (text[i] === '{') {
                      if (openBraces === 0) {
                        if (objectCount === index) {
                          const pos = document.positionAt(i);
                          range = new vscode.Range(pos.line, 0, pos.line, document.lineAt(pos.line).text.length);
                          foundPosition = true;
                          break;
                        }
                        objectCount++;
                      }
                      openBraces++;
                    } else if (text[i] === '}') {
                      openBraces--;
                    }
                  }
                }
              }
            } catch (error) {
              // Fall back to default range if there's an error
            }
            
            issues.push({
              code: 'POLICY_SET_MISSING_DEFINITION_ID',
              message: 'Policy definition reference is missing either policyDefinitionId or policyDefinitionName',
              severity: ValidationSeverity.Error,
              range,
              source: 'ePacMan Policy',
              rule: 'policy-set-definition-references'
            });
            
            continue;
          }
          
          // Check for missing reference ID if parameters are used
          if (!policyDef.policyDefinitionReferenceId) {
            // Try to find the position of this policy definition entry
            try {
              const policyIdField = policyDef.policyDefinitionId ? 
                `"policyDefinitionId"\\s*:\\s*"${policyDef.policyDefinitionId.replace(/[\\/\-\[\]\{\}\(\)\*\+\?\.\\\^\$\|]/g, '\\$&')}"` :
                `"policyDefinitionName"\\s*:\\s*"${policyDef.policyDefinitionName.replace(/[\\/\-\[\]\{\}\(\)\*\+\?\.\\\^\$\|]/g, '\\$&')}"`;
              
              const regex = new RegExp(policyIdField, 'g');
              const text = document.getText();
              
              let count = 0;
              let match: RegExpExecArray | null;
              
              // Find the nth occurrence
              while ((match = regex.exec(text)) !== null && count <= index) {
                if (count === index) {
                  const pos = document.positionAt(match.index);
                  range = new vscode.Range(pos.line, 0, pos.line, document.lineAt(pos.line).text.length);
                  break;
                }
                count++;
              }
            } catch (error) {
              // Keep the default range if there's an error
            }
            
            issues.push({
              code: 'POLICY_MISSING_REFERENCE_ID',
              message: 'Policy definition is missing a required policyDefinitionReferenceId',
              severity: ValidationSeverity.Error, // Changing to Error since it's required in the schema
              range,
              source: 'ePacMan Policy',
              rule: 'policy-set-definition-references',
              data: { index }
            });
          }
          
          index++;
        }
        
        // Check for duplicate reference IDs
        const referenceIds = new Map<string, number>();
        index = 0;
        
        for (const policyDef of policyDefs) {
          if (policyDef.policyDefinitionReferenceId) {
            const refId = policyDef.policyDefinitionReferenceId;
            
            if (referenceIds.has(refId)) {
              // Try to find the position of this reference ID
              try {
                const refIdStr = `"policyDefinitionReferenceId"\\s*:\\s*"${refId.replace(/[\\/\-\[\]\{\}\(\)\*\+\?\.\\\^\$\|]/g, '\\$&')}"`;
                const regex = new RegExp(refIdStr, 'g');
                const text = document.getText();
                
                let count = 0;
                let match: RegExpExecArray | null;
                
                while ((match = regex.exec(text)) !== null && count <= index) {
                  if (count === index) {
                    const pos = document.positionAt(match.index);
                    range = new vscode.Range(pos.line, 0, pos.line, document.lineAt(pos.line).text.length);
                    break;
                  }
                  count++;
                }
              } catch (error) {
                // Keep the default range if there's an error
              }
              
              issues.push({
                code: 'POLICY_DUPLICATE_REFERENCE_ID',
                message: `Duplicate policy definition reference ID: ${refId}`,
                severity: ValidationSeverity.Error,
                range,
                source: 'ePacMan Policy',
                rule: 'policy-set-definition-references',
                data: { refId, index }
              });
            } else {
              referenceIds.set(refId, index);
            }
          }
          
          index++;
        }
        
        return issues;
      },
      canFix(issue) {
        return issue.code === 'POLICY_MISSING_REFERENCE_ID' || 
               issue.code === 'POLICY_DUPLICATE_REFERENCE_ID';
      },
      async fix(document, issue) {
        const edit = new vscode.WorkspaceEdit();
        
        // Parse the document to get current content
        const parser = new JsonParser();
        const parseResult = await parser.parse(document);
        
        if (!parseResult) {
          return undefined;
        }
        
        const content = parseResult.content;
        
        if (issue.code === 'POLICY_MISSING_REFERENCE_ID') {
          // Fix by adding reference ID
          const index = issue.data?.index || 0;
          
          if (content.properties && 
              content.properties.policyDefinitions && 
              index < content.properties.policyDefinitions.length) {
            
            const policyDef = content.properties.policyDefinitions[index];
            
            // Generate a reference ID based on policy ID or name
            let refId = '';
            if (policyDef.policyDefinitionId) {
              // Extract the last segment of the policy ID
              const segments = policyDef.policyDefinitionId.split('/');
              refId = segments[segments.length - 1].replace('.', '_').toLowerCase();
            } else if (policyDef.policyDefinitionName) {
              // Generate a reference ID based on policy name
              refId = policyDef.policyDefinitionName.replace(/[\s\.]/g, '_').toLowerCase();
            } else {
              // Generate a generic reference ID
              refId = `policy_ref_${index + 1}`;
            }
            
            // Find the position to insert the reference ID
            try {
              const text = document.getText();
              
              // Look for the opening brace of this policy definition
              let defStart = -1;
              let braceCount = 0;
              let inPolicyDefs = false;
              let currentDefIndex = -1;
              
              for (let i = 0; i < text.length; i++) {
                const char = text[i];
                
                if (text.substring(i, i + 19) === '"policyDefinitions"') {
                  inPolicyDefs = true;
                }
                
                if (inPolicyDefs) {
                  if (char === '{' && text.substring(i - 1, i).trim() === '') {
                    braceCount++;
                    
                    if (braceCount === 1) {
                      currentDefIndex++;
                      
                      if (currentDefIndex === index) {
                        defStart = i + 1;
                        break;
                      }
                    }
                  } else if (char === '}') {
                    braceCount--;
                  }
                }
              }
              
              if (defStart !== -1) {
                const pos = document.positionAt(defStart);
                edit.insert(document.uri, pos, `\n      "policyDefinitionReferenceId": "${refId}",`);
              }
            } catch (error) {
              // Failed to find position
              return undefined;
            }
          }
        } else if (issue.code === 'POLICY_DUPLICATE_REFERENCE_ID') {
          // Fix by making reference ID unique
          const refId = issue.data?.refId;
          const index = issue.data?.index || 0;
          
          if (refId && content.properties && 
              content.properties.policyDefinitions && 
              index < content.properties.policyDefinitions.length) {
            
            // Generate a unique reference ID
            const uniqueRefId = `${refId}_${index + 1}`;
            
            try {
              // Find the existing reference ID
              const refIdStr = `"policyDefinitionReferenceId"\\s*:\\s*"${refId.replace(/[\\/\-\[\]\{\}\(\)\*\+\?\.\\\^\$\|]/g, '\\$&')}"`;
              const regex = new RegExp(refIdStr, 'g');
              const text = document.getText();
              
              let count = 0;
              let match: RegExpExecArray | null;
              
              while ((match = regex.exec(text)) !== null) {
                if (count === index) {
                  const startPos = document.positionAt(match.index);
                  const endPos = document.positionAt(match.index + match[0].length);
                  const range = new vscode.Range(startPos, endPos);
                  
                  edit.replace(document.uri, range, `"policyDefinitionReferenceId": "${uniqueRefId}"`);
                  break;
                }
                count++;
              }
            } catch (error) {
              // Failed to find position
              return undefined;
            }
          }
        }
        
        return edit;
      }
    });
  }
}