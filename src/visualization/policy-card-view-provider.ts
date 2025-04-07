import * as vscode from 'vscode';
import { parse } from 'jsonc-parser';
import { Logger } from '../logging';
import { ErrorHandler } from '../error';

/**
 * Provider for displaying policy cards in a webview
 */
export class PolicyCardViewProvider {
    public static readonly viewType = 'epacman.policyCardView';
    private _panels = new Map<string, vscode.WebviewPanel>();
    private _policyDefinitions = new Map<string, any>();
    private _policySetMap = new Map<string, string[]>();
    private logger = Logger.getInstance();
    private isLoadingDefinitions = false;
    private loadingPromise: Promise<void> | null = null;

    constructor(
        private readonly _extensionUri: vscode.Uri
    ) {
        this.logger.info("PolicyCardViewProvider initialized");
    }

    /**
     * Show a policy in card view
     * @param uri The URI of the policy file
     */
    public async showPolicyInCardView(uri: vscode.Uri): Promise<void> {
        try {
            this.logger.info(`Showing policy in card view: ${uri.fsPath}`);
            
            const document = await vscode.workspace.openTextDocument(uri);
            const content = document.getText();
            const fileName = document.fileName;
            
            // Parse the policy content
            this.logger.debug("Parsing policy content");
            let policy;
            try {
                policy = parse(content);
                this.logger.debug("Policy content parsed successfully");
            } catch (error) {
                this.logger.error("Failed to parse policy content", error);
                vscode.window.showErrorMessage(`Failed to parse policy content: ${error}`);
                return;
            }

            // Create and show panel immediately to improve perceived performance
            this.logger.debug("Creating webview panel");
            const panel = vscode.window.createWebviewPanel(
                PolicyCardViewProvider.viewType,
                `ePacMan: ${fileName}`,
                vscode.ViewColumn.Beside,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true,
                    localResourceRoots: [
                        vscode.Uri.joinPath(this._extensionUri, 'media'),
                    ]
                }
            );
            
            // Store the panel reference
            const key = uri.toString();
            this._panels.set(key, panel);
            
            // Clean up when the panel is closed
            panel.onDidDispose(() => {
                this.logger.debug(`Panel disposed: ${key}`);
                this._panels.delete(key);
            });
            
            // Set the webview's HTML content immediately with loading state
            this.logger.debug("Setting initial webview HTML content");
            panel.webview.html = this._getWebViewContent(panel.webview, policy, true);

            // Extract policy set name if available for targeted loading
            let policySetName: string | undefined;
            if (policy.definitionEntry && policy.definitionEntry.policySetName) {
                policySetName = policy.definitionEntry.policySetName;
                this.logger.debug(`Found policySetName: ${policySetName} - will prioritize loading`);
                
                // Load just this policy definition first if not already loaded
                if (policySetName && !this._policyDefinitions.has(policySetName)) {
                    await this.loadSpecificPolicyDefinition(policySetName);
                }
            }
            
            // Start loading all policy definitions in the background
            this.startBackgroundPolicyLoad();
            
            // Handle messages from the webview
            panel.webview.onDidReceiveMessage(message => {
                this.logger.debug(`Received message from webview: ${message.command}`);
                switch (message.command) {
                    case 'log':
                        this.logger.info(`[Policy Card View]: ${message.text}`);
                        break;
                    case 'error':
                        this.logger.error(`[Policy Card View error]: ${message.text}`);
                        vscode.window.showErrorMessage(`Error in policy card view: ${message.text}`);
                        break;
                    case 'lookupPolicyDefinition':
                        this.handlePolicyDefinitionLookup(panel.webview, message.policyName);
                        break;
                    case 'refreshContent':
                        // Update the webview content without loading state
                        panel.webview.html = this._getWebViewContent(panel.webview, policy, false);
                        break;
                }
            });
            
            // Update the panel with non-loading state once initial processing is done
            panel.webview.html = this._getWebViewContent(panel.webview, policy, false);
            
            this.logger.info(`Policy card view shown successfully: ${uri.fsPath}`);
        } catch (error) {
            this.logger.error('Error showing policy in card view:', error);
            ErrorHandler.handleError(error, `Error showing policy: ${error}`);
        }
    }

    /**
     * Start loading policy definitions in the background
     */
    private async startBackgroundPolicyLoad(): Promise<void> {
        if (!this.isLoadingDefinitions && !this.loadingPromise) {
            this.loadingPromise = this.loadPolicyDefinitions();
            try {
                await this.loadingPromise;
            } finally {
                this.loadingPromise = null;
            }
        }
    }

    /**
     * Load a specific policy definition by name
     * @param policyName The name of the policy to load
     */
    private async loadSpecificPolicyDefinition(policyName: string): Promise<void> {
        try {
            this.logger.debug(`Loading specific policy definition: ${policyName}`);
            
            // Find policy definition files that might contain this policy
            const definitionFiles = await vscode.workspace.findFiles(
                `**/policyDefinitions/**/*${policyName}*.json`, 
                '**/node_modules/**'
            );
            
            for (const fileUri of definitionFiles) {
                try {
                    const document = await vscode.workspace.openTextDocument(fileUri);
                    const content = document.getText();
                    const definition = parse(content);
                    
                    if (definition && definition.name === policyName) {
                        this._policyDefinitions.set(policyName, definition);
                        this.logger.debug(`Loaded specific policy definition: ${policyName}`);
                        return;
                    }
                } catch (err) {
                    this.logger.warn(`Error parsing policy definition file ${fileUri.fsPath}:`, err);
                }
            }
            
            this.logger.debug(`Specific policy definition not found: ${policyName}`);
        } catch (error) {
            this.logger.error(`Error loading specific policy definition ${policyName}:`, error);
        }
    }

    /**
     * Load policy definitions from the workspace
     */
    private async loadPolicyDefinitions(): Promise<void> {
        if (this.isLoadingDefinitions) {
            return;
        }
        
        try {
            this.isLoadingDefinitions = true;
            this.logger.debug("Loading policy definitions");
            
            // Find all policy definition files in the workspace
            const definitionFiles = await vscode.workspace.findFiles(
                '**/policyDefinitions/**/*.json', 
                '**/node_modules/**'
            );
            
            this.logger.debug(`Found ${definitionFiles.length} policy definition files`);
            
            for (const fileUri of definitionFiles) {
                try {
                    const document = await vscode.workspace.openTextDocument(fileUri);
                    const content = document.getText();
                    const definition = parse(content);
                    
                    if (definition && definition.name) {
                        this._policyDefinitions.set(definition.name, definition);
                        this.logger.debug(`Loaded policy definition: ${definition.name}`);
                        
                        // If this is a policy set definition, store the mapping of included policies
                        if (definition.properties?.policyDefinitions && Array.isArray(definition.properties.policyDefinitions)) {
                            const includedPolicies: string[] = [];
                            
                            for (const policyRef of definition.properties.policyDefinitions) {
                                if (policyRef.policyDefinitionName) {
                                    includedPolicies.push(policyRef.policyDefinitionName);
                                } else if (policyRef.policyDefinitionId) {
                                    // Extract name from ID if present
                                    const idParts = policyRef.policyDefinitionId.split('/');
                                    const nameFromId = idParts[idParts.length - 1];
                                    if (nameFromId) {
                                        includedPolicies.push(nameFromId);
                                    }
                                }
                            }
                            
                            if (includedPolicies.length > 0) {
                                this._policySetMap.set(definition.name, includedPolicies);
                                this.logger.debug(`Policy set ${definition.name} includes ${includedPolicies.length} policies`);
                            }
                        }
                    }
                } catch (err) {
                    this.logger.warn(`Error parsing policy definition file ${fileUri.fsPath}:`, err);
                }
            }
            
            this.logger.debug(`Loaded ${this._policyDefinitions.size} policy definitions`);
            
            // Notify all open panels that policy definitions are loaded
            for (const panel of this._panels.values()) {
                panel.webview.postMessage({ command: 'policyDefinitionsLoaded' });
            }
        } catch (error) {
            this.logger.error('Error loading policy definitions:', error);
        } finally {
            this.isLoadingDefinitions = false;
        }
    }

    /**
     * Handle policy definition lookup from the webview
     * @param webview The webview
     * @param policyName The policy name to look up
     */
    private handlePolicyDefinitionLookup(webview: vscode.Webview, policyName: string): void {
        try {
            this.logger.debug(`Looking up policy definition: ${policyName}`);
            const definition = this._policyDefinitions.get(policyName);
            
            if (definition) {
                this.logger.debug(`Found policy definition: ${policyName}`);
                webview.postMessage({
                    command: 'policyDefinitionData',
                    policyName: policyName,
                    definition: definition
                });
            } else {
                this.logger.debug(`Policy definition not found: ${policyName}`);
                webview.postMessage({
                    command: 'policyDefinitionNotFound',
                    policyName: policyName
                });
            }
        } catch (error) {
            this.logger.error(`Error handling policy definition lookup for ${policyName}:`, error);
        }
    }

    /**
     * Get the webview content
     * @param webview The webview
     * @param policy The policy data
     * @param isLoading Whether the policy definitions are still loading
     * @returns The HTML content
     */
    private _getWebViewContent(webview: vscode.Webview, policy: any, isLoading: boolean = false): string {
        const stylePath = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'style.css')
        );

        // Add loading overlay HTML if in loading state
        const loadingOverlay = isLoading ? `
            <div class="loading-overlay" id="loading-overlay">
                <div class="loading-spinner"></div>
                <div class="loading-text">Loading policy definitions...</div>
            </div>
        ` : '';

        // Add additional CSS for loading overlay
        const loadingStyles = `
            .loading-overlay {
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background-color: rgba(0, 0, 0, 0.7);
                display: flex;
                flex-direction: column;
                justify-content: center;
                align-items: center;
                z-index: 1000;
            }

            .loading-spinner {
                width: 40px;
                height: 40px;
                border: 4px solid rgba(255, 255, 255, 0.3);
                border-radius: 50%;
                border-top: 4px solid var(--vscode-button-background);
                animation: spin 1s linear infinite;
                margin-bottom: 12px;
            }

            .loading-text {
                color: white;
                font-size: 14px;
            }

            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
        `;

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <link rel="stylesheet" href="${stylePath}">
            <title>EPAC Policy Card View</title>
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    color: var(--vscode-foreground);
                    background-color: var(--vscode-editor-background);
                    padding: 20px;
                    margin: 0;
                    position: relative;
                }

                .card-container {
                    display: flex;
                    flex-direction: column;
                    align-items: flex-start;
                    padding: 20px;
                    width: 100%;
                    box-sizing: border-box;
                }

                .error-message {
                    color: var(--vscode-errorForeground);
                    background-color: var(--vscode-inputValidation-errorBackground);
                    padding: 10px;
                    border-radius: 4px;
                    margin-top: 10px;
                    border: 1px solid var(--vscode-inputValidation-errorBorder);
                }

                /* Scope section styling */
                .scope-container {
                    margin-bottom: 30px;
                    width: 100%;
                }

                .scope-header {
                    font-weight: bold;
                    font-size: 1.2em;
                    margin-bottom: 15px;
                    padding-bottom: 8px;
                    border-bottom: 1px solid var(--vscode-editorGroup-border);
                }

                .scope-assignments {
                    display: flex;
                    flex-direction: column;
                    gap: 15px;
                    margin-left: 20px;
                    position: relative;
                }

                .scope-assignments::before {
                    content: "";
                    position: absolute;
                    top: 0;
                    bottom: 0;
                    left: -10px;
                    width: 2px;
                    background-color: var(--vscode-charts-blue);
                }

                .scope-assignment {
                    background-color: var(--vscode-editorGroup-dropBackground, rgba(38, 50, 78, 0.1));
                    border-radius: 6px;
                    padding: 15px;
                    position: relative;
                }

                .scope-assignment::before {
                    content: "";
                    position: absolute;
                    top: 50%;
                    left: -10px;
                    width: 10px;
                    height: 2px;
                    background-color: var(--vscode-charts-blue);
                }

                .assignment-name {
                    font-weight: bold;
                    margin-bottom: 5px;
                    display: flex;
                    align-items: center;
                }

                .assignment-name-text {
                    display: inline-block;
                }

                .assignment-displayname {
                    margin-bottom: 8px;
                    font-style: italic;
                }

                .assignment-parameters {
                    margin-top: 8px;
                    font-size: 0.9em;
                    color: var(--vscode-descriptionForeground);
                    background-color: rgba(0, 0, 0, 0.1);
                    border-radius: 4px;
                    padding: 8px;
                }

                .param-name {
                    color: var(--vscode-charts-orange);
                }

                .param-value {
                    color: var(--vscode-charts-blue);
                }
                
                .scope-description {
                    font-size: 0.9em;
                    color: var(--vscode-descriptionForeground);
                    margin-top: -10px;
                    margin-bottom: 15px;
                }

                /* Effect bubble styling */
                .effect-bubble {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    border-radius: 12px;
                    font-size: 0.75em;
                    color: white;
                    padding: 3px 8px;
                    margin-left: 8px;
                    font-weight: normal;
                }

                .effect-deny {
                    background-color: rgba(231, 76, 60, 0.85);
                }

                .effect-audit {
                    background-color: rgba(46, 204, 113, 0.85);
                }

                .effect-auditifnotexists {
                    background-color: rgba(46, 204, 113, 0.85);
                }

                .effect-deployifnotexists {
                    background-color: rgba(243, 156, 18, 0.85);
                }

                .effect-modify {
                    background-color: rgba(52, 152, 219, 0.85);
                }

                .effect-disabled {
                    background-color: rgba(149, 165, 166, 0.85);
                }

                .effect-default {
                    background-color: rgba(155, 89, 182, 0.85);
                }

                .expanded-details {
                    margin-top: 12px;
                    padding: 12px;
                    background-color: var(--vscode-editor-background);
                    border-top: 1px solid var(--border-color);
                }

                .expanded-details h3 {
                    margin-top: 0;
                    margin-bottom: 8px;
                    font-size: 14px;
                }

                .parameter-list {
                    font-family: monospace;
                    font-size: 12px;
                }

                .parameter-item {
                    margin-bottom: 8px;
                    padding-bottom: 4px;
                    border-bottom: 1px dotted var(--border-color);
                }

                ${loadingStyles}
            </style>
        </head>
        <body>
            ${loadingOverlay}
            <div class="card-container" id="card-container">
                <div class="loading">Processing policy data...</div>
            </div>

            <script>
                (function() {
                    const vscode = acquireVsCodeApi();
                    const container = document.getElementById('card-container');
                    
                    // Handle messages from the extension
                    window.addEventListener('message', event => {
                        const message = event.data;
                        if (message.command === 'policyDefinitionsLoaded') {
                            // When definitions are loaded, request a refresh if needed
                            const loadingOverlay = document.getElementById('loading-overlay');
                            if (loadingOverlay) {
                                loadingOverlay.remove();
                                vscode.postMessage({ command: 'refreshContent' });
                            }
                        } else if (message.command === 'policyDefinitionData') {
                            // Handle policy definition data if needed
                        }
                    });
                    
                    // Log a message to both console and VS Code
                    function debug(message) {
                        console.log(message);
                        vscode.postMessage({ command: 'log', text: message });
                    }

                    // Report an error to both console and UI
                    function reportError(message, error) {
                        const errorText = error ? \`\${message}: \${error.message}\` : message;
                        console.error(errorText);
                        vscode.postMessage({ command: 'error', text: errorText });
                        
                        const errorDiv = document.createElement('div');
                        errorDiv.className = 'error-message';
                        errorDiv.textContent = errorText;
                        container.innerHTML = '';
                        container.appendChild(errorDiv);
                    }

                    // Extract management group name from a path
                    function extractMgNameFromPath(path) {
                        if (!path) return null;
                        const mgNameMatch = path.match(/managementGroups\\/([^\\/]+)(?:\\/|$)/);
                        return mgNameMatch && mgNameMatch[1] ? mgNameMatch[1] : null;
                    }

                    // Get the effect class for an effect value
                    function getEffectClass(effect) {
                        if (!effect) return 'effect-default';
                        
                        const effectLower = effect.toLowerCase();
                        if (effectLower.includes('deny')) return 'effect-deny';
                        if (effectLower.includes('auditifnotexists')) return 'effect-auditifnotexists';
                        if (effectLower.includes('audit')) return 'effect-audit';
                        if (effectLower.includes('deployifnotexists')) return 'effect-deployifnotexists';
                        if (effectLower.includes('modify')) return 'effect-modify';
                        if (effectLower.includes('disabled')) return 'effect-disabled';
                        
                        return 'effect-default';
                    }

                    // Get the effect from parameters or definitionEntry
                    function getEffect(assignment, node) {
                        // First check if effect is in parameters
                        if (assignment.parameters && assignment.parameters.effect) {
                            return assignment.parameters.effect;
                        }
                        
                        // Then check if node has parameters with effect
                        if (node && node.parameters && node.parameters.effect) {
                            return node.parameters.effect;
                        }
                        
                        // Default effect if not found
                        return 'Default';
                    }

                    // Format parameter value for display
                    function formatParamValue(value) {
                        if (Array.isArray(value)) {
                            if (value.length <= 3) {
                                return JSON.stringify(value);
                            } else {
                                return \`[\${value.slice(0, 2).join(', ')}, ... (\${value.length} items)]\`;
                            }
                        } else if (typeof value === 'object' && value !== null) {
                            return JSON.stringify(value, null, 2)
                                .replace(/\\n/g, '<br>')
                                .replace(/\\s{2}/g, '&nbsp;&nbsp;');
                        } else {
                            return String(value);
                        }
                    }

                    // Initialize with the policy data
                    try {
                        const policy = ${JSON.stringify(policy)};
                        debug("Starting to render policy data");

                        // Main rendering function
                        function renderPolicyView(policy) {
                            try {
                                container.innerHTML = '';
                                
                                // Collect all assignments with their scopes
                                const scopedAssignments = {};
                                
                                // First try to get root level scope
                                const rootScope = policy.scope || {};
                                
                                // Helper function to collect assignments recursively
                                function collectAssignments(node, parentScope = null) {
                                    if (!node) return;
                                    
                                    // Use node-specific scope or parent scope
                                    const nodeScope = node.scope || parentScope;
                                    
                                    // If this node has an assignment
                                    if (node.assignment) {
                                        // Process each scope in the node scope
                                        if (nodeScope) {
                                            let foundScope = false;
                                            
                                            for (const [envName, mgPaths] of Object.entries(nodeScope)) {
                                                if (Array.isArray(mgPaths) && mgPaths.length > 0) {
                                                    for (const mgPath of mgPaths) {
                                                        const mgName = extractMgNameFromPath(mgPath);
                                                        if (mgName) {
                                                            if (!scopedAssignments[mgName]) {
                                                                scopedAssignments[mgName] = {
                                                                    assignments: [],
                                                                    fullPath: mgPath
                                                                };
                                                            }
                                                            // Store the node along with the assignment for parameter access
                                                            scopedAssignments[mgName].assignments.push({
                                                                assignment: node.assignment,
                                                                node: node
                                                            });
                                                            foundScope = true;
                                                        }
                                                    }
                                                }
                                            }
                                            
                                            // If we couldn't find a scope, use "Unknown Scope"
                                            if (!foundScope) {
                                                if (!scopedAssignments["Unknown Scope"]) {
                                                    scopedAssignments["Unknown Scope"] = {
                                                        assignments: [],
                                                        fullPath: ""
                                                    };
                                                }
                                                scopedAssignments["Unknown Scope"].assignments.push({
                                                    assignment: node.assignment,
                                                    node: node
                                                });
                                            }
                                        } else {
                                            // No scope found, use "Unknown Scope"
                                            if (!scopedAssignments["Unknown Scope"]) {
                                                scopedAssignments["Unknown Scope"] = {
                                                    assignments: [],
                                                    fullPath: ""
                                                };
                                            }
                                            scopedAssignments["Unknown Scope"].assignments.push({
                                                assignment: node.assignment,
                                                node: node
                                            });
                                        }
                                    }
                                    
                                    // Process children recursively
                                    if (node.children && Array.isArray(node.children)) {
                                        for (const child of node.children) {
                                            collectAssignments(child, nodeScope || rootScope);
                                        }
                                    }
                                }
                                
                                // Start collection from the root node
                                collectAssignments(policy);
                                
                                debug("Found scopes: " + Object.keys(scopedAssignments).join(", "));
                                
                                // Check if we found any scopes
                                if (Object.keys(scopedAssignments).length === 0) {
                                    const noScopesElement = document.createElement('div');
                                    noScopesElement.textContent = "No scopes or policy assignments found";
                                    container.appendChild(noScopesElement);
                                    return;
                                }
                                
                                // Create a section for each scope
                                for (const [scopeName, scopeData] of Object.entries(scopedAssignments)) {
                                    const { assignments, fullPath } = scopeData;
                                    
                                    // Create the scope container
                                    const scopeContainer = document.createElement('div');
                                    scopeContainer.className = 'scope-container';
                                    
                                    // Create scope header
                                    const scopeHeader = document.createElement('div');
                                    scopeHeader.className = 'scope-header';
                                    scopeHeader.textContent = scopeName;
                                    scopeContainer.appendChild(scopeHeader);
                                    
                                    // Add scope description with full path
                                    if (fullPath) {
                                        const scopeDescription = document.createElement('div');
                                        scopeDescription.className = 'scope-description';
                                        scopeDescription.textContent = fullPath;
                                        scopeContainer.appendChild(scopeDescription);
                                    }
                                    
                                    // Create assignments container
                                    const assignmentsContainer = document.createElement('div');
                                    assignmentsContainer.className = 'scope-assignments';
                                    
                                    // Add all assignments to the container
                                    if (assignments.length > 0) {
                                        assignments.forEach(assignmentData => {
                                            try {
                                                const { assignment, node } = assignmentData;
                                                const assignmentElement = document.createElement('div');
                                                assignmentElement.className = 'scope-assignment';
                                                assignmentElement.setAttribute('data-id', assignment.name || '');
                                                assignmentElement.style.cursor = 'pointer';
                                                assignmentElement.addEventListener('click', function() {
                                                    toggleCardDetails(this);
                                                });
                                                
                                                // Get the effect for this assignment
                                                const effect = getEffect(assignment, node);
                                                const effectClass = getEffectClass(effect);
                                                
                                                // Create assignment name with effect bubble
                                                const nameElement = document.createElement('div');
                                                nameElement.className = 'assignment-name';
                                                
                                                const nameTextElement = document.createElement('span');
                                                nameTextElement.className = 'assignment-name-text';
                                                nameTextElement.textContent = assignment.name || 'Unnamed Assignment';
                                                nameElement.appendChild(nameTextElement);
                                                
                                                const effectElement = document.createElement('span');
                                                effectElement.className = \`effect-bubble \${effectClass}\`;
                                                effectElement.textContent = effect;
                                                nameElement.appendChild(effectElement);
                                                
                                                assignmentElement.appendChild(nameElement);
                                                
                                                // Add display name if available
                                                if (assignment.displayName) {
                                                    const displayNameElement = document.createElement('div');
                                                    displayNameElement.className = 'assignment-displayname';
                                                    displayNameElement.textContent = assignment.displayName;
                                                    assignmentElement.appendChild(displayNameElement);
                                                }
                                                
                                                // Add parameters if available - check all possible locations
                                                const parameters = assignment.parameters || 
                                                                 node.parameters || 
                                                                 policy.parameters;
                                                if (parameters && Object.keys(parameters).length > 0) {
                                                    const paramsElement = document.createElement('div');
                                                    paramsElement.className = 'assignment-parameters';
                                                    
                                                    for (const [paramName, paramValue] of Object.entries(parameters)) {
                                                        const paramElement = document.createElement('div');
                                                        
                                                        const paramNameElement = document.createElement('span');
                                                        paramNameElement.className = 'param-name';
                                                        paramNameElement.textContent = paramName + ': ';
                                                        paramElement.appendChild(paramNameElement);
                                                        
                                                        const paramValueElement = document.createElement('span');
                                                        paramValueElement.className = 'param-value';
                                                        paramValueElement.innerHTML = formatParamValue(paramValue);
                                                        paramElement.appendChild(paramValueElement);
                                                        
                                                        paramsElement.appendChild(paramElement);
                                                    }
                                                    
                                                    assignmentElement.appendChild(paramsElement);
                                                }
                                                
                                                assignmentsContainer.appendChild(assignmentElement);
                                            } catch (error) {
                                                reportError("Error rendering assignment", error);
                                            }
                                        });
                                    } else {
                                        const noAssignmentsElement = document.createElement('div');
                                        noAssignmentsElement.textContent = "No assignments in this scope";
                                        assignmentsContainer.appendChild(noAssignmentsElement);
                                    }
                                    
                                    scopeContainer.appendChild(assignmentsContainer);
                                    container.appendChild(scopeContainer);
                                }
                            } catch (error) {
                                reportError("Error rendering policy view", error);
                            }
                        }
                        
                        // Render the policy view
                        renderPolicyView(policy);
                    } catch (error) {
                        reportError("Error processing policy data", error);
                    }
                })();

                // Toggle card details
                function toggleCardDetails(card) {
                    // Remove existing expanded details
                    const existingDetails = card.querySelector('.expanded-details');
                    if (existingDetails) {
                        card.removeChild(existingDetails);
                        return;
                    }
                    
                    // Create expanded details
                    const details = document.createElement('div');
                    details.className = 'expanded-details';
                    
                    // Get the parameters
                    const params = card.querySelector('.assignment-parameters');
                    if (params) {
                        details.innerHTML = 
                            '<h3>Parameters</h3>' +
                            '<div class="parameter-list">' +
                            params.innerHTML +
                            '</div>';
                    } else {
                        details.innerHTML = 
                            '<h3>Parameters</h3>' +
                            '<div class="parameter-list">No parameters available</div>';
                    }
                    
                    // Add to card
                    card.appendChild(details);
                }
            </script>
        </body>
        </html>`;
    }
}