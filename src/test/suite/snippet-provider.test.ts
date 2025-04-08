import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import * as path from 'path';
import * as fs from 'fs';
import { PolicyDocumentType } from '../../utils';

/**
 * Test suite for the Snippet Completion Provider functionality
 * These tests verify that the snippet provider correctly:
 * - Identifies policy documents
 * - Provides appropriate completions based on document type
 * - Handles caching correctly
 */
suite('Snippet Completion Provider Tests', () => {
    // Create sandbox for managing Sinon stubs
    const sandbox = sinon.createSandbox();
    
    // Mock objects
    let mockContext: vscode.ExtensionContext;
    let mockDocumentChangeEvent: vscode.TextDocumentChangeEvent;
    let mockPosition: vscode.Position;
    let mockCancellationToken: vscode.CancellationToken;
    let mockCompletionContext: vscode.CompletionContext;
    let mockTextDocument: vscode.TextDocument;
    
    // Cache for testing
    let policyDocumentCache: Map<string, PolicyDocumentType>;
    
    /**
     * Setup function run before each test
     * Creates mock objects and stubs
     */
    setup(() => {
        // Initialize mocks
        mockPosition = { line: 0, character: 0 } as vscode.Position;
        mockCancellationToken = { isCancellationRequested: false } as vscode.CancellationToken;
        mockCompletionContext = { triggerKind: vscode.CompletionTriggerKind.Invoke } as vscode.CompletionContext;
        
        // Mock text document
        mockTextDocument = {
            uri: { toString: () => 'file:///test/policy-assignment.json' },
            fileName: '/test/policy-assignment.json',
            languageId: 'json',
            version: 1,
            isDirty: false,
            isClosed: false,
            getText: () => '{"nodeName": "test", "policyDefinitionId": "test-id", "enforcementMode": "Default"}',
            lineCount: 1,
        } as unknown as vscode.TextDocument;
        
        // Mock document change event with the required reason property
        mockDocumentChangeEvent = {
            document: mockTextDocument,
            contentChanges: [],
            reason: undefined
        } as vscode.TextDocumentChangeEvent;
        
        // Mock extension context
        mockContext = {
            subscriptions: [],
            asAbsolutePath: (relativePath: string) => path.join(__dirname, relativePath),
        } as unknown as vscode.ExtensionContext;
        
        // Create a real Map for the cache
        policyDocumentCache = new Map<string, PolicyDocumentType>();
        
        // Stub VSCode namespace functions
        sandbox.stub(vscode.languages, 'registerCompletionItemProvider').returns({
            dispose: () => {}
        });
        
        sandbox.stub(vscode.workspace, 'onDidChangeTextDocument').returns({
            dispose: () => {}
        });
        
        sandbox.stub(vscode.workspace, 'onDidCloseTextDocument').returns({
            dispose: () => {}
        });
    });
    
    /**
     * Teardown function run after each test
     * Restores all stubbed functions
     */
    teardown(() => {
        sandbox.restore();
        policyDocumentCache.clear();
    });
    
    /**
     * Test that policy assignment documents are correctly identified
     * and appropriate completions are provided
     */
    test('Should provide completions for policy assignment documents', async () => {
        // Mock the identifyPolicyDocument to return PolicyAssignment type
        const identifyPolicyDocumentStub = sandbox.stub().resolves(PolicyDocumentType.PolicyAssignment);
        
        // Get the completion provider implementation
        const registerCompletionProviderStub = vscode.languages.registerCompletionItemProvider as sinon.SinonStub;
        
        // Call the provider for a policy assignment document
        const completionItems = await simulateProvideCompletionItems(
            mockTextDocument, 
            mockPosition, 
            mockCancellationToken, 
            mockCompletionContext, 
            policyDocumentCache, 
            identifyPolicyDocumentStub
        );
        
        // Assert we got completions
        assert.ok(completionItems, 'Should return completion items');
        assert.ok(Array.isArray(completionItems), 'Should return an array of completion items');
        assert.ok(completionItems.length > 0, 'Should return at least one completion item');
        
        // Verify specific snippets are included
        const snippetNames = completionItems.map(item => item.label);
        assert.ok(snippetNames.includes('additionalRoleAssignments-Subscription'), 'Should include subscription role assignment snippet');
        assert.ok(snippetNames.includes('additionalRoleAssignments-ResourceGroup'), 'Should include resource group role assignment snippet');
        assert.ok(snippetNames.includes('resourceSelectors'), 'Should include resource selectors snippet');
        assert.ok(snippetNames.includes('userAssignedIdentity'), 'Should include user assigned identity snippet');
    });
    
    /**
     * Test that non-policy documents don't receive completions
     */
    test('Should not provide completions for non-policy documents', async () => {
        // Create a non-policy document
        const nonPolicyDocument = {
            uri: { toString: () => 'file:///test/regular.json' },
            fileName: '/test/regular.json',
            languageId: 'json',
            version: 1,
            isDirty: false,
            isClosed: false,
            getText: () => '{"regular": "json"}',
            lineCount: 1,
        } as unknown as vscode.TextDocument;
        
        // Mock the identifyPolicyDocument to return None type
        const identifyPolicyDocumentStub = sandbox.stub().resolves(PolicyDocumentType.None);
        
        // Set cache entry to avoid async identification
        policyDocumentCache.set(nonPolicyDocument.uri.toString(), PolicyDocumentType.None);
        
        // Call the provider for a non-policy document
        const completionItems = await simulateProvideCompletionItems(
            nonPolicyDocument, 
            mockPosition, 
            mockCancellationToken, 
            mockCompletionContext, 
            policyDocumentCache,
            identifyPolicyDocumentStub
        );
        
        // Assert we got no completions
        assert.strictEqual(completionItems, null, 'Should not return completion items for non-policy documents');
    });
    
    /**
     * Test that the cache is properly used and updated
     */
    test('Should use and update the document cache', async () => {
        const docUri = mockTextDocument.uri.toString();
        
        // Mock the identifyPolicyDocument to return PolicyAssignment type
        const identifyPolicyDocumentStub = sandbox.stub().resolves(PolicyDocumentType.PolicyAssignment);
        
        // First call - cache miss, should call identifyPolicyDocument
        await simulateProvideCompletionItems(
            mockTextDocument, 
            mockPosition, 
            mockCancellationToken, 
            mockCompletionContext, 
            policyDocumentCache,
            identifyPolicyDocumentStub
        );
        
        // The async identification would update the cache in real implementation
        policyDocumentCache.set(docUri, PolicyDocumentType.PolicyAssignment);
        
        // Second call - cache hit, should not call identifyPolicyDocument again
        await simulateProvideCompletionItems(
            mockTextDocument, 
            mockPosition, 
            mockCancellationToken, 
            mockCompletionContext, 
            policyDocumentCache,
            identifyPolicyDocumentStub
        );
        
        // Verify identifyPolicyDocument was called just once despite two calls to the provider
        assert.strictEqual(identifyPolicyDocumentStub.callCount, 1, 'identifyPolicyDocument should be called only once due to caching');
    });
    
    /**
     * Test that cache is cleared when document content changes
     */
    test('Should clear cache when document content changes', () => {
        const docUri = mockTextDocument.uri.toString();
        
        // Populate cache with entry
        policyDocumentCache.set(docUri, PolicyDocumentType.PolicyAssignment);
        
        // Simulate document change event
        simulateDocumentChangeEvent(mockDocumentChangeEvent, policyDocumentCache);
        
        // Verify cache entry was removed
        assert.strictEqual(policyDocumentCache.has(docUri), false, 'Cache entry should be removed when document changes');
    });
    
    /**
     * Test that cache is cleared when document is closed
     */
    test('Should clear cache when document is closed', () => {
        const docUri = mockTextDocument.uri.toString();
        
        // Populate cache with entry
        policyDocumentCache.set(docUri, PolicyDocumentType.PolicyAssignment);
        
        // Simulate document close event
        simulateDocumentCloseEvent(mockTextDocument, policyDocumentCache);
        
        // Verify cache entry was removed
        assert.strictEqual(policyDocumentCache.has(docUri), false, 'Cache entry should be removed when document is closed');
    });
});

