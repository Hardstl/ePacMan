import * as vscode from 'vscode';
import { Logger } from '../logging';
import { PolicyDefinition } from './template-generator';
import { SchemaManager } from '../validation/core/schema-manager';
import { JsonParser } from '../validation/core/json-parser';

/**
 * Policy Definition Parser class
 * Responsible for parsing policy definition files and extracting relevant information
 */
export class PolicyDefinitionParser {
    private logger = Logger.getInstance();
    private schemaManager: SchemaManager;
    private jsonParser: JsonParser;
    
    constructor() {
        // Initialize schema manager and JSON parser for validation
        this.schemaManager = new SchemaManager(vscode.extensions.getExtension('your-extension-id')?.extensionPath || '');
        this.jsonParser = new JsonParser();
    }
    
    /**
     * Parse a policy definition file - alias for parsePolicyDefinition for better method naming
     * @param file The URI of the policy definition file
     * @returns The parsed policy definition
     */
    async parseFile(file: vscode.Uri): Promise<PolicyDefinition> {
        return this.parsePolicyDefinition(file);
    }
    
    /**
     * Parse a policy definition file
     * @param file The URI of the policy definition file
     * @returns The parsed policy definition
     */
    async parsePolicyDefinition(file: vscode.Uri): Promise<PolicyDefinition> {
        try {
            this.logger.info(`Parsing policy definition file: ${file.fsPath}`);
            
            // Read the file content
            const content = await vscode.workspace.fs.readFile(file);
            const text = new TextDecoder().decode(content);
            
            // First, validate JSON syntax
            let json: any;
            try {
                json = JSON.parse(text);
            } catch (parseError: any) {
                throw new Error(`Invalid JSON format: ${parseError.message}`);
            }
            
            // Validate the structure directly without using the schema validator
            // Since creating a virtual TextDocument has compatibility issues
            this.validateJsonStructure(json);
            
            // Validate that this is a policy definition with proper structure
            if (!this.isPolicyDefinition(json)) {
                throw new Error("The file does not contain a valid policy definition");
            }
            
            // Validate required field types
            this.validateFieldTypes(json);
            
            // Extract the policy definition
            const policyDefinition: PolicyDefinition = {
                name: json.name,
                type: json.type,
                properties: json.properties
            };
            
            this.logger.info(`Policy definition parsed successfully: ${policyDefinition.name}`);
            return policyDefinition;
        } catch (error: any) {
            this.logger.error(`Error parsing policy definition: ${error.message}`);
            throw new Error(`Failed to parse policy definition: ${error.message}`);
        }
    }
    
    /**
     * Validate JSON structure against basic policy requirements
     * @param json The JSON object to validate
     * @throws Error if validation fails
     */
    private validateJsonStructure(json: any): void {
        // Perform basic validation similar to what the schema would do
        
        // Must be an object
        if (!json || typeof json !== 'object' || Array.isArray(json)) {
            throw new Error("Policy must be a JSON object");
        }
        
        // Required top-level fields
        const requiredFields = ["name", "properties"];
        for (const field of requiredFields) {
            if (json[field] === undefined) {
                throw new Error(`Policy is missing required field: '${field}'`);
            }
        }
        
        // Validate type field if present
        if (json.type !== undefined) {
            if (typeof json.type !== 'string') {
                throw new Error("Policy 'type' must be a string");
            }
            
            // Validate Azure resource type strings
            const validTypes = [
                "Microsoft.Authorization/policyDefinitions",
                "Microsoft.Authorization/policySetDefinitions",
                "Microsoft.Authorization/policyAssignments"
            ];
            
            if (!validTypes.includes(json.type)) {
                throw new Error(`Invalid policy type: '${json.type}'. Must be one of: ${validTypes.join(", ")}`);
            }
        }
        
        // Validate policy structure based on type
        if (json.type === "Microsoft.Authorization/policyDefinitions") {
            if (!json.properties.policyRule) {
                throw new Error("Policy definition must contain a 'policyRule' in properties");
            }
        } else if (json.type === "Microsoft.Authorization/policySetDefinitions") {
            if (!json.properties.policyDefinitions) {
                throw new Error("Policy initiative must contain 'policyDefinitions' in properties");
            }
        }
    }
    
