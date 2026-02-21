const BASE_URL = window.location.origin.includes('127.0.0.1') || window.location.origin.includes('localhost') ? '/api' : 'http://127.0.0.1:5000/api';
const TOKEN_KEY = 'gate_pass_token';
const SESSION_KEY = 'gate_pass_session';
const THEME_KEY = 'gate_pass_theme';

// Theme Logic
function toggleTheme() {
    const body = document.body;
    const isLight = body.classList.toggle('light-theme');
    localStorage.setItem(THEME_KEY, isLight ? 'light' : 'dark');
    updateThemeToggleUI();
}

function initTheme() {
    const savedTheme = localStorage.getItem(THEME_KEY);
    if (savedTheme === 'light') {
        document.body.classList.add('light-theme');
    }
}

function updateThemeToggleUI() {
    const toggleIcon = document.getElementById('theme-toggle-icon');
    if (toggleIcon) {
        const isLight = document.body.classList.contains('light-theme');
        toggleIcon.className = isLight ? 'fas fa-moon' : 'fas fa-sun';
    }
}

initTheme();

// Helper for Authenticated API Requests
async function apiRequest(endpoint, method = 'GET', data = null) {
    const token = localStorage.getItem(TOKEN_KEY);
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = token;

    const options = { method, headers };
    if (data) options.body = JSON.stringify(data);

    try {
        const response = await fetch(`${BASE_URL}${endpoint}`, options);

        let result;
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
            result = await response.json();
        } else {
            const text = await response.text();
            console.error("Non-JSON response:", text);
            return { success: false, message: `Server error (${response.status})` };
        }

        if (response.status === 401) {
            // If it's not the login page, clear session and alert
            if (!endpoint.includes('/auth/login')) {
                logout();
                alert('Your session has expired. Please login again.');
            }
            return { success: false, message: result.message || 'Unauthorized' };
        }
        return result;
    } catch (error) {
        console.error('API Error:', error);
        return { success: false, message: 'Server connection failed' };
    }
}

// User Management Logic
async function registerUser(userData) {
    return await apiRequest('/auth/register', 'POST', userData);
}

async function loginUser(email, password) {
    const result = await apiRequest('/auth/login', 'POST', { email, password });
    if (result.success) {
        localStorage.setItem(TOKEN_KEY, result.token);
        localStorage.setItem(SESSION_KEY, JSON.stringify(result.user));
    }
    return result;
}

function logout() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(SESSION_KEY);
    window.location.href = 'index.html';
}

function getCurrentUser() {
    return JSON.parse(localStorage.getItem(SESSION_KEY));
}

function checkAuth(requiredRole) {
    initTheme();
    const user = getCurrentUser();
    const path = window.location.pathname;
    const page = path.split("/").pop() || 'index.html';

    console.log('CheckAuth:', { page, userRole: user?.role, requiredRole });

    if (!user) {
        if (page !== 'index.html' && page !== 'register.html' && page !== 'login.html') {
            window.location.href = 'index.html';
        }
        return;
    }

    if (page === 'index.html' || page === 'login.html' || page === 'register.html') {
        window.location.href = `${user.role}.html`;
        return;
    }

    if (requiredRole && user.role !== requiredRole) {
        alert('Unauthorized access');
        window.location.href = 'index.html';
    }
}

// Request Management Logic
async function getRequests() {
    return await apiRequest('/requests');
}

async function saveRequest(request) {
    const result = await apiRequest('/requests', 'POST', request);
    if (result.success) {
        alert('Request submitted successfully!');
        window.location.reload();
    } else {
        alert(result.message);
    }
}

async function updateRequestStatus(id, role, decision) {
    const result = await apiRequest(`/requests/${id}/status`, 'PUT', { decision });
    if (result.success) {
        window.location.reload();
    } else {
        alert(result.message);
    }
}

