// ==================== ADMIN DASHBOARD JAVASCRIPT ====================

// API Base ve fetch helper (API: 5130, same-site)
const getApiBaseUrl = () => {
    const protocol = window.location.protocol;
    const hostname = window.location.hostname;
    return `${protocol}//${hostname}:5130`;
};

async function apiFetch(path, options = {}) {
    const base = getApiBaseUrl();
    const finalOptions = {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
        ...options
    };
    const url = `${base}${path}`;
    try {
        const resp = await fetch(url, finalOptions);
        if (!resp.ok) {
            console.warn('API error:', finalOptions.method || 'GET', url, resp.status, resp.statusText);
        }
        return resp;
    } catch (e) {
        console.error('API network error:', finalOptions.method || 'GET', url, e);
        throw e;
    }
}

let currentUser = null;
let adminWS = null;

document.addEventListener('DOMContentLoaded', function() {
    console.log('Admin API base:', getApiBaseUrl());
    initializeAdmin();
    loadUserInfo();
    setupEventListeners();
    startAutoRefresh();
    setupWebSocket();
    initPortManager(); // Port yönetimini başlat
});

function initializeAdmin() {
    const sidebar = document.querySelector('.sidebar');
    const mainContent = document.querySelector('.main-content');
    const overlay = document.querySelector('.sidebar-overlay');
    if (window.innerWidth > 768) {
        sidebar?.classList.add('show');
        mainContent?.classList.remove('expanded');
    } else {
        sidebar?.classList.remove('show');
        mainContent?.classList.add('expanded');
        overlay?.classList.remove('active');
    }
}

function setupEventListeners() {
    document.querySelectorAll('.menu-item').forEach(item => {
        item.addEventListener('click', function() {
            const tab = this.dataset.tab;
            switchTab(tab);
            if (window.innerWidth <= 768) closeSidebar();
        });
    });
    const t = document.querySelector('.sidebar-toggle');
    t?.addEventListener('click', toggleSidebar);
    window.addEventListener('resize', onResize);
}

function onResize() {
    const sidebar = document.querySelector('.sidebar');
    const mainContent = document.querySelector('.main-content');
    const overlay = document.querySelector('.sidebar-overlay');
    if (window.innerWidth <= 768) {
        sidebar?.classList.remove('show');
        mainContent?.classList.add('expanded');
        overlay?.classList.remove('active');
    } else {
        sidebar?.classList.add('show');
        mainContent?.classList.remove('expanded');
        overlay?.classList.remove('active');
    }
}

function toggleSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.querySelector('.sidebar-overlay');
    if (window.innerWidth > 768) return;
    const willOpen = !sidebar.classList.contains('open');
    sidebar.classList.toggle('open', willOpen);
    sidebar.style.transform = willOpen ? 'translateX(0%)' : 'translateX(-100%)';
    overlay?.classList.toggle('active', willOpen);
}

function closeSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.querySelector('.sidebar-overlay');
    if (window.innerWidth <= 768) {
        sidebar.classList.remove('open');
        sidebar.style.transform = 'translateX(-100%)';
        overlay?.classList.remove('active');
    }
}

function switchTab(tabName) {
    document.querySelectorAll('.menu-item').forEach(i => i.classList.remove('active'));
    document.querySelector(`[data-tab="${tabName}"]`)?.classList.add('active');
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById(tabName)?.classList.add('active');
    loadTabData(tabName);
}

function loadTabData(tabName) {
    switch(tabName) {
        case 'dashboard': loadDashboardData(); break;
        case 'users': loadUsers(); break;
        case 'devices': loadDevices(); break;
        case 'device-configs': initDeviceConfigs(); break;
        case 'logs': loadLogs(); break;
        case 'analytics': loadAnalytics(); break;
        case 'security': loadSecurityData(); break;
        case 'settings': loadSettings(); initLayoutManager(); break;
        case 'backup': loadBackups(); break;
    }
}

async function loadUserInfo() {
    try {
        const r = await apiFetch('/api/user');
        if (!r.ok) { console.warn('Admin loadUserInfo: auth required', r.status); return; }
        const user = await r.json();
        currentUser = user;
        const el = document.getElementById('admin-name');
        if (el) el.textContent = user.name || user.username;
    } catch (e) { console.error('Admin loadUserInfo error:', e); }
}

