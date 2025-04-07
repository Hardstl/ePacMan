import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../logging';
import { ErrorHandler } from '../error';
import { isPolicyDocument } from '../utils';

/**
 * Interface for policy assignment data
 */
export interface PolicyAssignment {
    id: string;
    name: string;
    displayName?: string;
    description?: string;
    scope: string;
    policyDefinitionId: string;
    parameters?: Record<string, any>;
    enforcementMode?: string;
    nonComplianceMessages?: Array<{ message: string }>;
    metadata?: Record<string, any>;
    filePath: string;
}

/**
 * Class for parsing policy assignment files
 */
export class PolicyAssignmentParser {
    private logger = Logger.getInstance();
    
    /**
     * Parse policy assignments from the workspace
     * @param focusFileUri Optional URI of a policy assignment file to focus on
     * @returns Array of policy assignments
     */
    async parseAssignments(focusFileUri?: vscode.Uri): Promise<PolicyAssignment[]> {
        try {
            this.logger.info("Parsing policy assignments");
            
            const assignments: PolicyAssignment[] = [];
            
            // If a specific file is provided, only parse that file
            if (focusFileUri) {
                const document = await vscode.workspace.openTextDocument(focusFileUri);
                if (this.isPolicyAssignmentFile(document)) {
                    const parsedAssignments = await this.parseAssignmentFromDocument(document);
                    if (parsedAssignments && parsedAssignments.length > 0) {
                        assignments.push(...parsedAssignments);
                    }
                }
            } else {
                // Find all policy assignment files in the workspace
                const files = await this.findPolicyAssignmentFiles();
                
                // Parse each file
                for (const file of files) {
                    try {
                        const document = await vscode.workspace.openTextDocument(file);
                        const parsedAssignments = await this.parseAssignmentFromDocument(document);
                        if (parsedAssignments && parsedAssignments.length > 0) {
                            assignments.push(...parsedAssignments);
                        }
                    } catch (error: any) {
                        this.logger.error(`Error parsing assignment file: ${file.fsPath}`, error);
                    }
                }
            }
            
            this.logger.info(`Found ${assignments.length} policy assignments`);
            return assignments;
        } catch (error: any) {
            this.logger.error("Error parsing policy assignments", error);
            ErrorHandler.handleError(error, "Failed to parse policy assignments");
            return [];
        }
    }
    
    /**
     * Find all policy assignment files in the workspace
     * @returns Array of file URIs
     */
    private async findPolicyAssignmentFiles(): Promise<vscode.Uri[]> {
        // Find all .json and .jsonc files in the workspace
        const jsonFiles = await vscode.workspace.findFiles(
            '**/*.json',
            '**/node_modules/**'
        );
        
        const jsonCFiles = await vscode.workspace.findFiles(
            '**/*.jsonc',
            '**/node_modules/**'
        );
        
        // Combine all potential files
        const allFiles = [...jsonFiles, ...jsonCFiles];
        
        // Filter to only include those with the EPAC schema
        const policyFiles: vscode.Uri[] = [];
        for (const file of allFiles) {
            try {
                const document = await vscode.workspace.openTextDocument(file);
                const content = document.getText();
                if (content.includes('"$schema": "https://raw.githubusercontent.com/Azure/enterprise-azure-policy-as-code/main/Schemas/policy-assignment-schema.json"')) {
                    this.logger.info(`Found EPAC policy assignment file: ${file.fsPath}`);
                    policyFiles.push(file);
                }
            } catch (error) {
                // Ignore errors when checking for EPAC schema
                this.logger.warn(`Error checking file for EPAC schema: ${file.fsPath}`);
            }
        }
        
        this.logger.info(`Found ${policyFiles.length} policy assignment files`);
        return policyFiles;
    }
    
    /**
     * Check if a document is a policy assignment file
     * @param document The document to check
     * @returns True if the document is a policy assignment file
     */
    private isPolicyAssignmentFile(document: vscode.TextDocument): boolean {
        if (document.languageId !== 'json' && document.languageId !== 'jsonc') {
            this.logger.info(`Document is not JSON or JSONC: ${document.uri.fsPath}, languageId: ${document.languageId}`);
            return false;
        }
        
        const content = document.getText();
        
        // Check if this is an EPAC policy assignment by schema
        if (content.includes('"$schema": "https://raw.githubusercontent.com/Azure/enterprise-azure-policy-as-code/main/Schemas/policy-assignment-schema.json"')) {
            this.logger.info(`Found EPAC policy assignment by schema: ${document.uri.fsPath}`);
            return true;
        }
        
        return false;
    }
    
