import * as vscode from 'vscode';
import { AbstractValidator, ValidationIssue, ValidationSeverity } from '../core/validator-framework';
import { JsonParser, JsonParseResult } from '../core/json-parser';
import { SchemaManager } from '../core/schema-manager';

/**
 * Policy Assignment Validator
 * Validates Azure Policy Assignment documents
 */
export class PolicyAssignmentValidator extends AbstractValidator {
  private parser: JsonParser;
  private schemaManager: SchemaManager;
  
  /**
   * Constructor
   */
  constructor(schemaManager: SchemaManager) {
    super('policy-assignment');
    this.parser = new JsonParser();
    this.schemaManager = schemaManager;
    
    // Register policy assignment specific rules
    this.registerPolicyAssignmentRules();
  }
  
  /**
   * Check if this validator can validate the document
   */
  async canValidate(document: vscode.TextDocument): Promise<boolean> {
    if (!document) return false;
    
    // Check if it's a JSON or JSONC file
    const isJsonFile = document.languageId === 'json' || document.languageId === 'jsonc';
    if (!isJsonFile) {
      return false;
    }
    
    try {
      const text = document.getText();
      
      // Try to parse the document
      const parseResult = await this.parser.parse(document);
      if (!parseResult) return false;
      
      // Check if it has the characteristics of a policy assignment
      return this.checkForPolicyAssignment(parseResult.content);
    } catch (error) {
      return false;
    }
  }
  
  /**
   * Check if content appears to be a policy assignment
   */
  private checkForPolicyAssignment(content: any): boolean {
    // Check for standard ARM template format
    if (content.type === 'Microsoft.Authorization/policyAssignments') {
      return true;
    }
    
    // Check for ePacMan format with nodeName and assignment properties
    const hasNodeNameAndAssignment = content.nodeName && content.assignment;
    if (hasNodeNameAndAssignment) {
      return true;
    }
    
    // Check for other formats with definitionEntry
    const hasDefinitionEntry = content.definitionEntry || content.definitionEntryList;
    if (hasDefinitionEntry) {
      return true;
    }
    
    // Check for standard Azure Policy format with properties
    const hasPolicyRefId = content.properties && 
                          (content.properties.policyDefinitionId || 
                           content.properties.policySetDefinitionId);
                           
    return hasPolicyRefId;
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
    return 'policy-assignment';
  }
  
