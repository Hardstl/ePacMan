import axios, { AxiosError, AxiosResponse, AxiosResponseHeaders, RawAxiosResponseHeaders } from 'axios';
import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import { Logger } from '../logging';

/**
 * Cache entry for API responses
 */
interface CacheEntry {
    timestamp: number;
    data: any;
    etag?: string;
}

/**
 * Service for interacting with the GitHub API to fetch policy files
 */
export class GitHubService {
    private readonly GITHUB_API_BASE = 'https://api.github.com';
    private readonly REPO_OWNER = 'Azure';
    private readonly REPO_NAME = 'ALZ-Bicep';
    private readonly BRANCH = 'main';
    
    // Policy definitions path
    private readonly POLICY_DEFINITIONS_PATH = 
        'infra-as-code/bicep/modules/policy/definitions/lib/policy_definitions';
    
    // Policy set definitions path
    private readonly POLICY_SET_DEFINITIONS_PATH = 
        'infra-as-code/bicep/modules/policy/definitions/lib/policy_set_definitions';
    
    private readonly logger: Logger;
    
    // Rate limiting state
    private rateLimitRemaining: number = 60; // GitHub's default limit is 60 requests per hour for unauthenticated users
    private rateLimitReset: number = 0;      // Timestamp when rate limit resets
    private requestQueue: Array<() => Promise<any>> = [];
    private isProcessingQueue: boolean = false;
    
    // Response cache to reduce API calls
    private cache: Map<string, CacheEntry> = new Map();
    private readonly CACHE_TTL = 1000 * 60 * 60; // 1 hour cache TTL
    
    constructor() {
        this.logger = Logger.getInstance();
    }
    
    /**
     * Fetch a list of policy files from GitHub
     * @param isPolicySet Whether to fetch policy set definitions instead of policy definitions
     * @returns Promise resolving to an array of file names
     */
    public async fetchPolicyFilesList(isPolicySet: boolean = false): Promise<string[]> {
        try {
            const path = isPolicySet ? this.POLICY_SET_DEFINITIONS_PATH : this.POLICY_DEFINITIONS_PATH;
            const url = `${this.GITHUB_API_BASE}/repos/${this.REPO_OWNER}/${this.REPO_NAME}/contents/${path}?ref=${this.BRANCH}`;
            
            this.logger.info(`[GitHub Service] Fetching policy files list from GitHub: ${url}`);
            this.logger.info(`[GitHub Service] Repository: ${this.REPO_OWNER}/${this.REPO_NAME}, Branch: ${this.BRANCH}`);
            this.logger.info(`[GitHub Service] Path: ${path} (isPolicySet: ${isPolicySet})`);
            
            try {
                // Use the rate-limited request with caching
                const response = await this.makeRateLimitedRequest(url);
                
                this.logger.info(`[GitHub Service] GitHub API response status: ${response.status}`);
                
                if (response.status !== 200) {
                    this.logger.error(`[GitHub Service] GitHub API returned non-200 status: ${response.status} ${response.statusText}`);
                    throw new Error(`Failed to fetch policy files list: ${response.statusText}`);
                }
                
                if (!response.data || !Array.isArray(response.data)) {
                    this.logger.error(`[GitHub Service] GitHub API returned unexpected data format: ${JSON.stringify(response.data)}`);
                    throw new Error('GitHub API returned unexpected data format');
                }
                
                const files = response.data
                    .filter((item: any) => item.type === 'file' && item.name.endsWith('.json'))
                    .map((item: any) => item.name);
                
                this.logger.info(`[GitHub Service] Found ${files.length} policy files in GitHub repository`);
                this.logger.debug(`[GitHub Service] Files: ${files.join(', ')}`);
                return files;
            } catch (axiosError: any) {
                // Error handling with better rate limit information
                this.handleApiError(axiosError, 'fetching policy files list');
                throw axiosError;
            }
        } catch (error: any) {
            this.logger.error(`[GitHub Service] Error fetching policy files list from GitHub: ${error.message}`, error);
            throw new Error(`Failed to fetch policy files list from GitHub: ${error.message}`);
        }
    }
    