// Users
async function loadUsers() {
    const r = await apiFetch('/api/admin/users');
    const users = await r.json();
    const tbody = document.querySelector('#users-table tbody');
    tbody.innerHTML = '';
    users.forEach(user => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${user.id}</td>
            <td>${user.username}</td>
            <td>${user.full_name || user.name || ''}</td>
            <td>${user.email || '-'}</td>
            <td><span class="badge badge-${user.role}">${user.role}</span></td>
            <td><span class="badge badge-${user.is_active ? 'success' : 'danger'}">${user.is_active ? 'Aktif' : 'Pasif'}</span></td>
            <td>${user.last_login ? new Date(user.last_login).toLocaleString('tr-TR') : 'Hiç'}</td>
            <td>
                <button class="btn-secondary" onclick="editUser('${user.id}')">Düzenle</button>
                <button class="btn-danger" onclick="deleteUser('${user.id}')">Sil</button>
            </td>
        `;
        tbody.appendChild(row);
    });
}

// Kullanıcı düzenleme
async function editUser(userId) {
    try {
        const response = await apiFetch(`/api/admin/users/${userId}`);
        const user = await response.json();
        
        if (user.error) {
            alert('Kullanıcı bilgileri alınamadı: ' + user.error);
            return;
        }
        
        // Modal'ı doldur
        document.getElementById('edit-user-id').value = user.id;
        document.getElementById('edit-username').value = user.username;
        document.getElementById('edit-name').value = user.name || '';
        document.getElementById('edit-email').value = user.email || '';
        document.getElementById('edit-role').value = user.role;
        document.getElementById('edit-active').checked = user.is_active;

        // Kullanıcıya cihaz atama alanı
        const form = document.getElementById('edit-user-form');
        const container = document.createElement('div');
        container.className = 'form-group';
        container.innerHTML = `
          <label>Kullanıcı Cihazları</label>
          <div id="user-device-assign">
            <div style="display:flex; gap:.5rem; align-items:center;">
              <select id="assign-device-select"><option value="">Cihaz seçin...</option></select>
              <button type="button" class="btn-secondary" id="assign-device-btn">Ata</button>
            </div>
            <div id="assigned-devices" style="margin-top:.5rem;"></div>
          </div>
        `;
        const actions = form.querySelector('.form-actions');
        form.insertBefore(container, actions);
        await populateDeviceAssignment(user);
        
        // Modal'ı göster
        const modal = document.getElementById('edit-user-modal');
        modal.style.display = 'flex';
        modal.classList.add('active');
    } catch (error) {
        console.error('Kullanıcı düzenleme hatası:', error);
        alert('Kullanıcı bilgileri alınamadı');
    }
}

// Edit user modal'ı kapat
function closeEditUserModal() {
    const modal = document.getElementById('edit-user-modal');
    modal.style.display = 'none';
    modal.classList.remove('active');
}

// Edit user form submit
document.addEventListener('DOMContentLoaded', function() {
    // Edit user form submit handler
    const editUserForm = document.getElementById('edit-user-form');
    if (editUserForm) {
        editUserForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const userId = document.getElementById('edit-user-id').value;
            const formData = {
                username: document.getElementById('edit-username').value,
                name: document.getElementById('edit-name').value,
                email: document.getElementById('edit-email').value,
                role: document.getElementById('edit-role').value,
                is_active: document.getElementById('edit-active').checked
            };
            
            try {
                const response = await apiFetch(`/api/admin/users/${userId}`, { method: 'PUT', body: JSON.stringify(formData) });
                const data = await response.json().catch(() => ({}));
                if (response.ok && data.success) {
                    alert('Kullanıcı başarıyla güncellendi');
                    closeEditUserModal();
                    loadUsers(); // Kullanıcı listesini yenile
                } else {
                    alert('Kullanıcı güncellenemedi' + (data.error ? (': ' + data.error) : ''));
                }
            } catch (error) {
                console.error('Kullanıcı güncelleme hatası:', error);
                alert('Kullanıcı güncellenemedi');
            }
        });
    }
});

function showAddUserModal() {
    // basitleştirilmiş modal oluşturma (mevcut showModal kullanılıyorsa onunla entegre olur)
    // ... mevcut projede showModal var, bunu çağırıyoruz
    showModal('Yeni Kullanıcı Ekle', `
      <form id="add-user-form">
        <div class="form-section">
          <h3>Kullanıcı Bilgileri</h3>
          <div class="form-group">
            <label class="required">Kullanıcı Adı</label>
            <input type="text" id="new-username" required placeholder="Kullanıcı adını girin">
          </div>
          <div class="form-group">
            <label class="required">Şifre</label>
            <input type="password" id="new-password" required placeholder="Güçlü bir şifre girin">
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Ad Soyad</label>
              <input type="text" id="new-fullname" placeholder="Ad Soyad">
            </div>
            <div class="form-group">
              <label>Email</label>
              <input type="email" id="new-email" placeholder="email@example.com">
            </div>
          </div>
          <div class="form-group">
            <label class="required">Rol</label>
            <select id="new-role">
              <option value="user">Kullanıcı</option>
              <option value="admin">Admin</option>
            </select>
          </div>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn-primary"><i class="fas fa-plus"></i> Kullanıcı Ekle</button>
          <button type="button" class="btn-secondary" onclick="closeModal()"><i class="fas fa-times"></i> İptal</button>
        </div>
      </form>
    `);
    document.getElementById('add-user-form')?.addEventListener('submit', addUser);
}

async function addUser(e) {
    e.preventDefault();
    const userData = {
        username: document.getElementById('new-username').value,
        full_name: document.getElementById('new-fullname').value,
        email: document.getElementById('new-email').value,
        password: document.getElementById('new-password').value,
        role: document.getElementById('new-role').value
    };
    const r = await apiFetch('/api/admin/users', { method:'POST', body: JSON.stringify(userData) });
    if (r.ok) { closeModal(); loadUsers(); showToast('Kullanıcı eklendi','success'); } else { const er = await r.json(); showToast(er.message||'Hata','error'); }
}

// Devices
async function loadDevices() {
    console.log('loadDevices çağrıldı');
    try {
        const r = await apiFetch('/api/admin/devices');
        console.log('API response status:', r.status);
        if (!r.ok) {
            console.error('API error:', r.status, r.statusText);
            showToast('Cihazlar yüklenemedi','error');
            return;
        }
        const devices = await r.json();
        console.log('Devices loaded:', devices);
        const tbody = document.querySelector('#devices-table tbody');
        if (!tbody) {
            console.error('devices-table tbody bulunamadı');
            return;
        }
        tbody.innerHTML = '';
        devices.forEach(device => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${device.device_id}</td>
                <td>${device.device_name}</td>
                <td>${device.ip_address || '-'}</td>
                <td><span class="badge badge-${device.is_online ? 'success' : 'danger'}">${device.is_online ? 'Online' : 'Offline'}</span></td>
                <td>${device.last_seen ? new Date(device.last_seen).toLocaleString('tr-TR') : 'Hiç'}</td>
                <td>${device.owner_name || '-'}</td>
                <td>
                    <button class="btn-secondary" onclick="editDevice('${device.device_id}')">Düzenle</button>
                    <button class="btn-danger" onclick="deleteDevice('${device.device_id}')">Sil</button>
                </td>
            `;
            tbody.appendChild(row);
        });
        console.log('Devices table updated');
    } catch (error) {
        console.error('loadDevices error:', error);
        showToast('Cihazlar yüklenirken hata oluştu','error');
    }
}

