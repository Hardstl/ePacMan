import * as vscode from 'vscode';
import { Logger } from '../logging';
import { PolicyAssignment } from './policy-assignment-parser';

/**
 * Interface for scope group
 */
export interface ScopeGroup {
    scope: string;
    displayName: string;
    assignments: PolicyAssignment[];
}

/**
 * Class for organizing and formatting policy assignments for visualization
 */
export class VisualizationEngine {
    private logger = Logger.getInstance();
    
    /**
     * Organize assignments by scope
     * @param assignments Array of policy assignments
     * @returns Array of scope groups
     */
    organizeByScope(assignments: PolicyAssignment[]): ScopeGroup[] {
        this.logger.info("Organizing assignments by scope");
        
        // Group assignments by scope
        const scopeMap = new Map<string, PolicyAssignment[]>();
        
        for (const assignment of assignments) {
            const scope = assignment.scope || 'Unknown';
            
            if (!scopeMap.has(scope)) {
                scopeMap.set(scope, []);
            }
            
            scopeMap.get(scope)!.push(assignment);
        }
        
        // Convert map to array of scope groups
        const scopeGroups: ScopeGroup[] = [];
        
        for (const [scope, scopeAssignments] of scopeMap.entries()) {
            scopeGroups.push({
                scope,
                displayName: this.formatScopeDisplayName(scope),
                assignments: scopeAssignments
            });
        }
        
        // Sort scope groups by display name
        scopeGroups.sort((a, b) => a.displayName.localeCompare(b.displayName));
        
        this.logger.info(`Organized assignments into ${scopeGroups.length} scope groups`);
        return scopeGroups;
    }
    
    /**
     * Format a scope for display
     * @param scope The scope string
     * @returns Formatted scope display name
     */
    private formatScopeDisplayName(scope: string): string {
        if (!scope || scope === 'Unknown') {
            return 'Unknown Scope';
        }
        
        // Extract the scope type and name
        const parts = scope.split('/');
        
        if (parts.length < 2) {
            return scope;
        }
        
        // Handle different scope types
        if (scope.includes('/providers/Microsoft.Management/managementGroups/')) {
            const mgName = parts[parts.length - 1];
            return `Management Group: ${mgName}`;
        } else if (scope.includes('/subscriptions/')) {
            const subId = parts.find(p => p === 'subscriptions') ? parts[parts.indexOf('subscriptions') + 1] : 'Unknown';
            return `Subscription: ${subId}`;
        } else if (scope.includes('/resourceGroups/')) {
            const rgName = parts.find(p => p === 'resourceGroups') ? parts[parts.indexOf('resourceGroups') + 1] : 'Unknown';
            const subId = parts.find(p => p === 'subscriptions') ? parts[parts.indexOf('subscriptions') + 1] : 'Unknown';
            return `Resource Group: ${rgName} (Subscription: ${subId})`;
        } else {
            return scope;
        }
    }
    
    /**
     * Generate HTML for the visualization
     * @param scopeGroups Array of scope groups
     * @returns HTML string
     */
    generateHtml(scopeGroups: ScopeGroup[]): string {
        this.logger.info("Generating HTML for visualization");
        
        let html = '';
        
        // Generate HTML for each scope group
        for (const scopeGroup of scopeGroups) {
            html += this.generateScopeGroupHtml(scopeGroup);
        }
        
        return html;
    }
    
    /**
     * Generate HTML for a scope group
     * @param scopeGroup The scope group
     * @returns HTML string
     */
    private generateScopeGroupHtml(scopeGroup: ScopeGroup): string {
        let html = `
            <div class="scope-group">
                <div class="scope-header">
                    <h2>${scopeGroup.displayName}</h2>
                    <div class="scope-info">${scopeGroup.assignments.length} assignments</div>
                </div>
                <div class="assignments-list">
        `;
        
        // Generate HTML for each assignment
        for (const assignment of scopeGroup.assignments) {
            html += this.generateAssignmentCardHtml(assignment);
        }
        
        html += `
                </div>
            </div>
        `;
        
        return html;
    }
    
    /**
     * Generate HTML for an assignment card
     * @param assignment The policy assignment
     * @returns HTML string
     */
    private generateAssignmentCardHtml(assignment: PolicyAssignment): string {
        const displayName = assignment.displayName || assignment.name;
        const description = assignment.description || 'No description';
        const enforcementMode = assignment.enforcementMode || 'Default';
        const effectClass = this.getEffectClass(assignment);
        
        return `
            <div class="assignment-card" data-id="${assignment.id}" data-path="${assignment.filePath}">
                <div class="card-header ${effectClass}">
                    <div class="card-title">${displayName}</div>
                    <div class="card-enforcement">${enforcementMode}</div>
                </div>
                <div class="card-body">
                    <div class="card-description">${description}</div>
                    <div class="card-policy-id">${assignment.policyDefinitionId}</div>
                </div>
                <div class="card-footer">
                    <button class="card-action open-file" data-path="${assignment.filePath}">Open File</button>
                    <button class="card-action validate">Validate</button>
                </div>
            </div>
        `;
    }
    
    /**
     * Get the CSS class for the effect
     * @param assignment The policy assignment
     * @returns CSS class name
     */
    private getEffectClass(assignment: PolicyAssignment): string {
        // Try to determine the effect from parameters or metadata
        let effect = 'default';
        
        if (assignment.parameters && assignment.parameters.effect && assignment.parameters.effect.value) {
            effect = assignment.parameters.effect.value.toLowerCase();
        } else if (assignment.metadata && assignment.metadata.effect) {
            effect = assignment.metadata.effect.toLowerCase();
        }
        
        // Map effect to CSS class
        switch (effect) {
            case 'deny':
                return 'effect-deny';
            case 'audit':
                return 'effect-audit';
            case 'disabled':
                return 'effect-disabled';
            case 'deployifnotexists':
            case 'deploy':
                return 'effect-deploy';
            case 'modify':
                return 'effect-modify';
            default:
                return 'effect-default';
        }
    }
}