This directory contains the Policy Assignment Visualization component.

Implemented in Phase 3, this directory includes:

1. WebView panel implementation (webview-panel.ts)
   - Creates and manages the VSCode WebView panel
   - Loads HTML, CSS, and JavaScript resources
   - Handles messages between the extension and the WebView
   - Responds to panel lifecycle events

2. Policy assignment parser (policy-assignment-parser.ts)
   - Finds policy assignment files in the workspace
   - Parses JSON content
   - Extracts relevant information
   - Resolves references to policy definitions

3. Visualization engine (visualization-engine.ts)
   - Organizes assignments by scope
   - Formats assignment data for display
   - Generates HTML for the visualization
   - Applies styling based on assignment properties

4. Interactive elements (interactive-elements.ts)
   - Handles click events
   - Implements navigation controls
   - Provides context menus
   - Responds to user actions

5. Main visualizer class (index.ts)
   - Coordinates the visualization process
   - Integrates all components
   - Provides the main entry point for the visualizer

The Policy Assignment Visualization component provides a visual representation of Azure Policy assignments, displaying them grouped by scope with validation status indicators, making it easier for users to understand and manage their policy assignments.