async function editDevice(deviceId) {
    const r = await apiFetch(`/api/admin/devices/${deviceId}`);
    if (!r.ok) { showToast('Cihaz bilgileri alınamadı','error'); return; }
    const device = await r.json();
    showModal('Cihaz Düzenle', `
      <form id="edit-device-form">
        <div class="form-group"><label>Cihaz ID</label><input type="text" id="edit-device-id" value="${device.device_id}" readonly></div>
        <div class="form-group"><label>Cihaz Adı</label><input type="text" id="edit-device-name" value="${device.device_name}" required></div>
        <div class="form-group"><label>IP Adresi</label><input type="text" id="edit-ip-address" value="${device.ip_address || ''}"></div>
        <div class="form-group"><label>MAC Adresi</label><input type="text" id="edit-mac-address" value="${device.mac_address || ''}"></div>
        <div class="form-group"><label>Konum</label><input type="text" id="edit-location" value="${device.location || ''}"></div>
        <div class="form-group"><label>Açıklama</label><textarea id="edit-description">${device.description || ''}</textarea></div>
        <div class="form-group"><label>Sahibi</label><select id="edit-owner" disabled><option value="">Sahipsiz</option></select><small style="display:block;opacity:.8;margin-top:.25rem;">Sahip atama işlemi kullanıcı düzenleme modalına taşındı.</small></div>
        <div class="form-group"><button type="submit" class="btn-primary">Güncelle</button></div>
      </form>
    `);
    await loadUserOptions(device.owner_name || '');
    document.getElementById('edit-device-form')?.addEventListener('submit', (e) => { e.preventDefault(); updateDevice(deviceId); });
}

async function loadUserOptions(selectedUsername = '') {
    const r = await apiFetch('/api/admin/users');
    const users = await r.json();
    const fill = (sel) => {
        if (!sel) return;
        sel.innerHTML = '<option value="">Sahipsiz</option>';
        users.forEach(u => {
            const opt = document.createElement('option');
            opt.value = u.username;
            opt.textContent = u.full_name || u.name || u.username;
            sel.appendChild(opt);
        });
        if (selectedUsername) sel.value = selectedUsername;
    };
    fill(document.getElementById('edit-owner'));
    fill(document.getElementById('new-owner'));
}

async function updateDevice(deviceId) {
    const payload = {
        device_name: document.getElementById('edit-device-name').value,
        ip_address: document.getElementById('edit-ip-address').value,
        mac_address: document.getElementById('edit-mac-address').value,
        location: document.getElementById('edit-location').value,
        description: document.getElementById('edit-description').value,
        owner: document.getElementById('edit-owner').value
    };
    const r = await apiFetch(`/api/admin/devices/${deviceId}`, { method:'PUT', body: JSON.stringify(payload) });
    if (r.ok) { closeModal(); loadDevices(); showToast('Cihaz güncellendi','success'); } else { const er = await r.json(); showToast(er.message||'Hata','error'); }
}

function showAddDeviceModal() {
    showModal('Yeni Cihaz Ekle', `
      <form id="add-device-form">
        <div class="form-section">
          <h3>Cihaz Bilgileri</h3>
          <div class="form-group"><label class="required">Cihaz ID</label><input type="text" id="new-device-id" required placeholder="esp32_001"></div>
          <div class="form-group"><label class="required">Cihaz Adı</label><input type="text" id="new-device-name" required placeholder="Oturma Odası ESP32"></div>
          <div class="form-row">
            <div class="form-group"><label>IP Adresi</label><input type="text" id="new-ip-address" placeholder="192.168.1.100"></div>
            <div class="form-group"><label>MAC Adresi</label><input type="text" id="new-mac-address" placeholder="AA:BB:CC:DD:EE:FF"></div>
          </div>
          <div class="form-group"><label>Konum</label><input type="text" id="new-location" placeholder="Oturma Odası"></div>
          <div class="form-group"><label>Açıklama</label><textarea id="new-description" placeholder="Cihaz hakkında açıklama..."></textarea></div>
          <div class="form-group"><label>Sahibi</label><select id="new-owner"><option value="">Sahipsiz</option></select></div>
          <div class="form-check"><input type="checkbox" id="new-device-active" checked><label for="new-device-active">Cihaz aktif</label></div>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn-primary"><i class="fas fa-plus"></i> Cihaz Ekle</button>
          <button type="button" class="btn-secondary" onclick="closeModal()"><i class="fas fa-times"></i> İptal</button>
        </div>
      </form>
    `);
    loadUserOptions();
    document.getElementById('add-device-form')?.addEventListener('submit', addDevice);
}

async function addDevice(e) {
    e.preventDefault();
    const deviceData = {
        device_id: document.getElementById('new-device-id').value,
        device_name: document.getElementById('new-device-name').value,
        ip_address: document.getElementById('new-ip-address').value,
        mac_address: document.getElementById('new-mac-address').value,
        location: document.getElementById('new-location').value,
        description: document.getElementById('new-description').value,
        owner: document.getElementById('new-owner').value
    };
    const r = await apiFetch('/api/admin/devices', { method:'POST', body: JSON.stringify(deviceData) });
    if (r.ok) { closeModal(); loadDevices(); showToast('Cihaz eklendi','success'); } else { const er = await r.json(); showToast(er.message||'Hata','error'); }
}

async function deleteDevice(deviceId) {
    if (!confirm('Bu cihazı silmek istediğinizden emin misiniz?')) return;
    const r = await apiFetch(`/api/admin/devices/${deviceId}`, { method:'DELETE' });
    if (r.ok) { loadDevices(); showToast('Cihaz silindi','success'); } else { const er = await r.json(); showToast(er.message||'Hata','error'); }
}