    /**
     * Fetch a specific policy file content from GitHub by filename
     * @param filename The filename to fetch
     * @param isPolicySet Whether to fetch from policy set definitions instead of policy definitions
     * @returns Promise resolving to the file content
     */
    public async fetchPolicyFileByFilename(filename: string, isPolicySet: boolean = false): Promise<string> {
        try {
            const path = isPolicySet ? this.POLICY_SET_DEFINITIONS_PATH : this.POLICY_DEFINITIONS_PATH;
            const url = `${this.GITHUB_API_BASE}/repos/${this.REPO_OWNER}/${this.REPO_NAME}/contents/${path}/${filename}?ref=${this.BRANCH}`;
            
            this.logger.info(`[GitHub Service] Fetching policy file from GitHub: ${url}`);
            this.logger.info(`[GitHub Service] Filename: ${filename}, isPolicySet: ${isPolicySet}`);
            
            try {
                // Use the rate-limited request with caching
                const response = await this.makeRateLimitedRequest(url);
                
                this.logger.info(`[GitHub Service] GitHub API response status for file ${filename}: ${response.status}`);
                
                if (response.status !== 200) {
                    this.logger.error(`[GitHub Service] GitHub API returned non-200 status for file ${filename}: ${response.status} ${response.statusText}`);
                    throw new Error(`Failed to fetch policy file: ${response.statusText}`);
                }
                
                if (!response.data || !response.data.content) {
                    this.logger.error(`[GitHub Service] GitHub API returned unexpected data format for file ${filename}: ${JSON.stringify(response.data)}`);
                    throw new Error('GitHub API returned unexpected data format');
                }
                
                // GitHub API returns content as base64 encoded
                try {
                    const content = Buffer.from(response.data.content, 'base64').toString('utf-8');
                    this.logger.info(`[GitHub Service] Successfully decoded content for file ${filename}`);
                    return content;
                } catch (decodeError) {
                    this.logger.error(`[GitHub Service] Error decoding base64 content for file ${filename}`, decodeError);
                    throw new Error(`Error decoding base64 content: ${decodeError instanceof Error ? decodeError.message : 'Unknown error'}`);
                }
            } catch (axiosError: any) {
                // Handle rate limiting errors and use fallback if necessary
                if (this.handleApiError(axiosError, `fetching file ${filename}`)) {
                    // If we got a 403 Forbidden (rate limit), try the fallback method
                    this.logger.warn(`[GitHub Service] GitHub API rate limit exceeded, trying fallback method for file ${filename}`);
                    return await this.fetchFromRawGitHub(filename, isPolicySet);
                }
                throw axiosError;
            }
        } catch (error: any) {
            // If this is a network error or other non-API error, try the fallback method
            this.logger.warn(`[GitHub Service] Error fetching policy file ${filename} from GitHub API, trying fallback method: ${error.message}`);
            try {
                return await this.fetchFromRawGitHub(filename, isPolicySet);
            } catch (fallbackError: any) {
                this.logger.error(`[GitHub Service] Fallback method also failed for file ${filename}: ${fallbackError.message}`, fallbackError);
                throw new Error(`Failed to fetch policy file from GitHub (both API and fallback failed): ${error.message}`);
            }
        }
    }
    
