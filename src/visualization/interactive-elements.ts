import * as vscode from 'vscode';
import { Logger } from '../logging';
import { ErrorHandler } from '../error';
import { PolicyAssignmentParser } from './policy-assignment-parser';

/**
 * Interface for message from WebView to extension
 */
export interface WebViewMessage {
    command: string;
    data?: any;
}

/**
 * Class for handling interactive elements in the visualization
 */
export class InteractiveElements {
    private logger = Logger.getInstance();
    private webviewPanel: vscode.WebviewPanel | undefined;
    private assignmentParser: PolicyAssignmentParser;
    private assignmentCache: Map<string, any> = new Map();
    
    constructor() {
        this.assignmentParser = new PolicyAssignmentParser();
    }
    
    /**
     * Set the WebView panel
     * @param panel The WebView panel
     */
    setWebViewPanel(panel: vscode.WebviewPanel): void {
        this.webviewPanel = panel;
    }
    
    /**
     * Set assignment data for quick access
     * @param assignments The policy assignments
     */
    setAssignmentData(assignments: any[]): void {
        this.assignmentCache.clear();
        for (const assignment of assignments) {
            this.assignmentCache.set(assignment.id, assignment);
        }
        this.logger.info(`Cached ${this.assignmentCache.size} assignments for quick access`);
    }
    
    /**
     * Handle messages from the WebView
     * @param message The message from the WebView
     */
    async handleMessage(message: WebViewMessage): Promise<void> {
        try {
            this.logger.info(`Received message from WebView: ${message.command}`);
            
            switch (message.command) {
                case 'openFile':
                    await this.openFile(message.data.path);
                    break;
                    
                case 'validateAssignment':
                    await this.validateAssignment(message.data.id, message.data.path);
                    break;
                    
                case 'expandDetails':
                    await this.sendAssignmentParameters(message.data.id);
                    break;
                    
                default:
                    this.logger.warn(`Unknown command from WebView: ${message.command}`);
            }
        } catch (error: any) {
            this.logger.error(`Error handling WebView message: ${message.command}`, error);
            ErrorHandler.handleError(error, `Failed to handle WebView message: ${message.command}`);
        }
    }
    
    /**
     * Open a file in the editor
     * @param filePath The file path to open
     */
    private async openFile(filePath: string): Promise<void> {
        try {
            const document = await vscode.workspace.openTextDocument(filePath);
            await vscode.window.showTextDocument(document);
            this.logger.info(`Opened file: ${filePath}`);
        } catch (error: any) {
            this.logger.error(`Error opening file: ${filePath}`, error);
            vscode.window.showErrorMessage(`Failed to open file: ${error.message}`);
        }
    }
    
    /**
     * Send parameters for an assignment to the webview
     * @param id The assignment ID
     */
    private async sendAssignmentParameters(id: string): Promise<void> {
        try {
            // Get the assignment from the cache
            const assignment = this.assignmentCache.get(id);
            
            if (!assignment) {
                this.logger.warn(`Assignment not found in cache: ${id}`);
                return;
            }
            
            // Format parameters for display
            let parameters = assignment.parameters;
            
            // Debug the incoming parameters
            this.logger.info(`Raw parameters for assignment ${id}: found ${parameters ? Object.keys(parameters).length : 0} parameters`);
            this.logger.debug(`Parameters object: ${JSON.stringify(parameters, null, 2)}`);
            
            // If parameters is an object with nested value properties, extract the values for display
            if (parameters) {
                const formattedParams: Record<string, any> = {};
                
                for (const [key, param] of Object.entries(parameters)) {
                    this.logger.debug(`Processing parameter: ${key}, type: ${typeof param}`);
                    
                    if (param && typeof param === 'object' && 'value' in param) {
                        // Standard Azure format with value property
                        formattedParams[key] = param.value;
                        this.logger.debug(`Parameter ${key} has value property: ${JSON.stringify(param.value)}`);
                    } else if (Array.isArray(param)) {
                        // Array values (common in EPAC)
                        formattedParams[key] = param;
                        this.logger.debug(`Parameter ${key} is array with ${param.length} items`);
                    } else if (param && typeof param === 'object') {
                        // If it's a complex object without a value property, use as is
                        formattedParams[key] = param;
                        this.logger.debug(`Parameter ${key} is complex object without value property`);
                    } else {
                        // Simple value
                        formattedParams[key] = param;
                        this.logger.debug(`Parameter ${key} is simple value: ${param}`);
                    }
                }
                
                // Log detailed parameter information
                this.logger.info(`Formatted ${Object.keys(formattedParams).length} parameters for assignment: ${id}`);
                this.logger.debug(`Formatted parameters: ${JSON.stringify(formattedParams, null, 2)}`);
                
                // Send the parameters to the webview
                this.sendMessageToWebView('updateParameters', {
                    id,
                    parameters: formattedParams
                });
                
                this.logger.info(`Sent parameters for assignment: ${id}`);
            } else {
                this.logger.warn(`No parameters found for assignment: ${id}`);
                this.sendMessageToWebView('updateParameters', {
                    id,
                    parameters: {}
                });
            }
        } catch (error: any) {
            this.logger.error(`Error sending assignment parameters: ${id}`, error);
            this.sendMessageToWebView('showError', {
                message: `Failed to load parameters: ${error.message}`
            });
        }
    }
    
    /**
     * Validate a policy assignment
     * @param id The assignment ID
     * @param filePath The file path of the assignment
     */
    private async validateAssignment(id: string, filePath: string): Promise<void> {
        try {
            // Open the file
            const document = await vscode.workspace.openTextDocument(filePath);
            
            // Execute the validate command
            await vscode.commands.executeCommand('epacman.validateCurrentFile');
            
            this.logger.info(`Validated assignment: ${id}`);
        } catch (error: any) {
            this.logger.error(`Error validating assignment: ${id}`, error);
            vscode.window.showErrorMessage(`Failed to validate assignment: ${error.message}`);
        }
    }
    
    /**
     * Update the WebView panel
     * @param message The command to send
     * @param data The data to send
     */
    sendMessageToWebView(command: string, data?: any): void {
        if (!this.webviewPanel) {
            this.logger.warn("Cannot send message to WebView: panel not set");
            return;
        }
        
        // Add detailed logging for parameter updates
        if (command === 'updateParameters') {
            this.logger.info(`Sending parameters to WebView for ID: ${data.id}`);
            this.logger.info(`Parameter count: ${Object.keys(data.parameters).length}`);
            this.logger.info(`Parameters: ${JSON.stringify(data.parameters, null, 2)}`);
        }
        
        this.webviewPanel.webview.postMessage({
            command,
            data
        });
        
        this.logger.info(`Sent message to WebView: ${command}`);
    }
}