// Settings, Logs, Analytics, Security basitleştirilmiş placeholder
async function loadSettings() {}
async function loadLogs() {}
async function loadAnalytics() {}
async function loadSecurityData() {}
async function loadBackups() {}

function startAutoRefresh() {}

// Minimal modal/notification helpers (projede zaten varsa kullanılacak)
function showModal(title, content){
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = content;
  document.getElementById('modal-overlay').classList.add('active');
}
function closeModal(){ document.getElementById('modal-overlay').classList.remove('active'); }
function showNotification(msg,type='info'){ console.log(`[${type}]`, msg); showToast(msg,type); }
// Toast helper (admin)
function showToast(message, type='info'){
  const c = document.getElementById('toast-container');
  if (!c) return console.log(`[${type}]`, message);
  const el = document.createElement('div');
  el.textContent = message;
  el.style.padding='10px 14px';
  el.style.borderRadius='8px';
  el.style.color='#fff';
  el.style.fontSize='14px';
  el.style.boxShadow='0 2px 8px rgba(0,0,0,0.25)';
  el.style.background = type==='error'?'#d9534f':(type==='success'?'#28a745':'#444');
  c.appendChild(el);
  setTimeout(()=>{ el.style.opacity='0'; el.style.transition='opacity 300ms'; }, 2500);
  setTimeout(()=>{ el.remove(); }, 2900);
}

// Layout manager minimal
async function initLayoutManager() {
  try {
    const usersResp = await apiFetch('/api/admin/users');
    const users = await usersResp.json();
    const userSelect = document.getElementById('layout-user-select');
    if (!userSelect) return;
    userSelect.innerHTML = '';
    users.forEach(u => { const opt = document.createElement('option'); opt.value = u.id; opt.textContent = `${u.username} (${u.role})`; userSelect.appendChild(opt); });
    userSelect.addEventListener('change', () => loadUserLayoutForAdmin(parseInt(userSelect.value)));
    if (users.length) loadUserLayoutForAdmin(users[0].id);
    document.getElementById('layout-move-up')?.addEventListener('click', () => moveSelectedLayoutItem(-1));
    document.getElementById('layout-move-down')?.addEventListener('click', () => moveSelectedLayoutItem(1));
    document.getElementById('layout-order')?.addEventListener('click', (e) => {
      if (e.target?.tagName === 'LI') { document.querySelectorAll('#layout-order li').forEach(li => li.classList.remove('active')); e.target.classList.add('active'); }
    });
    document.getElementById('layout-save-btn')?.addEventListener('click', async () => {
      const targetUserId = parseInt(userSelect.value);
      const layout = collectLayoutFromForm();
      const resp = await apiFetch(`/api/admin/user-layouts/${targetUserId}`, { method:'POST', body: JSON.stringify({ layout }) });
      if (resp.ok) {
        showToast('Layout kaydedildi','success');
      } else {
        const er = await resp.json().catch(() => ({}));
        showToast(er.error || 'Layout kaydedilemedi','error');
      }
    });
  } catch (e) { console.error('Layout manager init error:', e); }
}
function moveSelectedLayoutItem(direction) {
  const list = document.getElementById('layout-order');
  const active = list?.querySelector('li.active');
  if (!list || !active) return;
  const items = Array.from(list.children);
  const idx = items.indexOf(active);
  const targetIdx = idx + direction;
  if (targetIdx < 0 || targetIdx >= items.length) return;
  if (direction < 0) list.insertBefore(active, items[targetIdx]); else list.insertBefore(items[targetIdx], active);
}
function collectLayoutFromForm() {
  const orderEls = document.querySelectorAll('#layout-order li');
  const sections = Array.from(orderEls).map(li => li.dataset.id);
  const hidden = [];
  if (!document.getElementById('layout-relay')?.checked) hidden.push('relay_parent');
  if (!document.getElementById('layout-wol')?.checked) hidden.push('wol_parent');
  if (!document.getElementById('layout-log')?.checked) hidden.push('log_parent');
  return { sections, hidden };
}
async function loadUserLayoutForAdmin(userId) {
  const resp = await apiFetch('/api/admin/user-layouts');
  const rows = await resp.json();
  const row = rows.find(r => r.user_id === userId);
  const layout = row?.layout_json ? JSON.parse(row.layout_json) : { sections:['relay_parent','wol_parent','log_parent'], hidden:[] };
  document.getElementById('layout-relay').checked = !layout.hidden.includes('relay_parent');
  document.getElementById('layout-wol').checked = !layout.hidden.includes('wol_parent');
  document.getElementById('layout-log').checked = !layout.hidden.includes('log_parent');
  const list = document.getElementById('layout-order');
  if (list) {
    list.innerHTML = '';
    layout.sections.forEach(id => { const li = document.createElement('li'); li.dataset.id = id; li.className='menu-item'; li.style.padding='0.5rem 1rem'; li.style.borderBottom='1px solid #3b3b3b'; li.style.cursor='grab'; li.textContent = id; list.appendChild(li); });
    if (list.lastElementChild) list.lastElementChild.style.borderBottom = 'none';
  }
}

function setupWebSocket() {
    const wsUrl = `wss://fatihdev.xyz:5131/`;
    adminWS = new WebSocket(wsUrl);
    
    adminWS.onopen = () => {
        console.log('Admin WebSocket bağlandı');
        // Admin olarak auth gönder
        adminWS.send(JSON.stringify({
            type: 'userAuth',
            userId: 'admin',
            role: 'admin'
        }));
    };
    
    adminWS.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.type === 'deviceUpdated') {
                console.log('Cihaz güncellendi:', data.deviceId, data.action);
                // Cihaz yönetimi sekmesi aktifse listeyi yenile
                const devicesTab = document.getElementById('devices');
                if (devicesTab && devicesTab.classList.contains('active')) {
                    loadDevices();
                }
            }
        } catch (e) {
            // JSON olmayan mesajları görmezden gel
        }
    };
    
    adminWS.onclose = () => {
        console.log('Admin WebSocket bağlantısı kapandı');
        // 5 saniye sonra yeniden bağlan
        setTimeout(() => {
            setupWebSocket();
        }, 5000);
    };
    
    adminWS.onerror = (error) => {
        console.error('Admin WebSocket hatası:', error);
    };
}