    /**
     * Find a policy file in GitHub by policy name property
     * @param policyName The policy name to search for
     * @param isPolicySet Whether to search in policy set definitions instead of policy definitions
     * @returns Promise resolving to the file content if found, null otherwise
     */
    public async findPolicyFileByPolicyName(policyName: string, isPolicySet: boolean = false): Promise<string | null> {
        try {
            this.logger.info(`[GitHub Service] Finding policy file by name: ${policyName} (isPolicySet: ${isPolicySet})`);
            
            // First, try to directly fetch the file using common naming patterns
            this.logger.info(`[GitHub Service] Trying direct file access for policy: ${policyName} (isPolicySet: ${isPolicySet})`);
            
            // Different naming patterns for policy definitions and policy set definitions
            const possibleFilenames = isPolicySet ? [
                `policy_set_definition_es_${policyName}.json`,
                `initiative_definition_es_${policyName}.json`,
                `${policyName}.json`
            ] : [
                `policy_definition_es_${policyName}.json`,
                `${policyName}.json`
            ];
            
            this.logger.info(`[GitHub Service] Trying direct access with filenames: ${possibleFilenames.join(', ')}`);
            this.logger.info(`[GitHub Service] Full repository path: infra-as-code/bicep/modules/policy/definitions/lib/${isPolicySet ? 'policy_set_definitions' : 'policy_definitions'}`);
            
            // Try each possible filename directly
            for (const filename of possibleFilenames) {
                try {
                    this.logger.info(`[GitHub Service] Trying direct access to file: ${filename}`);
                    const content = await this.fetchPolicyFileByFilename(filename, isPolicySet);
                    
                    // Verify this is the right policy by checking the name case-insensitively
                    try {
                        const json = this.safeJsonParse(content);
                        if (json === null) {
                            throw new Error('Failed to parse JSON content');
                        }
                        // Use localeCompare with case-insensitive option for proper string comparison
                        if (json.name && typeof json.name === 'string' && 
                            json.name.localeCompare(policyName, undefined, { sensitivity: 'base' }) === 0) {
                            this.logger.info(`[GitHub Service] Successfully found policy by direct filename: ${filename}`);
                            return content;
                        } else {
                            this.logger.info(`[GitHub Service] File ${filename} exists but has different policy name: ${json.name}`);
                        }
                    } catch (parseError) {
                        this.logger.warn(`[GitHub Service] Error parsing JSON from direct file access: ${filename}`, parseError);
                    }
                } catch (fetchError) {
                    this.logger.info(`[GitHub Service] Direct access failed for file: ${filename}`);
                    // Continue to the next filename
                }
            }
            
            // Try some common variations in casing
            const caseSensitiveFilenames = this.generateCaseVariations(possibleFilenames, policyName);
            
            for (const filename of caseSensitiveFilenames) {
                try {
                    this.logger.info(`[GitHub Service] Trying direct access with case variation: ${filename}`);
                    const content = await this.fetchPolicyFileByFilename(filename, isPolicySet);
                    
                    // Verify this is the right policy
                    try {
                        const json = this.safeJsonParse(content);
                        if (json === null) {
                            throw new Error('Failed to parse JSON content');
                        }
                        // Use localeCompare with case-insensitive option
                        if (json.name && typeof json.name === 'string' && 
                            json.name.localeCompare(policyName, undefined, { sensitivity: 'base' }) === 0) {
                            this.logger.info(`[GitHub Service] Successfully found policy with case variation: ${filename}`);
                            return content;
                        } else {
                            this.logger.info(`[GitHub Service] File with case variation ${filename} has different policy name: ${json.name}`);
                        }
                    } catch (parseError) {
                        this.logger.warn(`[GitHub Service] Error parsing JSON from case variation: ${filename}`, parseError);
                    }
                } catch (fetchError) {
                    this.logger.info(`[GitHub Service] Case variation access failed for: ${filename}`);
                    // Continue to the next filename
                }
            }
            
            // If we get here, we couldn't find a match with any of our direct methods
            this.logger.warn(`[GitHub Service] No matching policy found for name: ${policyName} (direct access only)`);
            return null;
        } catch (error: any) {
            this.logger.error(`[GitHub Service] Error finding policy file by name ${policyName}: ${error.message}`, error);
            throw new Error(`Failed to find policy file by name: ${error.message}`);
        }
    }
    
    /**
     * Generate case variations of filenames to try
     * @param baseFilenames The original filenames to generate variations for
     * @param policyName The policy name that may need case variations
     * @returns Array of additional filenames with case variations
     */
    private generateCaseVariations(baseFilenames: string[], policyName: string): string[] {
        const variations: string[] = [];
        
        // Add lowercase, uppercase, and titlecase versions
        const policyNameLower = policyName.toLowerCase();
        const policyNameUpper = policyName.toUpperCase();
        const policyNameTitle = policyName
            .split(/[^a-zA-Z0-9]/)
            .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join('');
        
        if (policyNameLower !== policyName) {
            variations.push(
                `policy_definition_es_${policyNameLower}.json`,
                `policy_set_definition_es_${policyNameLower}.json`,
                `initiative_definition_es_${policyNameLower}.json`,
                `${policyNameLower}.json`
            );
        }
        
        if (policyNameUpper !== policyName) {
            variations.push(
                `policy_definition_es_${policyNameUpper}.json`,
                `policy_set_definition_es_${policyNameUpper}.json`,
                `initiative_definition_es_${policyNameUpper}.json`,
                `${policyNameUpper}.json`
            );
        }
        
        if (policyNameTitle !== policyName && policyNameTitle !== policyNameUpper) {
            variations.push(
                `policy_definition_es_${policyNameTitle}.json`,
                `policy_set_definition_es_${policyNameTitle}.json`, 
                `initiative_definition_es_${policyNameTitle}.json`,
                `${policyNameTitle}.json`
            );
        }
        
        return variations;
    }
    