  /**
   * Recursively validate assignment name length
   * @param document The document to validate
   * @param content The content to check for name length violations
   * @param issues Array to store found issues
   * @param parentPath Parent path for nested nodes
   */
  private validateAssignmentNameLength(
    document: vscode.TextDocument, 
    content: any, 
    issues: ValidationIssue[], 
    parentPath: string = ''
  ): void {
    // Initialize range with a default value
    let range = new vscode.Range(0, 0, 0, document.lineAt(0).text.length);
    
    // Get current node path for better error reporting
    const currentPath = parentPath + (content.nodeName || '');
    
    // Check if we have a name either in the root name or in assignment.name
    if (content.assignment && content.assignment.name) {
      const name = content.assignment.name;
      
      // Check name length - Azure policy assignment names are limited to 24 characters
      if (name.length > 24) {
        // Try to find the position of the name
        try {
          const nameRegExp = new RegExp(`"name"\\s*:\\s*"${name.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')}"`, 'g');
          const text = document.getText();
          const match = nameRegExp.exec(text);
          
          if (match) {
            const pos = document.positionAt(match.index);
            range = new vscode.Range(pos.line, 0, pos.line, document.lineAt(pos.line).text.length);
          }
        } catch (error) {
          // Keep the default range if there's an error
        }
        
        issues.push({
          code: 'POLICY_ASSIGNMENT_NAME_LENGTH',
          message: `Policy assignment name "${name}" at ${currentPath} exceeds 24 characters (${name.length})`,
          severity: ValidationSeverity.Error,
          range,
          source: 'ePacMan Policy',
          rule: 'policy-assignment-name-length',
          data: { name, path: currentPath }
        });
      }
    }
    
    // Check for name in standard ARM template format
    if (content.name && !content.assignment) {
      const name = content.name;
      
      // Check name length - Azure policy assignment names are limited to 24 characters
      if (name.length > 24) {
        // Try to find the position of the name
        try {
          const nameRegExp = new RegExp(`"name"\\s*:\\s*"${name.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')}"`, 'g');
          const text = document.getText();
          const match = nameRegExp.exec(text);
          
          if (match) {
            const pos = document.positionAt(match.index);
            range = new vscode.Range(pos.line, 0, pos.line, document.lineAt(pos.line).text.length);
          }
        } catch (error) {
          // Keep the default range if there's an error
        }
        
        issues.push({
          code: 'POLICY_ASSIGNMENT_NAME_LENGTH',
          message: `Policy assignment name "${name}" at ${currentPath} exceeds 24 characters (${name.length})`,
          severity: ValidationSeverity.Error,
          range,
          source: 'ePacMan Policy',
          rule: 'policy-assignment-name-length',
          data: { name, path: currentPath }
        });
      }
    }
    
    // Check in definitionEntryList
    if (content.definitionEntryList && Array.isArray(content.definitionEntryList)) {
      for (const entry of content.definitionEntryList) {
        if (entry.assignment && entry.assignment.name) {
          const name = entry.assignment.name;
          
          if (name.length > 24) {
            // Try to find the position of the name
            try {
              const nameRegExp = new RegExp(`"name"\\s*:\\s*"${name.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')}"`, 'g');
              const text = document.getText();
              const match = nameRegExp.exec(text);
              
              if (match) {
                const pos = document.positionAt(match.index);
                range = new vscode.Range(pos.line, 0, pos.line, document.lineAt(pos.line).text.length);
              }
            } catch (error) {
              // Keep the default range if there's an error
            }
            
            issues.push({
              code: 'POLICY_ASSIGNMENT_NAME_LENGTH',
              message: `Policy assignment name "${name}" in definitionEntryList at ${currentPath} exceeds 24 characters (${name.length})`,
              severity: ValidationSeverity.Error,
              range,
              source: 'ePacMan Policy',
              rule: 'policy-assignment-name-length',
              data: { name, path: currentPath + '/definitionEntryList' }
            });
          }
        }
      }
    }
    
    // Recursively check children
    if (content.children && Array.isArray(content.children)) {
      for (const child of content.children) {
        // Pass the current path as parent path for the children
        this.validateAssignmentNameLength(document, child, issues, currentPath + '/');
      }
    }
  }
  