// ==================== PORT YÖNETİMİ ====================

// Port yönetimi başlat
function initPortManager() {
    loadPorts();
    loadPortUsers();
    setupPortEventListeners();
}

// Port listesini yükle
async function loadPorts() {
    try {
        const response = await apiFetch('/api/admin/ports');
        const data = await response.json();
        
        if (data.error) {
            console.error('Port listesi yüklenemedi:', data.error);
            return;
        }
        
        renderUsedPorts(data.usedPorts);
        renderAvailablePorts(data.availablePorts);
    } catch (error) {
        console.error('Port listesi yüklenemedi:', error);
    }
}

// Kullanılan portları render et
function renderUsedPorts(usedPorts) {
    const container = document.getElementById('used-ports-list');
    container.innerHTML = '';
    
    if (usedPorts.length === 0) {
        container.innerHTML = '<div class="port-item"><div class="port-info"><span class="port-number">Kullanılan port yok</span></div></div>';
        return;
    }
    
    usedPorts.forEach(port => {
        const portItem = document.createElement('div');
        portItem.className = 'port-item used';
        portItem.innerHTML = `
            <div class="port-info">
                <span class="port-number">Port ${port.port}</span>
                <span class="port-user">${port.username}</span>
            </div>
            <div class="port-actions">
                <button class="btn-release" onclick="releaseUserPort(${port.userId})">Serbest Bırak</button>
            </div>
        `;
        container.appendChild(portItem);
    });
}

// Kullanılabilir portları render et
function renderAvailablePorts(availablePorts) {
    const container = document.getElementById('available-ports-list');
    container.innerHTML = '';
    
    if (availablePorts.length === 0) {
        container.innerHTML = '<div class="port-item"><div class="port-info"><span class="port-number">Kullanılabilir port yok</span></div></div>';
        return;
    }
    
    availablePorts.forEach(port => {
        const portItem = document.createElement('div');
        portItem.className = 'port-item available';
        portItem.innerHTML = `
            <div class="port-info">
                <span class="port-number">Port ${port}</span>
                <span class="port-user">Kullanılabilir</span>
            </div>
            <div class="port-actions">
                <button class="btn-assign" onclick="assignPortToUser(${port})">Ata</button>
            </div>
        `;
        container.appendChild(portItem);
    });
}

// Port kullanıcılarını yükle
async function loadPortUsers() {
    try {
        const response = await apiFetch('/api/admin/users');
        const users = await response.json();
        
        const select = document.getElementById('port-user-select');
        select.innerHTML = '<option value="">Kullanıcı seçin...</option>';
        
        users.forEach(user => {
            const option = document.createElement('option');
            option.value = user.id;
            option.textContent = `${user.username} (${user.name || 'İsimsiz'})`;
            select.appendChild(option);
        });
    } catch (error) {
        console.error('Kullanıcı listesi yüklenemedi:', error);
    }
}

// Port event listener'ları
function setupPortEventListeners() {
    // Port ata butonu
    document.getElementById('assign-port').addEventListener('click', async () => {
        const userId = document.getElementById('port-user-select').value;
        const port = document.getElementById('port-select').value;
        
        if (!userId) {
            alert('Lütfen kullanıcı seçin');
            return;
        }
        
        try {
            const response = await apiFetch('/api/admin/ports/assign', {
                method: 'POST',
                body: JSON.stringify({ userId, port: port || null })
            });
            
            const data = await response.json();
            if (data.success) {
                alert(`Port ${data.port} başarıyla atandı`);
                loadPorts();
                loadPortUsers();
            } else {
                alert('Port atanamadı: ' + data.error);
            }
        } catch (error) {
            console.error('Port atama hatası:', error);
            alert('Port atanamadı');
        }
    });
    
    // Port serbest bırak butonu
    document.getElementById('release-port').addEventListener('click', async () => {
        const userId = document.getElementById('port-user-select').value;
        
        if (!userId) {
            alert('Lütfen kullanıcı seçin');
            return;
        }
        
        try {
            const response = await apiFetch(`/api/admin/ports/${userId}`, {
                method: 'DELETE'
            });
            
            const data = await response.json();
            if (data.success) {
                alert('Port başarıyla serbest bırakıldı');
                loadPorts();
                loadPortUsers();
            } else {
                alert('Port serbest bırakılamadı: ' + data.error);
            }
        } catch (error) {
            console.error('Port serbest bırakma hatası:', error);
            alert('Port serbest bırakılamadı');
        }
    });
    
    // Yenile butonu
    document.getElementById('refresh-ports').addEventListener('click', () => {
        loadPorts();
        loadPortUsers();
    });
    
    // Kullanıcı seçimi değiştiğinde port seçeneklerini güncelle
    document.getElementById('port-user-select').addEventListener('change', (e) => {
        updatePortSelectOptions(e.target.value);
    });
}

// Port seçeneklerini güncelle
async function updatePortSelectOptions(userId) {
    const portSelect = document.getElementById('port-select');
    portSelect.innerHTML = '<option value="">Port seçin...</option>';
    
    if (!userId) return;
    
    try {
        const response = await apiFetch('/api/admin/ports');
        const data = await response.json();
        
        data.availablePorts.forEach(port => {
            const option = document.createElement('option');
            option.value = port;
            option.textContent = `Port ${port}`;
            portSelect.appendChild(option);
        });
    } catch (error) {
        console.error('Port seçenekleri yüklenemedi:', error);
    }
}

