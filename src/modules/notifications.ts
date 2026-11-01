/**
 * EBP-SMS Multi-Tier Notification Management Engine
 * Handles Urgent, Warning, and Update notifications generated from events,
 * and delivers them accurately based on user role (Admin vs User).
 */

export type NotificationType = 'critical' | 'warning' | 'info'; // critical = Urgent, warning = Warnings, info = Updates
export type TargetRole = 'all' | 'admin' | 'user';

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  timestamp: string;
  targetRole: TargetRole;
  category?: 'stock' | 'expiry' | 'sale' | 'loss' | 'audit' | 'security' | 'system';
  itemId?: number;
  page?: string;
  filter?: string;
  reviewed: boolean;
  metadata?: Record<string, unknown>;
}

export class NotificationEngine {
  private notifications: AppNotification[] = [];
  private activeFilterTab: 'all' | NotificationType = 'all';

  constructor(
    private getCurrentUserRole: () => 'admin' | 'user' | null,
    private onNavigateToItem?: (page: string, filter?: string) => void
  ) {
    this.loadFromStorage();
  }

  private loadFromStorage() {
    try {
      const stored = localStorage.getItem('ebp-sms-notifications-v2');
      if (stored) {
        this.notifications = JSON.parse(stored);
      }
    } catch (e) {
      this.notifications = [];
    }
  }

  private saveToStorage() {
    try {
      // Keep most recent 250 notifications
      if (this.notifications.length > 250) {
        this.notifications = this.notifications.slice(0, 250);
      }
      localStorage.setItem('ebp-sms-notifications-v2', JSON.stringify(this.notifications));
    } catch (e) {
      console.warn('Notification save error', e);
    }
  }

  /**
   * Generates a new notification and broadcasts to UI.
   */
  public notify(notif: Omit<AppNotification, 'timestamp' | 'reviewed'>): AppNotification {
    const existingIndex = this.notifications.findIndex(n => n.id === notif.id && !n.reviewed);
    const fullNotif: AppNotification = {
      ...notif,
      timestamp: new Date().toISOString(),
      reviewed: false,
    };

    if (existingIndex >= 0) {
      // Update existing unreviewed notification timestamp & message
      this.notifications[existingIndex] = fullNotif;
    } else {
      this.notifications.unshift(fullNotif);
    }

    this.saveToStorage();
    this.updateCounters();
    this.displayToast(fullNotif);

    // Audio cue for urgent alerts if sound is allowed
    if (fullNotif.type === 'critical') {
      const audio = document.getElementById('notificationSound') as HTMLAudioElement;
      if (audio) audio.play().catch(() => {});
    }

    return fullNotif;
  }

  /**
   * Filters notifications delivered to the currently logged in user.
   */
  public getDeliveredNotifications(): AppNotification[] {
    const role = this.getCurrentUserRole();
    if (!role) return [];

    return this.notifications.filter(n => {
      if (n.reviewed) return false;
      if (role === 'admin') return true; // Admins receive all
      // Regular users receive operational alerts:
      return n.targetRole === 'user' || n.targetRole === 'all';
    });
  }

  /**
   * Updates the three bottom-right notification counter badges.
   */
  public updateCounters() {
    const delivered = this.getDeliveredNotifications();
    const urgentCount = delivered.filter(n => n.type === 'critical').length;
    const warningCount = delivered.filter(n => n.type === 'warning').length;
    const updateCount = delivered.filter(n => n.type === 'info').length;

    const criticalSpan = document.getElementById('criticalCounter')?.querySelector('.count');
    const warningSpan = document.getElementById('warningCounter')?.querySelector('.count');
    const infoSpan = document.getElementById('infoCounter')?.querySelector('.count');

    if (criticalSpan) criticalSpan.textContent = urgentCount.toString();
    if (warningSpan) warningSpan.textContent = warningCount.toString();
    if (infoSpan) infoSpan.textContent = updateCount.toString();
  }

