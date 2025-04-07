import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs-extra';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { Logger } from '../../logging';
import { ValidationIssue, ValidationSeverity } from './validator-framework';
import { JsonParseResult } from './json-parser';

/**
 * Schema validation result
 */
export interface SchemaValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
}

/**
 * Schema Manager class
 */
export class SchemaManager {
  private schemas: Map<string, object> = new Map();
  private schemaUrls: Map<string, string> = new Map();
  private ajv: Ajv;
  private logger = Logger.getInstance();
  private rootPath: string;
  private initialized: boolean = false;
  
  /**
   * Constructor
   * @param rootPath The root path of the extension
   */
  constructor(rootPath: string) {
    this.rootPath = rootPath;
    
    // Initialize AJV
    this.ajv = new Ajv({
      allErrors: true,
      verbose: true,
      $data: true,
      strict: false
    });
    
    // Add support for different JSON Schema drafts by loading the built-in meta schemas
    try {
      // AJV has built-in support for draft-07 by default, but we can explicitly add others
      this.ajv.addMetaSchema(require('ajv/dist/refs/json-schema-draft-06.json'));
      this.ajv.addMetaSchema(require('ajv/dist/refs/json-schema-draft-07.json'));
      
      // For 2019-09 and 2020-12, add them as empty meta-schemas to prevent errors
      const draft2019Schema = {
        $id: "https://json-schema.org/draft/2019-09/schema",
        $schema: "https://json-schema.org/draft/2019-09/schema"
      };
      
      const draft2020Schema = {
        $id: "https://json-schema.org/draft/2020-12/schema",
        $schema: "https://json-schema.org/draft/2020-12/schema"
      };
      
      this.ajv.addMetaSchema(draft2019Schema);
      this.ajv.addMetaSchema(draft2020Schema);
    } catch (error) {
      this.logger.debug("Error loading JSON Schema drafts", error);
      // Continue even if we can't load some drafts, basic validation will still work
    }
    
    // Add format validation support
    addFormats(this.ajv);
    
    // Map external schema URLs to local schemas
    this.mapExternalSchemas();
  }
  
  /**
   * Map external schema URLs to local schemas
   */
  private mapExternalSchemas(): void {
    // Map enterprise-azure-policy-as-code schemas to local schemas
    
    // Policy definition schema mapping
    this.schemaUrls.set(
      'https://raw.githubusercontent.com/Azure/enterprise-azure-policy-as-code/main/Schemas/policy-definition-schema.json',
      'policy-definition-schema.json'
    );
    
    // Policy set definition schema mapping (initiative)
    this.schemaUrls.set(
      'https://raw.githubusercontent.com/Azure/enterprise-azure-policy-as-code/main/Schemas/policy-set-definition-schema.json',
      'policy-set-definition-schema.json'
    );
    
    // Policy assignment schema mapping
    this.schemaUrls.set(
      'https://raw.githubusercontent.com/Azure/enterprise-azure-policy-as-code/main/Schemas/policy-assignment-schema.json',
      'policy-assignment-schema.json'
    );
    
    // Add aliases for common variations in URL patterns
    this.schemaUrls.set(
      'https://raw.githubusercontent.com/Azure/Enterprise-Scale/main/src/resources/Microsoft.Authorization/policyDefinitions/schema.json',
      'policy-definition-schema.json'
    );
    
    this.schemaUrls.set(
      'https://raw.githubusercontent.com/Azure/Enterprise-Scale/main/src/resources/Microsoft.Authorization/policySetDefinitions/schema.json',
      'policy-set-definition-schema.json'
    );
    
    this.logger.debug(`Mapped ${this.schemaUrls.size} external schema URLs to local schemas`);
  }
  
