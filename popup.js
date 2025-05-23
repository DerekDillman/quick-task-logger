// Initialize task list, settings, and theme from storage
let tasks = [];
let settings = {
  historyLimit: 10,
  theme: 'matrix',
  quickLinks: [
    { name: 'GitHub', url: 'https://github.com' },
    { name: 'Office 365', url: 'https://office.com' },
    { name: 'Service Desk', url: 'https://servicedesk.example.com' }
  ],
  categories: ["Break/Fix", "Administration", "Network", "Maintenance", "Support", "Security", "Project", "Meeting", "Documentation"]
};

// Theme classes
const themes = {
  light: 'theme-light',
  dark: 'theme-dark',
  matrix: 'theme-matrix'
};

// Load saved tasks, settings, and theme
chrome.storage.sync.get(['tasks', 'settings'], function(result) {
  tasks = result.tasks || [];
  settings = {...settings, ...(result.settings || {})};
  
  // Apply saved theme
  applyTheme(settings.theme || 'matrix');
  
  // Set theme radio button
  document.querySelector(`input[name="theme"][value="${settings.theme || 'matrix'}"]`).checked = true;
  
  renderTasks();
  renderCategories();
  renderQuickLinks();
  updateSettingsUI();
});

// Theme switching
document.querySelectorAll('input[name="theme"]').forEach(radio => {
  radio.addEventListener('change', (e) => {
    const theme = e.target.value;
    settings.theme = theme;
    saveSettings();
    applyTheme(theme);
  });
});

// Apply theme to body
function applyTheme(theme) {
  // Remove all theme classes
  Object.values(themes).forEach(themeClass => {
    document.body.classList.remove(themeClass);
  });
  
  // Add current theme class
  document.body.classList.add(themes[theme]);
}

// DOM Elements
const taskInput = document.getElementById('task-input');
const companyInput = document.getElementById('company-input');
const ticketInput = document.getElementById('ticket-input');
const notesInput = document.getElementById('notes-input');
const linkInput = document.getElementById('link-input');
const quickLinksSelect = document.getElementById('quick-links');
const addTaskBtn = document.getElementById('add-task');
const exportJsonBtn = document.getElementById('export-json');
const exportMdBtn = document.getElementById('export-md');
const taskList = document.getElementById('task-list');
const categorySelect = document.getElementById('category-select');

// Quick links dropdown
quickLinksSelect.addEventListener('change', (e) => {
  if (e.target.value) {
    linkInput.value = e.target.value;
    quickLinksSelect.value = '';
  }
});

// Add task
const addTask = () => {
  const text = taskInput.value.trim();
  
  if (text) {
    const task = {
      text: text,
      category: categorySelect.value,
      timestamp: new Date().toISOString(),
      company: companyInput.value.trim(),
      ticket: ticketInput.value.trim(),
      notes: notesInput.value.trim(),
      link: linkInput.value.trim()
    };
    
    tasks.unshift(task);
    saveTasks();
    
    // Clear inputs
    taskInput.value = '';
    companyInput.value = '';
    ticketInput.value = '';
    notesInput.value = '';
    linkInput.value = '';
    
    renderTasks();
  }
};

// Click handler
addTaskBtn.addEventListener('click', addTask);

// Enter key handler for main task input
taskInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    addTask();
  }
});

// Save tasks to storage
function saveTasks() {
  chrome.storage.sync.set({ tasks: tasks });
}

// Save settings to storage
function saveSettings() {
  chrome.storage.sync.set({ settings: settings });
}

// Render categories dropdown
function renderCategories() {
  categorySelect.innerHTML = settings.categories
    .map(cat => `<option value="${cat}">${cat}</option>`)
    .join('');
}

// Render quick links dropdown
function renderQuickLinks() {
  quickLinksSelect.innerHTML = '<option value="">Quick Links</option>' +
    settings.quickLinks
      .map(link => `<option value="${link.url}">${link.name}</option>`)
      .join('');
  
  renderQuickLinksSettings();
}

// Render quick links in settings
function renderQuickLinksSettings() {
  const container = document.getElementById('quick-links-list');
  if (!container) return;
  
  container.innerHTML = settings.quickLinks
    .map((link, index) => `
      <div class="quick-link-item">
        <span>${link.name}: ${link.url}</span>
        <button onclick="removeQuickLink(${index})">Remove</button>
      </div>
    `)
    .join('');
}

// Remove quick link
window.removeQuickLink = function(index) {
  settings.quickLinks.splice(index, 1);
  saveSettings();
  renderQuickLinks();
};