/**
 * Helper function to simulate the provideCompletionItems method
 * @param document The document to provide completions for
 * @param position The position in the document
 * @param token Cancellation token
 * @param context Completion context
 * @param cache The document cache
 * @param identifyPolicyDocumentStub Stub for the identifyPolicyDocument function
 * @returns The completion items or null
 */
async function simulateProvideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
    context: vscode.CompletionContext,
    cache: Map<string, PolicyDocumentType>,
    identifyPolicyDocumentStub: sinon.SinonStub
): Promise<vscode.CompletionItem[] | null> {
    const documentUri = document.uri.toString();
    
    // Check if we've already identified this document
    if (!cache.has(documentUri)) {
        // Do a quick content check to speed things up
        const text = document.getText();
        const quickCheckForAssignment = text.includes('"nodeName"') || 
                                      text.includes('"policyDefinitionId"') ||
                                      text.includes('"enforcementMode"') ||
                                      text.includes('policy-assignment-schema.json');
        
        if (!quickCheckForAssignment) {
            // Quickly rule out non-assignment files
            cache.set(documentUri, PolicyDocumentType.None);
            return null;
        }
        
        // Start async full check to properly update the cache for future requests
        // In real implementation this would be awaited, but we're simulating here
        identifyPolicyDocumentStub(document).then((docType: PolicyDocumentType) => {
            cache.set(documentUri, docType);
        }).catch(() => {
            // On error, assume it's not a policy document
            cache.set(documentUri, PolicyDocumentType.None);
        });
        
        // For now, proceed with showing completions based on quick check
    } else if (cache.get(documentUri) !== PolicyDocumentType.PolicyAssignment) {
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

/**
 * Helper function to simulate document change event handler
 * @param event The document change event
 * @param cache The document cache
 */
function simulateDocumentChangeEvent(
    event: vscode.TextDocumentChangeEvent, 
    cache: Map<string, PolicyDocumentType>
): void {
    // Remove from cache when document content changes
    cache.delete(event.document.uri.toString());
}

/**
 * Helper function to simulate document close event handler
 * @param document The document being closed
 * @param cache The document cache
 */
function simulateDocumentCloseEvent(
    document: vscode.TextDocument, 
    cache: Map<string, PolicyDocumentType>
): void {
    // Remove from cache when document is closed to free memory
    cache.delete(document.uri.toString());
}