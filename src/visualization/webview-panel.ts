import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { Logger } from '../logging';
import { ErrorHandler } from '../error';
import { PolicyAssignment } from './policy-assignment-parser';
import { VisualizationEngine, ScopeGroup } from './visualization-engine';
import { InteractiveElements, WebViewMessage } from './interactive-elements';

/**
 * Class for managing the WebView panel
 */
export class WebViewPanel {
    private static readonly viewType = 'epacman.policyAssignmentVisualizer';
    private static readonly title = 'Policy Assignment Visualizer';
    private panel: vscode.WebviewPanel | undefined;
    private logger = Logger.getInstance();
    
    /**
     * Constructor
     * @param context The extension context
     * @param visualizationEngine The visualization engine
     * @param interactiveElements The interactive elements handler
     */
    constructor(
        private context: vscode.ExtensionContext,
        private visualizationEngine: VisualizationEngine,
        private interactiveElements: InteractiveElements
    ) {}
    
    /**
     * Show the WebView panel
     * @param assignments Array of policy assignments
     */
    async show(assignments: PolicyAssignment[]): Promise<void> {
        try {
            // Create or reveal the panel
            if (this.panel) {
                this.panel.reveal(vscode.ViewColumn.One);
            } else {
                this.panel = vscode.window.createWebviewPanel(
                    WebViewPanel.viewType,
                    WebViewPanel.title,
                    vscode.ViewColumn.One,
                    {
                        enableScripts: true,
                        retainContextWhenHidden: true,
                        localResourceRoots: [
                            vscode.Uri.file(path.join(this.context.extensionPath, 'webview'))
                        ]
                    }
                );
                
                // Set up message handling
                this.panel.webview.onDidReceiveMessage(
                    (message: WebViewMessage) => this.interactiveElements.handleMessage(message),
                    undefined,
                    this.context.subscriptions
                );
                
                // Set the WebView panel in the interactive elements
                this.interactiveElements.setWebViewPanel(this.panel);
                
                // Handle panel disposal
                this.panel.onDidDispose(
                    () => {
                        this.panel = undefined;
                        this.logger.info("WebView panel disposed");
                    },
                    null,
                    this.context.subscriptions
                );
            }
            
            // Cache the assignment data for quick access in the interactive elements
            this.interactiveElements.setAssignmentData(assignments);
            
            // Organize assignments by scope
            const scopeGroups = this.visualizationEngine.organizeByScope(assignments);
            
            // Set the WebView content
            this.panel.webview.html = await this.getWebViewContent(scopeGroups);
            
            this.logger.info("WebView panel shown successfully");
        } catch (error: any) {
            this.logger.error("Error showing WebView panel", error);
            ErrorHandler.handleError(error, "Failed to show policy assignment visualization");
        }
    }
    
    /**
     * Get the HTML content for the WebView
     * @param scopeGroups Array of scope groups
     * @returns HTML content
     */
    private async getWebViewContent(scopeGroups: ScopeGroup[]): Promise<string> {
        try {
            // Get the HTML, CSS, and JavaScript content
            const htmlContent = await this.getHtmlContent();
            const cssContent = await this.getCssContent();
            const jsContent = await this.getJavaScriptContent();
            
            // Generate the assignment HTML
            const assignmentsHtml = this.visualizationEngine.generateHtml(scopeGroups);
            
            // Replace placeholders in the HTML
            const html = htmlContent
                .replace('{{styles}}', cssContent)
                .replace('{{scripts}}', jsContent)
                .replace('{{assignments}}', assignmentsHtml)
                .replace('{{assignmentCount}}', scopeGroups.reduce((count, group) => count + group.assignments.length, 0).toString())
                .replace('{{scopeCount}}', scopeGroups.length.toString());
            
            return html;
        } catch (error: any) {
            this.logger.error("Error generating WebView content", error);
            return this.getErrorHtml(error.message);
        }
    }
    
    /**
     * Get the HTML content for the WebView
     * @returns HTML content
     */
    private async getHtmlContent(): Promise<string> {
        // Create the webview directory if it doesn't exist
        const webviewDir = path.join(this.context.extensionPath, 'webview');
        if (!fs.existsSync(webviewDir)) {
            fs.mkdirSync(webviewDir, { recursive: true });
        }
        
        // Create the HTML file if it doesn't exist
        const htmlPath = path.join(webviewDir, 'policy-assignment-visualizer.html');
        if (!fs.existsSync(htmlPath)) {
            await this.createWebViewFiles();
        }
        
        // Read the HTML file
        const html = fs.readFileSync(htmlPath, 'utf8');
        return html;
    }
    