  /**
   * Displays toast message on top-right.
   */
  public displayToast(notif: AppNotification) {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    // Check if relevant to current user
    const role = this.getCurrentUserRole();
    if (role === 'user' && notif.targetRole === 'admin') return;

    const toast = document.createElement('div');
    toast.className = `toast ${notif.type}`;
    const icon = notif.type === 'critical' ? 'exclamation-circle' : notif.type === 'warning' ? 'exclamation-triangle' : 'info-circle';

    toast.innerHTML = `
      <i class="fas fa-${icon}"></i>
      <div style="flex:1;">
        <strong style="display:block; font-size:12px;">${notif.title}</strong>
        <span style="font-size:11px;">${notif.message}</span>
      </div>
      <button class="notification-close" style="background:none; border:none; color:var(--light); cursor:pointer; margin-left:8px;">
        <i class="fas fa-times"></i>
      </button>
    `;

    toast.querySelector('.notification-close')?.addEventListener('click', () => toast.remove());
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 5500);
  }

  /**
   * Opens the notification center panel filtered by type tab.
   */
  public openPanel(initialType?: NotificationType) {
    const panel = document.getElementById('notificationPanel');
    if (!panel) return;

    if (initialType) this.activeFilterTab = initialType;
    panel.classList.add('active');
    this.renderPanelContent();
  }

  public closePanel() {
    const panel = document.getElementById('notificationPanel');
    if (panel) panel.classList.remove('active');
  }

  public renderPanelContent() {
    const titleEl = document.getElementById('notificationPanelTitle');
    const listEl = document.getElementById('notificationList');
    if (!listEl) return;

    const role = this.getCurrentUserRole() || 'user';
    const delivered = this.getDeliveredNotifications();

    if (titleEl) {
      titleEl.innerHTML = `<i class="fas fa-bell"></i> Notifications &bull; <small style="font-size:12px; color:var(--accent); text-transform:uppercase;">${role} Portal</small>`;
    }

    let filtered = delivered;
    if (this.activeFilterTab !== 'all') {
      filtered = delivered.filter(n => n.type === this.activeFilterTab);
    }

    // Render filter tabs & notification list
    let html = `
      <div class="notification-filters">
        <button class="notif-tab-btn ${this.activeFilterTab === 'all' ? 'active' : ''}" data-tab="all">All (${delivered.length})</button>
        <button class="notif-tab-btn ${this.activeFilterTab === 'critical' ? 'active' : ''}" data-tab="critical" style="color:var(--danger)">Urgent (${delivered.filter(n => n.type === 'critical').length})</button>
        <button class="notif-tab-btn ${this.activeFilterTab === 'warning' ? 'active' : ''}" data-tab="warning" style="color:var(--warning)">Warnings (${delivered.filter(n => n.type === 'warning').length})</button>
        <button class="notif-tab-btn ${this.activeFilterTab === 'info' ? 'active' : ''}" data-tab="info" style="color:var(--accent)">Updates (${delivered.filter(n => n.type === 'info').length})</button>
        <button id="clearAllDeliveredBtn" style="margin-left:auto; background:rgba(255,255,255,0.1); border:1px solid rgba(255,215,0,0.3); color:var(--light); padding:2px 8px; border-radius:10px; font-size:11px; cursor:pointer;">
          <i class="fas fa-check-double"></i> Clear All
        </button>
      </div>
      <div style="max-height: 60vh; overflow-y:auto; padding-right:4px;">
    `;

    if (filtered.length === 0) {
      html += `<div style="text-align:center; padding:2rem; color:var(--gray);"><i class="fas fa-check-circle" style="font-size:2rem; color:var(--success); margin-bottom:10px; display:block;"></i>No active ${this.activeFilterTab === 'all' ? '' : this.activeFilterTab} notifications for ${role}.</div></div>`;
    } else {
      filtered.forEach(n => {
        const timeAgo = this.formatTimeAgo(n.timestamp);
        html += `
          <div class="notification-list-item ${n.type}" data-notif-id="${n.id}">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:4px;">
              <div style="flex:1;">
                <span class="status-indicator ${n.type === 'critical' ? 'status-expired' : n.type === 'warning' ? 'status-critical' : 'status-warning'}"></span>
                <strong style="color:var(--light); font-size:13px;">${n.title}</strong>
              </div>
              <div style="display:flex; align-items:center;">
                <span style="font-size:10px; color:var(--gray);"><i class="far fa-clock"></i> ${timeAgo}</span>
                <button class="notif-item-close-btn dismiss-btn" data-id="${n.id}" title="Close & Dismiss Notification">
                  <i class="fas fa-times"></i>
                </button>
              </div>
            </div>
            <div style="font-size:12px; color:#e0e8f5; margin-bottom:6px; line-height:1.4;">${n.message}</div>
            <div class="actions">
              <button class="notification-action-btn review-btn" data-id="${n.id}">
                <i class="fas fa-check"></i> Review & Clear
              </button>
              ${n.page ? `
                <button class="notification-action-btn goto-btn" data-id="${n.id}" data-page="${n.page}" data-filter="${n.filter || ''}" style="background:rgba(255,215,0,0.1); border-color:var(--accent); color:var(--accent);">
                  <i class="fas fa-arrow-right"></i> Go to Item
                </button>
              ` : ''}
              <button class="notification-action-btn dismiss-btn" data-id="${n.id}" style="border-color:rgba(255,68,68,0.4); color:var(--danger); background:rgba(255,68,68,0.1);">
                <i class="fas fa-times"></i> Close
              </button>
            </div>
          </div>
        `;
      });
      html += `</div>`;
    }

    listEl.innerHTML = html;

    // Attach listeners
    listEl.querySelectorAll('.notif-tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tab = (e.currentTarget as HTMLElement).dataset.tab as 'all' | NotificationType;
        this.activeFilterTab = tab;
        this.renderPanelContent();
      });
    });

    listEl.querySelector('#clearAllDeliveredBtn')?.addEventListener('click', () => {
      this.clearAllDelivered();
    });

    listEl.querySelectorAll('.review-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = (e.currentTarget as HTMLElement).dataset.id;
        if (id) this.markReviewed(id);
      });
    });

    listEl.querySelectorAll('.dismiss-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = (e.currentTarget as HTMLElement).dataset.id;
        if (id) this.dismissNotification(id);
      });
    });

    listEl.querySelectorAll('.goto-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const el = e.currentTarget as HTMLElement;
        const id = el.dataset.id;
        const page = el.dataset.page;
        const filter = el.dataset.filter;
        if (id) this.markReviewed(id);
        this.closePanel();
        if (page && this.onNavigateToItem) {
          this.onNavigateToItem(page, filter);
        }
      });
    });
  }

  public markReviewed(id: string) {
    const notif = this.notifications.find(n => n.id === id);
    if (notif) {
      notif.reviewed = true;
      this.saveToStorage();
      this.updateCounters();
      this.renderPanelContent();
    }
  }

  public dismissNotification(id: string) {
    const notif = this.notifications.find(n => n.id === id);
    if (notif) {
      notif.reviewed = true;
      this.saveToStorage();
      this.updateCounters();
      this.renderPanelContent();
    }
  }

  public clearAllDelivered() {
    const delivered = this.getDeliveredNotifications();
    delivered.forEach(n => n.reviewed = true);
    this.saveToStorage();
    this.updateCounters();
    this.renderPanelContent();
  }

  private formatTimeAgo(isoString: string): string {
    const date = new Date(isoString);
    const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);
    if (seconds < 60) return 'Just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return date.toLocaleDateString();
  }
}