    /**
     * Parse a policy assignment from a document
     * @param document The document to parse
     * @returns Array of parsed policy assignments, or empty array if parsing fails
     */
    private async parseAssignmentFromDocument(document: vscode.TextDocument): Promise<PolicyAssignment[]> {
        try {
            const content = document.getText();
            
            // Remove comments from JSONC files
            const jsonContent = this.removeJsonComments(content);
            
            try {
                const json = JSON.parse(jsonContent);
                
                // Check if this is an EPAC policy assignment
                if (json.$schema && json.$schema.includes('enterprise-azure-policy-as-code') && json.$schema.includes('policy-assignment-schema.json')) {
                    this.logger.info(`Found EPAC policy assignment: ${document.uri.fsPath}`);
                    return this.parseEpacAssignment(json, document.uri.fsPath);
                } else if (content.includes('"$schema": "https://raw.githubusercontent.com/Azure/enterprise-azure-policy-as-code/main/Schemas/policy-assignment-schema.json"')) {
                    // Try again with a direct string check in case the JSON parsing didn't pick up the schema
                    this.logger.info(`Found EPAC policy assignment by string check: ${document.uri.fsPath}`);
                    return this.parseEpacAssignment(json, document.uri.fsPath);
                }
                
                // Check if this is a standard policy assignment
                if (json.properties && json.properties.policyDefinitionId) {
                    const assignment = this.parseStandardAssignment(json, document.uri.fsPath);
                    return assignment ? [assignment] : [];
                }
                
                this.logger.warn(`File is not a valid policy assignment: ${document.uri.fsPath}`);
                return [];
            } catch (parseError: any) {
                this.logger.error(`Error parsing JSON: ${document.uri.fsPath}`, parseError);
                return [];
            }
        } catch (error: any) {
            this.logger.error(`Error reading document: ${document.uri.fsPath}`, error);
            return [];
        }
    }
    