    /**
     * Get the CSS content for the WebView
     * @returns CSS content
     */
    private async getCssContent(): Promise<string> {
        const cssPath = path.join(this.context.extensionPath, 'webview', 'policy-assignment-visualizer.css');
        if (!fs.existsSync(cssPath)) {
            await this.createWebViewFiles();
        }
        
        const css = fs.readFileSync(cssPath, 'utf8');
        return css;
    }
    
    /**
     * Get the JavaScript content for the WebView
     * @returns JavaScript content
     */
    private async getJavaScriptContent(): Promise<string> {
        const jsPath = path.join(this.context.extensionPath, 'webview', 'policy-assignment-visualizer.js');
        if (!fs.existsSync(jsPath)) {
            await this.createWebViewFiles();
        }
        
        const js = fs.readFileSync(jsPath, 'utf8');
        return js;
    }
    
    /**
     * Create the WebView files if they don't exist
     */
    private async createWebViewFiles(): Promise<void> {
        const webviewDir = path.join(this.context.extensionPath, 'webview');
        if (!fs.existsSync(webviewDir)) {
            fs.mkdirSync(webviewDir, { recursive: true });
        }
        
        // Create HTML file
        const htmlPath = path.join(webviewDir, 'policy-assignment-visualizer.html');
        const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Policy Assignment Visualizer</title>
    <style>
        {{styles}}
    </style>
</head>
<body>
    <div class="visualizer-container">
        <header class="visualizer-header">
            <h1>Policy Assignment Visualizer</h1>
            <div class="stats">
                <span>{{assignmentCount}} assignments</span>
                <span>{{scopeCount}} scopes</span>
            </div>
        </header>
        
        <div class="controls">
            <input type="text" id="search-input" placeholder="Search assignments...">
            <select id="sort-select">
                <option value="scope">Sort by Scope</option>
                <option value="name">Sort by Name</option>
                <option value="effect">Sort by Effect</option>
            </select>
        </div>
        
        <div class="assignments-view">
            {{assignments}}
        </div>
        
        <div id="error-container" class="error-container" style="display: none;">
            <div class="error-message"></div>
        </div>
    </div>
    
    <script>
        {{scripts}}
    </script>
</body>
</html>`;
        fs.writeFileSync(htmlPath, htmlContent);
        
        // Create CSS file
        const cssPath = path.join(webviewDir, 'policy-assignment-visualizer.css');
        const cssContent = `:root {
    --background-color: var(--vscode-editor-background);
    --foreground-color: var(--vscode-editor-foreground);
    --header-color: var(--vscode-editor-selectionBackground);
    --border-color: var(--vscode-panel-border);
    --card-background: var(--vscode-editorWidget-background);
    --card-hover-background: var(--vscode-list-hoverBackground);
    --button-background: var(--vscode-button-background);
    --button-foreground: var(--vscode-button-foreground);
    --button-hover-background: var(--vscode-button-hoverBackground);
    --input-background: var(--vscode-input-background);
    --input-foreground: var(--vscode-input-foreground);
    --input-border: var(--vscode-input-border);
    --effect-deny-color: #ff6b6b;
    --effect-audit-color: #feca57;
    --effect-deploy-color: #54a0ff;
    --effect-modify-color: #5f27cd;
    --effect-disabled-color: #c8d6e5;
    --effect-default-color: #576574;
}

body {
    font-family: var(--vscode-font-family);
    background-color: var(--background-color);
    color: var(--foreground-color);
    padding: 0;
    margin: 0;
}

.visualizer-container {
    display: flex;
    flex-direction: column;
    height: 100vh;
    padding: 16px;
    box-sizing: border-box;
}

.visualizer-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--border-color);
}

.visualizer-header h1 {
    margin: 0;
    font-size: 24px;
}

.stats {
    display: flex;
    gap: 16px;
}

.controls {
    display: flex;
    gap: 16px;
    margin-bottom: 16px;
}

#search-input {
    flex: 1;
    padding: 8px;
    background-color: var(--input-background);
    color: var(--input-foreground);
    border: 1px solid var(--input-border);
    border-radius: 4px;
}

#sort-select {
    padding: 8px;
    background-color: var(--input-background);
    color: var(--input-foreground);
    border: 1px solid var(--input-border);
    border-radius: 4px;
}

.assignments-view {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 24px;
}

.scope-group {
    margin-bottom: 16px;
}

.scope-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
    padding: 8px;
    background-color: var(--header-color);
    border-radius: 4px;
}