    /**
     * Determine if a JSON object is a valid policy definition
     * @param json The JSON object
     * @returns True if the JSON object is a valid policy definition, false otherwise
     */
    private isPolicyDefinition(json: any): boolean {
        // Check if this is a policy definition with the required fields
        if (json.name === undefined || json.properties === undefined) {
            return false;
        }
        
        // Check for policy definition indicators
        const isPolicyDef = json.properties.policyRule !== undefined;
        const isPolicySetDef = json.properties.policyDefinitions !== undefined;
        
        // Either a policy definition or a policy set definition is valid
        return isPolicyDef || isPolicySetDef;
    }
    
    /**
     * Validate field types and structure of a policy definition
     * @param json The JSON object to validate
     * @throws Error if validation fails
     */
    private validateFieldTypes(json: any): void {
        // Validate name field
        if (typeof json.name !== 'string' || json.name.trim() === '') {
            throw new Error("Policy 'name' must be a non-empty string");
        }
        
        // Validate properties field
        if (!json.properties || typeof json.properties !== 'object') {
            throw new Error("Policy 'properties' must be an object");
        }
        
        // Validate policy rule if present
        if (json.properties.policyRule) {
            if (typeof json.properties.policyRule !== 'object') {
                throw new Error("Policy 'policyRule' must be an object");
            }
            
            // Validate policyRule has if/then structure
            if (!json.properties.policyRule.if || !json.properties.policyRule.then) {
                throw new Error("Policy rule must contain 'if' and 'then' sections");
            }
        }
        
        // Validate policy definitions if present
        if (json.properties.policyDefinitions) {
            if (!Array.isArray(json.properties.policyDefinitions)) {
                throw new Error("Policy 'policyDefinitions' must be an array");
            }
            
            // Check each policy definition reference
            for (let i = 0; i < json.properties.policyDefinitions.length; i++) {
                const def = json.properties.policyDefinitions[i];
                // Allow either policyDefinitionId or policyDefinitionName for policy sets
                if ((!def.policyDefinitionId && !def.policyDefinitionName) || 
                    (def.policyDefinitionId && typeof def.policyDefinitionId !== 'string') ||
                    (def.policyDefinitionName && typeof def.policyDefinitionName !== 'string')) {
                    throw new Error(`Policy definition at index ${i} is missing a valid 'policyDefinitionId' or 'policyDefinitionName'`);
                }
                
                // Ensure policyDefinitionReferenceId is present and valid
                if (!def.policyDefinitionReferenceId || typeof def.policyDefinitionReferenceId !== 'string') {
                    throw new Error(`Policy definition at index ${i} is missing a valid 'policyDefinitionReferenceId'`);
                }
            }
        }
        
        // Validate parameters if present
        if (json.properties.parameters) {
            if (typeof json.properties.parameters !== 'object') {
                throw new Error("Policy 'parameters' must be an object");
            }
            
            // Check each parameter
            for (const [paramName, param] of Object.entries(json.properties.parameters)) {
                const paramValue = param as any;
                if (!paramValue.type || typeof paramValue.type !== 'string') {
                    throw new Error(`Parameter '${paramName}' is missing a valid 'type'`);
                }
                
                // Validate allowed parameter types
                const validTypes = ['string', 'array', 'object', 'boolean', 'integer', 'number', 'null'];
                if (!validTypes.includes(paramValue.type.toLowerCase())) {
                    throw new Error(`Parameter '${paramName}' has invalid type '${paramValue.type}'`);
                }
            }
        }
    }
}