// Form Handlers
async function handleStudentSubmit(e) {
    e.preventDefault();
    const formData = new FormData(e.target);
    const data = {};

    // Convert FormData to object, skipping the file for now
    formData.forEach((value, key) => {
        if (key !== 'document') data[key] = value;
    });

    // Handle File Upload ONLY if a file is actually selected
    const fileInput = e.target.querySelector('input[name="document"]');
    if (fileInput && fileInput.files && fileInput.files[0]) {
        try {
            const file = fileInput.files[0];
            const base64 = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = (err) => reject(err);
                reader.readAsDataURL(file);
            });
            data.document = base64;
        } catch (fileError) {
            console.error('File Read Error:', fileError);
            alert('Failed to process document. Please try again or skip.');
            return;
        }
    }

    if (data.from_date && data.to_date) {
        const start = new Date(data.from_date);
        const end = new Date(data.to_date);
        const diff = Math.abs(end - start);
        const days = Math.ceil(diff / (1000 * 60 * 60 * 24)) + 1;
        data.days = days;
    }

    await saveRequest(data);
}

async function handleRegister(e) {
    e.preventDefault();
    // Clear any old session before starting registration
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(SESSION_KEY);

    const formData = new FormData(e.target);
    const data = {};
    formData.forEach((value, key) => data[key] = value);

    console.log('Registration Attempt:', data);

    const result = await registerUser(data);
    if (result.success) {
        alert('Registration successful! Please login.');
        window.location.href = 'index.html';
    } else {
        alert(result.message);
    }
}

async function handleLogin(e) {
    e.preventDefault();
    const formData = new FormData(e.target);
    const { email, password } = Object.fromEntries(formData.entries());
    const activeTab = document.querySelector('.tab-btn.active').dataset.portal;

    console.log('Login Attempt:', { email, activeTab });

    const result = await loginUser(email, password);
    console.log('Login Result:', result);

    if (result.success) {
        const userRole = result.user.role;
        console.log('Redirecting to:', `${userRole}.html`);

        // Strict Role Enforcement
        if (activeTab === 'gate' && userRole !== 'gate') {
            alert('Access Denied: This tab is for Gate Security only.');
            return logout();
        }
        if (activeTab === 'admin' && userRole !== 'admin') {
            alert('Access Denied: This tab is for System Administrators only.');
            return logout();
        }
        if (activeTab === 'portal' && (userRole === 'admin' || userRole === 'gate')) {
            alert('Access Denied: Please use the appropriate login tab.');
            return logout();
        }

        window.location.href = `${userRole}.html`;
    } else {
        alert(result.message);
    }
}

function switchLoginTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    event.currentTarget.classList.add('active');

    const desc = document.getElementById('login-desc');
    if (tab === 'gate') desc.textContent = 'Security Personnel: Please login to record gate entries.';
    else if (tab === 'admin') desc.textContent = 'System Administrators: Access your management dashboard.';
    else desc.textContent = 'Please enter your credentials to access your portal.';
}