  /**
   * Register policy assignment specific rules
   */
  private registerPolicyAssignmentRules(): void {
    // Rule: Schema Validation
    this.registerRule({
      id: 'policy-assignment-schema',
      name: 'Schema Validation',
      description: 'Validate policy assignment against JSON schema',
      enabled: true,
      severity: ValidationSeverity.Error,
      async validate(document, content, context) {
        // Get the schema URI from the document if available
        let schemaUrl = content.$schema;
        
        // Get the schema manager from context
        const schemaManager = context.schemaManager;
        
        // Validate using the appropriate schema
        const result = schemaManager.validateSchema(
          schemaUrl || 'policy-assignment',
          content,
          document,
          context.parseResult
        );
        
        return result.errors;
      }
    });
    
    // Rule: Assignment Name Length
    this.registerRule({
      id: 'policy-assignment-name-length',
      name: 'Assignment Name Length Validation',
      description: 'Validate policy assignment name length',
      enabled: true,
      severity: ValidationSeverity.Error,
      validate: async (document, content, context) => {
        const issues: ValidationIssue[] = [];
        
        // Check all assignment names recursively, including in children
        this.validateAssignmentNameLength(document, content, issues);
        
        return issues;
      },
      
      canFix(issue) {
        return issue.code === 'POLICY_ASSIGNMENT_NAME_LENGTH';
      },
      
      async fix(document, issue) {
        const edit = new vscode.WorkspaceEdit();
        
        if (issue.code === 'POLICY_ASSIGNMENT_NAME_LENGTH') {
          const name = issue.data?.name;
          
          if (name) {
            // Truncate the name to 24 characters
            const truncatedName = name.substring(0, 24);
            
            // Find the name in the document
            try {
              const nameMatch = new RegExp(`"name"\\s*:\\s*"${name.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')}"`, 'g');
              const text = document.getText();
              const match = nameMatch.exec(text);
              
              if (match) {
                const startPos = document.positionAt(match.index);
                const endPos = document.positionAt(match.index + match[0].length);
                const range = new vscode.Range(startPos, endPos);
                
                edit.replace(document.uri, range, `"name": "${truncatedName}"`);
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
    
    // Rule: Missing Scope
    this.registerRule({
      id: 'policy-assignment-scope',
      name: 'Assignment Scope Validation',
      description: 'Validate policy assignment scope',
      enabled: true,
      severity: ValidationSeverity.Error,
      async validate(document, content, context) {
        const issues: ValidationIssue[] = [];
        
        // Initialize range with a default value
        let range = new vscode.Range(0, 0, 0, document.lineAt(0).text.length);
        
        // Check for scope in ePacMan format
        if (content.scope) {
          // Scope exists in root, it's valid
          return issues;
        }
        
        // Check for scope in standard ARM template format
        if (content.properties && content.properties.scope) {
          // Scope exists in properties, check if it's valid
          const scope = content.properties.scope;
          
          if (typeof scope === 'string') {
            // Check scope format for ARM template
            if (!scope.startsWith('/subscriptions/') && 
                !scope.startsWith('/providers/')) {
              
              try {
                const scopeMatch = new RegExp(`"scope"\\s*:\\s*"${scope.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')}"`, 'g');
                const text = document.getText();
                const match = scopeMatch.exec(text);
                
                if (match) {
                  const pos = document.positionAt(match.index);
                  range = new vscode.Range(pos.line, 0, pos.line, document.lineAt(pos.line).text.length);
                }
              } catch (error) {
                // Keep the default range if there's an error
              }
              
              issues.push({
                code: 'POLICY_ASSIGNMENT_INVALID_SCOPE',
                message: 'Policy assignment scope must start with /subscriptions/ or /providers/',
                severity: ValidationSeverity.Error,
                range,
                source: 'ePacMan Policy',
                rule: 'policy-assignment-scope'
              });
            }
          }
          
          return issues;
        }
        
        // If we get here, scope is missing
        try {
          if (content.properties) {
            // Try to find position for standard ARM template
            const propertiesMatch = /"properties"\s*:\s*{/g;
            const text = document.getText();
            const match = propertiesMatch.exec(text);
            
            if (match) {
              const pos = document.positionAt(match.index + match[0].length);
              range = new vscode.Range(pos.line, 0, pos.line, document.lineAt(pos.line).text.length);
            }
          } else {
            // Try to find position for root object
            const objStart = /\{/g;
            const text = document.getText();
            const match = objStart.exec(text);
            
            if (match) {
              const pos = document.positionAt(match.index + 1);
              range = new vscode.Range(pos.line, 0, pos.line, document.lineAt(pos.line).text.length);
            }
          }
        } catch (error) {
          // Keep the default range if there's an error
        }
        
        issues.push({
          code: 'POLICY_ASSIGNMENT_MISSING_SCOPE',
          message: 'Policy assignment is missing scope property',
          severity: ValidationSeverity.Error,
          range,
          source: 'ePacMan Policy',
          rule: 'policy-assignment-scope'
        });
        
        return issues;
      },
      canFix(issue) {
        return issue.code === 'POLICY_ASSIGNMENT_MISSING_SCOPE';
      },
      async fix(document, issue) {
        const edit = new vscode.WorkspaceEdit();
        
        if (issue.code === 'POLICY_ASSIGNMENT_MISSING_SCOPE') {
          try {
            const text = document.getText();
            const content = JSON.parse(text);
            
            if (content.properties) {
              // Standard ARM template format
              const propertiesMatch = /"properties"\s*:\s*{/g;
              const match = propertiesMatch.exec(text);
              
              if (match) {
                const pos = document.positionAt(match.index + match[0].length);
                
                // Check if the next character is a newline
                const nextChar = text.charAt(match.index + match[0].length);
                const indent = nextChar === '\n' ? '    ' : '\n    ';
                
                const scopeText = `${indent}"scope": "/subscriptions/{subscription-id}",`;
                
                edit.insert(document.uri, pos, scopeText);
              }
            } else {
              // ePacMan format
              const objStart = /\{/g;
              const match = objStart.exec(text);
              
              if (match) {
                const pos = document.positionAt(match.index + 1);
                const scopeText = `\n  "scope": {\n    "tenant1": [\n      "/providers/Microsoft.Management/managementGroups/{management-group-id}"\n    ]\n  },`;
                
                edit.insert(document.uri, pos, scopeText);
              }
            }
          } catch (error) {
            // Failed to parse or find position
            return undefined;
          }
        }
        
        return edit;
      }
    });
    
    // Rule: Policy Reference Validation
    this.registerRule({
      id: 'policy-assignment-reference',
      name: 'Policy Reference Validation',
      description: 'Validate policy definition or set definition reference',
      enabled: true,
      severity: ValidationSeverity.Error,
      async validate(document, content, context) {
        const issues: ValidationIssue[] = [];
        
        // Initialize range with a default value
        let range = new vscode.Range(0, 0, 0, document.lineAt(0).text.length);
        
        // Check for ePacMan format with definitionEntry
        if (content.definitionEntry) {
          const defEntry = content.definitionEntry;
          
          // Check if it has at least one policy reference
          const hasAnyPolicy = defEntry.policyId || defEntry.policyName || 
                              defEntry.policySetId || defEntry.policySetName;
                              
          if (!hasAnyPolicy) {
            try {
              const defMatch = /"definitionEntry"\s*:\s*{/g;
              const text = document.getText();
              const match = defMatch.exec(text);
              
              if (match) {
                const pos = document.positionAt(match.index + match[0].length);
                range = new vscode.Range(pos.line, 0, pos.line, document.lineAt(pos.line).text.length);
              }
            } catch (error) {
              // Keep default range
            }
            
            issues.push({
              code: 'POLICY_ASSIGNMENT_MISSING_POLICY_REFERENCE',
              message: 'Policy assignment must include a policy reference (policyId, policyName, policySetId, or policySetName)',
              severity: ValidationSeverity.Error,
              range,
              source: 'ePacMan Policy',
              rule: 'policy-assignment-reference'
            });
          }
          
          return issues;
        }
        
        // Check definitionEntryList
        if (content.definitionEntryList && Array.isArray(content.definitionEntryList)) {
          // The entries are already validated by the schema, so we don't need
          // additional validation here
          return issues;
        }
        
        // Standard ARM template format
        if (content.properties) {
          // Check for policy reference
          const hasPolicyDefId = !!content.properties.policyDefinitionId;
          const hasPolicySetDefId = !!content.properties.policySetDefinitionId;
          
          if (!hasPolicyDefId && !hasPolicySetDefId) {
            // Try to find the position of the properties
            try {
              const propertiesMatch = /"properties"\s*:\s*{/g;
              const text = document.getText();
              const match = propertiesMatch.exec(text);
              
              if (match) {
                const pos = document.positionAt(match.index + match[0].length);
                range = new vscode.Range(pos.line, 0, pos.line, document.lineAt(pos.line).text.length);
              }
            } catch (error) {
              // Keep the default range if there's an error
            }
            
            issues.push({
              code: 'POLICY_ASSIGNMENT_MISSING_POLICY_REFERENCE',
              message: 'Policy assignment must include either policyDefinitionId or policySetDefinitionId',
              severity: ValidationSeverity.Error,
              range,
              source: 'ePacMan Policy',
              rule: 'policy-assignment-reference'
            });
          } else if (hasPolicyDefId && hasPolicySetDefId) {
            // Cannot have both
            // Try to find the position of the second definition
            let defToFind = '';
            
            if (content.properties.policyDefinitionId) {
              defToFind = 'policySetDefinitionId';
            } else {
              defToFind = 'policyDefinitionId';
            }
            
            try {
              const defMatch = new RegExp(`"${defToFind}"\\s*:`, 'g');
              const text = document.getText();
              const match = defMatch.exec(text);
              
              if (match) {
                const pos = document.positionAt(match.index);
                range = new vscode.Range(pos.line, 0, pos.line, document.lineAt(pos.line).text.length);
              }
            } catch (error) {
              // Keep the default range if there's an error
            }
            
            issues.push({
              code: 'POLICY_ASSIGNMENT_DUPLICATE_POLICY_REFERENCE',
              message: 'Policy assignment cannot include both policyDefinitionId and policySetDefinitionId',
              severity: ValidationSeverity.Error,
              range,
              source: 'ePacMan Policy',
              rule: 'policy-assignment-reference'
            });
          }
        }
        
        return issues;
      }
    });
  }
}