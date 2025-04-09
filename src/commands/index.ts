import * as vscode from 'vscode';
import { Logger } from '../logging';
import { ErrorHandler } from '../error';
import { ValidationEngine } from '../validation';
import { PolicyAssignmentGenerator } from '../generator';
import { GitHubComparisonService } from '../github';
import { isPolicyDocument } from '../utils';

/**
 * Register all commands for the extension
 * @param context The extension context
 * @param validationEngine The validation engine
 */
export function registerCommands(context: vscode.ExtensionContext, validationEngine: ValidationEngine): void {
    const logger = Logger.getInstance();
    logger.info("Registering commands");
    
    // Register command to validate current file
    context.subscriptions.push(
        vscode.commands.registerCommand('epacman.validateCurrentFile', async () => {
            try {
                const editor = vscode.window.activeTextEditor;
                if (!editor) {
                    vscode.window.showWarningMessage("No file is currently open");
                    return;
                }
                
                logger.info(`Validating file: ${editor.document.uri.fsPath}`);
                
                // First check the content for EPAC schema, regardless of file path
                const content = editor.document.getText();
                if (content.includes('"$schema": "https://raw.githubusercontent.com/Azure/enterprise-azure-policy-as-code/main/Schemas/policy-assignment-schema.json"') ||
                    content.includes('"$schema":"https://raw.githubusercontent.com/Azure/enterprise-azure-policy-as-code/main/Schemas/policy-assignment-schema.json"')) {
                    // Found EPAC policy assignment schema
                    const result = await validationEngine.validateDocument(editor.document);
                    if (result?.valid) {
                        vscode.window.showInformationMessage("Policy assignment document is valid");
                    } else {
                        vscode.window.showWarningMessage(`Policy assignment has ${result?.issues.length || 0} validation issues`);
                    }
                    return;
                }
                
                // Fall back to checking if it's a policy document
                if (await isPolicyDocument(editor.document)) {
                    const result = await validationEngine.validateDocument(editor.document);
                    if (result?.valid) {
                        vscode.window.showInformationMessage("Document is valid");
                    } else {
                        vscode.window.showWarningMessage(`Document has ${result?.issues.length || 0} validation issues`);
                    }
                } else {
                    vscode.window.showWarningMessage("Current file is not a policy document");
                }
            } catch (error: any) {
                ErrorHandler.handleError(error, "Failed to validate current file");
            }
        })
    );
    
    // Command for viewing policy assignments has been removed
    
    // Register command to generate policy assignment
    context.subscriptions.push(
        vscode.commands.registerCommand('epacman.generatePolicyAssignment', async (fileUri: vscode.Uri) => {
            try {
                logger.info("Executing command: epacman.generatePolicyAssignment");
                
                // If no file URI is provided, use the active editor
                if (!fileUri) {
                    const editor = vscode.window.activeTextEditor;
                    if (editor) {
                        fileUri = editor.document.uri;
                    } else {
                        vscode.window.showWarningMessage("No file selected. Please open a policy definition file.");
                        return;
                    }
                }
                
                // Create the policy assignment generator
                const policyAssignmentGenerator = new PolicyAssignmentGenerator();
                
                // Generate the assignment
                await policyAssignmentGenerator.generateAssignment(fileUri);
                
                logger.info("Policy assignment generated successfully");
            } catch (error: any) {
                logger.error("Failed to generate policy assignment", error);
                ErrorHandler.handleError(error, "Failed to generate policy assignment");
            }
        })
    );
    
    // Register command to generate policy assignment from Azure policy
    context.subscriptions.push(
        vscode.commands.registerCommand('epacman.generatePolicyAssignmentFromAzure', async () => {
            try {
                logger.info("Executing command: epacman.generatePolicyAssignmentFromAzure");
                
                // Prompt the user for the policy ID
                const policyId = await vscode.window.showInputBox({
                    prompt: "Enter Azure Policy ID",
                    placeHolder: "/providers/Microsoft.Authorization/policyDefinitions/cccc23c7-8427-4f53-ad12-b6a63eb452b3",
                    validateInput: (input) => {
                        if (!input) {
                            return "Policy ID is required";
                        }
                        
                        // Basic validation for policy ID format
                        if (!input.includes('/providers/Microsoft.Authorization/policyDefinitions/') && 
                            !input.includes('/providers/Microsoft.Authorization/policySetDefinitions/')) {
                            return "Invalid policy ID format. Should contain '/providers/Microsoft.Authorization/policyDefinitions/' or '/providers/Microsoft.Authorization/policySetDefinitions/'";
                        }
                        
                        return null;
                    }
                });
                
                if (!policyId) {
                    // User cancelled the operation
                    logger.info("User cancelled policy ID input");
                    return;
                }
                
                // Create the policy assignment generator
                const policyAssignmentGenerator = new PolicyAssignmentGenerator();
                
                // Generate the assignment from Azure policy
                await policyAssignmentGenerator.generateAssignmentFromAzure(policyId);
                
                logger.info("Azure policy assignment generated successfully");
            } catch (error: any) {
                logger.error("Failed to generate Azure policy assignment", error);
                ErrorHandler.handleError(error, "Failed to generate Azure policy assignment");
            }
        })
    );
    
    // Register context menu command for generating policy assignments
    context.subscriptions.push(
        vscode.commands.registerCommand('epacman.generatePolicyAssignmentFromContext', async (fileUri: vscode.Uri) => {
            try {
                logger.info("Executing command: epacman.generatePolicyAssignmentFromContext");
                
                // Create the policy assignment generator
                const policyAssignmentGenerator = new PolicyAssignmentGenerator();
                
                // Generate the assignment
                await policyAssignmentGenerator.generateAssignment(fileUri);
                
                logger.info("Policy assignment generated successfully from context menu");
            } catch (error: any) {
                logger.error("Failed to generate policy assignment from context menu", error);
                ErrorHandler.handleError(error, "Failed to generate policy assignment from context menu");
            }
        })
    );
    
    // Register command to validate policy definition against Azure
    context.subscriptions.push(
        vscode.commands.registerCommand('epacman.validatePolicyDefinitionAgainstAzure', async () => {
            try {
                vscode.window.showInformationMessage("Azure validation not implemented yet");
                // TODO: Implement Azure validation in Phase 5
            } catch (error: any) {
                ErrorHandler.handleError(error, "Failed to validate against Azure");
            }
        })
    );
    
    // Register command to validate policy assignment against Azure
    context.subscriptions.push(
        vscode.commands.registerCommand('epacman.validatePolicyAssignmentAgainstAzure', async () => {
            try {
                vscode.window.showInformationMessage("Azure validation not implemented yet");
                // TODO: Implement Azure validation in Phase 5
            } catch (error: any) {
                ErrorHandler.handleError(error, "Failed to validate against Azure");
            }
        })
    );
    // Register command to view policy card
    context.subscriptions.push(
        vscode.commands.registerCommand('epacman.viewPolicyCard', async (fileUri?: vscode.Uri) => {
            try {
                logger.info("Executing command: epacman.viewPolicyCard");
                
                // If no file URI is provided, use the active editor
                if (!fileUri) {
                    const editor = vscode.window.activeTextEditor;
                    if (editor) {
                        fileUri = editor.document.uri;
                    } else {
                        vscode.window.showWarningMessage("No file selected. Please open a policy file.");
                        return;
                    }
                }
                
                // Read the file content
                const document = await vscode.workspace.openTextDocument(fileUri);
                const content = document.getText();
                
                // Parse JSON to check schema
                let json;
                try {
                    // First try standard JSON parsing
                    json = JSON.parse(content);
                } catch (e) {
                    // If standard JSON parsing fails, try parsing as JSONC
                    try {
                        const jsonc = require('jsonc-parser');
                        json = jsonc.parse(content);
                    } catch (e2) {
                        vscode.window.showErrorMessage('Failed to parse file as JSON or JSONC');
                        return;
                    }
                }
                
                // Check if it's a policy assignment by looking for the schema
                const schemaUrl = json.$schema;
                const isEpacPolicyAssignment = schemaUrl && 
                    schemaUrl === "https://raw.githubusercontent.com/Azure/enterprise-azure-policy-as-code/main/Schemas/policy-assignment-schema.json";
                
                if (!isEpacPolicyAssignment) {
                    vscode.window.showInformationMessage('The selected file is not an EPAC policy assignment.');
                    return;
                }
                
                // Import the PolicyCardViewProvider dynamically to avoid circular dependencies
                const { PolicyCardViewProvider } = await import('../visualization/policy-card-view-provider');
                
                // Create and show the policy card
                const provider = new PolicyCardViewProvider(context.extensionUri);
                await provider.showPolicyInCardView(fileUri);
                
                logger.info("Policy card view shown successfully");
            } catch (error: any) {
                logger.error("Failed to view policy card", error);
                ErrorHandler.handleError(error, "Failed to view policy card");
            }
        })
    );
    
    // Register command to compare with GitHub
    context.subscriptions.push(
        vscode.commands.registerCommand('epacman.compareWithGitHub', async (fileUri?: vscode.Uri) => {
            try {
                logger.info("Executing command: epacman.compareWithGitHub");
                
                // If no file URI is provided, use the active editor
                if (!fileUri) {
                    const editor = vscode.window.activeTextEditor;
                    if (editor) {
                        fileUri = editor.document.uri;
                    } else {
                        vscode.window.showWarningMessage("No file selected. Please open a policy file.");
                        return;
                    }
                }
                
                // Get the singleton instance of the GitHub comparison service
                const githubComparisonService = GitHubComparisonService.getInstance();
                
                // Compare the file with GitHub
                await githubComparisonService.compareWithGitHub(fileUri);
                
                logger.info("GitHub comparison completed successfully");
            } catch (error: any) {
                logger.error("Failed to compare with GitHub", error);
                ErrorHandler.handleError(error, "Failed to compare with GitHub");
            }
        })
    );
    
    logger.info("Commands registered successfully");
}