// Kullanıcı portunu serbest bırak
async function releaseUserPort(userId) {
    if (!confirm('Bu kullanıcının portunu serbest bırakmak istediğinizden emin misiniz?')) {
        return;
    }
    
    try {
        const response = await apiFetch(`/api/admin/ports/${userId}`, {
            method: 'DELETE'
        });
        
        const data = await response.json();
        if (data.success) {
            alert('Port başarıyla serbest bırakıldı');
            loadPorts();
        } else {
            alert('Port serbest bırakılamadı: ' + data.error);
        }
    } catch (error) {
        console.error('Port serbest bırakma hatası:', error);
        alert('Port serbest bırakılamadı');
    }
}

// Portu kullanıcıya ata
async function assignPortToUser(port) {
    const userId = document.getElementById('port-user-select').value;
    
    if (!userId) {
        alert('Lütfen kullanıcı seçin');
        return;
    }
    
    try {
        const response = await apiFetch('/api/admin/ports/assign', {
            method: 'POST',
            body: JSON.stringify({ userId, port })
        });
        
        const data = await response.json();
        if (data.success) {
            alert(`Port ${port} başarıyla atandı`);
            loadPorts();
        } else {
            alert('Port atanamadı: ' + data.error);
        }
    } catch (error) {
        console.error('Port atama hatası:', error);
        alert('Port atanamadı');
    }
}


// ==================== AUTH / USER ACTIONS ====================
async function logout() {
    try {
        const r = await apiFetch('/api/logout', { method: 'POST' });
        // Başarılı/başarısız fark etmeksizin login'e yönlendir
        window.location.href = '/login';
    } catch (e) {
        window.location.href = '/login';
    }
}

async function deleteUser(userId) {
    try {
        if (!confirm('Bu kullanıcıyı silmek istediğinizden emin misiniz?')) return;
        const r = await apiFetch(`/api/admin/users/${userId}`, { method: 'DELETE' });
        if (r.ok) {
            showToast('Kullanıcı silindi', 'success');
            loadUsers();
        } else {
            const er = await r.json().catch(() => ({}));
            showToast(er.error || 'Kullanıcı silinemedi', 'error');
        }
    } catch (e) {
        console.error('deleteUser error:', e);
        showToast('Kullanıcı silinemedi', 'error');
    }
}

// ==================== DEVICE CONFIG MANAGEMENT ====================

let selectedDeviceId = null;
let deviceConfigs = {};

// Device config sekmesi yüklendiğinde
function initDeviceConfigs() {
    console.log('🔧 initDeviceConfigs çağrıldı');
    loadDevicesForConfig();
    setupDeviceConfigEventListeners();
}

// Cihaz seçici için cihazları yükle
async function loadDevicesForConfig() {
    try {
        const response = await apiFetch('/api/admin/devices');
        const devices = await response.json();
        
        const deviceSelector = document.getElementById('device-selector');
        deviceSelector.innerHTML = '<option value="">Cihaz Seçin</option>';
        
        devices.forEach(device => {
            const option = document.createElement('option');
            option.value = device.device_id;
            option.textContent = `${device.device_name} (${device.device_id})`;
            deviceSelector.appendChild(option);
        });
        
        // Cihaz seçimi değiştiğinde
        deviceSelector.addEventListener('change', function() {
            selectedDeviceId = this.value;
            if (selectedDeviceId) {
                loadDeviceStatus();
                loadWolProfiles();
                loadConfigHistory();
            } else {
                clearDeviceConfigUI();
            }
        });
        
    } catch (error) {
        console.error('Cihazlar yüklenemedi:', error);
        showToast('Cihazlar yüklenemedi', 'error');
    }
}

// Event listeners kurulumu
function setupDeviceConfigEventListeners() {
    // DHCP checkbox değiştiğinde
    document.getElementById('use-dhcp').addEventListener('change', function() {
        const staticIpGroup = document.getElementById('static-ip-group');
        staticIpGroup.style.display = this.checked ? 'none' : 'block';
    });
}

// Cihaz durumunu yükle
async function loadDeviceStatus() {
    console.log('🔧 loadDeviceStatus çağrıldı, selectedDeviceId:', selectedDeviceId);
    if (!selectedDeviceId) return;
    
    try {
        console.log('🔧 API çağrısı yapılıyor:', `/api/devices/${selectedDeviceId}/status`);
        const response = await apiFetch(`/api/devices/${selectedDeviceId}/status`);
        const data = await response.json();
        console.log('🔧 API yanıtı:', data);
        
        if (data.success) {
            const device = data.device;
            console.log('🔧 Cihaz bilgileri:', device);
            
            // Durum güncelle
            const statusElement = document.getElementById('device-online-status');
            console.log('🔧 Status element:', statusElement);
            if (statusElement) {
                statusElement.textContent = device.is_online ? 'Online' : 'Offline';
                statusElement.className = `status-value ${device.is_online ? 'online' : 'offline'}`;
                console.log('🔧 Status güncellendi:', device.is_online ? 'Online' : 'Offline');
            }
            
            // Diğer bilgiler
            const lastSeenElement = document.getElementById('device-last-seen');
            const firmwareElement = document.getElementById('device-firmware');
            const queueCountElement = document.getElementById('device-queue-count');
            
            if (lastSeenElement) {
                lastSeenElement.textContent = device.last_seen ? new Date(device.last_seen).toLocaleString('tr-TR') : '-';
            }
            if (firmwareElement) {
                firmwareElement.textContent = device.firmware || '-';
            }
            if (queueCountElement) {
                queueCountElement.textContent = device.queue_count || '0';
            }
            
        } else {
            console.error('❌ API başarısız:', data);
            showToast('Cihaz durumu alınamadı', 'error');
        }
    } catch (error) {
        console.error('❌ Cihaz durumu yüklenemedi:', error);
        showToast('Cihaz durumu yüklenemedi', 'error');
    }
}

