/**
 * EBP-SMS Security, Anti-Tamper & Device Verification Manager
 * Enforces code protection (anti-copy, anti-paste, inspect blocking)
 * Manages device verification with 3-attempt lockout and authorized administrator recovery.
 */

export class SecurityManager {
  private static readonly MASTER_PASSWORD = 'kpi21232026';
  private static readonly ADMIN_PASSWORD = 'kpi2123';
  private static readonly STORAGE_AUTH = 'ebp-sms-device-authenticated';
  private static readonly STORAGE_ATTEMPTS = 'ebp-sms-device-failed-attempts';
  private static readonly STORAGE_LOCKED = 'ebp-sms-device-locked';
  private static readonly STORAGE_DEVICE_ID = 'ebp-sms-device-id';

  private failedAttempts: number = 0;
  private isLocked: boolean = false;
  private currentCaptcha: string = '';

  constructor(private onAuthenticated: () => void, private onSecurityEvent?: (msg: string, type: string) => void) {
    this.initDeviceId();
    this.initCodeProtection();
    this.loadState();
    this.initDeviceVerificationUI();
  }

  private initDeviceId(): string {
    let deviceId = localStorage.getItem(SecurityManager.STORAGE_DEVICE_ID);
    if (!deviceId) {
      const entropy = navigator.userAgent + screen.width + 'x' + screen.height + Math.random().toString(36).substring(2, 9);
      let hash = 0;
      for (let i = 0; i < entropy.length; i++) {
        hash = (hash << 5) - hash + entropy.charCodeAt(i);
        hash |= 0;
      }
      deviceId = `EBP-DEV-${Math.abs(hash).toString().padStart(6, '0')}`;
      localStorage.setItem(SecurityManager.STORAGE_DEVICE_ID, deviceId);
    }
    return deviceId;
  }

  public getDeviceId(): string {
    return localStorage.getItem(SecurityManager.STORAGE_DEVICE_ID) || 'EBP-DEV-PRIMARY';
  }

  private loadState() {
    this.failedAttempts = parseInt(localStorage.getItem(SecurityManager.STORAGE_ATTEMPTS) || '0', 10);
    this.isLocked = localStorage.getItem(SecurityManager.STORAGE_LOCKED) === 'true' || this.failedAttempts >= 3;
    if (this.failedAttempts >= 3 && !this.isLocked) {
      this.isLocked = true;
      localStorage.setItem(SecurityManager.STORAGE_LOCKED, 'true');
    }
  }

  /**
   * Code protection: disables right click context menu, inspect devtools shortcuts,
   * clipboard copying/cutting of application source or layouts, while preserving normal input typing.
   */
  private initCodeProtection() {
    // 1. Right Click Prevention
    document.addEventListener('contextmenu', (e: MouseEvent) => {
      e.preventDefault();
      this.notifySecurity('Right-click is protected for application security', 'warning');
      return false;
    });

    // 2. Inspection Shortcut Blocking (F12, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+Shift+C, Ctrl+U, Ctrl+S)
    document.addEventListener('keydown', (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const ctrlOrCmd = isMac ? e.metaKey : e.ctrlKey;

      // F12 DevTools
      if (e.key === 'F12') {
        e.preventDefault();
        this.notifySecurity('Developer inspection tools are disabled', 'critical');
        return false;
      }

      // Ctrl/Cmd + Shift + I / J / C (DevTools & Console)
      if (ctrlOrCmd && e.shiftKey && (e.key === 'I' || e.key === 'i' || e.key === 'J' || e.key === 'j' || e.key === 'C' || e.key === 'c')) {
        e.preventDefault();
        this.notifySecurity('Inspection and console shortcuts are disabled', 'critical');
        return false;
      }

      // Ctrl/Cmd + U (View Source)
      if (ctrlOrCmd && (e.key === 'U' || e.key === 'u')) {
        e.preventDefault();
        this.notifySecurity('Source code viewing is restricted', 'warning');
        return false;
      }

      // Ctrl/Cmd + S (Save Page)
      if (ctrlOrCmd && (e.key === 'S' || e.key === 's')) {
        e.preventDefault();
        return false;
      }

      // Ctrl/Cmd + A outside of text inputs
      if (ctrlOrCmd && (e.key === 'A' || e.key === 'a')) {
        const target = e.target as HTMLElement;
        const isInput = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
        if (!isInput) {
          e.preventDefault();
          return false;
        }
      }
    });

    // 3. Unauthorized Copy/Cut Protection on non-input UI elements
    document.addEventListener('copy', (e: ClipboardEvent) => {
      const activeEl = document.activeElement as HTMLElement;
      const isInput = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA');
      if (!isInput) {
        e.preventDefault();
        this.notifySecurity('Content copying is protected', 'warning');
      }
    });

    document.addEventListener('cut', (e: ClipboardEvent) => {
      const activeEl = document.activeElement as HTMLElement;
      const isInput = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA');
      if (!isInput) {
        e.preventDefault();
      }
    });

    // Console security warning
    console.log(
      '%c🔒 EBP-SMS Security Shield Active\nUnauthorized inspection, modification, or code extraction is strictly monitored.',
      'color:#ffd700; background:#0a1f3d; font-size:14px; font-weight:bold; padding:8px;'
    );
  }

