/* ===== WEBCITY RO ADMIN DASHBOARD ===== */

// API base — works locally and after deploy
var API = 'port/5000'.startsWith('__') ? 'http://localhost:5000' : 'port/5000';

// ===== STATE =====
var currentPage = 'dashboard';
var currentMessageId = null;
var editingPortfolioId = null;
var authToken = null;

// ===== UTILS =====
function showToast(msg, type) {
  var toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = 'toast' + (type ? ' ' + type : '');
  toast.style.display = 'block';
  setTimeout(function() { toast.style.display = 'none'; }, 3000);
}

function formatDate(dateStr) {
  var d = new Date(dateStr + (dateStr.indexOf('T') === -1 ? ' UTC' : ''));
  return d.toLocaleDateString('ro-RO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, function(c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

// ===== API CALLS =====
function apiCall(method, path, body) {
  var opts = {
    method: method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (authToken) {
    opts.headers['Authorization'] = 'Bearer ' + authToken;
  }
  if (body) opts.body = JSON.stringify(body);
  return fetch(API + path, opts).then(function(r) {
    if (r.status === 401) {
      showLogin();
      throw new Error('Neautentificat');
    }
    return r.json().then(function(data) {
      if (!r.ok) throw new Error(data.error || 'Eroare');
      return data;
    });
  });
}

// ===== AUTH =====
function checkAuth() {
  if (!authToken) return Promise.resolve(false);
  return fetch(API + '/api/admin/auth', {
    headers: { 'Authorization': 'Bearer ' + authToken },
  }).then(function(r) { return r.json(); })
    .then(function(data) { return data.authenticated; })
    .catch(function() { return false; });
}

function showLogin() {
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('dashboard').style.display = 'none';
}

function showDashboard() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('dashboard').style.display = 'flex';
  navigateTo(currentPage);
}

function login(password) {
  return fetch(API + '/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: password }),
  }).then(function(r) { return r.json(); });
}

function logout() {
  apiCall('POST', '/api/admin/logout').then(function() {
    authToken = null;
    showLogin();
    document.getElementById('loginPassword').value = '';
  }).catch(function() {
    authToken = null;
    showLogin();
  });
}

// ===== ROUTING =====
function navigateTo(page) {
  currentPage = page;
  document.querySelectorAll('.page').forEach(function(p) { p.style.display = 'none'; });
  document.getElementById('page-' + page).style.display = 'block';

  document.querySelectorAll('.nav-item').forEach(function(n) { n.classList.remove('active'); });
  var navItem = document.querySelector('.nav-item[data-page="' + page + '"]');
  if (navItem) navItem.classList.add('active');

  // Close sidebar on mobile
  document.getElementById('sidebar').classList.remove('open');

  // Load page data
  if (page === 'dashboard') loadDashboard();
  else if (page === 'messages') loadMessages();
  else if (page === 'portfolio') loadPortfolio();
}

function handleHashChange() {
  var hash = window.location.hash.replace('#/', '').replace('#', '');
  var page = hash || 'dashboard';
  if (['dashboard', 'messages', 'portfolio', 'settings'].indexOf(page) === -1) page = 'dashboard';
  navigateTo(page);
}

// ===== DASHBOARD PAGE =====
function loadDashboard() {
  // Set current date
  var now = new Date();
  document.getElementById('currentDate').textContent = now.toLocaleDateString('ro-RO', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });

  apiCall('GET', '/api/admin/stats').then(function(data) {
    document.getElementById('statTotal').textContent = data.total_messages;
    document.getElementById('statUnread').textContent = data.unread_messages;
    document.getElementById('statPortfolio').textContent = data.portfolio_count;

    // Update unread badge
    var badge = document.getElementById('unreadBadge');
    if (data.unread_messages > 0) {
      badge.style.display = 'inline-block';
      badge.textContent = data.unread_messages;
    } else {
      badge.style.display = 'none';
    }

    // Recent messages
    var tbody = document.getElementById('recentMessagesBody');
    if (data.recent_messages.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="table-empty">Nu există mesaje</td></tr>';
    } else {
      tbody.innerHTML = data.recent_messages.map(function(m) {
        return '<tr onclick="openMessageDetail(' + m.id + ')">' +
          '<td><strong>' + escapeHtml(m.name) + '</strong></td>' +
          '<td>' + escapeHtml(m.email) + '</td>' +
          '<td>' + escapeHtml(m.service || '—') + '</td>' +
          '<td>' + formatDate(m.created_at) + '</td>' +
          '<td><span class="status-badge ' + (m.is_read ? 'status-read' : 'status-unread') + '">' +
            (m.is_read ? 'Citit' : 'Nou') + '</span></td>' +
          '</tr>';
      }).join('');
    }
  }).catch(function(err) {
    showToast('Eroare la încărcarea datelor', 'error');
  });
}