  /**
   * Initialize the schema manager
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    
    try {
      await this.loadSchemas();
      this.initialized = true;
    } catch (error) {
      this.logger.error("Failed to initialize schema manager", error);
      throw error;
    }
  }
  
  /**
   * Load schemas from the schemas directory
   */
  private async loadSchemas(): Promise<void> {
    this.logger.info("Loading schemas");
    
    const schemaFiles = [
      "policy-definition-schema.json",
      "policy-set-definition-schema.json",
      "policy-assignment-schema.json"
    ];
    
    const schemasDir = path.join(this.rootPath, "schemas");
    
    try {
      // Check if schemas directory exists
      const dirExists = await this.directoryExists(schemasDir);
      if (!dirExists) {
        this.logger.warn(`Schemas directory not found: ${schemasDir}`);
        return;
      }
      
      // Load each schema file
      for (const file of schemaFiles) {
        const schemaPath = path.join(schemasDir, file);
        
        try {
          const fileExists = await this.fileExists(schemaPath);
          if (!fileExists) {
            this.logger.warn(`Schema file not found: ${schemaPath}`);
            // Create a basic schema as fallback
            this.schemas.set(file, this.createBasicSchema(file));
            continue;
          }
          
          // Read and parse the schema file
          const schemaContent = await fs.readFile(schemaPath, "utf-8");
          const schema = JSON.parse(schemaContent);
          
          // Store the schema
          this.schemas.set(file, schema);
          
          this.logger.debug(`Loaded schema: ${file}`);
        } catch (error) {
          this.logger.error(`Failed to load schema ${file}:`, error);
          // Create a basic schema as fallback
          this.schemas.set(file, this.createBasicSchema(file));
        }
      }
      
      this.logger.info(`Loaded ${this.schemas.size} schemas`);
    } catch (error) {
      this.logger.error("Error loading schemas", error);
      throw new Error(`Failed to load schemas: ${error}`);
    }
  }
  
  /**
   * Create a basic schema for fallback validation
   * @param schemaType The type of schema to create
   * @returns A basic schema object
   */
  private createBasicSchema(schemaType: string): object {
    const type = schemaType.replace("-schema.json", "");
    
    // Create a minimal schema that will allow most documents but catch severe issues
    return {
      $schema: "http://json-schema.org/draft-07/schema#",
      title: `${type} Schema (fallback)`,
      type: "object",
      required: ["name", "properties"],
      properties: {
        name: { type: "string" },
        properties: { type: "object" }
      }
    };
  }
  
  /**
   * Get a schema by type or URL
   * @param schemaTypeOrUrl The schema type or URL
   * @returns The schema object
   */
  getSchema(schemaTypeOrUrl: string): object | undefined {
    // If it's a URL, try to map it to a local schema
    if (schemaTypeOrUrl.startsWith('http')) {
      const localSchemaName = this.schemaUrls.get(schemaTypeOrUrl);
      if (localSchemaName) {
        return this.schemas.get(localSchemaName);
      } else {
        this.logger.warn(`No local mapping for schema URL: ${schemaTypeOrUrl}`);
        return undefined;
      }
    }
    
    // Handle schema type names
    let schemaFile: string;
    switch (schemaTypeOrUrl) {
      case "policy-definition":
        schemaFile = "policy-definition-schema.json";
        break;
      case "policy-set-definition":
        schemaFile = "policy-set-definition-schema.json";
        break;
      case "policy-assignment":
        schemaFile = "policy-assignment-schema.json";
        break;
      default:
        // Might be a direct schema file name
        schemaFile = schemaTypeOrUrl.endsWith('.json') ? schemaTypeOrUrl : `${schemaTypeOrUrl}.json`;
    }
    
    return this.schemas.get(schemaFile);
  }
  