// Render Logic
async function renderStudentRequests() {
    const container = document.getElementById('student-requests-container');
    if (!container) return;

    const response = await getRequests();
    if (!Array.isArray(response)) return;

    if (response.length === 0) {
        container.innerHTML = '<p style="text-align:center; color: var(--text-muted); margin-top:1rem">No requests found.</p>';
        return;
    }

    container.innerHTML = `
        <h2 style="margin: 2rem 0 1rem; font-size: 1.5rem; color: var(--primary)">My Requests</h2>
        ${response.map(req => {
        const data = req; // Backend returns direct object mapped from mongo
        return `
            <div class="request-card">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem">
                    <div>
                        <h4 style="color:var(--text-main)">${data.reason}</h4>
                        <p style="font-size:0.8rem; color:var(--text-muted)">Applied on: ${new Date(data.created_at.$date || data.created_at).toLocaleDateString()}</p>
                    </div>
                    <span class="status-badge ${getStatusClass(data.status)}">${data.status}</span>
                </div>
                <div style="font-size:0.85rem; color: var(--text-muted)">
                    <p><strong>Duration:</strong> ${data.from_date} to ${data.to_date} (${data.days} days)</p>
                    ${data.document ? `<img src="${data.document}" style="max-width: 100%; max-height: 150px; border-radius: 0.5rem; margin-top: 0.5rem; border: 1px solid var(--glass-border); cursor: pointer;" onclick="window.open('${data.document}')">` : ''}
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-top:1.25rem">
                         <div style="display:flex; gap:1rem">
                            <span style="color: ${data.staff_approval ? 'var(--success)' : 'var(--text-muted)'}"><i class="fas ${data.staff_approval ? 'fa-check' : 'fa-clock'}"></i> Staff</span>
                            <span style="color: ${data.hod_approval ? 'var(--success)' : 'var(--text-muted)'}"><i class="fas ${data.hod_approval ? 'fa-check' : 'fa-clock'}"></i> HOD</span>
                            ${data.resident_type !== 'Day Scholar' ? `<span style="color: ${data.warden_approval ? 'var(--success)' : 'var(--text-muted)'}"><i class="fas ${data.warden_approval ? 'fa-check' : 'fa-clock'}"></i> Warden</span>` : ''}
                        </div>
                        ${data.status === 'Approved' ? `<button onclick="printLeaveForm('${data._id?.$oid || data._id || data.id}')" class="print-btn"><i class="fas fa-print"></i> Print</button>` : ''}
                    </div>
                </div>
            </div>
        `;
    }).join('')}
    `;
}