// ===== MESSAGES PAGE =====
function loadMessages() {
  apiCall('GET', '/api/admin/messages').then(function(data) {
    var tbody = document.getElementById('messagesBody');
    if (data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="table-empty">Nu există mesaje</td></tr>';
    } else {
      tbody.innerHTML = data.map(function(m) {
        return '<tr onclick="openMessageDetail(' + m.id + ')">' +
          '<td><strong>' + escapeHtml(m.name) + '</strong></td>' +
          '<td>' + escapeHtml(m.email) + '</td>' +
          '<td>' + escapeHtml(m.company || '—') + '</td>' +
          '<td>' + escapeHtml(m.service || '—') + '</td>' +
          '<td>' + formatDate(m.created_at) + '</td>' +
          '<td><span class="status-badge ' + (m.is_read ? 'status-read' : 'status-unread') + '">' +
            (m.is_read ? 'Citit' : 'Nou') + '</span></td>' +
          '<td onclick="event.stopPropagation()">' +
            '<button class="btn-outline" style="padding:4px 10px;font-size:12px;" onclick="openMessageDetail(' + m.id + ')">Vezi</button>' +
          '</td>' +
          '</tr>';
      }).join('');
    }
  }).catch(function(err) {
    showToast('Eroare la încărcarea mesajelor', 'error');
  });
}

function openMessageDetail(id) {
  currentMessageId = id;
  apiCall('GET', '/api/admin/messages').then(function(data) {
    var msg = data.find(function(m) { return m.id === id; });
    if (!msg) return;

    // Mark as read automatically
    if (!msg.is_read) {
      apiCall('PATCH', '/api/admin/messages/' + id, { is_read: 1 }).then(function() {
        loadDashboard();
        loadMessages();
      });
    }

    var detail = document.getElementById('messageDetail');
    detail.innerHTML =
      '<div class="detail-row"><span class="detail-label">Nume:</span><span class="detail-value"><strong>' + escapeHtml(msg.name) + '</strong></span></div>' +
      '<div class="detail-row"><span class="detail-label">Email:</span><span class="detail-value"><a href="mailto:' + escapeHtml(msg.email) + '">' + escapeHtml(msg.email) + '</a></span></div>' +
      '<div class="detail-row"><span class="detail-label">Companie:</span><span class="detail-value">' + escapeHtml(msg.company || '—') + '</span></div>' +
      '<div class="detail-row"><span class="detail-label">Serviciu:</span><span class="detail-value">' + escapeHtml(msg.service || '—') + '</span></div>' +
      '<div class="detail-row"><span class="detail-label">Data:</span><span class="detail-value">' + formatDate(msg.created_at) + '</span></div>' +
      '<div class="detail-row"><span class="detail-label">Status:</span><span class="detail-value"><span class="status-badge ' + (msg.is_read ? 'status-read' : 'status-unread') + '">' + (msg.is_read ? 'Citit' : 'Nou') + '</span></span></div>' +
      '<div class="detail-row" style="flex-direction:column;"><span class="detail-label">Mesaj:</span><div class="detail-message">' + escapeHtml(msg.message) + '</div></div>';

    // Update toggle button
    var toggleBtn = document.getElementById('toggleReadBtn');
    toggleBtn.textContent = msg.is_read ? 'Marchează ca necitit' : 'Marchează ca citit';

    document.getElementById('messageModal').style.display = 'flex';
  }).catch(function() {
    showToast('Eroare la încărcarea mesajului', 'error');
  });
}