.scope-header h2 {
    margin: 0;
    font-size: 18px;
}

.assignments-list {
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.assignment-card {
    background-color: var(--card-background);
    border-radius: 4px;
    overflow: hidden;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    transition: transform 0.2s;
}

.assignment-card:hover {
    transform: translateY(-2px);
    background-color: var(--card-hover-background);
}

.card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border-color);
}

.card-title {
    font-weight: bold;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.card-enforcement {
    font-size: 12px;
    padding: 2px 6px;
    border-radius: 4px;
    background-color: var(--effect-default-color);
    color: white;
}

.card-body {
    padding: 12px;
}

.card-description {
    margin-bottom: 8px;
    font-size: 14px;
    line-height: 1.4;
    max-height: 60px;
    overflow: hidden;
}

.card-policy-id {
    font-size: 12px;
    color: var(--foreground-color);
    opacity: 0.7;
    word-break: break-all;
}

.card-footer {
    display: flex;
    justify-content: space-between;
    padding: 8px 12px;
    border-top: 1px solid var(--border-color);
}

.card-action {
    padding: 4px 8px;
    background-color: var(--button-background);
    color: var(--button-foreground);
    border: none;
    border-radius: 4px;
    cursor: pointer;
}

.card-action:hover {
    background-color: var(--button-hover-background);
}

.effect-deny {
    border-top: 4px solid var(--effect-deny-color);
}

.effect-audit {
    border-top: 4px solid var(--effect-audit-color);
}

.effect-deploy {
    border-top: 4px solid var(--effect-deploy-color);
}

.effect-modify {
    border-top: 4px solid var(--effect-modify-color);
}

.effect-disabled {
    border-top: 4px solid var(--effect-disabled-color);
}

.effect-default {
    border-top: 4px solid var(--effect-default-color);
}

.error-container {
    padding: 16px;
    margin-top: 16px;
    background-color: var(--effect-deny-color);
    color: white;
    border-radius: 4px;
}

.expanded-details {
    padding: 12px;
    background-color: var(--background-color);
    border-top: 1px solid var(--border-color);
}

.expanded-details h3 {
    margin-top: 0;
    margin-bottom: 8px;
}

.parameter-list {
    font-family: monospace;
    font-size: 12px;
    white-space: pre-wrap;
}

@media (max-width: 768px) {
    .assignments-list {
        width: 100%;
    }
}`;
        fs.writeFileSync(cssPath, cssContent);
        
        // Create JavaScript file
        const jsPath = path.join(webviewDir, 'policy-assignment-visualizer.js');
        const jsContent = `// Get the VS Code API
const vscode = acquireVsCodeApi();

// Store state
let state = {
    searchTerm: '',
    sortBy: 'scope'
};

// Initialize the visualizer
function initVisualizer() {
    // Set up event listeners
    document.getElementById('search-input').addEventListener('input', handleSearch);
    document.getElementById('sort-select').addEventListener('change', handleSort);
    
    // Set up card click handlers
    document.querySelectorAll('.assignment-card').forEach(card => {
        // Open file button
        card.querySelector('.open-file').addEventListener('click', (e) => {
            e.stopPropagation();
            const path = e.target.getAttribute('data-path');
            vscode.postMessage({
                command: 'openFile',
                data: { path }
            });
        });
        
        // Validate button
        card.querySelector('.validate').addEventListener('click', (e) => {
            e.stopPropagation();
            const id = card.getAttribute('data-id');
            const path = card.getAttribute('data-path');
            vscode.postMessage({
                command: 'validateAssignment',
                data: { id, path }
            });
        });
        
        // Card click for expanding details
        card.addEventListener('click', () => {
            toggleCardDetails(card);
        });
    });
}

// Handle search input
function handleSearch(e) {
    state.searchTerm = e.target.value.toLowerCase();
    filterCards();
}

// Handle sort selection
function handleSort(e) {
    state.sortBy = e.target.value;
    sortCards();
}

// Filter cards based on search term
function filterCards() {
    const searchTerm = state.searchTerm;
    
    document.querySelectorAll('.assignment-card').forEach(card => {
        const title = card.querySelector('.card-title').textContent.toLowerCase();
        const description = card.querySelector('.card-description').textContent.toLowerCase();
        const policyId = card.querySelector('.card-policy-id').textContent.toLowerCase();
        
        const matches = title.includes(searchTerm) || 
                       description.includes(searchTerm) || 
                       policyId.includes(searchTerm);
        
        card.style.display = matches ? 'block' : 'none';
    });
    
    // Show/hide scope groups based on visible cards
    document.querySelectorAll('.scope-group').forEach(group => {
        const hasVisibleCards = Array.from(group.querySelectorAll('.assignment-card'))
            .some(card => card.style.display !== 'none');
        
        group.style.display = hasVisibleCards ? 'block' : 'none';
    });
}

// Sort cards based on selected sort option
function sortCards() {
    const sortBy = state.sortBy;
    const scopeGroups = document.querySelectorAll('.scope-group');
    
    if (sortBy === 'scope') {
        // Sort scope groups by name
        const sortedGroups = Array.from(scopeGroups).sort((a, b) => {
            const aName = a.querySelector('h2').textContent;
            const bName = b.querySelector('h2').textContent;
            return aName.localeCompare(bName);
        });
        
        const container = document.querySelector('.assignments-view');
        sortedGroups.forEach(group => container.appendChild(group));
    } else {
        // Sort cards within each scope group
        scopeGroups.forEach(group => {
            const container = group.querySelector('.assignments-list');
            const cards = Array.from(container.querySelectorAll('.assignment-card'));
            
            const sortedCards = cards.sort((a, b) => {
                if (sortBy === 'name') {
                    const aName = a.querySelector('.card-title').textContent;
                    const bName = b.querySelector('.card-title').textContent;
                    return aName.localeCompare(bName);
                } else if (sortBy === 'effect') {
                    const aEffect = getCardEffect(a);
                    const bEffect = getCardEffect(b);
                    return aEffect.localeCompare(bEffect);
                }
                return 0;
            });
            
            sortedCards.forEach(card => container.appendChild(card));
        });
    }
}

// Get the effect from a card
function getCardEffect(card) {
    const header = card.querySelector('.card-header');
    const classes = header.className.split(' ');
    const effectClass = classes.find(cls => cls.startsWith('effect-'));
    return effectClass ? effectClass.replace('effect-', '') : '';
}

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
    
    // Get policy ID
    const policyId = card.querySelector('.card-policy-id').textContent;
    
    // Create details content
    details.innerHTML = \`
        <h3>Policy Definition</h3>
        <div>\${policyId}</div>
        <h3>Parameters</h3>
        <div class="parameter-list">Loading parameters...</div>
    \`;
    
    // Add to card
    card.appendChild(details);
    
    // Request parameters from extension
    const id = card.getAttribute('data-id');
    vscode.postMessage({
        command: 'expandDetails',
        data: { id }
    });
}

// Handle messages from the extension
window.addEventListener('message', event => {
    const message = event.data;
    
    switch (message.command) {
        case 'updateParameters':
            updateParameters(message.data.id, message.data.parameters);
            break;
            
        case 'showError':
            showError(message.data.message);
            break;
    }
});

// Update parameters in expanded details
function updateParameters(id, parameters) {
    const card = document.querySelector(\`.assignment-card[data-id="\${id}"]\`);
    if (!card) return;
    
    const parameterList = card.querySelector('.parameter-list');
    if (!parameterList) return;
    
    if (parameters && Object.keys(parameters).length > 0) {
        parameterList.textContent = JSON.stringify(parameters, null, 2);
    } else {
        parameterList.textContent = 'No parameters';
    }
}

// Show error message
function showError(message) {
    const errorContainer = document.getElementById('error-container');
    const errorMessage = errorContainer.querySelector('.error-message');
    
    errorMessage.textContent = message;
    errorContainer.style.display = 'block';
    
    // Hide after 5 seconds
    setTimeout(() => {
        errorContainer.style.display = 'none';
    }, 5000);
}

// Initialize on load
document.addEventListener('DOMContentLoaded', initVisualizer);
initVisualizer();`;
        fs.writeFileSync(jsPath, jsContent);
    }
    
    /**
     * Get HTML for an error message
     * @param errorMessage The error message
     * @returns HTML content
     */
    private getErrorHtml(errorMessage: string): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Error</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            background-color: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            padding: 20px;
        }
        .error-container {
            padding: 20px;
            background-color: #ff6b6b;
            color: white;
            border-radius: 4px;
        }
        h1 {
            margin-top: 0;
        }
        pre {
            background-color: rgba(0, 0, 0, 0.1);
            padding: 10px;
            border-radius: 4px;
            overflow: auto;
        }
    </style>
</head>
<body>
    <h1>Error Loading Policy Assignment Visualizer</h1>
    <div class="error-container">
        <p>An error occurred while loading the Policy Assignment Visualizer:</p>
        <pre>${errorMessage}</pre>
    </div>
    <p>Please check the logs for more information.</p>
</body>
</html>`;
    }
}