async function printLeaveForm(requestId) {
    const requests = await getRequests();
    const req = requests.find(r => (r._id?.$oid || r._id || r.id) === requestId);
    if (!req) return;

    const expiryTimeFormatted = req.expiry_timestamp ? new Date(req.expiry_timestamp).toLocaleString('en-IN', {
        day: 'numeric', month: 'numeric', year: 'numeric',
        hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: true
    }) : 'N/A';

    const isExpired = req.expiry_timestamp && Date.now() > req.expiry_timestamp;

    // Compact QR Data
    const reqId = req._id?.$oid || req._id || req.id;
    const qrData = `PASS|${reqId}|${req.student_name}|${req.dept}|${req.year_sem_sec}|${req.type}|EXP:${expiryTimeFormatted}`;
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(qrData)}`;

    const printWindow = window.open('', '_blank');
    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Gate Pass - ${req.student_name}</title>
            <style>
                @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700;900&display=swap');
                body { font-family: 'Roboto', sans-serif; padding: 20px; background: #f0f0f0; }
                .gate-pass { border: 2px solid #000; padding: 40px; max-width: 750px; margin: 0 auto; position: relative; background: #fff; box-shadow: 0 0 10px rgba(0,0,0,0.1); }
                .header { text-align: center; border-bottom: 2px solid #000; padding-bottom: 15px; margin-bottom: 30px; }
                .header h1 { margin: 0; font-size: 28px; font-weight: 900; letter-spacing: 2px; }
                .header p { margin: 5px 0 0; font-size: 18px; font-weight: 700; color: #333; }
                .content-row { display: flex; align-items: baseline; margin-bottom: 25px; }
                .label { font-weight: 900; font-size: 18px; width: 180px; color: #222; }
                .value { flex: 1; font-size: 18px; border-bottom: 1.5px dashed #666; padding-left: 10px; padding-bottom: 2px; color: #333; }
                .approved-stamp { position: absolute; top: 100px; right: 40px; border: 5px solid #4CAF50; color: #4CAF50; padding: 10px 30px; font-size: 32px; font-weight: 900; transform: rotate(-15deg); opacity: 0.8; text-transform: uppercase; border-radius: 12px; letter-spacing: 3px; }
                .footer { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 50px; }
                .qr-container { text-align: center; }
                .approval-info { text-align: right; font-size: 11px; color: #666; margin-bottom: 40px; font-style: italic; }
                .signature-section { display: flex; gap: 40px; }
                .sig { text-align: center; }
                .sig-line { border-top: 2px solid #000; width: 160px; margin-bottom: 5px; }
                @media print { body { background: none; padding: 0; } .gate-pass { border: 2px solid #000; box-shadow: none; } .print-btn { display: none; } }
            </style>
        </head>
        <body>
            <div class="gate-pass">
                ${isExpired ? '<div class="approved-stamp" style="border-color:#F44336; color:#F44336;">EXPIRED</div>' : '<div class="approved-stamp">APPROVED</div>'}
                <div class="header">
                    <h1>SMART GATE PASS SYSTEM</h1>
                    <p>Student Leave/OD Permission Form</p>
                </div>
                <div class="content-row"><span class="label">Name:</span><span class="value">${req.student_name}</span></div>
                <div class="content-row"><span class="label">Department:</span><span class="value">${req.dept}</span></div>
                <div class="content-row"><span class="label">Year / Sem / Sec:</span><span class="value">${req.year_sem_sec}</span></div>
                <div class="content-row"><span class="label">Category:</span><span class="value">${req.resident_type}</span></div>
                <div class="content-row"><span class="label">Type:</span><span class="value">${req.type}</span></div>
                <div class="content-row"><span class="label">Duration:</span><span class="value">${req.from_date} to ${req.to_date} (${req.days} Day/s)</span></div>
                <div class="content-row"><span class="label">Reason:</span><span class="value">${req.reason}</span></div>
                <div class="approval-info">
                    Digitally Approved On: ${new Date(req.approved_at.$date || req.approved_at).toLocaleString()}<br>
                    <span style="color: ${isExpired ? '#F44336' : '#E91E63'}; font-weight: bold; font-size: 14px;">
                        Valid Until: ${expiryTimeFormatted} ${isExpired ? '(EXPIRED)' : ''}
                    </span>
                </div>
                <div class="footer">
                    <div class="qr-container"><img src="${qrUrl}" width="140"><p>Scan to verify authenticity</p></div>
                    <div class="signature-section">
                        <div class="sig"><div class="sig-line"></div><span style="font-weight:900">Staff Signature</span></div>
                        <div class="sig"><div class="sig-line"></div><span style="font-weight:900">HOD Signature</span></div>
                    </div>
                </div>
            </div>
            <div style="text-align:center; margin-top:20px;">
                ${isExpired ? '<p style="color:#F44336; font-weight:bold;">This pass has expired and cannot be printed for use.</p>' : '<button class="print-btn" onclick="window.print()" style="padding: 10px 30px; font-size: 16px; background: #2196F3; color: white; border: none; border-radius: 5px; cursor: pointer;">Print Pass</button>'}
            </div>
        </body>
        </html>
    `;
    printWindow.document.write(html);
    printWindow.document.close();
}

function getStatusClass(status) {
    if (status === 'Approved') return 'status-approved';
    if (status.includes('Rejected')) return 'status-rejected';
    return 'status-pending';
}

