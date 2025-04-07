import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs-extra';
import { Logger } from '../logging';
import { PolicyAssignmentTemplate } from './template-generator';

/**
 * File Creator class
 * Responsible for creating new files with the generated templates
 */
export class FileCreator {
    private logger = Logger.getInstance();
    
    /**
     * Create a policy assignment file from a template
     * @param sourceUri The URI of the source policy definition file
     * @param template The policy assignment template
     * @returns The URI of the created file
     */
    async createAssignmentFile(sourceUri: vscode.Uri, template: PolicyAssignmentTemplate): Promise<vscode.Uri> {
        try {
            this.logger.info(`Creating assignment file for template: ${template.assignment.name}`);
            
            // Generate the target file path
            const targetPath = this.generateTargetPathFromSource(sourceUri.fsPath);
            
            // Format the template as JSON
            const content = JSON.stringify(template, null, 2);
            
            // Create the file
            const targetUri = vscode.Uri.file(targetPath);
            await vscode.workspace.fs.writeFile(targetUri, Buffer.from(content, 'utf8'));
            
            // Show a success message
            vscode.window.showInformationMessage(`Policy assignment template created: ${path.basename(targetPath)}`);
            
            // Open the file in the editor
            await this.openInEditor(targetUri);
            
            this.logger.info(`Assignment file created successfully: ${targetPath}`);
            return targetUri;
        } catch (error: any) {
            this.logger.error(`Error creating assignment file: ${error.message}`, error);
            throw new Error(`Failed to create assignment file: ${error.message}`);
        }
    }
    
    /**
     * Create a policy assignment file from an Azure policy
     * @param policyName The name of the Azure policy
     * @param template The policy assignment template
     * @returns The URI of the created file
     */
    async createAssignmentFileFromAzure(policyName: string, template: PolicyAssignmentTemplate): Promise<vscode.Uri> {
        try {
            this.logger.info(`Creating assignment file for Azure policy: ${policyName}`);
            
            // Generate the target file path
            const targetPath = this.generateTargetPathFromWorkspace(template);
            
            // Format the template as JSON
            const content = JSON.stringify(template, null, 2);
            
            // Create the file
            const targetUri = vscode.Uri.file(targetPath);
            await vscode.workspace.fs.writeFile(targetUri, Buffer.from(content, 'utf8'));
            
            // Show a success message
            vscode.window.showInformationMessage(`Policy assignment template created: ${path.basename(targetPath)}`);
            
            // Open the file in the editor
            await this.openInEditor(targetUri);
            
            this.logger.info(`Assignment file created successfully: ${targetPath}`);
            return targetUri;
        } catch (error: any) {
            this.logger.error(`Error creating assignment file: ${error.message}`, error);
            throw new Error(`Failed to create assignment file: ${error.message}`);
        }
    }
    
    /**
     * Generate a target path for the policy assignment file based on source file
     * @param sourcePath The path of the source policy definition file
     * @returns The target path
     */
    private generateTargetPathFromSource(sourcePath: string): string {
        // Generate a target path by appending "-assignment" to the filename
        const parsedPath = path.parse(sourcePath);
        const targetDir = parsedPath.dir; // Use the same directory as the source file
        const targetName = `${parsedPath.name}-assignment${parsedPath.ext}`;
        const targetPath = path.join(targetDir, targetName);
        
        return targetPath;
    }

    /**
     * Generate a target path for the policy assignment file based on workspace
     * @param template The policy assignment template
     * @returns The target path
     */
    private generateTargetPathFromWorkspace(template: PolicyAssignmentTemplate): string {
        // Find the workspace folder
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            throw new Error('No workspace folder found');
        }
        
        const workspaceRoot = path.normalize(workspaceFolders[0].uri.fsPath);
        
        // Ask the user where to save the file
        // For now, we'll use the workspace root
        const targetDir = workspaceRoot;
        
        // Use displayName if available, otherwise fallback to name
        const nameToUse = template.assignment.displayName || template.assignment.name;
        
        // Create a safe filename from the template name
        const safeName = nameToUse
            .replace(/[^a-zA-Z0-9-_]/g, '-') // Replace special chars with hyphens
            .replace(/-+/g, '-')             // Replace multiple consecutive hyphens with a single one
            .toLowerCase();
        
        // Add the appropriate suffix based on whether it's a policy set
        const isPolicySet = template.definitionEntry.policySetId !== undefined ||
                          template.definitionEntry.policySetName !== undefined;
        const suffix = isPolicySet ? '-policySet' : '-policy';
        const targetName = `${safeName}${suffix}.json`;
        
        // Generate the target path and normalize it
        const targetPath = path.normalize(path.join(targetDir, targetName));
        
        // Validate that the target path is within the workspace root
        if (!targetPath.startsWith(workspaceRoot)) {
            this.logger.error(`Security violation: Generated path is outside workspace: ${targetPath}`);
            throw new Error('Security violation: Generated path is outside workspace');
        }
        
        return targetPath;
    }
    
    /**
     * Open a file in the editor
     * @param fileUri The URI of the file to open
     */
    async openInEditor(fileUri: vscode.Uri): Promise<void> {
        try {
            // Open the file in the editor
            await vscode.window.showTextDocument(fileUri);
            this.logger.info(`File opened in editor: ${fileUri.fsPath}`);
        } catch (error: any) {
            this.logger.error(`Error opening file in editor: ${error.message}`, error);
            throw new Error(`Failed to open file in editor: ${error.message}`);
        }
    }
}