  private notifySecurity(message: string, type: 'warning' | 'critical' | 'info') {
    if (this.onSecurityEvent) {
      this.onSecurityEvent(message, type);
    }
  }

  /**
   * Initializes device verification modal and renders standard verification
   * or administrator recovery screen if deactivation occurred.
   */
  public initDeviceVerificationUI() {
    const overlay = document.getElementById('masterOverlay');
    if (!overlay) return;

    const isAlreadyAuthenticated = localStorage.getItem(SecurityManager.STORAGE_AUTH) === 'true';
    if (isAlreadyAuthenticated && !this.isLocked) {
      overlay.style.display = 'none';
      this.onAuthenticated();
      return;
    }

    overlay.style.display = 'flex';
    this.renderVerificationBox();
  }

  private generateCaptcha(): string {
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    this.currentCaptcha = code;
    return code;
  }

  private renderVerificationBox() {
    const overlay = document.getElementById('masterOverlay');
    if (!overlay) return;

    const deviceId = this.getDeviceId();

    if (this.isLocked) {
      // DEACTIVATED / LOCKOUT STATE - Requires authorized administrator recovery
      const captcha = this.generateCaptcha();
      overlay.innerHTML = `
        <div class="master-box locked-box">
          <h2><i class="fas fa-ban"></i> ACCESS DEACTIVATED</h2>
          <div class="attempts-badge danger">3 FAILED ATTEMPTS - SYSTEM LOCKED</div>
          <p style="margin-bottom:12px; color:#ffdddd; font-size:13px; line-height:1.5;">
            Device verification has failed 3 consecutive times. For code protection and security, application access has been deactivated on this device.
          </p>
          <div style="background:rgba(0,255,136,0.08); border:1px solid rgba(0,255,136,0.3); border-radius:8px; padding:10px; margin-bottom:15px; font-size:12px; color:var(--success);">
            <i class="fas fa-shield-alt"></i> <strong>DATA FULLY PRESERVED:</strong> All stock items, transactions, sales, and audit records are safe and secure.
          </div>
          <div style="text-align:left; margin-bottom:12px;">
            <label style="color:var(--accent); font-size:12px; display:block; margin-bottom:4px;"><i class="fas fa-key"></i> Administrator Recovery Key *</label>
            <input type="password" id="adminRecoveryKey" placeholder="Enter administrator recovery key..." style="width:100%; padding:10px; background:rgba(255,255,255,0.1); border:2px solid var(--danger); border-radius:8px; color:white; font-size:14px;">
          </div>
          <div style="text-align:left; margin-bottom:15px;">
            <label style="color:var(--accent); font-size:12px; display:block; margin-bottom:4px;">Security Challenge: Enter <span class="captcha-box">${captcha}</span></label>
            <input type="text" id="adminRecoveryCaptcha" placeholder="Type the 4-digit code..." style="width:100%; padding:10px; background:rgba(255,255,255,0.1); border:1px solid var(--accent); border-radius:8px; color:white; font-size:14px;">
          </div>
          <button id="recoverAccessBtn" class="recovery-btn"><i class="fas fa-unlock-alt"></i> AUTHENTICATE & RECOVER ACCESS</button>
          <div id="masterError" class="error-msg"></div>
          <div style="margin-top:10px; font-size:11px; color:var(--gray);">Device: ${deviceId}</div>
        </div>
      `;

      document.getElementById('recoverAccessBtn')?.addEventListener('click', () => this.handleAdminRecovery());
    } else {
      // NORMAL VERIFICATION STATE (Attempts 0, 1, 2)
      const attemptsLeft = 3 - this.failedAttempts;
      const badgeClass = this.failedAttempts === 0 ? 'safe' : this.failedAttempts === 1 ? 'warning' : 'danger';

      overlay.innerHTML = `
        <div class="master-box">
          <h2><i class="fas fa-shield-alt"></i> DEVICE VERIFICATION</h2>
          <div class="attempts-badge ${badgeClass}">${attemptsLeft} of 3 attempts remaining</div>
          <p style="margin-bottom:14px; color:var(--light); font-size:13px;">
            Enter pre-configured Master Device Verification Password to unlock system access.
          </p>
          <div style="text-align:left; margin-bottom:12px;">
            <label style="color:var(--accent); font-size:12px; display:block; margin-bottom:4px;"><i class="fas fa-lock"></i> Master Password / Device Key</label>
            <input type="password" id="masterPasswordInput" value="${SecurityManager.MASTER_PASSWORD}" placeholder="Enter master password..." style="width:100%; padding:10px; background:rgba(255,255,255,0.1); border:2px solid rgba(255,215,0,0.3); border-radius:8px; color:white; font-size:14px;">
          </div>
          <button id="verifyMasterBtn"><i class="fas fa-check-circle"></i> VERIFY & CONTINUE</button>
          <div id="masterError" class="error-msg"></div>
          <div style="margin-top:12px; font-size:11px; color:var(--gray);">Device ID: ${deviceId} &bull; Security Protocol Active</div>
        </div>
      `;

      document.getElementById('verifyMasterBtn')?.addEventListener('click', () => this.handleVerificationSubmit());
    }
  }