function closeMessageModal() {
  document.getElementById('messageModal').style.display = 'none';
  currentMessageId = null;
}

function toggleMessageRead() {
  if (!currentMessageId) return;
  apiCall('GET', '/api/admin/messages').then(function(data) {
    var msg = data.find(function(m) { return m.id === currentMessageId; });
    if (!msg) return;
    var newRead = msg.is_read ? 0 : 1;
    apiCall('PATCH', '/api/admin/messages/' + currentMessageId, { is_read: newRead }).then(function() {
      showToast(newRead ? 'Marchează ca citit' : 'Marchează ca necitit', 'success');
      closeMessageModal();
      loadDashboard();
      loadMessages();
    });
  });
}

function deleteMessage() {
  if (!currentMessageId) return;
  if (!confirm('Ești sigur că vrei să ștergi acest mesaj?')) return;
  apiCall('DELETE', '/api/admin/messages/' + currentMessageId).then(function() {
    showToast('Mesaj șters', 'success');
    closeMessageModal();
    loadDashboard();
    loadMessages();
  }).catch(function() {
    showToast('Eroare la ștergere', 'error');
  });
}

// ===== PORTFOLIO PAGE =====
function loadPortfolio() {
  apiCall('GET', '/api/admin/portfolio').then(function(data) {
    var grid = document.getElementById('portfolioGrid');
    if (data.length === 0) {
      grid.innerHTML = '<div class="table-empty">Nu există proiecte. Apasă "Adaugă proiect" pentru a crea.</div>';
    } else {
      grid.innerHTML = data.map(function(item) {
        var img = (item.image_url || '../assets/portfolio-1.png').replace(/^\/assets\//, '../assets/');
        return '<div class="portfolio-card">' +
          '<img src="' + escapeHtml(img) + '" alt="' + escapeHtml(item.title) + '" class="portfolio-card-img" onerror="this.src=\'../assets/portfolio-1.png\'">' +
          '<div class="portfolio-card-body">' +
            '<div class="portfolio-card-cat">' + escapeHtml(item.category) + '</div>' +
            '<div class="portfolio-card-title">' + escapeHtml(item.title) + '</div>' +
            '<div class="portfolio-card-client">' + escapeHtml(item.client || '') + (item.year ? ' • ' + item.year : '') + '</div>' +
          '</div>' +
          '<div class="portfolio-card-actions">' +
            '<button class="btn-edit" onclick="editPortfolio(' + item.id + ')">Editează</button>' +
            '<button class="btn-delete" onclick="deletePortfolio(' + item.id + ')">Șterge</button>' +
          '</div>' +
        '</div>';
      }).join('');
    }
  }).catch(function() {
    showToast('Eroare la încărcarea portofoliului', 'error');
  });
}

function openAddPortfolio() {
  editingPortfolioId = null;
  document.getElementById('portfolioModalTitle').textContent = 'Adaugă proiect';
  document.getElementById('portfolioForm').reset();
  document.getElementById('portfolioId').value = '';
  document.getElementById('pfYear').value = new Date().getFullYear();
  document.getElementById('portfolioModal').style.display = 'flex';
}

function editPortfolio(id) {
  editingPortfolioId = id;
  apiCall('GET', '/api/admin/portfolio').then(function(data) {
    var item = data.find(function(p) { return p.id === id; });
    if (!item) return;

    document.getElementById('portfolioModalTitle').textContent = 'Editează proiect';
    document.getElementById('portfolioId').value = item.id;
    document.getElementById('pfTitle').value = item.title || '';
    document.getElementById('pfCategory').value = item.category || '';
    document.getElementById('pfDescription').value = item.description || '';
    document.getElementById('pfClient').value = item.client || '';
    document.getElementById('pfYear').value = item.year || '';
    document.getElementById('pfImageUrl').value = item.image_url || '';
    document.getElementById('pfProjectUrl').value = item.project_url || '';
    document.getElementById('pfTags').value = (item.tags || []).join(',');
    document.getElementById('portfolioModal').style.display = 'flex';
  });
}

function closePortfolioModal() {
  document.getElementById('portfolioModal').style.display = 'none';
  editingPortfolioId = null;
}

function savePortfolio() {
  var id = document.getElementById('portfolioId').value;
  var tagsStr = document.getElementById('pfTags').value;
  var data = {
    title: document.getElementById('pfTitle').value,
    category: document.getElementById('pfCategory').value,
    description: document.getElementById('pfDescription').value,
    client: document.getElementById('pfClient').value,
    year: parseInt(document.getElementById('pfYear').value) || null,
    image_url: document.getElementById('pfImageUrl').value,
    project_url: document.getElementById('pfProjectUrl').value,
    tags: tagsStr ? tagsStr.split(',').map(function(t) { return t.trim(); }).filter(Boolean) : [],
    sort_order: 0,
  };

  if (!data.title || !data.category) {
    showToast('Titlul și categoria sunt obligatorii', 'error');
    return;
  }

  var method = id ? 'PUT' : 'POST';
  var path = id ? '/api/admin/portfolio/' + id : '/api/admin/portfolio';

  apiCall(method, path, data).then(function() {
    showToast(id ? 'Proiect actualizat' : 'Proiect adăugat', 'success');
    closePortfolioModal();
    loadPortfolio();
    loadDashboard();
  }).catch(function() {
    showToast('Eroare la salvare', 'error');
  });
}

function deletePortfolio(id) {
  if (!confirm('Ești sigur că vrei să ștergi acest proiect?')) return;
  apiCall('DELETE', '/api/admin/portfolio/' + id).then(function() {
    showToast('Proiect șters', 'success');
    loadPortfolio();
    loadDashboard();
  }).catch(function() {
    showToast('Eroare la ștergere', 'error');
  });
}

// ===== EVENT LISTENERS =====
document.addEventListener('DOMContentLoaded', function() {
  // Login form
  document.getElementById('loginForm').addEventListener('submit', function(e) {
    e.preventDefault();
    var password = document.getElementById('loginPassword').value;
    var errorDiv = document.getElementById('loginError');
    errorDiv.textContent = '';

    login(password).then(function(data) {
      if (data.success) {
        authToken = data.token;
        document.getElementById('loginPassword').value = '';
        showDashboard();
      } else {
        errorDiv.textContent = data.error || 'Eroare la autentificare';
      }
    }).catch(function() {
      errorDiv.textContent = 'Eroare de conexiune. Verifică dacă serverul rulează.';
    });
  });

  // Logout
  document.getElementById('logoutBtn').addEventListener('click', logout);

  // Navigation
  document.querySelectorAll('.nav-item').forEach(function(item) {
    item.addEventListener('click', function(e) {
      e.preventDefault();
      var page = this.getAttribute('data-page');
      window.location.hash = '#/' + page;
    });
  });

  // Hash routing
  window.addEventListener('hashchange', handleHashChange);

  // Sidebar toggle (mobile)
  document.getElementById('sidebarToggle').addEventListener('click', function() {
    document.getElementById('sidebar').classList.toggle('open');
  });

  // Modal close buttons
  document.getElementById('closeMessageModal').addEventListener('click', closeMessageModal);
  document.getElementById('closePortfolioModal').addEventListener('click', closePortfolioModal);
  document.getElementById('cancelPortfolioBtn').addEventListener('click', closePortfolioModal);

  // Modal actions
  document.getElementById('toggleReadBtn').addEventListener('click', toggleMessageRead);
  document.getElementById('deleteMessageBtn').addEventListener('click', deleteMessage);
  document.getElementById('savePortfolioBtn').addEventListener('click', savePortfolio);
  document.getElementById('addPortfolioBtn').addEventListener('click', openAddPortfolio);

  // Close modals on overlay click
  document.getElementById('messageModal').addEventListener('click', function(e) {
    if (e.target === this) closeMessageModal();
  });
  document.getElementById('portfolioModal').addEventListener('click', function(e) {
    if (e.target === this) closePortfolioModal();
  });

  // Close modals on Escape
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      closeMessageModal();
      closePortfolioModal();
    }
  });

  // Check auth on load
  checkAuth().then(function(authenticated) {
    if (authenticated) {
      showDashboard();
    } else {
      showLogin();
    }
  });
});