  /**
   * Validate content against a schema
   * @param schemaName The name of the schema
   * @param content The content to validate
   * @param document The document
   * @param parseResult The parse result
   * @returns The validation result
   */
  validateSchema(schemaName: string, content: any, document: vscode.TextDocument, parseResult: any): { valid: boolean; errors: any[] } {
    try {
        // If schemaName is not provided or is empty (no $schema property in the file)
        // Try to infer the schema type immediately
        if (!schemaName || schemaName === '') {
            this.logger.info(`No schema provided, trying to infer schema type from content`);
            const inferredSchemaType = this.inferSchemaType(content);
            
            if (inferredSchemaType) {
                this.logger.info(`Inferred schema type: ${inferredSchemaType}`);
                const inferredSchema = this.getSchema(inferredSchemaType);
                
                if (inferredSchema) {
                    this.logger.info(`Using inferred schema: ${inferredSchemaType}`);
                    return this.performValidation(inferredSchema, content, document, parseResult);
                } else {
                    this.logger.warn(`Inferred schema type ${inferredSchemaType}, but couldn't find corresponding schema file`);
                }
            }
        }
        
        // Try to get schema by name if provided
        const schema = this.getSchema(schemaName);
        
        if (!schema) {
            this.logger.info(`Schema not found by name: ${schemaName}, trying to infer schema type from content`);
            
            // Try to infer the schema type from content (as a fallback)
            const inferredSchemaType = this.inferSchemaType(content);
            if (inferredSchemaType) {
                this.logger.info(`Inferred schema type: ${inferredSchemaType}`);
                const inferredSchema = this.getSchema(inferredSchemaType);
                
                if (inferredSchema) {
                    this.logger.info(`Using inferred schema: ${inferredSchemaType}`);
                    return this.performValidation(inferredSchema, content, document, parseResult);
                }
            }
            
            // Neither schema name nor inference worked
            return {
                valid: false,
                errors: [{
                    message: `No schema found. Document appears to be a ${inferredSchemaType || 'policy'} file but no schema could be loaded.`,
                    range: new vscode.Range(0, 0, 0, 1)
                }]
            };
        }
        
        // Perform validation with the found schema
        return this.performValidation(schema, content, document, parseResult);
    } catch (error: any) {
        this.logger.error("Schema validation error", error);
        return {
            valid: false,
            errors: [{
                message: `Validation error: ${error.message}`,
                range: new vscode.Range(0, 0, 0, 1)
            }]
        };
    }
  }
  
  /**
   * Perform the actual validation against a schema
   * @param schema The schema to validate against
   * @param content The content to validate
   * @param document The document
   * @param parseResult The parse result
   * @returns The validation result
   */
  private performValidation(schema: object, content: any, document: vscode.TextDocument, parseResult: any): { valid: boolean; errors: any[] } {
    // Create a new Ajv instance for validation
    const ajv = new Ajv({
        allErrors: true,
        verbose: true,
        $data: true,
        strict: false  // Disable strict mode to be more lenient with schema validation
    });
    
    // Add format validation
    addFormats(ajv);
    
    try {
        // Add meta schemas to prevent common reference errors
        try {
          ajv.addMetaSchema(require('ajv/dist/refs/json-schema-draft-06.json'));
          ajv.addMetaSchema(require('ajv/dist/refs/json-schema-draft-07.json'));
          
          // For 2019-09 and 2020-12, add them as empty meta-schemas to prevent errors
          const draft2019Schema = {
            $id: "https://json-schema.org/draft/2019-09/schema",
            $schema: "https://json-schema.org/draft/2019-09/schema"
          };
          
          const draft2020Schema = {
            $id: "https://json-schema.org/draft/2020-12/schema",
            $schema: "https://json-schema.org/draft/2020-12/schema"
          };
          
          ajv.addMetaSchema(draft2019Schema);
          ajv.addMetaSchema(draft2020Schema);
        } catch (error) {
          this.logger.debug("Error loading JSON Schema drafts in performValidation", error);
          // Continue even if we can't load some drafts, basic validation will still work
        }
        
        const validate = ajv.compile(schema);
        const valid = validate(content);
        
        if (valid) {
            return { 
                valid: true, 
                errors: []
            };
        } else {
            // Filter out the specific error about missing schema drafts
            const filteredErrors = (validate.errors || []).filter(error => {
                // Filter out errors about missing JSON Schema draft references
                return !(error.message && (
                    error.message.includes('no schema with key or ref "https://json-schema.org/draft/2020-12/schema"') ||
                    error.message.includes('no schema with key or ref "https://json-schema.org/draft/2019-09/schema"')
                ));
            });
            
            const formattedErrors = this.formatErrors(filteredErrors, document, parseResult);
            
            // Log validation errors for debugging
            this.logger.debug("Schema validation failed with errors:", validate.errors);
            
            return {
                valid: filteredErrors.length === 0, // Valid if no errors remain after filtering
                errors: formattedErrors
            };
        }
    } catch (validationError: any) {
        // Skip certain validation errors completely
        if (validationError.message && (
            validationError.message.includes('no schema with key or ref "https://json-schema.org/draft/2020-12/schema"') ||
            validationError.message.includes('no schema with key or ref "https://json-schema.org/draft/2019-09/schema"')
        )) {
            this.logger.debug("Ignoring JSON Schema draft reference error:", validationError.message);
            return {
                valid: true,
                errors: []
            };
        }
        
        // Log detailed error for debugging
        this.logger.error("Schema validation error", { 
            errorType: validationError.name || 'ValidationError',
            message: validationError.message || 'Unknown schema validation error',
            stack: validationError.stack
        });
        
        // Return a more specific error message
        return {
            valid: false,
            errors: [{
                message: `Schema validation failed: ${validationError.message || 'Unknown error'}`,
                range: new vscode.Range(0, 0, 0, 1)
            }]
        };
    }
  }