    /**
     * Get the raw GitHub URL for a policy file
     * @param filename The filename
     * @param isPolicySet Whether it's a policy set definition
     * @returns The raw GitHub URL
     */
    public getRawGitHubUrl(filename: string, isPolicySet: boolean = false): string {
        const path = isPolicySet ? this.POLICY_SET_DEFINITIONS_PATH : this.POLICY_DEFINITIONS_PATH;
        return `https://raw.githubusercontent.com/${this.REPO_OWNER}/${this.REPO_NAME}/${this.BRANCH}/${path}/${filename}`;
    }
    
    /**
     * Fetch content directly from raw GitHub URL (fallback method when API fails)
     * @param filename The filename to fetch
     * @param isPolicySet Whether to fetch from policy set definitions instead of policy definitions
     * @returns Promise resolving to the file content
     */
    public async fetchFromRawGitHub(filename: string, isPolicySet: boolean = false): Promise<string> {
        try {
            const rawUrl = this.getRawGitHubUrl(filename, isPolicySet);
            this.logger.info(`[GitHub Service] Fetching from raw GitHub URL (fallback): ${rawUrl}`);
            
            // Even for raw GitHub URLs, we implement rate limiting and exponential backoff
            try {
                // Use the same rate limiting but with different headers
                const response = await this.makeRateLimitedRequest(rawUrl, false);
                
                this.logger.info(`[GitHub Service] Raw GitHub response status for file ${filename}: ${response.status}`);
                
                if (response.status !== 200) {
                    this.logger.error(`[GitHub Service] Raw GitHub returned non-200 status for file ${filename}: ${response.status} ${response.statusText}`);
                    throw new Error(`Failed to fetch from raw GitHub: ${response.statusText}`);
                }
                
                // Ensure we always return a string
                let content: string;
                if (typeof response.data === 'string') {
                    content = response.data;
                } else if (Buffer.isBuffer(response.data)) {
                    content = response.data.toString('utf-8');
                } else {
                    // Convert to string if it's an object
                    content = typeof response.data === 'object' ? JSON.stringify(response.data) : String(response.data);
                }
                
                this.logger.info(`[GitHub Service] Successfully fetched content from raw GitHub for file ${filename}`);
                return content;
            } catch (axiosError: any) {
                this.handleApiError(axiosError, `fetching raw file ${filename}`);
                throw axiosError;
            }
        } catch (error: any) {
            this.logger.error(`[GitHub Service] Error fetching from raw GitHub for file ${filename}: ${error.message}`, error);
            throw new Error(`Failed to fetch from raw GitHub: ${error.message}`);
        }
    }
    