    /**
     * Remove comments from JSON content
     * @param content The JSON content with comments
     * @returns The JSON content without comments
     */
    private removeJsonComments(content: string): string {
        // Remove single line comments
        let result = content.replace(/\/\/.*$/gm, '');
        
        // Remove multi-line comments
        result = result.replace(/\/\*[\s\S]*?\*\//g, '');
        
        return result;
    }
    
    /**
     * Parse a standard Azure policy assignment
     * @param json The JSON object
     * @param filePath The file path
     * @returns The parsed policy assignment, or undefined if parsing fails
     */
    private parseStandardAssignment(json: any, filePath: string): PolicyAssignment | undefined {
        try {
            // Extract the assignment data
            const assignment: PolicyAssignment = {
                id: json.id || json.name || path.basename(filePath, '.json'),
                name: json.name || path.basename(filePath, '.json'),
                displayName: json.properties.displayName,
                description: json.properties.description,
                scope: json.properties.scope || '',
                policyDefinitionId: json.properties.policyDefinitionId,
                parameters: json.properties.parameters,
                enforcementMode: json.properties.enforcementMode,
                nonComplianceMessages: json.properties.nonComplianceMessages,
                metadata: json.properties.metadata,
                filePath: filePath
            };
            
            return assignment;
        } catch (error: any) {
            this.logger.error(`Error parsing standard assignment: ${filePath}`, error);
            return undefined;
        }
    }
    
    /**
     * Parse an EPAC policy assignment
     * @param json The JSON object
     * @param filePath The file path
     * @returns Array of parsed policy assignments
     */
    private parseEpacAssignment(json: any, filePath: string): PolicyAssignment[] {
        const assignments: PolicyAssignment[] = [];
        
        try {
            // Get the root scope and pacSelector from the EPAC assignment
            let rootScope = '';
            let rootPacSelector = '';
            
            if (json.scope) {
                // Get the first scope from the first environment
                const environments = Object.keys(json.scope);
                if (environments.length > 0) {
                    rootPacSelector = environments[0];
                    const scopes = json.scope[rootPacSelector];
                    if (scopes && scopes.length > 0) {
                        rootScope = scopes[0];
                    }
                }
                this.logger.info(`Root EPAC assignment scope: ${rootScope}, pacSelector: ${rootPacSelector}`);
            }
            
            // Check if this is a direct assignment at the root level
            if (json.assignment) {
                const assignment = this.processEpacAssignment(json, rootScope, json.nodeName || '', filePath, rootPacSelector);
                if (assignment) {
                    assignments.push(assignment);
                }
            }
            
            // Process the children recursively
            if (json.children) {
                this.processEpacChildren(json.children, rootScope, assignments, filePath, '', rootPacSelector);
            }
            
            return assignments;
        } catch (error: any) {
            this.logger.error(`Error parsing EPAC assignment: ${filePath}`, error);
            return [];
        }
    }
    
    /**
     * Process EPAC children recursively
     * @param children The children array
     * @param parentScope The parent scope
     * @param assignments The assignments array to populate
     * @param filePath The file path
     * @param parentPath The parent path for node names
     * @param pacSelector The PAC selector (environment name)
     */
    private processEpacChildren(
        children: any[],
        parentScope: string,
        assignments: PolicyAssignment[],
        filePath: string,
        parentPath: string = '',
        parentPacSelector: string = ''
    ): void {
        for (const child of children) {
            const nodePath = parentPath + (child.nodeName || '');
            
            // Check if this child has its own scope
            let childScope = parentScope;
            let childPacSelector = parentPacSelector;
            
            if (child.scope) {
                // Get the first scope from the first environment
                const environments = Object.keys(child.scope);
                if (environments.length > 0) {
                    childPacSelector = environments[0];
                    const scopes = child.scope[childPacSelector];
                    if (scopes && scopes.length > 0) {
                        childScope = scopes[0];
                    }
                }
                this.logger.info(`Node-level scope found: ${childScope}, pacSelector: ${childPacSelector}, nodePath: ${nodePath}`);
            }
            
            // If this child has an assignment, process it
            if (child.assignment) {
                const assignment = this.processEpacAssignment(child, childScope, nodePath, filePath, childPacSelector);
                if (assignment) {
                    assignments.push(assignment);
                }
            }
            
            // Process children recursively
            if (child.children) {
                this.processEpacChildren(child.children, childScope, assignments, filePath, nodePath, childPacSelector);
            }
        }
    }
    
    /**
     * Process an EPAC assignment
     * @param node The EPAC node
     * @param scope The scope
     * @param nodePath The node path
     * @param filePath The file path
     * @param pacSelector The PAC selector (environment name)
     * @returns The parsed policy assignment, or undefined if parsing fails
     */
    private processEpacAssignment(node: any, scope: string, nodePath: string, filePath: string, pacSelector: string = ''): PolicyAssignment | undefined {
        try {
            this.logger.info(`Processing EPAC assignment: scope=${scope}, pacSelector=${pacSelector}, nodePath=${nodePath}`);
            
            // In EPAC format, each node with an assignment has:
            // - assignment: contains name, displayName, description
            // - definitionEntry: contains policySetName or policyId/policyName
            // - parameters: sibling object containing all parameters
            const assignment = node.assignment;
            const definitionEntry = node.definitionEntry || {};
            const parameters = node.parameters || {};

            if (!assignment || !assignment.name) {
                this.logger.warn(`Invalid EPAC assignment node: missing required assignment.name`);
                return undefined;
            }
            
            // Get policy definition ID
            let policyDefinitionId = '';
            if (definitionEntry.policyId) {
                policyDefinitionId = definitionEntry.policyId;
            } else if (definitionEntry.policySetId) {
                policyDefinitionId = definitionEntry.policySetId;
            } else if (definitionEntry.policyName) {
                policyDefinitionId = `/providers/Microsoft.Authorization/policyDefinitions/${definitionEntry.policyName}`;
            } else if (definitionEntry.policySetName) {
                policyDefinitionId = `/providers/Microsoft.Authorization/policySetDefinitions/${definitionEntry.policySetName}`;
            }
            
            // Log the parameters we found
            this.logger.info(`Found ${Object.keys(parameters).length} parameters for assignment '${assignment.name}'`);
            this.logger.debug(`Parameters for ${assignment.name}: ${JSON.stringify(parameters, null, 2)}`);
            
            // Get non-compliance messages from node or definitionEntry
            const nonComplianceMessages = node.nonComplianceMessages || 
                (definitionEntry.nonComplianceMessages ? definitionEntry.nonComplianceMessages : []);
            
            // Extract management group name from scope
            let scopeDisplay = scope;
            if (scope.includes('/providers/Microsoft.Management/managementGroups/')) {
                const parts = scope.split('/');
                const mgName = parts[parts.length - 1];
                scopeDisplay = `pacSelector: ${pacSelector}, Management Group: ${mgName}`;
                this.logger.info(`Setting scope display: ${scopeDisplay}`);
            } else {
                this.logger.warn(`Scope does not contain management group: ${scope}`);
            }
            
            // Create the assignment object
            const policyAssignment: PolicyAssignment = {
                id: assignment.name,
                name: assignment.name,
                displayName: assignment.displayName || '',
                description: assignment.description || '',
                scope: scopeDisplay,
                policyDefinitionId: policyDefinitionId,
                parameters: parameters, // Direct assignment of parameters object
                enforcementMode: assignment.enforcementMode || 'Default',
                nonComplianceMessages: nonComplianceMessages,
                metadata: assignment.metadata || {},
                filePath: filePath
            };
            
            return policyAssignment;
        } catch (error: any) {
            this.logger.error(`Error processing EPAC assignment node: ${nodePath}`, error);
            return undefined;
        }
    }
}