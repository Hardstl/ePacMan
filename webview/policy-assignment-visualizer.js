// Get the VS Code API
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
            const container = group.querySelector('.assignments-container');
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
    details.innerHTML = `
        <h3>Policy Definition</h3>
        <div>${policyId}</div>
        <h3>Parameters</h3>
        <div class="parameter-list">Loading parameters...</div>
    `;
    
    // Add to card
    card.appendChild(details);
    
    // Request parameters from extension
    const id = card.getAttribute('data-id');
    console.log('Requesting parameters for assignment:', id);
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
            console.log('Received parameters from extension:', message.data.id, message.data.parameters);
            updateParameters(message.data.id, message.data.parameters);
            break;
            
        case 'showError':
            showError(message.data.message);
            break;
    }
});

// Update parameters in expanded details
function updateParameters(id, parameters) {
    const card = document.querySelector(`.assignment-card[data-id="${id}"]`);
    if (!card) {
        console.error(`Card with ID ${id} not found`);
        return;
    }
    
    const parameterList = card.querySelector('.parameter-list');
    if (!parameterList) {
        console.error(`Parameter list not found in card ${id}`);
        return;
    }
    
    if (parameters && Object.keys(parameters).length > 0) {
        console.log(`Found ${Object.keys(parameters).length} parameters for ${id}`);
        
        // Create formatted HTML for better parameter display
        let paramHtml = '';
        
        // Sort parameters by key for easier reading
        const sortedKeys = Object.keys(parameters).sort();
        
        for (const key of sortedKeys) {
            const value = parameters[key];
            paramHtml += `<div class="parameter-item">
                <span class="parameter-name">${key}:</span>
                <span class="parameter-value">${formatParameterValue(value)}</span>
            </div>`;
        }
        
        parameterList.innerHTML = paramHtml;
    } else {
        console.warn(`No parameters found for ${id}`);
        parameterList.textContent = 'No parameters found for this assignment';
    }
}

// Format parameter value for better display
function formatParameterValue(value) {
    if (value === null || value === undefined) {
        return '<span class="null-value">null</span>';
    }
    
    if (Array.isArray(value)) {
        if (value.length === 0) {
            return '[]';
        }
        
        let result = '<div class="array-value">[<br>';
        for (let i = 0; i < value.length; i++) {
            result += `&nbsp;&nbsp;&nbsp;&nbsp;"${value[i]}"${i < value.length - 1 ? ',' : ''}<br>`;
        }
        result += ']</div>';
        return result;
    }
    
    if (typeof value === 'object') {
        // Pretty-print objects with better formatting
        try {
            return JSON.stringify(value, null, 2)
                .replace(/\n/g, '<br>')
                .replace(/\s{2}/g, '&nbsp;&nbsp;');
        } catch (e) {
            console.error('Error stringifying object:', e);
            return String(value);
        }
    }
    
    if (typeof value === 'string') {
        return `"${value}"`;
    }
    
    return value.toString();
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
initVisualizer();