// Add quick link
document.getElementById('add-quick-link').addEventListener('click', () => {
  const name = document.getElementById('new-link-name').value.trim();
  const url = document.getElementById('new-link-url').value.trim();
  
  if (name && url) {
    settings.quickLinks.push({ name, url });
    saveSettings();
    renderQuickLinks();
    
    // Clear inputs
    document.getElementById('new-link-name').value = '';
    document.getElementById('new-link-url').value = '';
  }
});

// Render tasks based on history limit
function renderTasks() {
  const limit = settings.historyLimit;
  const limitedTasks = tasks.slice(0, limit);
  
  taskList.innerHTML = limitedTasks
    .map(task => {
      let metaInfo = [];
      if (task.company) metaInfo.push(`Company: ${task.company}`);
      if (task.ticket) metaInfo.push(`Ticket: ${task.ticket}`);
      
      return `
        <div class="task-item">
          <div class="task-header">
            <span class="task-category">[${task.category || 'Uncategorized'}]</span>
            <span class="task-time">${new Date(task.timestamp).toLocaleTimeString()}</span>
          </div>
          <div class="task-text">${task.text}</div>
          ${metaInfo.length > 0 ? `<div class="task-meta">${metaInfo.join(' • ')}</div>` : ''}
        </div>
      `;
    })
    .join('');
}

// History limit handler
document.getElementById('history-limit').addEventListener('change', (e) => {
  const limit = Math.min(Math.max(1, e.target.value), 50);
  settings.historyLimit = limit;
  saveSettings();
  renderTasks();
});

// Generate timestamped filename
function getTimestampedFilename(extension) {
  const now = new Date();
  const date = now.toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-');
  const time = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }).replace(/:/g, '');
  return `task_${date}_${time}.${extension}`;
}

// Export to TXT
exportJsonBtn.addEventListener('click', () => {
  const txt = tasks
    .map(task => {
      let line = `${new Date(task.timestamp).toLocaleString()} - [${task.category || 'Uncategorized'}] ${task.text}`;
      if (task.company) line += ` | Company: ${task.company}`;
      if (task.ticket) line += ` | Ticket: ${task.ticket}`;
      if (task.notes) line += `\n  Notes: ${task.notes}`;
      if (task.link) line += `\n  Link: ${task.link}`;
      return line;
    })
    .join('\n\n');
  const filename = getTimestampedFilename('txt');
  downloadFile(filename, txt);
});

// Export to Markdown
exportMdBtn.addEventListener('click', () => {
  const md = `# Task Log - ${new Date().toLocaleDateString()}\n\n` +
    tasks
      .map(task => {
        let md = `- **[${task.category || 'Uncategorized'}]** ${task.text} *(${new Date(task.timestamp).toLocaleString()})*`;
        if (task.company || task.ticket) {
          md += '\n  - ';
          if (task.company) md += `Company: ${task.company} `;
          if (task.ticket) md += `Ticket: ${task.ticket}`;
        }
        if (task.notes) md += `\n  - Notes: ${task.notes}`;
        if (task.link) md += `\n  - Link: [${task.link}](${task.link})`;
        return md;
      })
      .join('\n');
  const filename = getTimestampedFilename('md');
  downloadFile(filename, md);
});

// Helper function to download files
function downloadFile(filename, content) {
  try {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    // Create temporary status message
    const status = document.createElement('div');
    status.className = 'export-status';
    status.textContent = `Exported: ${filename}`;
    document.body.appendChild(status);
    setTimeout(() => status.remove(), 3000);
  } catch (error) {
    console.error('Error exporting file:', error);
    alert('Error exporting tasks. Please try again.');
  }
}

// Modal functionality
const modal = document.getElementById('settings-modal');
const openSettingsBtn = document.getElementById('open-settings');
const closeModalBtn = document.querySelector('.close-modal');

// Open settings modal
openSettingsBtn.addEventListener('click', () => {
  modal.style.display = 'block';
  modal.setAttribute('aria-hidden', 'false');
});

// Close settings modal
closeModalBtn.addEventListener('click', () => {
  modal.style.display = 'none';
  modal.setAttribute('aria-hidden', 'true');
});

// Close modal when clicking outside
window.addEventListener('click', (event) => {
  if (event.target === modal) {
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
  }
});

// Clear storage handler
document.getElementById('clear-storage').addEventListener('click', () => {
  if (confirm('Are you sure you want to clear all tasks?')) {
    tasks = [];
    saveTasks();
    renderTasks();
  }
});

// View all tasks handler
document.getElementById('view-all-tasks').addEventListener('click', () => {
  chrome.tabs.create({ url: 'tasks.html' });
});

// Update settings UI
function updateSettingsUI() {
  document.getElementById('history-limit').value = settings.historyLimit;
}