    /**
     * Make a rate-limited request to GitHub API with caching
     * @param url The URL to request
     * @param isApiRequest Whether this is a GitHub API request (vs. raw GitHub URL)
     * @param attempts The current attempt number (for exponential backoff)
     * @returns Promise resolving to the Axios response
     */
    private async makeRateLimitedRequest(url: string, isApiRequest: boolean = true, attempts: number = 1): Promise<AxiosResponse> {
        // Check if we have a cached response
        const cachedResponse = this.getFromCache(url);
        if (cachedResponse) {
            this.logger.info(`[GitHub Service] Using cached response for: ${url}`);
            return {
                status: 200,
                statusText: 'OK (cached)',
                headers: {},
                config: { headers: axios.defaults.headers } as any,
                data: cachedResponse.data
            } as AxiosResponse;
        }
        
        // Create a request function to be queued
        const requestFn = async (): Promise<AxiosResponse> => {
            // Check if we need to wait for rate limit reset
            const now = Math.floor(Date.now() / 1000);
            if (this.rateLimitRemaining <= 1 && this.rateLimitReset > now) {
                const waitTime = (this.rateLimitReset - now) * 1000 + 1000; // Add 1 second buffer
                this.logger.warn(`[GitHub Service] Rate limit almost exceeded, waiting ${waitTime}ms for reset`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }
            
            // Set up headers based on whether this is an API request or raw GitHub
            const headers: Record<string, string> = {};
            
            if (isApiRequest) {
                headers['Accept'] = 'application/vnd.github.v3+json';
                
                // Add If-None-Match header if we have an ETag for this URL to support 304 responses
                const cachedEntry = this.getCacheEntry(url);
                if (cachedEntry?.etag) {
                    headers['If-None-Match'] = cachedEntry.etag;
                }
            }
            
            try {
                const response = await axios.get(url, { headers });
                
                // Update rate limit info from response headers if this is an API request
                if (isApiRequest && response.headers) {
                    this.updateRateLimitInfo(response.headers);
                }
                
                // Cache the successful response
                this.cacheResponse(url, response);
                
                return response;
            } catch (error: any) {
                if (error.response) {
                    // Update rate limit info even on error responses
                    if (isApiRequest && error.response.headers) {
                        this.updateRateLimitInfo(error.response.headers);
                    }
                    
                    // Handle 304 Not Modified - return cached response
                    if (error.response.status === 304) {
                        const cachedEntry = this.getCacheEntry(url);
                        if (cachedEntry) {
                            this.logger.info(`[GitHub Service] Server returned 304 Not Modified, using cached data for: ${url}`);
                            // Refresh cache timestamp
                            this.touchCache(url);
                            return {
                                status: 200,
                                statusText: 'OK (from cache, validated)',
                                headers: error.response.headers,
                                config: error.response.config,
                                data: cachedEntry.data
                            } as AxiosResponse;
                        }
                    }
                    
                    // Handle rate limiting with exponential backoff
                    const errorMessage = error.response.data?.message;
                    if ((error.response.status === 403 && typeof errorMessage === 'string' && errorMessage.includes('rate limit')) ||
                        error.response.status === 429) {
                        // Get retry-after header or calculate based on rate limit reset
                        let retryAfter = 0;
                        const retryHeader = error.response.headers['retry-after'];
                        
                        if (retryHeader !== undefined) {
                            retryAfter = parseInt(String(retryHeader), 10) * 1000;
                        } else {
                            const resetHeader = error.response.headers['x-ratelimit-reset'];
                            if (resetHeader !== undefined) {
                                const resetTime = parseInt(String(resetHeader), 10) * 1000;
                                retryAfter = Math.max(1000, resetTime - Date.now());
                            } else {
                                // Use exponential backoff if no header guidance
                                retryAfter = Math.min(30000, Math.pow(2, attempts) * 1000);
                            }
                        }
                        
                        this.logger.warn(`[GitHub Service] Rate limited, waiting ${retryAfter}ms before retry ${attempts}`);
                        
                        // Wait for the specified delay
                        await new Promise(resolve => setTimeout(resolve, retryAfter));
                        
                        // Try again with incremented attempt counter (recursively)
                        if (attempts < 5) {  // Maximum 5 retries
                            return this.makeRateLimitedRequest(url, isApiRequest, attempts + 1);
                        }
                    }
                }
                
                // Rethrow the error if we can't handle it
                throw error;
            }
        };
        
        // Queue the request
        return this.enqueueRequest(requestFn);
    }
    
    /**
     * Enqueue a request for rate limiting
     * @param requestFn The request function to enqueue
     * @returns Promise resolving to the request result
     */
    private async enqueueRequest<T>(requestFn: () => Promise<T>): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            // Add the request to the queue
            this.requestQueue.push(async () => {
                try {
                    const result = await requestFn();
                    resolve(result);
                } catch (error) {
                    reject(error);
                }
            });
            
            // Start processing the queue if not already processing
            if (!this.isProcessingQueue) {
                this.processQueue();
            }
        });
    }
    
    /**
     * Process the request queue with controlled concurrency
     */
    private async processQueue() {
        if (this.isProcessingQueue) {
            return;
        }
        
        this.isProcessingQueue = true;
        
        try {
            // Process requests in the queue one at a time
            while (this.requestQueue.length > 0) {
                const request = this.requestQueue.shift();
                if (request) {
                    await request();
                    
                    // Add a small delay between requests to avoid overwhelming the API
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            }
        } finally {
            this.isProcessingQueue = false;
        }
    }
    
    /**
     * Update rate limit information from response headers
     * @param headers The response headers
     */
    private updateRateLimitInfo(headers: RawAxiosResponseHeaders | AxiosResponseHeaders): void {
        // Parse rate limit headers
        const remaining = headers['x-ratelimit-remaining'];
        if (remaining !== undefined) {
            this.rateLimitRemaining = parseInt(String(remaining), 10);
        }
        
        const reset = headers['x-ratelimit-reset'];
        if (reset !== undefined) {
            this.rateLimitReset = parseInt(String(reset), 10);
        }
        
        // Log current rate limit status
        this.logger.debug(`[GitHub Service] Rate limit status: ${this.rateLimitRemaining} requests remaining, resets at ${new Date(this.rateLimitReset * 1000).toISOString()}`);
        
        // Show warning if rate limit is getting low
        if (this.rateLimitRemaining < 10) {
            this.logger.warn(`[GitHub Service] GitHub API rate limit is getting low: ${this.rateLimitRemaining} requests remaining`);
        }
    }
    
    /**
     * Handle API errors and extract rate limit information
     * @param error The API error
     * @param context The context of the operation
     * @returns True if this was a rate limit error, false otherwise
     */
    private handleApiError(error: any, context: string): boolean {
        if (error.response) {
            // Update rate limit info from error response
            if (error.response.headers) {
                this.updateRateLimitInfo(error.response.headers);
            }
            
            // Log detailed error information
            this.logger.error(`[GitHub Service] Error ${context}: ${error.response.status} ${error.response.statusText}`);
            
            // Check if this is a rate limit error
            const errorMessage = error.response.data?.message;
            if ((error.response.status === 403 && typeof errorMessage === 'string' && errorMessage.includes('rate limit')) ||
                error.response.status === 429) {
                this.logger.warn(`[GitHub Service] Rate limit exceeded while ${context}`);
                return true;
            }
        } else if (error.request) {
            this.logger.error(`[GitHub Service] No response received while ${context}`);
        } else {
            this.logger.error(`[GitHub Service] Request error while ${context}: ${error.message}`);
        }
        
        return false;
    }
    
    /**
     * Cache a successful response
     * @param url The request URL
     * @param response The response to cache
     */
    private cacheResponse(url: string, response: AxiosResponse): void {
        if (response.status === 200 && response.data) {
            const entry: CacheEntry = {
                timestamp: Date.now(),
                data: response.data,
            };
            
            // Store ETag if available
            if (response.headers?.etag) {
                entry.etag = response.headers.etag;
            }
            
            this.cache.set(url, entry);
            this.logger.debug(`[GitHub Service] Cached response for: ${url}`);
        }
    }
    
    /**
     * Get a cached response if it exists and is still valid
     * @param url The request URL
     * @returns The cached data or null if not cached or expired
     */
    private getFromCache(url: string): CacheEntry | null {
        const entry = this.getCacheEntry(url);
        if (entry) {
            // If cache is still valid
            if (Date.now() - entry.timestamp < this.CACHE_TTL) {
                return entry;
            } else {
                this.logger.debug(`[GitHub Service] Cache expired for: ${url}`);
            }
        }
        return null;
    }
    
    /**
     * Get a cache entry regardless of its age
     * @param url The request URL
     * @returns The cache entry or null if not cached
     */
    private getCacheEntry(url: string): CacheEntry | null {
        return this.cache.get(url) || null;
    }
    
    /**
     * Update the timestamp for a cached item
     * @param url The request URL
     */
    private touchCache(url: string): void {
        const entry = this.cache.get(url);
        if (entry) {
            entry.timestamp = Date.now();
            this.cache.set(url, entry);
        }
    }

    /**
     * Safely parse JSON content to prevent prototype pollution
     * @param content The JSON content to parse
     * @returns The safely parsed object or null if parsing fails
     */
    private safeJsonParse(content: string): any {
        try {
            // Use a reviver function to create objects without prototype
            return JSON.parse(content, (key, value) => {
                // For objects, create a new object with null prototype
                if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                    const safeObj = Object.create(null);
                    Object.entries(value).forEach(([k, v]) => {
                        // Skip potentially dangerous properties
                        if (k !== '__proto__' && k !== 'constructor' && k !== 'prototype') {
                            safeObj[k] = v;
                        }
                    });
                    return safeObj;
                }
                return value;
            });
        } catch (error) {
            this.logger.error('[GitHub Service] JSON parsing error:', error);
            return null;
        }
    }
}