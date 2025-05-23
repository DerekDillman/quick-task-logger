// Initialize variables
let allTasks = [];
let filteredTasks = [];
let categories = new Set();
let companies = new Set();

// Load tasks and settings
chrome.storage.sync.get(['tasks', 'settings'], function(result) {
  allTasks = result.tasks || [];
  const settings = result.settings || {};
  
  // Apply theme
  if (settings.theme) {
    document.body.className = `theme-${settings.theme}`;
  }
  
  // Extract categories and companies from tasks
  allTasks.forEach(task => {
    if (task.category) categories.add(task.category);
    if (task.company) companies.add(task.company);
  });
  
  // Add settings categories
  if (settings.categories) {
    settings.categories.forEach(cat => categories.add(cat));
  }
  
  populateCategoryFilter();
  applyFilters();
  updateStats();
});

// Populate category filter
function populateCategoryFilter() {
  const filterCategory = document.getElementById('filter-category');
  filterCategory.innerHTML = '<option value="">All Categories</option>';
  
  Array.from(categories).sort().forEach(category => {
    const option = document.createElement('option');
    option.value = category;
    option.textContent = category;
    filterCategory.appendChild(option);
  });
}

// Apply filters
function applyFilters() {
  const categoryFilter = document.getElementById('filter-category').value;
  const companyFilter = document.getElementById('filter-company').value.toLowerCase();
  const ticketFilter = document.getElementById('filter-ticket').value.toLowerCase();
  const searchFilter = document.getElementById('filter-search').value.toLowerCase();
  const dateFrom = document.getElementById('filter-date-from').value;
  const dateTo = document.getElementById('filter-date-to').value;
  
  filteredTasks = allTasks.filter(task => {
    // Category filter
    if (categoryFilter && task.category !== categoryFilter) {
      return false;
    }
    
    // Company filter
    if (companyFilter && (!task.company || !task.company.toLowerCase().includes(companyFilter))) {
      return false;
    }
    
    // Ticket filter
    if (ticketFilter && (!task.ticket || !task.ticket.toLowerCase().includes(ticketFilter))) {
      return false;
    }
    
    // Search filter (searches in text, notes, and link)
    if (searchFilter) {
      const searchIn = [
        task.text,
        task.notes || '',
        task.link || ''
      ].join(' ').toLowerCase();
      
      if (!searchIn.includes(searchFilter)) {
        return false;
      }
    }
    
    // Date filters
    const taskDate = new Date(task.timestamp).toISOString().split('T')[0];
    if (dateFrom && taskDate < dateFrom) {
      return false;
    }
    if (dateTo && taskDate > dateTo) {
      return false;
    }
    
    return true;
  });
  
  renderTasks();
  updateStats();
}

// Render filtered tasks
function renderTasks() {
  const container = document.getElementById('task-container');
  
  if (filteredTasks.length === 0) {
    container.innerHTML = '<div class="no-tasks">No tasks found</div>';
    return;
  }
  
  // Group tasks by date
  const tasksByDate = {};
  filteredTasks.forEach(task => {
    const date = new Date(task.timestamp).toLocaleDateString();
    if (!tasksByDate[date]) {
      tasksByDate[date] = [];
    }
    tasksByDate[date].push(task);
  });
  
  // Render grouped tasks
  container.innerHTML = Object.entries(tasksByDate)
    .map(([date, tasks]) => `
      <div class="date-group">
        <h3 class="date-header">${date}</h3>
        <div class="date-tasks">
          ${tasks.map(task => {
            let metadataHtml = '';
            const metadata = [];
            
            if (task.company) metadata.push(`<div class="task-meta-item"><span class="task-meta-label">Company:</span> ${escapeHtml(task.company)}</div>`);
            if (task.ticket) metadata.push(`<div class="task-meta-item"><span class="task-meta-label">Ticket:</span> ${escapeHtml(task.ticket)}</div>`);
            
            if (metadata.length > 0) {
              metadataHtml = `<div class="task-metadata">${metadata.join('')}</div>`;
            }
            
            let notesHtml = '';
            if (task.notes) {
              notesHtml = `<div class="task-notes"><strong>Notes:</strong> ${escapeHtml(task.notes)}</div>`;
            }
            
            let linkHtml = '';
            if (task.link) {
              linkHtml = `<div class="task-link"><strong>Link:</strong> <a href="${escapeHtml(task.link)}" target="_blank">${escapeHtml(task.link)}</a></div>`;
            }
            
            return `
              <div class="task-item">
                <div class="task-header">
                  <span class="task-category">[${task.category || 'Uncategorized'}]</span>
                  <span class="task-time">${new Date(task.timestamp).toLocaleTimeString()}</span>
                </div>
                <div class="task-text">${escapeHtml(task.text)}</div>
                ${metadataHtml}
                ${notesHtml}
                ${linkHtml}
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `).join('');
}

// Update statistics
function updateStats() {
  const now = new Date();
  const today = now.toDateString();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  
  let todayCount = 0;
  let weekCount = 0;
  const uniqueCompanies = new Set();
  
  filteredTasks.forEach(task => {
    const taskDate = new Date(task.timestamp);
    if (taskDate.toDateString() === today) {
      todayCount++;
    }
    if (taskDate >= weekAgo) {
      weekCount++;
    }
    if (task.company) {
      uniqueCompanies.add(task.company);
    }
  });
  
  document.getElementById('total-tasks').textContent = filteredTasks.length;
  document.getElementById('today-tasks').textContent = todayCount;
  document.getElementById('week-tasks').textContent = weekCount;
  document.getElementById('unique-companies').textContent = uniqueCompanies.size;
}

// Escape HTML for security
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Event listeners
document.getElementById('filter-category').addEventListener('change', applyFilters);
document.getElementById('filter-company').addEventListener('input', applyFilters);
document.getElementById('filter-ticket').addEventListener('input', applyFilters);
document.getElementById('filter-search').addEventListener('input', applyFilters);
document.getElementById('filter-date-from').addEventListener('change', applyFilters);
document.getElementById('filter-date-to').addEventListener('change', applyFilters);

document.getElementById('clear-filters').addEventListener('click', () => {
  document.getElementById('filter-category').value = '';
  document.getElementById('filter-company').value = '';
  document.getElementById('filter-ticket').value = '';
  document.getElementById('filter-search').value = '';
  document.getElementById('filter-date-from').value = '';
  document.getElementById('filter-date-to').value = '';
  applyFilters();
});

document.getElementById('back-to-popup').addEventListener('click', () => {
  window.close();
});

document.getElementById('export-all').addEventListener('click', () => {
  const dateRange = document.getElementById('filter-date-from').value || 'all';
  const category = document.getElementById('filter-category').value || 'all';
  
  // Generate CSV
  let csv = 'Date,Time,Category,Task,Company,Ticket,Notes,Link\n';
  filteredTasks.forEach(task => {
    const date = new Date(task.timestamp);
    csv += `"${date.toLocaleDateString()}","${date.toLocaleTimeString()}","${task.category || 'Uncategorized'}","${task.text.replace(/"/g, '""')}","${(task.company || '').replace(/"/g, '""')}","${(task.ticket || '').replace(/"/g, '""')}","${(task.notes || '').replace(/"/g, '""')}","${task.link || ''}"\n`;
  });
  
  // Download
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tasks_export_${dateRange}_${category}_${new Date().toISOString().split('T')[0]}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});