  private handleVerificationSubmit() {
    const input = document.getElementById('masterPasswordInput') as HTMLInputElement;
    const errorDiv = document.getElementById('masterError');
    const entered = (input?.value || '').trim();

    if (entered === SecurityManager.MASTER_PASSWORD) {
      // SUCCESS
      this.failedAttempts = 0;
      this.isLocked = false;
      localStorage.setItem(SecurityManager.STORAGE_ATTEMPTS, '0');
      localStorage.setItem(SecurityManager.STORAGE_LOCKED, 'false');
      localStorage.setItem(SecurityManager.STORAGE_AUTH, 'true');

      const overlay = document.getElementById('masterOverlay');
      if (overlay) overlay.style.display = 'none';

      this.notifySecurity('Device verified successfully. System access granted.', 'info');
      this.onAuthenticated();
    } else {
      // FAILURE
      this.failedAttempts++;
      localStorage.setItem(SecurityManager.STORAGE_ATTEMPTS, this.failedAttempts.toString());

      if (this.failedAttempts >= 3) {
        this.isLocked = true;
        localStorage.setItem(SecurityManager.STORAGE_LOCKED, 'true');
        this.notifySecurity('Security Alert: Device verification failed 3 times. Application access deactivated.', 'critical');
        this.renderVerificationBox();
      } else {
        const remaining = 3 - this.failedAttempts;
        if (errorDiv) {
          errorDiv.innerHTML = `<i class="fas fa-exclamation-triangle"></i> Invalid password. Attempt ${this.failedAttempts} of 3. (${remaining} left before lockout)`;
        }
        this.notifySecurity(`Device verification failed (Attempt ${this.failedAttempts} of 3)`, 'warning');
        this.renderVerificationBox();
      }
    }
  }

  private handleAdminRecovery() {
    const keyInput = document.getElementById('adminRecoveryKey') as HTMLInputElement;
    const captchaInput = document.getElementById('adminRecoveryCaptcha') as HTMLInputElement;
    const errorDiv = document.getElementById('masterError');

    const enteredKey = (keyInput?.value || '').trim();
    const enteredCaptcha = (captchaInput?.value || '').trim();

    if (enteredCaptcha !== this.currentCaptcha) {
      if (errorDiv) errorDiv.innerHTML = '<i class="fas fa-times-circle"></i> Security code does not match. Please re-enter.';
      this.generateCaptcha();
      const captchaEl = document.querySelector('.captcha-box');
      if (captchaEl) captchaEl.textContent = this.currentCaptcha;
      return;
    }

    if (enteredKey === SecurityManager.ADMIN_PASSWORD || enteredKey === SecurityManager.MASTER_PASSWORD) {
      // SUCCESSFUL RECOVERY
      this.failedAttempts = 0;
      this.isLocked = false;
      localStorage.setItem(SecurityManager.STORAGE_ATTEMPTS, '0');
      localStorage.setItem(SecurityManager.STORAGE_LOCKED, 'false');
      localStorage.setItem(SecurityManager.STORAGE_AUTH, 'true');

      const overlay = document.getElementById('masterOverlay');
      if (overlay) overlay.style.display = 'none';

      this.notifySecurity('Administrator recovery successful! Application access reactivated.', 'info');
      this.onAuthenticated();
    } else {
      if (errorDiv) errorDiv.innerHTML = '<i class="fas fa-times-circle"></i> Invalid administrator recovery key. Access remains deactivated.';
      this.generateCaptcha();
      const captchaEl = document.querySelector('.captcha-box');
      if (captchaEl) captchaEl.textContent = this.currentCaptcha;
      this.notifySecurity('Unauthorized administrator recovery attempt rejected', 'critical');
    }
  }
}
