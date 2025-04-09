import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../logging';

/**
 * Utility for comparing local policy files with GitHub versions
 */
export class FileComparisonUtility {
    private readonly logger: Logger;
    
    constructor() {
        this.logger = Logger.getInstance();
    }
    
    /**
     * Extract policy name from JSON content
     * @param jsonContent The JSON content as a string
     * @returns The policy name or null if not found
     */
    public extractPolicyName(jsonContent: string): string | null {
        try {
            const json = JSON.parse(jsonContent);
            
            if (json.name) {
                return json.name;
            }
            
            return null;
        } catch (error: any) {
            this.logger.error('Error extracting policy name from JSON content', error);
            return null;
        }
    }
    
    /**
     * Read a local file and extract its policy name
     * @param filePath The path to the local file
     * @returns The policy name or null if not found
     */
    public async readLocalFileAndExtractPolicyName(filePath: string): Promise<string | null> {
        try {
            const content = await fs.promises.readFile(filePath, 'utf-8');
            return this.extractPolicyName(content);
        } catch (error: any) {
            this.logger.error(`Error reading local file ${filePath}`, error);
            throw new Error(`Failed to read local file: ${error.message}`);
        }
    }
    
    /**
     * Compare local and GitHub policy files
     * @param localFilePath The path to the local file
     * @param githubContent The content of the GitHub file
     * @returns True if the files are identical, false otherwise
     */
    public async compareFiles(localFilePath: string, githubContent: string): Promise<boolean> {
        try {
            const localContent = await fs.promises.readFile(localFilePath, 'utf-8');
            
            // Parse both files to compare the actual content, not just the string representation
            // This handles differences in formatting, whitespace, etc.
            const localJson = JSON.parse(localContent);
            const githubJson = JSON.parse(githubContent);
            
            // Create normalized copies of the JSON objects for comparison
            const normalizedLocalJson = this.normalizeJsonForComparison(localJson);
            const normalizedGithubJson = this.normalizeJsonForComparison(githubJson);
            
            // Convert back to strings with consistent formatting for comparison
            const normalizedLocalContent = JSON.stringify(normalizedLocalJson, null, 2);
            const normalizedGithubContent = JSON.stringify(normalizedGithubJson, null, 2);
            
            return normalizedLocalContent === normalizedGithubContent;
        } catch (error: any) {
            this.logger.error(`Error comparing files ${localFilePath}`, error);
            throw new Error(`Failed to compare files: ${error.message}`);
        }
    }
    
