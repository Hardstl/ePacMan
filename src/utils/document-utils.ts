import * as vscode from 'vscode';
import * as fs from 'fs';
import * as jsonc from 'jsonc-parser';
import { Logger } from '../logging';

/**
 * Policy document types
 */
export enum PolicyDocumentType {
    None = 'none',
    PolicyDefinition = 'policyDefinition',
    PolicySetDefinition = 'policySetDefinition',
    PolicyAssignment = 'policyAssignment'
}

/**
 * Options for document type identification
 */
export interface DocumentTypeOptions {
    checkEpacSpecificSchema?: boolean;
}

/**
 * Parse JSON content with support for comments
 * @param content The content to parse
 * @param allowComments Whether to allow comments in the JSON
 * @returns The parsed JSON object and any parse errors
 */
export function parseJsonContent(content: string, allowComments: boolean = true): { json: any, errors: jsonc.ParseError[] } {
    const errors: jsonc.ParseError[] = [];
    const parseOptions = { 
        allowTrailingComma: true, 
        disallowComments: !allowComments 
    };
    
    try {
        const json = jsonc.parse(content, errors, parseOptions);
        return { json, errors };
    } catch (error) {
        return { json: null, errors };
    }
}

/**
 * Check if a JSON object is a valid policy document
 * @param json The JSON object to check
 * @param options Options for document type identification
 * @returns The type of policy document, or PolicyDocumentType.None if not a policy document
 */
export function getPolicyDocumentType(json: any, options: DocumentTypeOptions = {}): PolicyDocumentType {
    const logger = Logger.getInstance();
    
    if (!json) {
        return PolicyDocumentType.None;
    }
    
    // Check for schema URL
    if (json.$schema && typeof json.$schema === 'string') {
        const schemaUrl = json.$schema.toLowerCase();
        if (schemaUrl.includes('policy-definition-schema.json')) {
            logger.debug('Document identified as policy definition by schema URL');
            return PolicyDocumentType.PolicyDefinition;
        } else if (schemaUrl.includes('policy-set-definition-schema.json')) {
            logger.debug('Document identified as policy set definition by schema URL');
            return PolicyDocumentType.PolicySetDefinition;
        } else if (schemaUrl.includes('policy-assignment-schema.json')) {
            logger.debug('Document identified as policy assignment by schema URL');
            return PolicyDocumentType.PolicyAssignment;
        }
    }
    
    // Check for EPAC-specific schema if requested
    if (options.checkEpacSpecificSchema && json.$schema && typeof json.$schema === 'string') {
        if (json.$schema.includes('https://raw.githubusercontent.com/Azure/enterprise-azure-policy-as-code/main/Schemas/policy-assignment-schema.json')) {
            logger.debug('Document identified as ePac assignment by ePac schema URL');
            return PolicyDocumentType.PolicyAssignment;
        }
    }
    
    // Check for Enterprise-Scale source
    if (json.properties?.metadata?.source && 
        json.properties.metadata.source.includes('https://github.com/Azure/Enterprise-Scale')) {
        logger.debug('Document identified as policy document by Enterprise-Scale source');
        return PolicyDocumentType.PolicyDefinition;
    }
    
    // Check for assignment (nodeName property)
    if (json.nodeName && typeof json.nodeName === 'string') {
        logger.debug('Document identified as policy assignment by nodeName property');
        return PolicyDocumentType.PolicyAssignment;
    }
    
    // Check for policy definition structure - requires mode and policyRule properties
    if (json.name &&
        json.properties &&
        json.properties.mode &&
        json.properties.policyRule &&
        typeof json.properties.policyRule === 'object') {
        logger.debug('Document identified as policy definition by structure');
        return PolicyDocumentType.PolicyDefinition;
    }
    
    // Check for policy set definition structure - only requires policyDefinitions array
    if (json.name &&
        json.properties &&
        json.properties.policyDefinitions &&
        Array.isArray(json.properties.policyDefinitions)) {
        logger.debug('Document identified as policy set definition by structure');
        return PolicyDocumentType.PolicySetDefinition;
    }
    
    // Check for Azure resource types
    if (json.type === "Microsoft.Authorization/policyDefinitions") {
        logger.debug('Document identified as Azure policy definition by type');
        return PolicyDocumentType.PolicyDefinition;
    } else if (json.type === "Microsoft.Authorization/policySetDefinitions") {
        logger.debug('Document identified as Azure policy set definition by type');
        return PolicyDocumentType.PolicySetDefinition;
    } else if (json.type === "Microsoft.Authorization/policyAssignments") {
        logger.debug('Document identified as Azure policy assignment by type');
        return PolicyDocumentType.PolicyAssignment;
    }
    
    logger.debug('Document is not a known policy document type');
    return PolicyDocumentType.None;
}

/**
 * Check if a document is a valid policy document
 * @param document The document to check
 * @param options Options for document type identification
 * @returns The type of policy document, or PolicyDocumentType.None if not a policy document
 */
export async function identifyPolicyDocument(document: vscode.TextDocument | undefined, options: DocumentTypeOptions = {}): Promise<PolicyDocumentType> {
    if (!document) {
        return PolicyDocumentType.None;
    }
    
    try {
        // Check if document is JSON or JSONC
        if (document.languageId !== 'json' && document.languageId !== 'jsonc') {
            return PolicyDocumentType.None;
        }
        
        const content = document.getText();
        const isJsonc = document.fileName.toLowerCase().endsWith('.jsonc');
        
        // Parse the content
        const { json, errors } = parseJsonContent(content, isJsonc);
        
        if (errors.length > 0 || !json) {
            return PolicyDocumentType.None;
        }
        
        return getPolicyDocumentType(json, options);
    } catch (error) {
        return PolicyDocumentType.None;
    }
}

/**
 * Check if a document is a policy document
 * @param document The document to check
 * @param options Options for document type identification
 * @returns True if the document is a policy document, false otherwise
 */
export async function isPolicyDocument(document: vscode.TextDocument | undefined, options: DocumentTypeOptions = {}): Promise<boolean> {
    const type = await identifyPolicyDocument(document, options);
    return type !== PolicyDocumentType.None;
}