// WiFi konfigürasyonu gönder
async function sendWifiConfig() {
    if (!selectedDeviceId) {
        showToast('Lütfen bir cihaz seçin', 'warning');
        return;
    }
    
    const ssid = document.getElementById('wifi-ssid').value;
    const password = document.getElementById('wifi-password').value;
    const useDhcp = document.getElementById('use-dhcp').checked;
    const staticIp = document.getElementById('static-ip').value;
    
    if (!ssid || !password) {
        showToast('SSID ve şifre gerekli', 'warning');
        return;
    }
    
    const config = {
        wifi_ssid: ssid,
        wifi_pass: password,
        use_dhcp: useDhcp,
        static_ip: useDhcp ? null : staticIp
    };
    
    try {
        const response = await apiFetch(`/api/devices/${selectedDeviceId}/config`, {
            method: 'POST',
            body: JSON.stringify({ config })
        });
        
        const data = await response.json();
        if (data.success) {
            showToast(data.message, data.sent ? 'success' : 'info');
            loadConfigHistory(); // Geçmişi yenile
        } else {
            showToast('Konfigürasyon gönderilemedi: ' + data.error, 'error');
        }
    } catch (error) {
        console.error('WiFi config gönderme hatası:', error);
        showToast('Konfigürasyon gönderilemedi', 'error');
    }
}

// WOL profillerini yükle
async function loadWolProfiles() {
    if (!selectedDeviceId) return;
    
    try {
        const response = await apiFetch(`/api/devices/${selectedDeviceId}/wol-profiles`);
        const data = await response.json();
        
        if (data.success) {
            const profilesList = document.getElementById('wol-profiles-list');
            profilesList.innerHTML = '';
            
            data.profiles.forEach(profile => {
                const profileItem = document.createElement('div');
                profileItem.className = 'wol-profile-item';
                profileItem.innerHTML = `
                    <div class="wol-profile-info">
                        <div class="wol-profile-name">${profile.name}</div>
                        <div class="wol-profile-details">${profile.mac} | ${profile.broadcast_ip}:${profile.port}</div>
                    </div>
                    <div class="wol-profile-actions">
                        <button class="btn-small" onclick="syncWolProfilesToDevice()" title="Cihaza Senkronize Et">
                            <i class="fas fa-cloud-upload-alt"></i>
                        </button>
                        <button class="btn-small btn-danger" onclick="deleteWolProfile(${profile.id})">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                `;
                profilesList.appendChild(profileItem);
            });
        }
    } catch (error) {
        console.error('WOL profilleri yüklenemedi:', error);
    }
}

// WOL profili ekleme modalını göster
function showAddWolProfileModal() {
    console.log('🔧 showAddWolProfileModal çağrıldı, selectedDeviceId:', selectedDeviceId);
    if (!selectedDeviceId) {
        showToast('Lütfen bir cihaz seçin', 'warning');
        return;
    }
    
    const modal = document.getElementById('add-wol-profile-modal');
    console.log('🔧 Modal element:', modal);
    if (modal) {
        modal.classList.add('active');
        modal.style.display = 'flex';
        console.log('🔧 Modal gösterildi');
    } else {
        console.error('❌ Modal bulunamadı!');
    }
}

// WOL profili ekleme modalını kapat
function closeAddWolProfileModal() {
    const modal = document.getElementById('add-wol-profile-modal');
    if (modal) {
        modal.classList.remove('active');
        modal.style.display = 'none';
    }
    const form = document.getElementById('add-wol-profile-form');
    if (form) {
        form.reset();
    }
}

// WOL profili ekle
async function addWolProfile() {
    const name = document.getElementById('wol-profile-name').value;
    const mac = document.getElementById('wol-profile-mac').value;
    const broadcast = document.getElementById('wol-profile-broadcast').value;
    const port = document.getElementById('wol-profile-port').value;
    
    if (!name || !mac || !broadcast) {
        showToast('Tüm alanlar gerekli', 'warning');
        return;
    }
    
    try {
        const response = await apiFetch(`/api/devices/${selectedDeviceId}/wol-profiles`, {
            method: 'POST',
            body: JSON.stringify({ name, mac, broadcast_ip: broadcast, port: parseInt(port) })
        });
        
        const data = await response.json();
        if (data.success) {
            showToast('WOL profili eklendi', 'success');
            closeAddWolProfileModal();
            loadWolProfiles();
        setTimeout(() => { syncWolProfilesToDevice(); }, 300);
        } else {
            showToast('WOL profili eklenemedi: ' + data.error, 'error');
        }
    } catch (error) {
        console.error('WOL profili ekleme hatası:', error);
        showToast('WOL profili eklenemedi', 'error');
    }
}

// WOL profillerini cihaza senkronize et
async function syncWolProfilesToDevice() {
    if (!selectedDeviceId) return;
    try {
        const response = await apiFetch(`/api/devices/${selectedDeviceId}/wol-profiles`);
        const data = await response.json();
        if (!data.success) {
            showToast('WOL profilleri alınamadı', 'error');
            return;
        }
        const profiles = data.profiles.map(p => ({
            name: p.name,
            mac: p.mac,
            broadcast_ip: p.broadcast_ip,
            port: p.port || 9,
            ip: p.ip_address || '0.0.0.0'
        }));

        const payload = {
            wol_profiles: profiles
        };

        const resp = await apiFetch(`/api/devices/${selectedDeviceId}/config`, {
            method: 'POST',
            body: JSON.stringify({ config: payload })
        });
        const resj = await resp.json();
        if (resp.ok && resj.success) {
            showToast('WOL profilleri cihaza gönderildi', 'success');
        } else {
            showToast('WOL profilleri gönderilemedi', 'error');
        }
    } catch (e) {
        console.error('syncWolProfilesToDevice error:', e);
        showToast('Senkronizasyon hatası', 'error');
    }
}

