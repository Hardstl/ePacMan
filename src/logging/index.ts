import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs-extra';
import * as os from 'os';

/**
 * Log levels for the logger
 */
export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3
}

/**
 * Logger class for the extension
 * Implements the singleton pattern to ensure only one instance exists
 */
export class Logger {
    private static instance: Logger;
    private outputChannel: vscode.OutputChannel;
    private logLevel: LogLevel;
    private logToFile: boolean;
    private logFilePath: string;
    
    private constructor() {
        this.outputChannel = vscode.window.createOutputChannel('ePacMan');
        this.logLevel = this.getConfiguredLogLevel();
        this.logToFile = vscode.workspace.getConfiguration('epacman').get('logging.saveToFile', false);
        this.logFilePath = path.join(os.tmpdir(), 'epacman.log');
        
        this.info('Logger initialized');
        
        if (this.logToFile) {
            this.info(`Logging to file: ${this.logFilePath}`);
        }
    }
    
    /**
     * Get the singleton instance of the logger
     */
    public static getInstance(): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }
    
    /**
     * Get the configured log level from the extension settings
     */
    private getConfiguredLogLevel(): LogLevel {
        // Get log level from settings instead of hardcoding DEBUG for development
        const configLevel = vscode.workspace.getConfiguration('epacman').get('logging.level', 'info');
        switch (configLevel.toLowerCase()) {
            case 'debug': return LogLevel.DEBUG;
            case 'info': return LogLevel.INFO;
            case 'warn': return LogLevel.WARN;
            case 'error': return LogLevel.ERROR;
            default: return LogLevel.INFO;
        }
    }
    
    /**
     * Log a debug message
     * @param message The message to log
     * @param data Optional data to include in the log
     */
    public debug(message: string, data?: any): void {
        if (this.logLevel <= LogLevel.DEBUG) {
            this.log(LogLevel.DEBUG, message, data);
        }
    }
    
    /**
     * Log an info message
     * @param message The message to log
     * @param data Optional data to include in the log
     */
    public info(message: string, data?: any): void {
        if (this.logLevel <= LogLevel.INFO) {
            this.log(LogLevel.INFO, message, data);
        }
    }
    
    /**
     * Log a warning message
     * @param message The message to log
     * @param data Optional data to include in the log
     */
    public warn(message: string, data?: any): void {
        if (this.logLevel <= LogLevel.WARN) {
            this.log(LogLevel.WARN, message, data);
        }
    }
    
    /**
     * Log an error message
     * @param message The message to log
     * @param error Optional error to include in the log
     */
    public error(message: string, error?: any): void {
        if (this.logLevel <= LogLevel.ERROR) {
            this.log(LogLevel.ERROR, message, error);
            
            // Log stack trace if available
            if (error && error.stack) {
                this.outputChannel.appendLine(`Stack Trace: ${error.stack}`);
                
                if (this.logToFile) {
                    this.appendToLogFile(`Stack Trace: ${error.stack}`);
                }
            }
        }
    }
    
    /**
     * Log a message that contains sensitive data (like tokens, IDs, etc.)
     * Only logs at debug level and masks the sensitive data
     * @param message The message to log
     * @param sensitiveData The sensitive data to mask in the log
     */
    public sensitive(message: string, sensitiveData?: any): void {
        // Only log sensitive data at debug level
        if (this.logLevel <= LogLevel.DEBUG) {
            const safeMessage = this.maskSensitiveData(message);
            
            // Handle sensitive data object if provided
            let safeData: any = undefined;
            if (sensitiveData) {
                if (typeof sensitiveData === 'object') {
                    // Create a sanitized copy of the object
                    safeData = this.sanitizeObject(sensitiveData);
                } else if (typeof sensitiveData === 'string') {
                    // Mask string data
                    safeData = this.maskString(sensitiveData);
                } else {
                    // For other types, convert to string and mask
                    safeData = `[Sensitive data (${typeof sensitiveData})]`;
                }
            }
            
            this.log(LogLevel.DEBUG, safeMessage, safeData);
        }
    }
    
    /**
     * Utility to mask sensitive data in a string
     * @param input The string that might contain sensitive data
     * @returns The masked string
     */
    private maskSensitiveData(input: string): string {
        if (!input) {
            return input;
        }
        
        // Mask GUIDs/UUIDs (commonly used for IDs in Azure)
        const guidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
        input = input.replace(guidRegex, (match) => this.maskString(match));
        
        // Mask subscription IDs
        const subIdRegex = /subscription\/([^\/]+)/gi;
        input = input.replace(subIdRegex, (match, group) => `subscription/${this.maskString(group)}`);
        
        // Mask tenant IDs
        const tenantIdRegex = /tenant\/([^\/]+)/gi;
        input = input.replace(tenantIdRegex, (match, group) => `tenant/${this.maskString(group)}`);
        
        return input;
    }
    
    /**
     * Utility to sanitize an object by masking its sensitive properties
     * @param obj The object to sanitize
     * @returns A sanitized copy of the object
     */
    private sanitizeObject(obj: any): any {
        if (!obj) {
            return obj;
        }
        
        // List of property names that might contain sensitive data
        const sensitiveProps = [
            'token', 'key', 'secret', 'password', 'credential', 'auth',
            'subscription', 'subscriptionId', 'tenant', 'tenantId', 'id'
        ];
        
        try {
            // Create a deep copy
            const copy = JSON.parse(JSON.stringify(obj));
            
            // Process the copy recursively
            const sanitize = (object: any) => {
                if (!object || typeof object !== 'object') {
                    return;
                }
                
                Object.keys(object).forEach(key => {
                    // Check if this property should be masked
                    const shouldMask = sensitiveProps.some(prop => 
                        key.toLowerCase().includes(prop.toLowerCase()));
                    
                    if (shouldMask && typeof object[key] === 'string') {
                        // Mask the value
                        object[key] = this.maskString(object[key]);
                    } else if (object[key] && typeof object[key] === 'object') {
                        // Recurse into nested objects
                        sanitize(object[key]);
                    }
                });
            };
            
            sanitize(copy);
            return copy;
        } catch (error) {
            // If something goes wrong, return a placeholder
            return { sanitized: "[Object contained sensitive data]" };
        }
    }
    
    /**
     * Utility to mask a string for logging purposes
     * @param str The string to mask
     * @returns The masked string
     */
    private maskString(str: string): string {
        if (!str || typeof str !== 'string') {
            return '***';
        }
        
        if (str.length < 8) {
            return '***';
        }
        
        const firstChars = str.substring(0, 3);
        const lastChars = str.substring(str.length - 3);
        return `${firstChars}...${lastChars}`;
    }
    
    /**
     * Log a message at the specified level
     * @param level The log level
     * @param message The message to log
     * @param data Optional data to include in the log
     */
    private log(level: LogLevel, message: string, data?: any): void {
        const timestamp = new Date().toISOString();
        const levelString = LogLevel[level];
        let logMessage = `[${timestamp}] [${levelString}] ${message}`;
        
        // Add data if provided
        if (data) {
            if (typeof data === 'object') {
                try {
                    logMessage += ` - ${JSON.stringify(data)}`;
                } catch (error) {
                    logMessage += ` - [Object]`;
                }
            } else {
                logMessage += ` - ${data}`;
            }
        }
        
        // Log to output channel
        this.outputChannel.appendLine(logMessage);
        
        // Log to file if enabled
        if (this.logToFile) {
            this.appendToLogFile(logMessage);
        }
    }
    
    /**
     * Append a message to the log file
     * @param message The message to append
     */
    private appendToLogFile(message: string): void {
        try {
            fs.appendFileSync(this.logFilePath, message + '\n');
        } catch (error: any) {
            // Log to output channel only to avoid infinite recursion
            this.outputChannel.appendLine(`[ERROR] Failed to write to log file: ${error.message}`);
        }
    }
    
    /**
     * Show the output channel
     */
    public show(): void {
        this.outputChannel.show();
    }
    
    /**
     * Dispose the output channel
     */
    public dispose(): void {
        this.outputChannel.dispose();
    }
    
    /**
     * Set the log level
     * @param level The new log level
     */
    public setLogLevel(level: LogLevel): void {
        this.logLevel = level;
        this.info(`Log level set to ${LogLevel[level]}`);
    }
    
    /**
     * Set whether to log to a file
     * @param enable Whether to enable file logging
     * @param filePath Optional custom file path
     */
    public setLogToFile(enable: boolean, filePath?: string): void {
        this.logToFile = enable;
        
        if (filePath) {
            this.logFilePath = filePath;
        }
        
        if (enable) {
            this.info(`File logging enabled, writing to: ${this.logFilePath}`);
        } else {
            this.info('File logging disabled');
        }
    }
}