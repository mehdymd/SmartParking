import React, { useState, useEffect } from 'react';
import { authFetch } from '../../lib/auth';
import { Users, Plus, Trash2, DollarSign, AlertTriangle } from 'lucide-react';

const UsersPage = ({ currentUser }) => {
  const [users, setUsers] = useState([]);
  const [issues, setIssues] = useState([]);
  const [cashPayments, setCashPayments] = useState([]);
  const [showUserModal, setShowUserModal] = useState(false);
  const [showIssueModal, setShowIssueModal] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [userForm, setUserForm] = useState({
    username: '',
    password: '',
    full_name: '',
    role: 'user',
  });

  const [issueForm, setIssueForm] = useState({
    title: '',
    description: '',
    priority: 'medium',
  });

  const isAdmin = currentUser?.role === 'admin';
  // eslint-disable-next-line no-unused-vars
  const isCashier = currentUser?.role === 'cashier';
  const canManageUsers = isAdmin;

  const loadUsers = async () => {
    try {
      const response = await authFetch('/auth/users');
      const payload = await response.json();
      if (response.ok) {
        setUsers(payload.users || []);
      }
    } catch {}
  };

  const loadIssues = async () => {
    try {
      const response = await authFetch('/issues');
      const payload = await response.json();
      if (response.ok) {
        setIssues(payload.issues || []);
      }
    } catch {}
  };

  const loadCashPayments = async () => {
    try {
      const response = await authFetch('/cash-payments');
      const payload = await response.json();
      if (response.ok) {
        setCashPayments(payload.cash_payments || []);
      }
    } catch {}
  };

  useEffect(() => {
    loadUsers();
    loadIssues();
    loadCashPayments();
  }, []);

  const handleCreateUser = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const response = await authFetch('/auth/users', {
        method: 'POST',
        body: JSON.stringify(userForm),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || 'Failed to create user');
      setSuccess('User created successfully');
      setShowUserModal(false);
      setUserForm({ username: '', password: '', full_name: '', role: 'user' });
      loadUsers();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteUser = async (userId) => {
    if (!window.confirm('Are you sure you want to delete this user?')) return;
    setLoading(true);
    try {
      const response = await authFetch(`/auth/users/${userId}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Failed to delete user');
      loadUsers();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateIssue = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const response = await authFetch('/issues', {
        method: 'POST',
        body: JSON.stringify(issueForm),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || 'Failed to create issue');
      setSuccess('Issue reported to admin');
      setShowIssueModal(false);
      setIssueForm({ title: '', description: '', priority: 'medium' });
      loadIssues();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleResolveIssue = async (issueId) => {
    try {
      const response = await authFetch(`/issues/${issueId}`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'resolved' }),
      });
      if (response.ok) loadIssues();
    } catch {}
  };

  const roleColors = {
    admin: { bg: 'rgba(239, 68, 68, 0.15)', text: '#ef4444', border: 'rgba(239, 68, 68, 0.3)' },
    cashier: { bg: 'rgba(34, 197, 94, 0.15)', text: '#22c55e', border: 'rgba(34, 197, 94, 0.3)' },
    operator: { bg: 'rgba(59, 130, 246, 0.15)', text: '#3b82f6', border: 'rgba(59, 130, 246, 0.3)' },
    user: { bg: 'rgba(156, 163, 175, 0.15)', text: '#9ca3af', border: 'rgba(156, 163, 175, 0.3)' },
  };

  return (
    <div className="sp-page">
      <div className="sp-head">
        <h1 style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Users size={24} /> User Management & Cashier
        </h1>
        <p style={{ color: 'var(--text-muted)', marginTop: '4px' }}>
          Manage users, process cash payments, and report issues to admin
        </p>
      </div>

      {(error || success) && (
        <div className={`sp-banner ${error ? 'is-error' : 'is-success'}`} style={{ marginBottom: '20px', padding: '12px 16px', borderRadius: '8px', fontSize: '14px' }}>
          {error || success}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '20px' }}>
        {canManageUsers && (
          <div className="sp-card sp-card-wide">
            <div className="sp-card-header">
              <div className="sp-card-icon" style={{ background: 'rgba(99, 102, 241, 0.15)', borderColor: 'rgba(99, 102, 241, 0.3)' }}>
                <Users size={18} style={{ color: '#6366f1' }} />
              </div>
              <div>
                <h2>Users</h2>
                <p className="sp-card-desc">Manage system users and roles</p>
              </div>
              <button
                className="btn btn-blue"
                style={{ marginLeft: 'auto', height: '36px', padding: '0 14px', fontSize: '12px' }}
                onClick={() => { setEditingUser(null); setShowUserModal(true); }}
              >
                <Plus size={14} /> Add User
              </button>
            </div>

            <div className="sp-table-wrap">
              <table className="sp-table">
                <thead>
                  <tr>
                    <th>Username</th>
                    <th>Full Name</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id}>
                      <td style={{ fontWeight: '500' }}>{user.username}</td>
                      <td>{user.full_name || '—'}</td>
                      <td>
                        <span style={{
                          padding: '4px 10px',
                          borderRadius: '6px',
                          fontSize: '11px',
                          fontWeight: '600',
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                          background: roleColors[user.role]?.bg || roleColors.user.bg,
                          color: roleColors[user.role]?.text || roleColors.user.text,
                          border: `1px solid ${roleColors[user.role]?.border || roleColors.user.border}`,
                        }}>
                          {user.role}
                        </span>
                      </td>
                      <td>
                        <span style={{ color: user.is_active ? 'var(--green)' : 'var(--red)', fontSize: '12px' }}>
                          {user.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td>
                        <button
                          className="sp-icon-btn"
                          onClick={() => handleDeleteUser(user.id)}
                          title="Delete user"
                          style={{ color: 'var(--red)' }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="sp-card sp-card-wide">
          <div className="sp-card-header">
            <div className="sp-card-icon" style={{ background: 'rgba(34, 197, 94, 0.15)', borderColor: 'rgba(34, 197, 94, 0.3)' }}>
              <DollarSign size={18} style={{ color: '#22c55e' }} />
            </div>
            <div>
              <h2>Cash Payments</h2>
              <p className="sp-card-desc">Recent cash payment transactions</p>
            </div>
          </div>

          <div className="sp-table-wrap">
            <table className="sp-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Reservation</th>
                  <th>Amount</th>
                  <th>Received By</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {cashPayments.length === 0 ? (
                  <tr><td colSpan="5" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No cash payments yet</td></tr>
                ) : (
                  cashPayments.map((payment) => (
                    <tr key={payment.id}>
                      <td style={{ fontFamily: 'monospace' }}>#{payment.id}</td>
                      <td>Res #{payment.reservation_id}</td>
                      <td style={{ fontWeight: '600', color: 'var(--green)' }}>${payment.amount.toFixed(2)}</td>
                      <td>User #{payment.received_by}</td>
                      <td style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        {payment.created_at ? new Date(payment.created_at).toLocaleString() : '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="sp-card sp-card-wide">
          <div className="sp-card-header">
            <div className="sp-card-icon" style={{ background: 'rgba(245, 158, 11, 0.15)', borderColor: 'rgba(245, 158, 11, 0.3)' }}>
              <AlertTriangle size={18} style={{ color: '#f59e0b' }} />
            </div>
            <div>
              <h2>Issues</h2>
              <p className="sp-card-desc">Report and view system issues</p>
            </div>
            <button
              className="btn btn-ghost"
              style={{ marginLeft: 'auto', height: '36px', padding: '0 14px', fontSize: '12px' }}
              onClick={() => setShowIssueModal(true)}
            >
              <Plus size={14} /> Report Issue
            </button>
          </div>

          <div className="sp-issues-list">
            {issues.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}>
                No issues reported
              </div>
            ) : (
              issues.map((issue) => (
                <div key={issue.id} className="sp-issue-card" style={{
                  padding: '14px',
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(255,255,255,0.06)',
                  borderRadius: '10px',
                  marginBottom: '10px',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                    <div>
                      <span style={{
                        padding: '3px 8px',
                        borderRadius: '4px',
                        fontSize: '10px',
                        fontWeight: '600',
                        textTransform: 'uppercase',
                        background: issue.priority === 'critical' ? 'rgba(239, 68, 68, 0.15)' : issue.priority === 'high' ? 'rgba(245, 158, 11, 0.15)' : 'rgba(156, 163, 175, 0.15)',
                        color: issue.priority === 'critical' ? '#ef4444' : issue.priority === 'high' ? '#f59e0b' : '#9ca3af',
                      }}>
                        {issue.priority}
                      </span>
                      <span style={{
                        marginLeft: '8px',
                        padding: '3px 8px',
                        borderRadius: '4px',
                        fontSize: '10px',
                        fontWeight: '600',
                        textTransform: 'uppercase',
                        background: issue.status === 'resolved' ? 'rgba(34, 197, 94, 0.15)' : 'rgba(59, 130, 246, 0.15)',
                        color: issue.status === 'resolved' ? '#22c55e' : '#3b82f6',
                      }}>
                        {issue.status}
                      </span>
                    </div>
                    {isAdmin && issue.status !== 'resolved' && (
                      <button
                        className="sp-btn-sm"
                        onClick={() => handleResolveIssue(issue.id)}
                        style={{ fontSize: '11px', padding: '4px 10px' }}
                      >
                        Resolve
                      </button>
                    )}
                  </div>
                  <div style={{ fontWeight: '600', fontSize: '14px', marginBottom: '4px' }}>{issue.title}</div>
                  <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{issue.description}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '8px' }}>
                    {issue.created_at ? new Date(issue.created_at).toLocaleString() : ''}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {showUserModal && (
        <div className="sp-modal-overlay" onClick={() => setShowUserModal(false)}>
          <div className="sp-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{editingUser ? 'Edit User' : 'Create New User'}</h3>
            <form onSubmit={handleCreateUser}>
              <div className="sp-form-group">
                <label>Username</label>
                <input
                  className="sp-input"
                  value={userForm.username}
                  onChange={(e) => setUserForm({ ...userForm, username: e.target.value })}
                  placeholder="Enter username"
                  required
                />
              </div>
              <div className="sp-form-group">
                <label>Password</label>
                <input
                  className="sp-input"
                  type="password"
                  value={userForm.password}
                  onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
                  placeholder="Enter password"
                  required={!editingUser}
                />
              </div>
              <div className="sp-form-group">
                <label>Full Name</label>
                <input
                  className="sp-input"
                  value={userForm.full_name}
                  onChange={(e) => setUserForm({ ...userForm, full_name: e.target.value })}
                  placeholder="Enter full name"
                />
              </div>
              <div className="sp-form-group">
                <label>Role</label>
                <select
                  className="sp-input"
                  value={userForm.role}
                  onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}
                >
                  <option value="user">User</option>
                  <option value="cashier">Cashier</option>
                  <option value="operator">Operator</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div className="sp-modal-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setShowUserModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-blue" disabled={loading}>
                  {loading ? 'Creating...' : 'Create User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showIssueModal && (
        <div className="sp-modal-overlay" onClick={() => setShowIssueModal(false)}>
          <div className="sp-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Report Issue to Admin</h3>
            <form onSubmit={handleCreateIssue}>
              <div className="sp-form-group">
                <label>Title</label>
                <input
                  className="sp-input"
                  value={issueForm.title}
                  onChange={(e) => setIssueForm({ ...issueForm, title: e.target.value })}
                  placeholder="Brief issue title"
                  required
                />
              </div>
              <div className="sp-form-group">
                <label>Description</label>
                <textarea
                  className="sp-input"
                  value={issueForm.description}
                  onChange={(e) => setIssueForm({ ...issueForm, description: e.target.value })}
                  placeholder="Describe the issue in detail"
                  rows={4}
                  required
                />
              </div>
              <div className="sp-form-group">
                <label>Priority</label>
                <select
                  className="sp-input"
                  value={issueForm.priority}
                  onChange={(e) => setIssueForm({ ...issueForm, priority: e.target.value })}
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </div>
              <div className="sp-modal-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setShowIssueModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-blue" disabled={loading}>
                  {loading ? 'Submitting...' : 'Report Issue'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <style>{`
        .sp-table-wrap { overflow-x: auto; }
        .sp-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .sp-table th { text-align: left; padding: 12px; border-bottom: 1px solid rgba(255,255,255,0.08); color: var(--text-muted); font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
        .sp-table td { padding: 12px; border-bottom: 1px solid rgba(255,255,255,0.04); }
        .sp-table tr:hover { background: rgba(255,255,255,0.02); }
        .sp-icon-btn { background: none; border: none; cursor: pointer; padding: 6px; border-radius: 6px; transition: background 0.15s; }
        .sp-icon-btn:hover { background: rgba(255,255,255,0.08); }
        .sp-modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.7); display: grid; place-items: center; z-index: 1000; }
        .sp-modal { background: var(--bg-secondary); border: 1px solid var(--panel-border); border-radius: 16px; padding: 24px; width: 100%; max-width: 420px; }
        .sp-modal h3 { font-size: 18px; font-weight: 600; margin-bottom: 20px; }
        .sp-form-group { margin-bottom: 16px; }
        .sp-form-group label { display: block; font-size: 12px; font-weight: 600; color: var(--text-muted); margin-bottom: 6px; }
        .sp-modal-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px; }
        .sp-btn-sm { padding: 6px 12px; background: rgba(34, 197, 94, 0.15); border: 1px solid rgba(34, 197, 94, 0.3); border-radius: 6px; color: #22c55e; font-size: 12px; font-weight: 600; cursor: pointer; }
      `}</style>
    </div>
  );
};

export default UsersPage;
