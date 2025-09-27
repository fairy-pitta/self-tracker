/* global Chart */

async function fetchJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to fetch ${path}: ${res.status}`);
  return res.json();
}

function groupToRows(records) {
  const rows = [];
  for (const [date, items] of Object.entries(records)) {
    for (const item of items) {
      const labels = item.labels || {};
      for (const [metric, value] of Object.entries(labels)) {
        rows.push({ date, url: item.url, metric, value });
      }
    }
  }
  return rows;
}

function uniqueMetrics(rows) {
  return Array.from(new Set(rows.map(r => r.metric)));
}

function filteredMetrics(metrics) {
  return metrics.filter(m => m.toLowerCase() !== 'height' && m.toLowerCase() !== 'age');
}

function datasetForMetric(rows, metric) {
  const filtered = rows.filter(r => r.metric === metric && r.value != null);
  filtered.sort((a, b) => a.date.localeCompare(b.date));
  return {
    labels: filtered.map(r => r.date),
    values: filtered.map(r => r.value),
  };
}

function buildRecordsTable(el, rows, metric) {
  const tbody = el.querySelector('tbody');
  tbody.innerHTML = '';
  const filtered = rows.filter(r => r.metric === metric);
  // Sort by date descending (newest first)
  filtered.sort((a, b) => b.date.localeCompare(a.date));
  for (const r of filtered) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${r.date}</td>
      <td><a href="${r.url}" target="_blank" rel="noopener">Open</a></td>
      <td>${r.metric}</td>
      <td>${r.value ?? '-'}</td>
    `;
    tbody.appendChild(tr);
  }
}

// Metric grouping configuration with icons
const METRIC_GROUPS = {
  'Body Composition': {
    icon: 'scale',
    metrics: ['Weight', 'Body Mass Index', 'Percent Body Fat', 'Body Fat Mass', 'Fat']
  },
  'Body Water & Fluids': {
    icon: 'droplets',
    metrics: ['Body Water', 'Extracellular Fluid', 'Cell Fluid']
  },
  'Muscle & Lean Mass': {
    icon: 'dumbbell',
    metrics: ['Protein', 'Fat FreeMass', 'Soft Lean Mass', 'Skeletal Muscle Mass']
  },
  'Health Measurements': {
    icon: 'activity',
    metrics: ['Score', 'Physiological Age', 'Minerals']
  }
};

// Legacy format for compatibility
const METRIC_GROUPS_LEGACY = {
  'Body Composition': ['Weight', 'Body Mass Index', 'Percent Body Fat', 'Body Fat Mass', 'Fat'],
  'Body Water & Fluids': ['Body Water', 'Extracellular Fluid', 'Cell Fluid'],
  'Muscle & Lean Mass': ['Protein', 'Fat FreeMass', 'Soft Lean Mass', 'Skeletal Muscle Mass'],
  'Health Measurements': ['Score', 'Physiological Age', 'Minerals']
}

let selectedMetrics = [];
let isDualChartMode = false;

