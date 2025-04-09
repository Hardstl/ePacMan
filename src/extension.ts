import * as vscode from 'vscode';
import * as fs from 'fs';
import * as jsonc from 'jsonc-parser'; // Add explicit import for jsonc-parser
import { Logger } from './logging';
import { ErrorHandler } from './error';
import { ValidationEngine } from './validation';
import { registerCommands } from './commands';
import { GitHubComparisonService } from './github';
import { isPolicyDocument, identifyPolicyDocument, PolicyDocumentType } from './utils';
// Components will be imported dynamically when needed

/**
 * Update the custom policy context key based on the active editor
 * @param context The extension context
 */
async function updateCustomPolicyContextKey(context: vscode.ExtensionContext): Promise<void> {
    const isCustomPolicy = await isPolicyDocument(vscode.window.activeTextEditor?.document);
    vscode.commands.executeCommand('setContext', 'epacman.isCustomPolicy', isCustomPolicy);
}

/**
 * Register JSON schema provider for both JSON and JSONC files
 * @param context The extension context
 */
function registerJsonSchemaProvider(context: vscode.ExtensionContext): void {
    const logger = Logger.getInstance();
    
    // Get schema file paths
    const policyDefinitionSchemaPath = vscode.Uri.file(
        context.asAbsolutePath('schemas/policy-definition-schema.json')
    ).toString();
    
    const policySetDefinitionSchemaPath = vscode.Uri.file(
        context.asAbsolutePath('schemas/policy-set-definition-schema.json')
    ).toString();
    
    const policyAssignmentSchemaPath = vscode.Uri.file(
        context.asAbsolutePath('schemas/policy-assignment-schema.json')
    ).toString();
    
    // Register the schema contributions
    try {
        logger.debug("Registering JSON schema associations");
        
        // Use setLanguageConfiguration instead of registerLanguageConfiguration
        vscode.languages.setLanguageConfiguration('jsonc', {
            wordPattern: /(-?\d*\.\d\w*)|([^\`\~\!\@\#\%\^\&\*\(\)\-\=\+\[\{\]\}\\\|\;\:\'\"\,\.\<\>\/\?\s]+)/g,
            indentationRules: {
                increaseIndentPattern: /^.*(\{[^}]*|\[[^\]]*)$/,
                decreaseIndentPattern: /^\s*[}\]],?\s*$/
            },
            comments: {
                lineComment: "//",
                blockComment: ["/*", "*/"]
            }
        });
        
        // Register a custom JSON schema provider that uses content-based detection
        // instead of relying on file paths in package.json
        const jsonSchemaProvider = vscode.languages.registerCompletionItemProvider(
            [{ language: 'json' }, { language: 'jsonc' }],
            {
                provideCompletionItems(document, position, token, context) {
                    // This is just a placeholder to register the provider
                    // The actual schema validation is done by the ValidationEngine
                    return null;
                }
            }
        );
        
        // Add the provider to the context subscriptions
        context.subscriptions.push(jsonSchemaProvider);
        
        logger.info("JSON schema associations registered successfully");
    } catch (error: any) {
        logger.error("Failed to register JSON schema associations", error);
    }
}

/**
 * Register a dedicated completion provider to enhance snippet suggestions
 * @param context The extension context
 */
function registerSnippetCompletionProvider(context: vscode.ExtensionContext): void {
    const logger = Logger.getInstance();
    logger.debug("Registering snippet completion provider");
    
    try {
        // Create a cache to store document URIs and their policy document types
        // This improves performance by avoiding repeated parsing of the same document
        const policyDocumentCache = new Map<string, PolicyDocumentType>();
        
        // Register event handlers to clear cache entries when documents change
        const documentChangeSubscription = vscode.workspace.onDidChangeTextDocument(event => {
            // Remove from cache when document content changes
            policyDocumentCache.delete(event.document.uri.toString());
        });
        
        const documentCloseSubscription = vscode.workspace.onDidCloseTextDocument(document => {
            // Remove from cache when document is closed to free memory
            policyDocumentCache.delete(document.uri.toString());
        });
        
        // Add subscriptions to context for proper cleanup
        context.subscriptions.push(documentChangeSubscription, documentCloseSubscription);
        
        // Register a completion provider for JSON and JSONC files
        const completionProvider = vscode.languages.registerCompletionItemProvider(
            [{ language: 'json' }, { language: 'jsonc' }],
            {
                async provideCompletionItems(document, position, token, completionContext) {
                    // Get document URI for caching
                    const documentUri = document.uri.toString();
                    
                    // Check if we've already identified this document
                    if (!policyDocumentCache.has(documentUri)) {
                        // Do a quick content check to speed things up
                        const text = document.getText();
                        const quickCheckForAssignment = text.includes('"nodeName"') || 
                                                      text.includes('"policyDefinitionId"') ||
                                                      text.includes('"enforcementMode"') ||
                                                      text.includes('policy-assignment-schema.json');
                        
                        if (!quickCheckForAssignment) {
                            // Quickly rule out non-assignment files
                            policyDocumentCache.set(documentUri, PolicyDocumentType.None);
                            return null;
                        }
                        
                        // Wait for full document type identification before proceeding
                        // This ensures completions are based on accurate document type
                        try {
                            // Await the async identification to ensure accurate cache updates
                            const docType = await identifyPolicyDocument(document);
                            policyDocumentCache.set(documentUri, docType);
                            
                            // If it's not a policy assignment, return null immediately
                            if (docType !== PolicyDocumentType.PolicyAssignment) {
                                return null;
                            }
                        } catch (error) {
                            // On error, assume it's not a policy document
                            logger.debug(`Error identifying policy document: ${error}`);
                            policyDocumentCache.set(documentUri, PolicyDocumentType.None);
                            return null;
                        }
                    } else if (policyDocumentCache.get(documentUri) !== PolicyDocumentType.PolicyAssignment) {
                        // We've seen this document before and determined it's not a policy assignment
                        return null;
                    }
                    
                    // Create completion items for policy-specific keywords
                    const completionItems: vscode.CompletionItem[] = [];
                    
                    // ---- Subscription Role Assignments ----
                    const additionalRoleAssignmentsSubscriptionItem = new vscode.CompletionItem(
                        'additionalRoleAssignments-Subscription',
                        vscode.CompletionItemKind.Method
                    );
                    additionalRoleAssignmentsSubscriptionItem.insertText = new vscode.SnippetString(
                        '"additionalRoleAssignments": {\n' +
                        '  "${1:pacSelector or *}":[\n' +
                        '    {\n' +
                        '      "roleDefinitionId": "${2:/providers/microsoft.authorization/roleDefinitions/4d97b98b-1d4f-4787-a291-c67834d212e7}",\n' +
                        '      "scope": "${3:/subscriptions/your-subscription-id}"\n' +
                        '    }\n' +
                        '  ]\n' +
                        '}'
                    );
                    additionalRoleAssignmentsSubscriptionItem.documentation = new vscode.MarkdownString(
                        'Adds additionalRoleAssignments for Policy Assignment managed identity targeting a subscription'
                    );
                    additionalRoleAssignmentsSubscriptionItem.detail = '(snippet)';
                    completionItems.push(additionalRoleAssignmentsSubscriptionItem);
                    
                    // ---- Resource Group Role Assignments ----
                    const additionalRoleAssignmentsResourceGroupItem = new vscode.CompletionItem(
                        'additionalRoleAssignments-ResourceGroup',
                        vscode.CompletionItemKind.Method
                    );
                    additionalRoleAssignmentsResourceGroupItem.insertText = new vscode.SnippetString(
                        '"additionalRoleAssignments": {\n' +
                        '  "${1:*}": [\n' +
                        '    {\n' +
                        '      "roleDefinitionId": "${2:/providers/microsoft.authorization/roleDefinitions/4d97b98b-1d4f-4787-a291-c67834d212e7}",\n' +
                        '      "scope": "/subscriptions/${3:subscription-id}/resourceGroups/${4:resource-group-name}"\n' +
                        '    }\n' +
                        '  ]\n' +
                        '}'
                    );
                    additionalRoleAssignmentsResourceGroupItem.documentation = new vscode.MarkdownString(
                        'Adds additionalRoleAssignments for Policy Assignment managed identity targeting a resource group'
                    );
                    additionalRoleAssignmentsResourceGroupItem.detail = '(snippet)';
                    completionItems.push(additionalRoleAssignmentsResourceGroupItem);
                    
                    // ---- Resource Selectors ----
                    const resourceSelectorsItem = new vscode.CompletionItem(
                        'resourceSelectors',
                        vscode.CompletionItemKind.Method
                    );
                    resourceSelectorsItem.insertText = new vscode.SnippetString(
                        '"resourceSelectors": [\n' +
                        '  {\n' +
                        '    "name": "${1:Selector1}",\n' +
                        '    "selectors": [\n' +
                        '      {\n' +
                        '        "kind": "${2|resourceLocation,resourceType,resourceWithoutLocation|}",\n' +
                        '        "${3|in,notIn|}": [\n' +
                        '          "${4:value1}",\n' +
                        '          "${5:value2}"\n' +
                        '        ]\n' +
                        '      }\n' +
                        '    ]\n' +
                        '  }\n' +
                        ']'
                    );
                    resourceSelectorsItem.documentation = new vscode.MarkdownString(
                        'Adds resourceSelectors to filter which resources the policy applies to'
                    );
                    resourceSelectorsItem.detail = '(snippet)';
                    completionItems.push(resourceSelectorsItem);
                    
                    // ---- User Assigned Identity ----
                    const userAssignedIdentityItem = new vscode.CompletionItem(
                        'userAssignedIdentity',
                        vscode.CompletionItemKind.Method
                    );
                    userAssignedIdentityItem.insertText = new vscode.SnippetString(
                        '"userAssignedIdentity": {\n' +
                        '  "${1:pacSelector or *}": [\n' +
                        '    {\n' +
                        '      "policyName": "${2:policyName}",\n' +
                        '      "identity": "${3:/subscriptions/{subscription-id}/resourceGroups/{resourceGroupName}/providers/Microsoft.ManagedIdentity/userAssignedIdentities/{identityName}}"\n' +
                        '    },\n' +
                        '    {\n' +
                        '      "policySetName": "${4:policySetName}",\n' +
                        '      "identity": "${5:/subscriptions/{subscription-id}/resourceGroups/{resourceGroupName}/providers/Microsoft.ManagedIdentity/userAssignedIdentities/{identityName}}"\n' +
                        '    }\n' +
                        '  ]\n' +
                        '}'
                    );
                    userAssignedIdentityItem.documentation = new vscode.MarkdownString(
                        'Adds userAssignedIdentity configuration for Policy Assignment indicating which managed identity to use for remediation tasks.\n\n' +
                        'The first placeholder is for the pacSelector or "*" to indicate which environments this applies to.'
                    );
                    userAssignedIdentityItem.detail = '(snippet)';
                    completionItems.push(userAssignedIdentityItem);
                    
                    // Set sorting priorities to make snippets appear first
                    completionItems.forEach((item, index) => {
                        item.sortText = `0${index}`;
                    });
                    
                    return completionItems;
                }
            },
            // Trigger on Ctrl+Space and automatically on typing
            ' ', '.', '"'
        );
        
        context.subscriptions.push(completionProvider);
        logger.info("Snippet completion provider registered successfully");
    } catch (error: any) {
        logger.error("Failed to register snippet completion provider", error);
    }
}

// This method is called when your extension is activated
export async function activate(context: vscode.ExtensionContext) {
    const logger = Logger.getInstance();
    logger.info("Activating ePacMan extension");
    
    try {
        // Initialize validation engine
        logger.debug("Initializing validation engine");
        const validationEngine = new ValidationEngine(context);
        await validationEngine.initialize();
        
        // Register JSON schema provider for both JSON and JSONC files
        logger.debug("Registering JSON schema provider");
        registerJsonSchemaProvider(context);
        
        // Register snippet completion provider to enhance IntelliSense for snippets
        registerSnippetCompletionProvider(context);
        
        // Register commands
        logger.debug("Registering commands");
        registerCommands(context, validationEngine);
        
        // Initialize the custom policy context key
        await updateCustomPolicyContextKey(context);
        
        // Register document validation on open and save
        context.subscriptions.push(
            vscode.workspace.onDidOpenTextDocument(async document => {
                if (await isPolicyDocument(document)) {
                    validationEngine.validateDocument(document);
                }
                // Update context key if the opened document is the active one
                if (vscode.window.activeTextEditor?.document === document) {
                    updateCustomPolicyContextKey(context);
                }
            }),
            vscode.workspace.onDidSaveTextDocument(async document => {
                if (await isPolicyDocument(document)) {
                    validationEngine.validateDocument(document);
                }
                // Update context key if the saved document is the active one
                if (vscode.window.activeTextEditor?.document === document) {
                    updateCustomPolicyContextKey(context);
                }
            }),
            // Update context key when the active editor changes
            vscode.window.onDidChangeActiveTextEditor(() => {
                updateCustomPolicyContextKey(context);
            })
        );
        
        // Validate all open policy documents
        for (const document of vscode.workspace.textDocuments) {
            if (await isPolicyDocument(document)) {
                validationEngine.validateDocument(document);
            }
        }
        
        // Add validation engine to extension context for other components to use
        context.subscriptions.push({
            dispose: () => {
                validationEngine.dispose();
            }
        });
        
        logger.info("ePacMan extension activated successfully");
    } catch (error: any) {
        logger.error("Failed to activate ePacMan extension", error);
        vscode.window.showErrorMessage(`Failed to activate ePacMan extension: ${error.message}`);
    }
}

// This method is called when your extension is deactivated
export function deactivate() {
    const logger = Logger.getInstance();
    logger.info("Deactivating ePacMan extension");
    
    try {
        // Clean up the GitHub comparison service to dispose of any lingering commands
        logger.info("Disposing GitHub comparison service resources");
        const githubComparisonService = GitHubComparisonService.getInstance();
        githubComparisonService.dispose();
        
        // Ensure any registered commands are properly removed
        try {
            vscode.commands.executeCommand('setContext', 'epacman.isCustomPolicy', false);
        } catch (error) {
            // Ignore errors during cleanup
        }
        
        logger.info("ePacMan extension deactivated successfully");
    } catch (error) {
        logger.error("Error during ePacMan extension deactivation", error);
    }
}