async function renderRequests(role) {
    const container = document.getElementById('requests-container');
    if (!container) return;

    const requests = await getRequests();
    const user = getCurrentUser();

    if (role === 'staff' && document.getElementById('staff-info')) {
        document.getElementById('staff-info').innerText = `${user.dept} | Year ${user.year} / Sec ${user.section} Advisor`;
    } else if (role === 'hod' && document.getElementById('hod-info')) {
        document.getElementById('hod-info').innerText = `${user.dept} Department HOD`;
    }

    if (!Array.isArray(requests) || requests.length === 0) {
        container.innerHTML = '<p style="text-align:center; color: var(--text-muted);">No pending requests.</p>';
        return;
    }

    container.innerHTML = requests.map(req => {
        const leaveCount = req.leave_count || 0;
        const odCount = req.od_count || 0;

        return `
        <div class="request-card">
            <h3 style="color:var(--primary)">${req.student_name}</h3>
            <p style="font-size:0.8rem; color:var(--text-muted)">${req.dept} | ${req.year_sem_sec}</p>
            <div style="margin-top:0.5rem; display:flex; gap:1rem; font-size:0.8rem">
                <span style="background:var(--glass-highlight); padding:0.2rem 0.5rem; border-radius:0.5rem; border:1px solid var(--glass-border)">Approved Leaves: <strong>${leaveCount}</strong></span>
                <span style="background:var(--glass-highlight); padding:0.2rem 0.5rem; border-radius:0.5rem; border:1px solid var(--glass-border)">Approved ODs: <strong>${odCount}</strong></span>
            </div>
            <div style="margin-top:1rem; font-size:0.9rem">
                <p><strong>Resident:</strong> ${req.resident_type}</p>
                <p><strong>Type:</strong> ${req.type}</p>
                <p><strong>Duration:</strong> ${req.from_date} to ${req.to_date}</p>
                <p><strong>Reason:</strong> ${req.reason}</p>
            </div>
            ${req.document ? `<img src="${req.document}" style="max-width: 100%; max-height: 150px; border-radius: 0.5rem; margin-top: 1rem; border: 1px solid var(--glass-border); cursor: pointer;" onclick="window.open('${req.document}')">` : ''}
            <div class="action-btns" style="margin-top:1.5rem">
                <button class="approve-btn" onclick="updateRequestStatus('${req._id?.$oid || req._id || req.id}', '${role}', 'approve')">Approve / Recommend</button>
                <button class="reject-btn" onclick="updateRequestStatus('${req._id?.$oid || req._id || req.id}', '${role}', 'reject')">Reject</button>
            </div>
        </div>
    `}).join('');
}

function renderAuthNav() {
    const nav = document.getElementById('auth-nav');
    if (!nav) return;
    const user = getCurrentUser();

    if (user) {
        nav.innerHTML = `
            <div style="display:flex; align-items:center; gap:1.5rem">
                <span style="font-size:0.9rem; color:var(--text-muted)">Welcome, <strong>${user.name}</strong></span>
                <button onclick="logout()" style="background:var(--secondary); border:none; color:white; padding: 0.4rem 1.25rem; border-radius: 0.75rem; cursor:pointer;">Logout</button>
            </div>
        `;
    }
}

async function autoFillStudentDetails() {
    const user = getCurrentUser();
    if (!user || user.role !== 'student') return;

    document.getElementById('student-name').value = user.name || '';
    document.getElementById('student-dept').value = user.dept || '';
    document.getElementById('student-year').value = user.year || '';
    document.getElementById('student-semester').value = user.semester || '';
    document.getElementById('student-section').value = user.section || '';

    const requests = await getRequests();
    const approved = requests.filter(r => r.status === 'Approved');
    document.getElementById('leave-count').innerText = approved.filter(r => r.type === 'Leave').length;
    document.getElementById('od-count').innerText = approved.filter(r => r.type === 'On Duty').length;
}

// Gate Management
async function recordGateEntry(data) {
    return await apiRequest('/gate/record', 'POST', data);
}

async function getGateHistory() {
    return await apiRequest('/gate/history');
}

async function clearGateHistory() {
    if (confirm("Clear all records?")) {
        await apiRequest('/gate/history/clear', 'POST');
        window.location.reload();
    }
}

function downloadGateHistoryCSV() {
    getGateHistory().then(history => {
        if (!Array.isArray(history) || history.length === 0) {
            alert("No records to download.");
            return;
        }

        const headers = ['Student Name', 'Department', 'Year/Section', 'Outing Time'];
        const rows = history.map(row => [
            `"${row.name}"`, `"${row.dept}"`, `"${row.year_sem_sec}"`, `"${row.outing_time}"`
        ]);

        const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `gate_records_${new Date().toISOString().split('T')[0]}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    });
}

// Admin Logic
async function adminGetManagedUsers() {
    return await apiRequest('/admin/users');
}

async function adminDeleteUser(email) {
    return await apiRequest(`/admin/users/${email}`, 'DELETE');
}

async function adminUpdateUser(email, updatedData) {
    return await apiRequest(`/admin/users/${email}`, 'PUT', updatedData);
}