function setupSidebar(listEl, metrics, onSelect) {
  listEl.innerHTML = '';
  

  
  // Group metrics
  const groupedMetrics = {};
  const ungrouped = [];
  
  for (const metric of metrics) {
    let grouped = false;
    for (const [groupName, groupData] of Object.entries(METRIC_GROUPS)) {
      if (groupData.metrics.includes(metric)) {
        if (!groupedMetrics[groupName]) {
          groupedMetrics[groupName] = {
            icon: groupData.icon,
            metrics: []
          };
        }
        groupedMetrics[groupName].metrics.push(metric);
        grouped = true;
        break;
      }
    }
    if (!grouped) ungrouped.push(metric);
  }
  
  // Render grouped metrics
  for (const [groupName, groupData] of Object.entries(groupedMetrics)) {
    const groupDiv = document.createElement('div');
    groupDiv.className = 'metric-group';
    
    const groupTitle = document.createElement('div');
    groupTitle.className = 'metric-group-title';
    groupTitle.innerHTML = `<span class="group-icon"><i data-lucide="${groupData.icon}"></i></span><span class="group-name">${groupName}</span>`;
    
    // Initialize Lucide icons after DOM update
    setTimeout(() => {
      if (window.lucide) {
        window.lucide.createIcons();
      }
    }, 0);
    groupDiv.appendChild(groupTitle);
    
    const groupList = document.createElement('ul');
    groupList.className = 'metric-list';
    
    for (const m of groupData.metrics) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'metric-button';
      btn.textContent = m;
      btn.setAttribute('data-metric', m);
      btn.addEventListener('click', () => toggleMetricSelection(m, btn, onSelect));
      li.appendChild(btn);
      groupList.appendChild(li);
    }
    
    groupDiv.appendChild(groupList);
    listEl.appendChild(groupDiv);
  }
  
  // Render ungrouped metrics
  if (ungrouped.length > 0) {
    const groupDiv = document.createElement('div');
    groupDiv.className = 'metric-group';
    
    const groupTitle = document.createElement('div');
    groupTitle.className = 'metric-group-title';
    groupTitle.innerHTML = `<span class="group-icon">📋</span><span class="group-name">Other</span>`;
    groupDiv.appendChild(groupTitle);
    
    const groupList = document.createElement('ul');
    groupList.className = 'metric-list';
    
    for (const m of ungrouped) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'metric-button';
      btn.textContent = m;
      btn.setAttribute('data-metric', m);
      btn.addEventListener('click', () => toggleMetricSelection(m, btn, onSelect));
      li.appendChild(btn);
      groupList.appendChild(li);
    }
    
    groupDiv.appendChild(groupList);
    listEl.appendChild(groupDiv);
  }
  

}

function toggleMetricSelection(metric, button, onSelect) {
  const index = selectedMetrics.indexOf(metric);
  
  if (index > -1) {
    // Remove metric
    selectedMetrics.splice(index, 1);
    button.classList.remove('active');
  } else {
    // Check dual chart mode limit
    if (isDualChartMode && selectedMetrics.length >= 2) {
      // Remove oldest selection
      const oldestMetric = selectedMetrics.shift();
      const oldButton = document.querySelector(`.metric-button[data-metric="${oldestMetric}"]`);
      if (oldButton) oldButton.classList.remove('active');
    } else if (!isDualChartMode && selectedMetrics.length >= 1) {
      // Single chart mode - replace current selection
      const currentMetric = selectedMetrics[0];
      const currentButton = document.querySelector(`.metric-button[data-metric="${currentMetric}"]`);
      if (currentButton) currentButton.classList.remove('active');
      selectedMetrics = [];
    } else if (!isDualChartMode && selectedMetrics.length >= 2) {
      // Single chart mode - prevent selecting more than 1 metric
      return;
    }
    selectedMetrics.push(metric);
    button.classList.add('active');
  }
  
  if (selectedMetrics.length > 0) {
    onSelect(selectedMetrics[0], button);
  }
}



function setActiveButton(btn) {
  document.querySelectorAll('.metric-button').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
}

function updateChartTitle(metric) {
  const titleEl = document.getElementById('chart-title');
  if (!titleEl) return;
  
  // Clear existing content
  titleEl.innerHTML = '';
  
  if (selectedMetrics.length === 1) {
    // Single metric mode
    const titleText = document.createTextNode(`${metric} Trend`);
    const helpButton = document.createElement('button');
    helpButton.className = 'help-icon';
    helpButton.textContent = '?';
    helpButton.setAttribute('aria-label', `Help for ${metric}`);
    helpButton.setAttribute('title', `What does ${metric} mean?`);
    helpButton.onclick = () => showHelpPopover(metric);
    
    titleEl.appendChild(titleText);
    titleEl.appendChild(document.createTextNode(' '));
    titleEl.appendChild(helpButton);
  } else if (selectedMetrics.length === 2) {
    // Dual chart mode
    const [metric1, metric2] = selectedMetrics;
    
    const metric1Text = document.createTextNode(`${metric1} Trend`);
    const helpButton1 = document.createElement('button');
    helpButton1.className = 'help-icon';
    helpButton1.textContent = '?';
    helpButton1.setAttribute('aria-label', `Help for ${metric1}`);
    helpButton1.setAttribute('title', `What does ${metric1} mean?`);
    helpButton1.onclick = () => showHelpPopover(metric1);
    
    const vsText = document.createTextNode(' vs ');
    
    const metric2Text = document.createTextNode(`${metric2} Trend`);
    const helpButton2 = document.createElement('button');
    helpButton2.className = 'help-icon';
    helpButton2.textContent = '?';
    helpButton2.setAttribute('aria-label', `Help for ${metric2}`);
    helpButton2.setAttribute('title', `What does ${metric2} mean?`);
    helpButton2.onclick = () => showHelpPopover(metric2);
    
    // Check if mobile view
    const isMobile = window.innerWidth <= 768;
    
    titleEl.appendChild(metric1Text);
    titleEl.appendChild(document.createTextNode(' '));
    titleEl.appendChild(helpButton1);
    titleEl.appendChild(vsText);
    
    if (isMobile) {
      // Add line break for mobile
      titleEl.appendChild(document.createElement('br'));
    }
    
    titleEl.appendChild(metric2Text);
    titleEl.appendChild(document.createTextNode(' '));
    titleEl.appendChild(helpButton2);
  } else {
    titleEl.textContent = 'Measurement Trend';
  }
}