// WOL profili sil
async function deleteWolProfile(profileId) {
    if (!confirm('Bu WOL profilini silmek istediğinizden emin misiniz?')) return;
    
    try {
        const response = await apiFetch(`/api/devices/${selectedDeviceId}/wol-profiles/${profileId}`, {
            method: 'DELETE'
        });
        
        const data = await response.json();
        if (data.success) {
            showToast('WOL profili silindi', 'success');
            loadWolProfiles();
        } else {
            showToast('WOL profili silinemedi: ' + data.error, 'error');
        }
    } catch (error) {
        console.error('WOL profili silme hatası:', error);
        showToast('WOL profili silinemedi', 'error');
    }
}

// Konfigürasyon geçmişini yükle
async function loadConfigHistory() {
    if (!selectedDeviceId) return;
    
    try {
        const response = await apiFetch(`/api/devices/${selectedDeviceId}/history?limit=20`);
        const data = await response.json();
        
        if (data.success) {
            const historyContainer = document.getElementById('config-history');
            historyContainer.innerHTML = '';
            
            data.history.forEach(entry => {
                const historyItem = document.createElement('div');
                historyItem.className = 'history-item';
                historyItem.innerHTML = `
                    <div class="history-info">
                        <div class="history-action ${entry.action}">${getActionText(entry.action)}</div>
                        <div class="history-details">${entry.username || 'Sistem'} - ${entry.error_message || 'Başarılı'}</div>
                    </div>
                    <div class="history-timestamp">${new Date(entry.created_at).toLocaleString('tr-TR')}</div>
                `;
                historyContainer.appendChild(historyItem);
            });
        }
    } catch (error) {
        console.error('Konfigürasyon geçmişi yüklenemedi:', error);
    }
}

// Action text'i döndür
function getActionText(action) {
    const actions = {
        'sent': 'Gönderildi',
        'applied': 'Uygulandı',
        'failed': 'Başarısız',
        'queued': 'Kuyruğa Eklendi'
    };
    return actions[action] || action;
}

// Cihaz durumunu yenile
async function refreshDeviceStatus() {
    if (!selectedDeviceId) {
        showToast('Lütfen bir cihaz seçin', 'warning');
        return;
    }
    
    await loadDeviceStatus();
    showToast('Durum yenilendi', 'success');
}

// Device config UI'sını temizle
function clearDeviceConfigUI() {
    document.getElementById('device-online-status').textContent = 'Offline';
    document.getElementById('device-online-status').className = 'status-value offline';
    document.getElementById('device-last-seen').textContent = '-';
    document.getElementById('device-firmware').textContent = '-';
    document.getElementById('device-queue-count').textContent = '0';
    document.getElementById('wol-profiles-list').innerHTML = '';
    document.getElementById('config-history').innerHTML = '';
    document.getElementById('wifi-config-form').reset();
}

// ==================== USER-DEVICE ASSIGNMENT ====================
async function populateDeviceAssignment(user){
  try {
    const r = await apiFetch('/api/admin/devices');
    if (!r.ok) return;
    const devices = await r.json();
    const select = document.getElementById('assign-device-select');
    if (select) {
      select.innerHTML = '<option value="">Cihaz seçin...</option>';
      devices.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.device_id;
        opt.textContent = `${d.device_name} (${d.device_id})`;
        select.appendChild(opt);
      });
    }

    const assignedWrap = document.getElementById('assigned-devices');
    if (assignedWrap) {
      assignedWrap.innerHTML = '';
      const owned = devices.filter(d => String(d.owner_name||'').toLowerCase() === String(user.username).toLowerCase() || String(d.owner_id||'') === String(user.id));
      if (!owned.length) {
        assignedWrap.innerHTML = '<div style="opacity:.75;">Bu kullanıcıya atanmış cihaz yok</div>';
      } else {
        owned.forEach(d => {
          const chip = document.createElement('div');
          chip.style.display='inline-flex';
          chip.style.alignItems='center';
          chip.style.gap='.5rem';
          chip.style.padding='.25rem .5rem';
          chip.style.border='1px solid #3b3b3b';
          chip.style.borderRadius='12px';
          chip.style.marginRight='.5rem';
          chip.style.marginBottom='.5rem';
          chip.innerHTML = `<span>${d.device_name} (${d.device_id})</span><button type="button" class="btn-small" data-unassign="${d.device_id}">Kaldır</button>`;
          assignedWrap.appendChild(chip);
        });
        assignedWrap.querySelectorAll('[data-unassign]').forEach(btn => {
          btn.addEventListener('click', async (e) => {
            const deviceId = e.currentTarget.getAttribute('data-unassign');
            await assignDeviceToUser(deviceId, null);
            await populateDeviceAssignment(user);
            showToast('Cihaz kullanıcıdan kaldırıldı','success');
          });
        });
      }
    }

    const assignBtn = document.getElementById('assign-device-btn');
    assignBtn?.addEventListener('click', async () => {
      const deviceId = select?.value;
      if (!deviceId) { showToast('Önce bir cihaz seçin','error'); return; }
      await assignDeviceToUser(deviceId, user.username);
      showToast('Cihaz kullanıcıya atandı','success');
      await populateDeviceAssignment(user);
    });
  } catch (e) { console.error('populateDeviceAssignment error:', e); }
}

async function assignDeviceToUser(deviceId, username){
  // Sunucu undefined/null alanları boş bırakmalı; sadece owner alanını gönderelim
  const payload = {};
  if (typeof username === 'string' && username.length) payload.owner = username;
  else payload.owner = '';
  const r = await apiFetch(`/api/admin/devices/${deviceId}`, { method:'PUT', body: JSON.stringify(payload) });
  return r.ok;
}