  /**
   * Infer schema type from content
   * @param content The document content
   * @returns The inferred schema type or undefined
   */
  private inferSchemaType(content: any): string | undefined {
    // Check for policy definition
    if (content.properties && content.properties.policyRule && 
        content.properties.policyRule.if && content.properties.policyRule.then) {
        this.logger.debug("Detected policy definition based on policyRule with if/then structure");
        return 'policy-definition';
    }
    
    // Check for policy set definition
    if (content.properties && Array.isArray(content.properties.policyDefinitions)) {
        this.logger.debug("Detected policy set definition based on policyDefinitions array");
        return 'policy-set-definition';
    }
    
    // Check for policy assignment
    if (content.properties && 
        (content.properties.policyDefinitionId || content.properties.policySetDefinitionId)) {
        this.logger.debug("Detected policy assignment based on policyDefinitionId/policySetDefinitionId");
        return 'policy-assignment';
    }
    
    // Additional checks for Azure policy structures
    if (content.properties && content.properties.displayName && content.properties.policyType) {
        if (content.properties.parameters && content.properties.policyRule) {
            this.logger.debug("Detected policy definition based on policyType and policyRule");
            return 'policy-definition';
        }
        
        if (content.properties.parameters && content.properties.policyDefinitions) {
            this.logger.debug("Detected policy set definition based on policyType and policyDefinitions");
            return 'policy-set-definition';
        }
    }
    
    this.logger.warn("Could not infer schema type from content structure");
    return undefined;
  }

  /**
   * Format validation errors
   * @param errors The validation errors
   * @param document The document
   * @param parseResult The parse result
   * @returns Formatted validation errors
   */
  private formatErrors(errors: any[], document: vscode.TextDocument, parseResult?: any): any[] {
    const jsonParser = parseResult?.jsonParser;
    
    return errors.map(error => {
        const path = error.instancePath;
        let range = new vscode.Range(0, 0, 0, 1);
        
        // Try to find the range using the JSON parser if available
        if (jsonParser && parseResult) {
            const pathParts = path.split('/').filter((p: string) => p);
            const node = jsonParser.findNodeByPath(parseResult.jsonDocument, pathParts);
            
            if (node) {
                range = jsonParser.getNodeRange(document, node);
            }
        } else {
            // Fallback method to find the range
            range = this.findPathRange(path, document);
        }
        
        return {
            message: error.message || "Unknown error",
            range
        };
    });
  }

  /**
   * Find the range in the document for a given JSON path
   * @param path The JSON path
   * @param document The document
   * @returns The range
   */
  private findPathRange(path: string, document: vscode.TextDocument): vscode.Range {
    // Logic to find the range in the document for a given JSON path
    // This is a simplified implementation
    const content = document.getText();
    const pathParts = path.split('/').filter(p => p);
    
    let currentPos = 0;
    
    for (const part of pathParts) {
        const propPattern = new RegExp(`"${part}"\\s*:`);
        const match = propPattern.exec(content.substring(currentPos));
        if (match) {
            currentPos += match.index + match[0].length;
        }
    }
    
    const line = document.positionAt(currentPos).line;
    return new vscode.Range(line, 0, line, 100);
  }
  
  /**
   * Check if a file exists
   * @param filePath Path to the file
   * @returns True if the file exists, false otherwise
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      const stats = await fs.stat(filePath);
      return stats.isFile();
    } catch (error) {
      return false;
    }
  }
  
  /**
   * Check if a directory exists
   * @param dirPath Path to the directory
   * @returns True if the directory exists, false otherwise
   */
  private async directoryExists(dirPath: string): Promise<boolean> {
    try {
      const stats = await fs.stat(dirPath);
      return stats.isDirectory();
    } catch (error) {
      return false;
    }
  }
}