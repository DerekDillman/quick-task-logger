// Initialize task list, settings, and theme from storage
let tasks = [];
let settings = {
  historyLimit: 10,
  theme: 'matrix' // Default theme
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
const addTaskBtn = document.getElementById('add-task');
const exportJsonBtn = document.getElementById('export-json');
const exportMdBtn = document.getElementById('export-md');
const taskList = document.getElementById('task-list');

// Add task
const addTask = () => {
  const taskText = taskInput.value.trim();
  if (taskText) {
    const task = {
      text: taskText,
      timestamp: new Date().toISOString()
    };
    tasks.unshift(task);
    saveTasks();
    taskInput.value = '';
    renderTasks();
  }
};

// Click handler
addTaskBtn.addEventListener('click', addTask);

// Enter key handler
taskInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    addTask();
  }
});

// Save tasks to storage
function saveTasks() {
  chrome.storage.sync.set({ tasks: tasks });
}

// Render tasks based on history limit
function renderTasks() {
  const limit = settings.historyLimit;
  const limitedTasks = tasks.slice(0, limit);
  
  taskList.innerHTML = limitedTasks
    .map(task => `
      <div class="task-item">
        <div class="task-text">${task.text}</div>
        <div class="task-time">${new Date(task.timestamp).toLocaleTimeString()}</div>
      </div>
    `)
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
    .map(task => `${new Date(task.timestamp).toLocaleString()} - ${task.text}`)
    .join('\n');
  const filename = getTimestampedFilename('txt');
  downloadFile(filename, txt);
});

// Export to Markdown
exportMdBtn.addEventListener('click', () => {
  const md = tasks
    .map(task => `- ${task.text} (${new Date(task.timestamp).toLocaleString()})`)
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
    alert(`Tasks exported successfully as ${filename}`);
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
});

// Close settings modal
closeModalBtn.addEventListener('click', () => {
  modal.style.display = 'none';
});

// Close modal when clicking outside
window.addEventListener('click', (event) => {
  if (event.target === modal) {
    modal.style.display = 'none';
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

// Update settings UI
function updateSettingsUI() {
  document.getElementById('history-limit').value = settings.historyLimit;
}

// Save settings to storage
function saveSettings() {
  chrome.storage.sync.set({ settings: settings });
}