function updateChart(rows) {
  const canvas = document.getElementById('trend-chart');
  if (!canvas) return;
  
  const ctx = canvas.getContext('2d');
  
  if (window.__chart) {
    window.__chart.destroy();
    window.__chart = null;
  }
  
  if (selectedMetrics.length === 0) {
    return;
  }
  
  const datasets = [];
  const colors = ['#2563eb', '#ef4444']; // Blue and Red
  const yAxes = {};
  
  selectedMetrics.forEach((metric, index) => {
    const data = datasetForMetric(rows, metric);
    const color = colors[index];
    const yAxisId = selectedMetrics.length > 1 ? `y${index}` : 'y';

    // compute suggestedMin with 15% padding
    const values = (data.values || []).map(v => Number(v)).filter(v => !Number.isNaN(v));
    const minV = values.length ? Math.min(...values) : 0;
    const maxV = values.length ? Math.max(...values) : 0;
    const range = maxV - minV;
    const pad = (range === 0 ? (Math.abs(minV) || 1) : range) * 0.15;
    const suggestedMin = minV - pad;
    
    datasets.push({
      label: metric,
      data: data.values,
      borderColor: color,
      backgroundColor: color.replace(')', ', 0.15)').replace('rgb', 'rgba'),
      tension: 0.25,
      pointRadius: 3,
      yAxisID: yAxisId
    });
    
    if (selectedMetrics.length > 1) {
      yAxes[yAxisId] = {
        type: 'linear',
        display: true,
        position: index === 0 ? 'left' : 'right',
        title: {
            display: true,
            text: metric
          },
          ticks: {
            font: {
              size: 14
            },
            padding: 10
          },
        suggestedMin: suggestedMin,
        grid: {
          drawOnChartArea: index === 0,
          color: 'rgba(0,0,0,.06)'
        }
      };
    } else {
      yAxes.y = {
        grid: { color: 'rgba(0,0,0,.06)' },
        suggestedMin: suggestedMin,
        ticks: {
          padding: 10
        }
      };
    }
  });
  
  const labels = datasetForMetric(rows, selectedMetrics[0]).labels;
  
  const chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: {
        padding: {
          bottom: 40
        }
      },
      interaction: {
        mode: 'index',
        intersect: false
      },
      scales: {
        x: { grid: { color: 'rgba(0,0,0,.06)' } },
        ...yAxes
      },
      plugins: {
        title: { display: false },
        legend: {
          display: selectedMetrics.length > 1,
          position: 'top'
        },
        tooltip: {
          mode: 'index',
          intersect: false,
          callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y}` }
        }
      }
    }
  });
  
  window.__chart = chart;
  updateChartTitle(selectedMetrics.join(' vs '));
  return chart;
}

function updateDualChart(metric1, metric2) {
  if (!metric1 || !metric2 || !window.__rows) return;
  
  const dataset1 = datasetForMetric(window.__rows, metric1);
  const dataset2 = datasetForMetric(window.__rows, metric2);
  
  upsertDualChart(dataset1, dataset2, metric1, metric2);
}

function upsertDualChart(dataset1, dataset2, metric1, metric2) {
  const canvas = document.getElementById('trend-chart');
  if (!canvas) return;
  
  const ctx = canvas.getContext('2d');
  
  // Destroy existing chart
  if (window.__chart) {
    window.__chart.destroy();
  }
  
  // Update chart title
  const chartTitle = document.getElementById('chart-title');
  if (chartTitle) {
    chartTitle.textContent = `${metric1} vs ${metric2}`;
  }
  
  // Create dual chart with two y-axes
  window.__chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: dataset1.labels,
      datasets: [
        {
          label: metric1,
          data: dataset1.data,
          borderColor: 'rgb(75, 192, 192)',
          backgroundColor: 'rgba(75, 192, 192, 0.1)',
          yAxisID: 'y'
        },
        {
          label: metric2,
          data: dataset2.data,
          borderColor: 'rgb(255, 99, 132)',
          backgroundColor: 'rgba(255, 99, 132, 0.1)',
          yAxisID: 'y1'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: {
        padding: {
          bottom: 40
        }
      },
      interaction: {
        mode: 'index',
        intersect: false,
      },
      scales: {
        x: {
          display: true,
          title: {
            display: true,
            text: 'Date'
          },
          ticks: {
            font: {
              size: 14
            }
          }
        },
        y: {
          type: 'linear',
          display: true,
          position: 'left',
          title: {
            display: true,
            text: metric1
          },
          ticks: {
            font: {
              size: 14
            },
            padding: 10
          }
        },
        y1: {
          type: 'linear',
          display: true,
          position: 'right',
          title: {
            display: true,
            text: metric2
          },
          grid: {
            drawOnChartArea: false,
          },
          ticks: {
            font: {
              size: 14
            },
            padding: 10
          }
        }
      },
      plugins: {
        legend: {
          display: true,
          position: 'top'
        }
      }
    }
  });
}

// Keep the old function for compatibility
function upsertChart(ctx, data, metric) {
  selectedMetrics = [metric];
  updateChart(window.__rows || []);
}

const METRIC_DESCRIPTIONS = {
  'Weight': {
    description: 'Total body weight measured at the time of the scan.',
    unit: 'kg',
    ranges: { healthy: '18.5-24.9 Body Mass Index range', low: '<18.5 Body Mass Index', high: '>25 Body Mass Index' },
    trend: 'Stable weight within healthy Body Mass Index range is ideal'
  },
  'Body Mass Index': {
    description: 'Body Mass Index calculated from height and weight (weight/height²).',
    unit: 'kg/m²',
    ranges: { healthy: '18.5-24.9', low: '<18.5 (underweight)', high: '>25 (overweight)' },
    trend: 'Lower is better within healthy range'
  },
  'Percent Body Fat': {
    description: 'Percent Body Fat: ratio of fat mass to total body weight.',
    unit: '%',
    ranges: { healthy: 'Men: 10-20%, Women: 16-25%', low: 'Too low can be unhealthy', high: '>25% men, >32% women' },
    trend: 'Lower is generally better within healthy range'
  },
  'Body Fat Mass': {
    description: 'Absolute mass of body fat in the body.',
    unit: 'kg',
    ranges: { healthy: 'Varies by individual', low: 'Essential fat needed', high: 'Excess increases health risks' },
    trend: 'Lower is generally better'
  },
  'Fat': {
    description: 'Fat mass shown in some devices; typically equals Body Fat Mass.',
    unit: 'kg',
    ranges: { healthy: 'Varies by individual', low: 'Essential fat needed', high: 'Excess increases health risks' },
    trend: 'Lower is generally better'
  },
  'Body Water': {
    description: 'Total body water contained in the body, including intracellular and extracellular fluid.',
    unit: 'kg or L',
    ranges: { healthy: '50-65% of body weight', low: 'Dehydration risk', high: 'May indicate fluid retention' },
    trend: 'Stable within healthy range is ideal'
  },
  'Protein': {
    description: 'Estimated protein mass, part of fat-free mass including muscle tissue.',
    unit: 'kg',
    ranges: { healthy: '16-20% of body weight', low: 'Muscle loss concern', high: 'Higher indicates more muscle' },
    trend: 'Higher is generally better'
  },
  'Minerals': {
    description: 'Estimated mineral content, primarily bone mineral density.',
    unit: 'kg',
    ranges: { healthy: '3-5% of body weight', low: 'Bone density concern', high: 'Strong bone structure' },
    trend: 'Higher is generally better'
  },
  'Fat FreeMass': {
    description: 'Fat-free mass equals total weight minus fat mass (muscle, bone, organs, water).',
    unit: 'kg',
    ranges: { healthy: 'Varies by individual', low: 'Muscle loss concern', high: 'More lean mass is better' },
    trend: 'Higher is generally better'
  },
  'Soft Lean Mass': {
    description: 'Lean mass excluding bone mineral content (muscle and organ tissue).',
    unit: 'kg',
    ranges: { healthy: 'Varies by individual', low: 'Muscle loss concern', high: 'More muscle mass is better' },
    trend: 'Higher is generally better'
  },
  'Skeletal Muscle Mass': {
    description: 'Estimated skeletal muscle mass, the voluntary muscles used for movement.',
    unit: 'kg',
    ranges: { healthy: 'Men: >37%, Women: >28% of body weight', low: 'Sarcopenia risk', high: 'Athletic/strong' },
    trend: 'Higher is generally better'
  },
  'Score': {
    description: 'Composite wellness/fitness score defined by the device manufacturer.',
    unit: 'points',
    ranges: { healthy: 'Device-specific scale', low: 'Below average fitness', high: 'Above average fitness' },
    trend: 'Higher is generally better'
  },
  'Physiological Age': {
    description: 'Device-estimated body age compared to chronological age based on body composition.',
    unit: 'years',
    ranges: { healthy: 'Equal to or less than actual age', low: 'Younger than actual age', high: 'Older than actual age' },
    trend: 'Lower (younger) is better'
  },
  'Extracellular Fluid': {
    description: 'Extracellular fluid - water outside of cells, including blood plasma and interstitial fluid.',
    unit: 'kg or L',
    ranges: { healthy: '20% of body weight', low: 'Dehydration', high: 'Fluid retention/edema' },
    trend: 'Stable within healthy range is ideal'
  },
  'Cell Fluid': {
    description: 'Cell fluid (intracellular) or device-specific fluid index measuring water inside cells.',
    unit: 'kg or L',
    ranges: { healthy: '40% of body weight', low: 'Cellular dehydration', high: 'Good cellular hydration' },
    trend: 'Higher within range is generally better'
  }
};

// Page navigation
function setupPageNavigation() {
  const navLinks = document.querySelectorAll('.nav-link');
  const pages = document.querySelectorAll('.page-content');
  
  navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const targetPage = link.dataset.page;
      
      // Update active nav link
      navLinks.forEach(l => l.classList.remove('active'));
      link.classList.add('active');
      
      // Show target page
      pages.forEach(page => {
        page.classList.remove('active');
        if (page.id === `${targetPage}-page`) {
          page.classList.add('active');
        }
      });
    });
  });
}

// Mobile hamburger menu
function setupMobileMenu() {
  const hamburgerMenu = document.getElementById('hamburger-menu');
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.getElementById('mobile-sidebar-overlay');
  
  if (!hamburgerMenu || !sidebar || !overlay) return;
  
  function toggleSidebar() {
    const isActive = sidebar.classList.contains('active');
    
    if (isActive) {
      // Close sidebar
      sidebar.classList.remove('active');
      overlay.classList.remove('active');
      hamburgerMenu.classList.remove('active');
      hamburgerMenu.setAttribute('aria-label', 'メニューを開く');
    } else {
      // Open sidebar
      sidebar.classList.add('active');
      overlay.classList.add('active');
      hamburgerMenu.classList.add('active');
      hamburgerMenu.setAttribute('aria-label', 'メニューを閉じる');
    }
  }
  
  // Hamburger menu click
  hamburgerMenu.addEventListener('click', toggleSidebar);
  
  // Overlay click to close
  overlay.addEventListener('click', toggleSidebar);
  
  // Close sidebar when window is resized to desktop
  window.addEventListener('resize', () => {
    if (window.innerWidth > 768) {
      sidebar.classList.remove('active');
      overlay.classList.remove('active');
      hamburgerMenu.classList.remove('active');
      hamburgerMenu.setAttribute('aria-label', 'メニューを開く');
    }
  });
}

function showHelpPopover(metric) {
  const pop = document.getElementById('help-popover');
  if (!pop) return;
  const info = METRIC_DESCRIPTIONS[metric];
  
  if (!info) {
    pop.innerHTML = `
      <h3>${metric}</h3>
      <p>No description available for this metric.</p>
      <ul>
        <li>Click measurements on the left to change the chart.</li>
        <li>Table below lists raw values per date.</li>
        <li>Values are shown as recorded; units depend on the device.</li>
      </ul>
    `;
  } else {
    pop.innerHTML = `
      <div class="help-header">
        <h3>${metric}</h3>
        <span class="help-unit">(${info.unit})</span>
      </div>
      <div class="help-description">${info.description}</div>
      <div class="help-trend">
        <strong>Trend:</strong> ${info.trend}
      </div>
    `;
  }
  
  // Position in center of screen
  pop.style.position = 'fixed';
  pop.style.top = '50%';
  pop.style.left = '50%';
  pop.style.transform = 'translate(-50%, -50%)';
  pop.style.zIndex = '9999';
  pop.hidden = false;
}

function hideHelpPopover() {
  const pop = document.getElementById('help-popover');
  if (!pop) return;
  pop.hidden = true;
}

async function main() {
  const statusEl = document.getElementById('status');
  const listEl = document.getElementById('metric-list');
  const tableEl = document.getElementById('records-table');
  const chartCanvas = document.getElementById('trend-chart');
  // Setup page navigation
  setupPageNavigation();
  
  // Setup mobile menu
  setupMobileMenu();
  
  // Show overview page by default
  document.getElementById('overview-page').classList.add('active');
  document.querySelector('[data-page="overview"]').classList.add('active');

  try {
    statusEl.textContent = 'Loading data...';
    const data = await fetchJSON('records_mapped.json');
    const rows = groupToRows(data.records || {});
    const allMetrics = uniqueMetrics(rows);
    const metrics = filteredMetrics(allMetrics);

    if (metrics.length === 0) {
      statusEl.textContent = 'No measurements found.';
      return;
    }

    let currentMetric = metrics[0];
    let currentBtn = null;

    window.__rows = rows; // Store rows globally for updateChart
    
    // Setup dual chart toggle
    const dualChartToggle = document.getElementById('dual-chart-mode') || document.getElementById('dual-chart-toggle');
    if (dualChartToggle) {
      dualChartToggle.addEventListener('change', (e) => {
        isDualChartMode = e.target.checked;
        // Clear selections when switching modes
        selectedMetrics = [];
        document.querySelectorAll('.metric-button.active').forEach(btn => {
          btn.classList.remove('active');
        });
        // Clear chart
        const chartTitle = document.getElementById('chart-title');
        if (chartTitle) chartTitle.textContent = 'Measurement Trend';
        if (window.__chart) {
          window.__chart.destroy();
          window.__chart = null;
        }
        // control-info removed
      });
    }

    setupSidebar(listEl, metrics, (metric, btn) => {
       currentMetric = metric;
       
       updateChart(rows);
       buildRecordsTable(tableEl, rows, metric);
     });

    // Initialize with first metric
    const initial = metrics[0];
    const initialBtn = listEl.querySelector('.metric-button');
    currentMetric = initial;
    setActiveButton(initialBtn);
    currentBtn = initialBtn;

    selectedMetrics = [initial];
    updateChart(rows);
    buildRecordsTable(tableEl, rows, initial);
    statusEl.textContent = `Loaded ${metrics.length} measurements.`;
    document.getElementById('last-updated').textContent = new Date().toISOString();

    // Close popover when clicking outside
    document.addEventListener('click', (e) => {
      const pop = document.getElementById('help-popover');
      if (!pop) return;
      const within = pop.contains(e.target) || e.target.classList.contains('help-icon');
      if (!within && !pop.hidden) hideHelpPopover();
    });
    // Reposition on scroll/resize
    window.addEventListener('scroll', () => {
      const pop = document.getElementById('help-popover');
      if (pop && !pop.hidden) {
        // Re-center the popover
        pop.style.position = 'fixed';
        pop.style.top = '50%';
        pop.style.left = '50%';
        pop.style.transform = 'translate(-50%, -50%)';
      }
    });
    window.addEventListener('resize', () => {
      const pop = document.getElementById('help-popover');
      if (pop && !pop.hidden) {
        // Re-center the popover
        pop.style.position = 'fixed';
        pop.style.top = '50%';
        pop.style.left = '50%';
        pop.style.transform = 'translate(-50%, -50%)';
      }
      
      // Update chart title for mobile/desktop layout changes
      if (selectedMetrics.length === 2) {
        updateChartTitle(selectedMetrics[0]);
      }
    });
  } catch (err) {
    console.error(err);
    statusEl.textContent = 'Failed to load data.';
  }
}

window.addEventListener('DOMContentLoaded', main);