    /**
     * Normalize JSON object for comparison by removing properties that should be ignored
     * @param json The JSON object to normalize
     * @returns A new JSON object with ignored properties removed
     */
    private normalizeJsonForComparison(json: any): any {
        // Create a deep copy of the JSON object
        let normalized = JSON.parse(JSON.stringify(json));
        
        // Remove properties that should be ignored
        delete normalized.type;
        delete normalized.apiVersion;
        delete normalized.scope;
        
        // Helper function to normalize double brackets in string values
        const normalizeDoubleBrackets = (value: any): any => {
            if (typeof value === 'string') {
                // Replace double brackets with single brackets
                return value.replace(/\[\[/g, "[").replace(/\]\]/g, "]");
            } else if (Array.isArray(value)) {
                // Process arrays recursively
                return value.map(item => normalizeDoubleBrackets(item));
            } else if (value !== null && typeof value === 'object') {
                // Process objects recursively
                const result: any = {};
                for (const key in value) {
                    result[key] = normalizeDoubleBrackets(value[key]);
                }
                return result;
            }
            return value;
        };
        
        // Normalize all string values to replace double brackets with single brackets
        normalized = normalizeDoubleBrackets(normalized);
        
        // If there are nested properties objects, handle them too
        if (normalized.properties) {
            // Some properties might be in the properties object in some formats
            delete normalized.properties.type;
            delete normalized.properties.apiVersion;
            delete normalized.properties.scope;
            delete normalized.properties.policyType; // Ignore policyType in the properties object
            delete normalized.properties.policyDefinitionGroups; // Ignore policyDefinitionGroups
            
            // Normalize metadata values that might be serialized differently
            if (normalized.properties.metadata && normalized.properties.metadata.alzCloudEnvironments) {
                // Ensure alzCloudEnvironments is always an array, regardless of how it was serialized
                if (typeof normalized.properties.metadata.alzCloudEnvironments === 'string') {
                    try {
                        normalized.properties.metadata.alzCloudEnvironments = JSON.parse(normalized.properties.metadata.alzCloudEnvironments);
                    } catch (e) {
                        // If parsing fails, leave it as is
                    }
                }
            }
            
            // Handle policy set definitions (initiatives)
            if (normalized.properties.policyDefinitions && Array.isArray(normalized.properties.policyDefinitions)) {
                // Sort policy definitions by their reference ID to ensure consistent ordering
                normalized.properties.policyDefinitions.sort((a: any, b: any) => {
                    return a.policyDefinitionReferenceId.localeCompare(b.policyDefinitionReferenceId);
                });
                
                // Normalize each policy definition in the set
                normalized.properties.policyDefinitions = normalized.properties.policyDefinitions.map((policyDef: any) => {
                    // Create a copy of the policy definition
                    const normalizedPolicyDef = { ...policyDef };
                    
                    // Remove properties we want to ignore for policy set definitions
                    delete normalizedPolicyDef.definitionVersion;
                    delete normalizedPolicyDef.groupNames;
                    
                    // Handle different formats of policy definition identifiers
                    if (normalizedPolicyDef.policyDefinitionId && !normalizedPolicyDef.policyDefinitionName) {
                        // Extract the name or ID from the policyDefinitionId - take everything after the last slash
                        const nameMatch = normalizedPolicyDef.policyDefinitionId.match(/\/([^\/]+)$/);
                        if (nameMatch && nameMatch[1]) {
                            normalizedPolicyDef.policyDefinitionName = nameMatch[1];
                        } else {
                            // Fallback to using the GUID extraction for backward compatibility
                            const idMatch = normalizedPolicyDef.policyDefinitionId.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i);
                            if (idMatch && idMatch[1]) {
                                normalizedPolicyDef.policyDefinitionName = idMatch[1];
                            }
                        }
                        // Keep the original ID for reference but don't use it for comparison
                        delete normalizedPolicyDef.policyDefinitionId;
                    } else if (normalizedPolicyDef.policyDefinitionName && !normalizedPolicyDef.policyDefinitionId) {
                        // Already in EPAC format, no need to change
                    }
                    
                    // Handle parameter values - normalize parameter reference syntax
                    if (normalizedPolicyDef.parameters) {
                        Object.keys(normalizedPolicyDef.parameters).forEach(paramKey => {
                            const paramValue = normalizedPolicyDef.parameters[paramKey];
                            if (paramValue && paramValue.value && typeof paramValue.value === 'string') {
                                // Normalize the parameter reference format by removing extra brackets
                                // Convert "[[parameters('name')]" to "[parameters('name')]"
                                paramValue.value = paramValue.value.replace(/\[\[parameters\(/g, "[parameters(");
                                // And handle the opposite case - add brackets if needed
                                paramValue.value = paramValue.value.replace(/\[parameters\(/g, "[parameters(");
                            }
                        });
                    }
                    
                    // For policy set definitions, ensure properties are in the expected order
                    if (normalizedPolicyDef.policyDefinitionReferenceId) {
                        // Create a new object with properties in the desired order
                        const orderedPolicyDef: any = {};
                        
                        // 1. First add policyDefinitionReferenceId
                        orderedPolicyDef.policyDefinitionReferenceId = normalizedPolicyDef.policyDefinitionReferenceId;
                        
                        // 2. Then add policyDefinitionId (preferred) or policyDefinitionName
                        if (normalizedPolicyDef.policyDefinitionId) {
                            orderedPolicyDef.policyDefinitionId = normalizedPolicyDef.policyDefinitionId;
                        } else if (normalizedPolicyDef.policyDefinitionName) {
                            orderedPolicyDef.policyDefinitionName = normalizedPolicyDef.policyDefinitionName;
                        }
                        
                        // 3. Finally add parameters if they exist
                        if (normalizedPolicyDef.parameters) {
                            orderedPolicyDef.parameters = normalizedPolicyDef.parameters;
                        }
                        
                        return orderedPolicyDef;
                    }
                    
                    return normalizedPolicyDef;
                });
            }
        }
        
        // Return a canonical representation that ignores property order
        return this.canonicalizeJson(normalized);
    }
    
    /**
     * Creates a canonical representation of a JSON object that ignores property order
     * This ensures properties like definitionVersion and groupNames are compared by value, not by order
     * @param obj The JSON object to canonicalize
     * @returns A new JSON object with properties in a canonical order
     */
    private canonicalizeJson(obj: any): any {
        if (obj === null || typeof obj !== 'object') {
            return obj;
        }
        
        if (Array.isArray(obj)) {
            // For arrays, recursively canonicalize each element
            return obj.map(item => this.canonicalizeJson(item));
        }
        
        // For objects, create a new object with keys in sorted order
        const sortedKeys = Object.keys(obj).sort();
        const canonicalObj: any = {};
        
        for (const key of sortedKeys) {
            canonicalObj[key] = this.canonicalizeJson(obj[key]);
        }
        
        return canonicalObj;
    }
    
    /**
     * Show diff view in VS Code
     * @param localFilePath The path to the local file
     * @param githubContent The content of the GitHub file
     * @param policyName The policy name
     * @returns Promise resolving when the diff view is shown
     */
    public async showDiffView(localFilePath: string, githubContent: string, policyName: string): Promise<void> {
        try {
            // Read the local file content
            const localContent = await fs.promises.readFile(localFilePath, 'utf-8');
            
            // Parse both files
            const localJson = JSON.parse(localContent);
            const githubJson = JSON.parse(githubContent);
            
            // Determine if this is a policy set definition
            const isPolicySet = await this.isPolicySetDefinition(localFilePath);
            
            // Choose the appropriate schema URL based on whether it's a policy set definition
            const schemaUrl = isPolicySet 
                ? "https://raw.githubusercontent.com/Azure/enterprise-azure-policy-as-code/main/Schemas/policy-set-definition-schema.json"
                : "https://raw.githubusercontent.com/Azure/enterprise-azure-policy-as-code/main/Schemas/policy-definition-schema.json";
            
            // Normalize both JSON objects using the same logic
            const normalizedLocalJson = this.normalizeJsonForComparison(localJson);
            const normalizedGithubJson = this.normalizeJsonForComparison(githubJson);
            
            // Convert to strings with consistent formatting
            let normalizedLocalContent = JSON.stringify(normalizedLocalJson, null, 2);
            let normalizedGithubContent = JSON.stringify(normalizedGithubJson, null, 2);
            
            // Add $schema at the top if it doesn't already exist
            const schemaProperty = `"$schema": "${schemaUrl}"`;
            
            // Check if schema already exists
            const localHasSchema = normalizedLocalContent.includes('"$schema"');
            const githubHasSchema = normalizedGithubContent.includes('"$schema"');
            
            // Add schema only if it doesn't exist already
            if (!localHasSchema) {
                normalizedLocalContent = `{\n  ${schemaProperty},${normalizedLocalContent.substring(1)}`;
            }
            
            if (!githubHasSchema) {
                normalizedGithubContent = `{\n  ${schemaProperty},${normalizedGithubContent.substring(1)}`;
            }
            
            // Quick equality check - if they're equal, just show a message
            if (normalizedLocalContent === normalizedGithubContent) {
                vscode.window.showInformationMessage(`Policy "${policyName}" is identical to the GitHub version.`);
                return;
            }
            
            // Create temporary files for both versions with normalized content
            const githubUri = vscode.Uri.parse(`untitled:${policyName}-github.json`);
            const localTempUri = vscode.Uri.parse(`untitled:${policyName}-local.json`);
            
            // Create documents and edit them with normalized content
            const githubDoc = await vscode.workspace.openTextDocument(githubUri);
            const localTempDoc = await vscode.workspace.openTextDocument(localTempUri);
            
            const workspaceEdit = new vscode.WorkspaceEdit();
            workspaceEdit.insert(githubUri, new vscode.Position(0, 0), normalizedGithubContent);
            workspaceEdit.insert(localTempUri, new vscode.Position(0, 0), normalizedLocalContent);
            await vscode.workspace.applyEdit(workspaceEdit);
            
            // Show the diff between normalized versions
            // Swap the order of parameters to show local first and GitHub second
            await vscode.commands.executeCommand(
                'vscode.diff',
                localTempUri,  // Show local file first
                githubUri,     // Show GitHub version second
                `${policyName}: Local ↔ GitHub (Normalized View)`  // Updated title to match new order
            );
            
            this.logger.info(`Showing normalized diff view for policy ${policyName}`);
        } catch (error: any) {
            this.logger.error(`Error showing diff view for ${localFilePath}`, error);
            throw new Error(`Failed to show diff view: ${error.message}`);
        }
    }
    
    /**
     * Normalize content for display by removing properties that should be ignored
     * @param content The JSON content as a string
     * @returns Normalized JSON content as a string
     */
    private async normalizeContentForDisplay(content: string, localFilePath: string): Promise<string> {
        try {
            // Parse the content
            const json = JSON.parse(content);
            
            // Determine if this is a policy set definition
            const isPolicySet = await this.isPolicySetDefinition(localFilePath);
            
            // Choose the appropriate schema URL based on whether it's a policy set definition
            const schemaUrl = isPolicySet 
                ? "https://raw.githubusercontent.com/Azure/enterprise-azure-policy-as-code/main/Schemas/policy-set-definition-schema.json"
                : "https://raw.githubusercontent.com/Azure/enterprise-azure-policy-as-code/main/Schemas/policy-definition-schema.json";
            
            // Normalize the JSON object using the same logic as for comparison
            const normalizedJson = this.normalizeJsonForComparison(json);
            
            // Convert to a string with consistent formatting
            const normalizedContent = JSON.stringify(normalizedJson, null, 2);
            
            // Check if schema already exists
            const hasSchema = normalizedContent.includes('"$schema"');
            
            // Add $schema at the top if it doesn't already exist
            if (!hasSchema) {
                const schemaProperty = `"$schema": "${schemaUrl}"`;
                return `{\n  ${schemaProperty},${normalizedContent.substring(1)}`;
            }
            
            return normalizedContent;
        } catch (error: any) {
            this.logger.error('Error normalizing content for display', error);
            // Return the original content if there's an error
            return content;
        }
    }
    
    /**
     * Update local file with GitHub content
     * @param localFilePath The path to the local file
     * @param githubContent The content of the GitHub file
     * @returns Promise resolving when the file is updated
     */
    public async updateLocalFile(localFilePath: string, githubContent: string): Promise<void> {
        try {
            // Normalize the GitHub content to remove properties that should be ignored
            const normalizedGithubContent = await this.normalizeContentForDisplay(githubContent, localFilePath);
            
            // Parse the normalized GitHub content to ensure it's valid JSON
            JSON.parse(normalizedGithubContent);
            
            // Write the normalized GitHub content to the local file
            await fs.promises.writeFile(localFilePath, normalizedGithubContent, 'utf-8');
            
            this.logger.info(`Updated local file ${localFilePath} with GitHub content`);
        } catch (error: any) {
            this.logger.error(`Error updating local file ${localFilePath}`, error);
            throw new Error(`Failed to update local file: ${error.message}`);
        }
    }
    
    /**
     * Determine if a file is a policy definition or policy set definition
     * @param filePath The path to the file
     * @returns Promise resolving to true if it's a policy set definition, false otherwise
     */
    public async isPolicySetDefinition(filePath: string): Promise<boolean> {
        try {
            this.logger.info(`[File Comparison] Checking if ${filePath} is a policy set definition`);
            
            // Check filename first for quick determination
            const filename = path.basename(filePath).toLowerCase();
            if (filename.includes('policy_set') || filename.includes('initiative')) {
                this.logger.info(`[File Comparison] File ${filePath} is a policy set definition based on filename`);
                return true;
            }
            
            // If filename doesn't give a clear answer, check content
            const content = await fs.promises.readFile(filePath, 'utf-8');
            const json = JSON.parse(content);
            
            this.logger.info(`[File Comparison] Analyzing content of ${filePath} to determine if it's a policy set definition`);
            
            // The definitive check for a policy set: presence of policyDefinitions array
            if (json.properties && Array.isArray(json.properties.policyDefinitions)) {
                this.logger.info(`[File Comparison] File ${filePath} is a policy set definition based on content (has policyDefinitions array)`);
                return true;
            }

            // Check schema if available - this is also a reliable indicator
            if (json.$schema && typeof json.$schema === 'string' && 
                json.$schema.toLowerCase().includes('policy-set-definition-schema')) {
                this.logger.info(`[File Comparison] File ${filePath} is a policy set definition based on schema reference`);
                return true;
            }
            
            // If no policyDefinitions array is found, it's a regular policy
            this.logger.info(`[File Comparison] File ${filePath} is not a policy set definition`);
            return false;
        } catch (error: any) {
            this.logger.error(`[File Comparison] Error determining if ${filePath} is a policy set definition`, error);
            return false;
        }
    }
}