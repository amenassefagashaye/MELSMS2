/**
 * EBP-SMS Core System Engine
 * Interconnects and synchronizes all six pages:
 * Register, Sales, Inventory, Deduct, Review, and Audit.
 */

import { StockItem, UnitConversionSystem } from './conversions';
import { AppNotification, NotificationEngine } from './notifications';
import { SecurityManager } from './security';
import { ExportEngine, SaleRecord, DeductionRecord, AuditRecord } from './exporter';

export class UltraStockSystem {
  public stockItems: StockItem[] = [];
  public salesData: SaleRecord[] = [];
  public transactions: DeductionRecord[] = [];
  public auditTrail: AuditRecord[] = [];
  public shareHistory: any[] = [];
  public currentId = 1;
  public salesCounter = 1001;
  public auditCounter = 1;

  public isEditing = false;
  public editingId: number | null = null;
  public isLoggedIn = false;
  public currentUserType: 'admin' | 'user' | null = null;
  public currentBranch = 'pharmacy';
  public salesHistoryPage = 1;
  public salesHistoryRowsPerPage = 20;

  public isProcessingTransaction = false; // Prevents duplicate submissions
  public isOnline = navigator.onLine;

  public settings = {
    lowStockThreshold: 20,
    expiryWarningDays: 30,
    expiryWarningDays60: 60,
    expiryWarningDays90: 90,
    defaultMarkup: 50.0,
    defaultVAT: 15.0,
    overstockAlert: 150,
    profitMarginAlert: 10,
    baseUnitsList: "tablet,capsule,ml,mg,g,piece,unit,dose,injection,patch",
    displayUnitsList: "tablet,capsule,piece,strip,bottle,pack,sachet,vial,ampoule",
    registeredUnitsList: "box,strip,bottle,pack,carton,jar,tube,sachet,vial,ampoule",
    userPassword: "123456",
    adminPassword: "kpi2123",
    masterPassword: "kpi21232026",
    pharmacyName: "Eras-Birhan Pharmaceuticals",
    brandName: "EBP-SMS",
    buttonTexts: {
      register: "Register",
      sales: "Sales",
      inventory: "Inventory",
      deduct: "Deduct",
      review: "Review",
      audit: "Audit",
    },
    maskUnitPrice: true,
    maskTotalCost: true,
    maskSellingPrice: true,
  };

  public currentTimeFilters: Record<string, string> = {
    register: 'all',
    sales: 'all',
    inventory: 'all',
    deduct: 'all',
    review: 'all',
    audit: 'all'
  };
  public exportTimeFilter = 'all';
  public currentSort = { inventory: 'default', share: 'default' };
  public selectedShareItems = new Set<number>();

  public notificationsEngine!: NotificationEngine;
  public securityManager!: SecurityManager;
  private notificationInterval: any = null;
  private charts: any = {};

  constructor() {
    this.initSecurity();
    this.initNotifications();
    this.loadState();
    this.setupEventListeners();
    this.setupUnitLists();
    this.setupFullscreen();
    this.setupOnlineListeners();
    this.setupEndingBalanceButton();
    this.setupExportDropdown();
    this.startNotificationDaemon();
    this.addSalesRow();
    this.syncAllPages();
  }

  private initSecurity() {
    this.securityManager = new SecurityManager(
      () => {
        // Authenticated callback
        console.log('Device verification passed');
      },
      (msg, type) => {
        if (this.notificationsEngine) {
          this.notificationsEngine.notify({
            id: `sec-${Date.now()}`,
            type: type === 'critical' ? 'critical' : 'warning',
            title: 'Security Alert',
            message: msg,
            targetRole: 'admin',
            category: 'security',
          });
        }
      }
    );
  }

  private initNotifications() {
    this.notificationsEngine = new NotificationEngine(
      () => this.currentUserType,
      (page, filter) => {
        this.openPage(page, filter);
      }
    );
  }

  private loadState() {
    try {
      const savedStock = localStorage.getItem('ebp-sms-stock');
      if (savedStock) {
        const parsed = JSON.parse(savedStock);
        this.stockItems = parsed.stockItems || [];
        this.currentId = parsed.currentId || 1;
      } else {
        this.seedInitialItems();
      }

      const savedSales = localStorage.getItem('ebp-sms-sales');
      if (savedSales) this.salesData = JSON.parse(savedSales);

      const savedAudit = localStorage.getItem('ebp-sms-audit');
      if (savedAudit) this.auditTrail = JSON.parse(savedAudit);

      const savedTx = localStorage.getItem('ebp-sms-transactions');
      if (savedTx) this.transactions = JSON.parse(savedTx);

      const savedSettings = localStorage.getItem('ebp-sms-settings');
      if (savedSettings) this.settings = { ...this.settings, ...JSON.parse(savedSettings) };

      const savedShare = localStorage.getItem('ebp-sms-share-history');
      if (savedShare) this.shareHistory = JSON.parse(savedShare);

      // Re-synchronize canonical balances across all loaded stock items
      this.stockItems.forEach(item => UnitConversionSystem.synchronizeItemBalances(item));
      this.auditCounter = this.auditTrail.length > 0 ? Math.max(...this.auditTrail.map(a => a.id)) + 1 : 1;
      this.salesCounter = this.salesData.length > 0 ? Math.max(...this.salesData.map(s => s.id)) + 1 : 1001;
    } catch (e) {
      console.error('Failed to load state', e);
    }
  }

  public saveState() {
    try {
      localStorage.setItem('ebp-sms-stock', JSON.stringify({ stockItems: this.stockItems, currentId: this.currentId }));
      localStorage.setItem('ebp-sms-sales', JSON.stringify(this.salesData));
      localStorage.setItem('ebp-sms-audit', JSON.stringify(this.auditTrail));
      localStorage.setItem('ebp-sms-transactions', JSON.stringify(this.transactions));
      localStorage.setItem('ebp-sms-settings', JSON.stringify(this.settings));
      localStorage.setItem('ebp-sms-share-history', JSON.stringify(this.shareHistory));
    } catch (e) {
      console.warn('LocalStorage save error', e);
    }
  }

  private seedInitialItems() {
    // Initial sample stock items if first run
    const initialNames = [
      { name: 'Amoxicillin 500mg', brand: 'Amoxil', cat: 'Antibiotics', base: 'capsule', reg: 'box', disp: 'strip', regFactor: 100, dispFactor: 10, qtyDisp: 50, buy: 35, sell: 55, batch: 'AMX-2026', exp: '2027-08-15' },
      { name: 'Paracetamol 500mg', brand: 'Panadol', cat: 'Analgesics', base: 'tablet', reg: 'box', disp: 'strip', regFactor: 200, dispFactor: 10, qtyDisp: 120, buy: 15, sell: 25, batch: 'PCT-9912', exp: '2027-12-30' },
      { name: 'Omeprazole 20mg', brand: 'Omez', cat: 'Gastrointestinal', base: 'capsule', reg: 'box', disp: 'strip', regFactor: 100, dispFactor: 10, qtyDisp: 18, buy: 40, sell: 65, batch: 'OMZ-4411', exp: '2026-11-20' }, // near expiry
      { name: 'Ciprofloxacin 500mg', brand: 'Cipro', cat: 'Antibiotics', base: 'tablet', reg: 'box', disp: 'strip', regFactor: 100, dispFactor: 10, qtyDisp: 5, buy: 50, sell: 80, batch: 'CIP-0021', exp: '2027-04-10' }, // low stock
      { name: 'Metformin 500mg', brand: 'Glucophage', cat: 'Antidiabetic', base: 'tablet', reg: 'box', disp: 'strip', regFactor: 100, dispFactor: 10, qtyDisp: 0, buy: 30, sell: 48, batch: 'MET-8832', exp: '2027-05-15' }, // out of stock
    ];

    initialNames.forEach(i => {
      const baseQty = i.qtyDisp * i.dispFactor;
      const item: StockItem = {
        id: this.currentId++,
        customId: `EBP-${this.currentId.toString().padStart(4, '0')}`,
        name: i.name,
        brandName: i.brand,
        category: i.cat,
        type: 'Medicine',
        baseUnit: i.base,
        registeredUnit: i.reg,
        displayUnit: i.disp,
        registeredToBaseFactor: i.regFactor,
        displayToBaseFactor: i.dispFactor,
        quantityBase: baseQty,
        quantityRegistered: baseQty / i.regFactor,
        quantityDisplay: i.qtyDisp,
        beginningBalance: i.qtyDisp,
        quantityReceived: i.qtyDisp,
        quantityIssued: 0,
        endingBalance: i.qtyDisp,
        physicalCount: i.qtyDisp,
        variance: 0,
        purchasePricePerDisplay: i.buy,
        markup: 50,
        sellingPricePerDisplay: i.sell,
        batchNumber: i.batch,
        expiryDate: i.exp,
        supplier: 'National Pharmaceutical Wholesaler',
        invoiceNumber: `INV-INIT-${this.currentId}`,
        registrant: 'System Administrator',
        branch: 'pharmacy',
        warehouse: 'main',
        storageCondition: 'ambient',
        minStockDisplay: 10,
        maxStockDisplay: 100,
        reorderLevelDisplay: 15,
        movement: 'normal',
        createdAt: new Date().toISOString(),
      };
      this.stockItems.push(item);
    });
    this.saveState();
  }

  /**
   * MASTER SYNCHRONIZATION ENGINE
   * Links and synchronizes Register, Sales, Inventory, Deduct, Review, and Audit pages.
   */
  public syncAllPages() {
    // 1. Enforce mathematical balances and unit conversions on all stock items
    this.stockItems.forEach(item => UnitConversionSystem.synchronizeItemBalances(item));

    // 2. Synchronize dropdowns, autocompletes, and selectors
    this.updateItemNameList();
    this.updateDatalists();
    this.updateSalesItemsList();
    this.updateReducePageSelect();
    this.updateCategoryFilter();

    // 3. Re-render active views
    this.renderRecentRegistrations();
    this.renderInventoryTable();
    this.renderSalesHistory();
    this.renderDeductionHistory();
    this.updateReviewDashboard();
    this.renderAuditTable();
    this.updateAuditSummary();

    // 4. Update notification badges
    this.checkNotifications();

    // 5. Persist state
    this.saveState();
  }

  // ==========================================
  // NOTIFICATION RULES & BACKGROUND DAEMON
  // ==========================================
  private startNotificationDaemon() {
    this.checkNotifications();
    this.notificationInterval = setInterval(() => this.checkNotifications(), 30000);
  }

  public checkNotifications() {
    const now = new Date();
    const items = this.stockItems.filter(i => i.branch === this.currentBranch);

    items.forEach(item => {
      const expDate = new Date(item.expiryDate);
      const diffDays = Math.ceil((expDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      const dispQty = item.quantityDisplay;

      // 1. Expired Stock -> URGENT
      if (diffDays < 0) {
        this.notificationsEngine.notify({
          id: `exp-${item.id}`,
          type: 'critical',
          title: 'Stock Expired',
          message: `${item.name} (Batch: ${item.batchNumber}) has expired. Remove immediately.`,
          category: 'expiry',
          itemId: item.id,
          page: 'stockInventoryPage',
          filter: 'expired',
          targetRole: 'all',
        });
      }
      // 2. Critical Expiry (<= 30 days) -> URGENT
      else if (diffDays <= 30 && diffDays > 0) {
        this.notificationsEngine.notify({
          id: `exp30-${item.id}`,
          type: 'critical',
          title: 'Urgent Expiry Notice',
          message: `${item.name} expires in ${diffDays} days (${item.expiryDate}). Prioritize dispensing.`,
          category: 'expiry',
          itemId: item.id,
          page: 'stockInventoryPage',
          filter: 'expiry',
          targetRole: 'all',
        });
      }
      // 3. Near Expiry (31 - 90 days) -> WARNING
      else if (diffDays <= 90 && diffDays > 30) {
        this.notificationsEngine.notify({
          id: `exp90-${item.id}`,
          type: 'warning',
          title: 'Near Expiry Warning',
          message: `${item.name} expires in ${diffDays} days. Monitor stock movement.`,
          category: 'expiry',
          itemId: item.id,
          page: 'stockInventoryPage',
          filter: 'expiry',
          targetRole: 'all',
        });
      }

      // 4. Stock Out (<= 0) -> URGENT
      if (dispQty <= 0) {
        this.notificationsEngine.notify({
          id: `out-${item.id}`,
          type: 'critical',
          title: 'Stock Depleted (Out of Stock)',
          message: `${item.name} is completely out of stock. Immediate replenishment required.`,
          category: 'stock',
          itemId: item.id,
          page: 'stockInventoryPage',
          filter: 'stockout',
          targetRole: 'all',
        });
      }
      // 5. Reorder Level -> URGENT
      else if (dispQty <= item.reorderLevelDisplay && dispQty > 0) {
        this.notificationsEngine.notify({
          id: `reord-${item.id}`,
          type: 'critical',
          title: 'Reorder Level Reached',
          message: `${item.name} reached reorder level (${dispQty} ${item.displayUnit} left). Place order soon.`,
          category: 'stock',
          itemId: item.id,
          page: 'stockInventoryPage',
          filter: 'reorder',
          targetRole: 'all',
        });
      }
      // 6. Low Stock (< minStock) -> WARNING
      else if (dispQty < item.minStockDisplay && dispQty > 0) {
        this.notificationsEngine.notify({
          id: `low-${item.id}`,
          type: 'warning',
          title: 'Low Stock Alert',
          message: `${item.name} is below minimum stock (${dispQty} / ${item.minStockDisplay} ${item.displayUnit}).`,
          category: 'stock',
          itemId: item.id,
          page: 'stockInventoryPage',
          filter: 'low',
          targetRole: 'all',
        });
      }
      // 7. Overstock (> maxStock) -> UPDATE (INFO)
      else if (dispQty > item.maxStockDisplay) {
        this.notificationsEngine.notify({
          id: `over-${item.id}`,
          type: 'info',
          title: 'Overstock Notice',
          message: `${item.name} exceeds max capacity (${dispQty} / ${item.maxStockDisplay} ${item.displayUnit}).`,
          category: 'stock',
          itemId: item.id,
          page: 'stockInventoryPage',
          filter: 'over',
          targetRole: 'admin',
        });
      }
    });

    this.notificationsEngine.updateCounters();
  }

  // ==========================================
  // PAGE 1: REGISTER STOCK
  // ==========================================
  public saveItem() {
    if (this.isProcessingTransaction) return;
    this.isProcessingTransaction = true;

    try {
      const nameInput = (document.getElementById('itemName') as HTMLInputElement)?.value.trim();
      if (!nameInput) {
        this.showToast('Please enter generic name', 'warning');
        return;
      }

      const displayUnit = (document.getElementById('displayUnit') as HTMLInputElement)?.value.trim() || 'piece';
      const baseUnit = (document.getElementById('baseUnit') as HTMLInputElement)?.value.trim() || 'piece';
      const registeredUnit = (document.getElementById('registeredUnit') as HTMLInputElement)?.value.trim() || 'box';

      const dispToBase = Math.max(0.000001, parseFloat((document.getElementById('displayToBaseFactor') as HTMLInputElement)?.value) || 1);
      const regToBase = Math.max(0.000001, parseFloat((document.getElementById('registeredToBaseFactor') as HTMLInputElement)?.value) || 1);

      const qtyDisplay = parseFloat((document.getElementById('qtyDisplay') as HTMLInputElement)?.value) || 0;
      const qtyBase = qtyDisplay * dispToBase;

      const purchase = parseFloat((document.getElementById('purchasePricePerDisplay') as HTMLInputElement)?.value) || 0;
      const markup = parseFloat((document.getElementById('markup') as HTMLInputElement)?.value) || this.settings.defaultMarkup;
      const discount = parseFloat((document.getElementById('discountPercent') as HTMLInputElement)?.value) || 0;
      const selling = parseFloat((document.getElementById('sellingPricePerDisplay') as HTMLInputElement)?.value) || purchase * (1 + markup / 100);

      const batch = (document.getElementById('batchNumber') as HTMLInputElement)?.value.trim() || `BTH-${Date.now()}`;
      const expiry = (document.getElementById('expiryDate') as HTMLInputElement)?.value || new Date(Date.now() + 365 * 86400000).toISOString().split('T')[0];

      const item: StockItem = {
        id: this.isEditing && this.editingId ? this.editingId : this.currentId++,
        customId: (document.getElementById('itemIdInput') as HTMLInputElement)?.value.trim() || `ITEM-${this.currentId}`,
        name: nameInput,
        brandName: (document.getElementById('brandName') as HTMLInputElement)?.value.trim() || '',
        category: (document.getElementById('category') as HTMLInputElement)?.value.trim() || 'General',
        type: (document.getElementById('itemType') as HTMLInputElement)?.value.trim() || 'Medicine',
        baseUnit,
        registeredUnit,
        displayUnit,
        registeredToBaseFactor: regToBase,
        displayToBaseFactor: dispToBase,
        quantityBase: qtyBase,
        quantityRegistered: qtyBase / regToBase,
        quantityDisplay: qtyDisplay,
        beginningBalance: qtyDisplay,
        quantityReceived: qtyDisplay,
        quantityIssued: 0,
        endingBalance: qtyDisplay,
        physicalCount: qtyDisplay,
        variance: 0,
        purchasePricePerDisplay: purchase,
        markup,
        discountPercent: discount,
        sellingPricePerDisplay: selling,
        batchNumber: batch,
        expiryDate: expiry,
        supplier: (document.getElementById('supplier') as HTMLInputElement)?.value.trim() || 'Default Supplier',
        invoiceNumber: (document.getElementById('invoiceNumber') as HTMLInputElement)?.value.trim() || '',
        registrant: (document.getElementById('registrant') as HTMLInputElement)?.value.trim() || (this.currentUserType || 'Pharmacist'),
        branch: (document.getElementById('branch') as HTMLSelectElement)?.value || this.currentBranch,
        warehouse: (document.getElementById('warehouse') as HTMLSelectElement)?.value || 'main',
        storageCondition: (document.getElementById('storageCondition') as HTMLSelectElement)?.value || 'ambient',
        shelfBin: (document.getElementById('shelfBin') as HTMLInputElement)?.value.trim() || '',
        minStockDisplay: parseFloat((document.getElementById('minStockDisplay') as HTMLInputElement)?.value) || 10,
        maxStockDisplay: parseFloat((document.getElementById('maxStockDisplay') as HTMLInputElement)?.value) || 100,
        reorderLevelDisplay: parseFloat((document.getElementById('reorderLevelDisplay') as HTMLInputElement)?.value) || 20,
        createdAt: new Date().toISOString(),
      };

      if (this.isEditing && this.editingId) {
        const idx = this.stockItems.findIndex(i => i.id === this.editingId);
        if (idx >= 0) this.stockItems[idx] = item;
        this.recordAudit('edit_item', item.id, item.name, qtyDisplay, 'stock_edit', item.branch, item.registrant || 'User', { selling, purchase });
        this.showToast(`Updated item: ${item.name}`, 'success');
      } else {
        this.stockItems.push(item);
        this.recordAudit('purchase', item.id, item.name, qtyDisplay, 'stock_in', item.branch, item.registrant || 'User', { value: qtyDisplay * purchase });
        this.showToast(`Registered new item: ${item.name}`, 'success');

        // Immediate Notification Check on registration
        const expDiff = Math.ceil((new Date(expiry).getTime() - Date.now()) / (86400000));
        if (expDiff <= 30) {
          this.notificationsEngine.notify({
            id: `new-exp-${item.id}`,
            type: 'critical',
            title: 'Critical Shelf-life Intake',
            message: `Newly registered ${item.name} has short expiry (${item.expiryDate}).`,
            targetRole: 'all',
          });
        }
      }

      this.clearRegisterForm();
      this.syncAllPages();
    } finally {
      this.isProcessingTransaction = false;
    }
  }

  public clearRegisterForm() {
    (document.getElementById('stockForm') as HTMLFormElement)?.reset();
    (document.getElementById('expiryDate') as HTMLInputElement).value = new Date().toISOString().split('T')[0];
    (document.getElementById('markup') as HTMLInputElement).value = this.settings.defaultMarkup.toString();
    this.isEditing = false;
    this.editingId = null;
    const btn = document.getElementById('saveBtn');
    if (btn) btn.innerHTML = '<i class="fas fa-save"></i> Save Item';
  }

  // ==========================================
  // PAGE 2: SALES TRANSACTION
  // ==========================================
  public addSalesRow() {
    const tbody = document.getElementById('salesItemsBody');
    if (!tbody) return;

    const rowId = `row_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const tr = document.createElement('tr');
    tr.setAttribute('data-id', rowId);

    tr.innerHTML = `
      <td><input type="text" class="sales-item" list="salesItemsList" placeholder="Search item (ID / Name / Brand)" style="width:200px;" autocomplete="off"></td>
      <td><input type="text" class="sales-category" readonly style="width:100px;"></td>
      <td><input type="text" class="sales-type" readonly style="width:100px;"></td>
      <td><input type="text" class="sales-batch" readonly style="width:100px;"></td>
      <td><input type="text" class="sales-expiry" readonly style="width:100px;"></td>
      <td>
        <div style="display:flex; gap:4px;">
          <input type="number" class="sales-quantity" min="0.01" step="0.01" style="width:70px;" value="1">
          <select class="sales-unit-dropdown" style="width:80px;">
            <option value="display" selected>Display</option>
            <option value="register">Register</option>
            <option value="base">Base</option>
          </select>
        </div>
      </td>
      <td><input type="number" class="sales-price" step="0.01" style="width:90px;" value="0"></td>
      <td><input type="number" class="sales-total" readonly style="width:90px;" class="total-display"></td>
      <td><input type="number" class="sales-markup" placeholder="Markup %" style="width:65px;" value="0"></td>
      <td><input type="number" class="sales-discount" placeholder="Discount %" style="width:65px;" value="0"></td>
      <td><input type="number" class="sales-vat" placeholder="VAT %" style="width:65px;" value="${this.settings.defaultVAT}"></td>
      <td>
        <button type="button" class="action-btn remove-row-btn"><i class="fas fa-times"></i></button>
      </td>
    `;

    tbody.appendChild(tr);

    const itemInput = tr.querySelector('.sales-item') as HTMLInputElement;
    itemInput.addEventListener('input', () => this.updateSalesRow(rowId));
    itemInput.addEventListener('change', () => this.updateSalesRow(rowId));

    // When unit changes: auto-convert unit price based on conversion factor
    tr.querySelector('.sales-unit-dropdown')?.addEventListener('change', () => {
      const val = (tr.querySelector('.sales-item') as HTMLInputElement)?.value.trim();
      const item = this.findStockItemByQuery(val);
      const unitType = (tr.querySelector('.sales-unit-dropdown') as HTMLSelectElement)?.value || 'display';
      if (item) {
        let price = item.sellingPricePerDisplay;
        if (unitType === 'register') {
          price = item.sellingPricePerDisplay * (item.registeredToBaseFactor / item.displayToBaseFactor);
        } else if (unitType === 'base') {
          price = item.sellingPricePerDisplay / item.displayToBaseFactor;
        }
        (tr.querySelector('.sales-price') as HTMLInputElement).value = (Math.round(price * 100) / 100).toFixed(2);
      }
      this.calcSalesRow(rowId);
    });

    // When price changes: auto-recalculate markup %
    tr.querySelector('.sales-price')?.addEventListener('input', () => {
      const val = (tr.querySelector('.sales-item') as HTMLInputElement)?.value.trim();
      const item = this.findStockItemByQuery(val);
      const unitType = (tr.querySelector('.sales-unit-dropdown') as HTMLSelectElement)?.value || 'display';
      const price = parseFloat((tr.querySelector('.sales-price') as HTMLInputElement)?.value) || 0;
      if (item) {
        let unitCost = item.purchasePricePerDisplay;
        if (unitType === 'register') {
          unitCost = item.purchasePricePerDisplay * (item.registeredToBaseFactor / item.displayToBaseFactor);
        } else if (unitType === 'base') {
          unitCost = item.purchasePricePerDisplay / item.displayToBaseFactor;
        }
        if (unitCost > 0) {
          const calcMarkup = ((price - unitCost) / unitCost) * 100;
          (tr.querySelector('.sales-markup') as HTMLInputElement).value = calcMarkup.toFixed(1);
        }
      }
      this.calcSalesRow(rowId);
    });

    // When markup changes: auto-recalculate unit price
    tr.querySelector('.sales-markup')?.addEventListener('input', () => {
      const val = (tr.querySelector('.sales-item') as HTMLInputElement)?.value.trim();
      const item = this.findStockItemByQuery(val);
      const unitType = (tr.querySelector('.sales-unit-dropdown') as HTMLSelectElement)?.value || 'display';
      const markup = parseFloat((tr.querySelector('.sales-markup') as HTMLInputElement)?.value) || 0;
      if (item) {
        let unitCost = item.purchasePricePerDisplay;
        if (unitType === 'register') {
          unitCost = item.purchasePricePerDisplay * (item.registeredToBaseFactor / item.displayToBaseFactor);
        } else if (unitType === 'base') {
          unitCost = item.purchasePricePerDisplay / item.displayToBaseFactor;
        }
        const newPrice = unitCost * (1 + markup / 100);
        (tr.querySelector('.sales-price') as HTMLInputElement).value = (Math.round(newPrice * 100) / 100).toFixed(2);
      }
      this.calcSalesRow(rowId);
    });

    tr.querySelector('.sales-quantity')?.addEventListener('input', () => this.calcSalesRow(rowId));
    tr.querySelector('.sales-discount')?.addEventListener('input', () => this.calcSalesRow(rowId));
    tr.querySelector('.sales-vat')?.addEventListener('input', () => this.calcSalesRow(rowId));

    tr.querySelector('.remove-row-btn')?.addEventListener('click', () => {
      tr.remove();
      this.updateSalesTotals();
    });

    this.calcSalesRow(rowId);
  }

  public updateSalesRow(rowId: string) {
    const tr = document.querySelector(`tr[data-id="${rowId}"]`);
    if (!tr) return;

    const val = (tr.querySelector('.sales-item') as HTMLInputElement)?.value.trim();
    const item = this.findStockItemByQuery(val);
    const unitType = (tr.querySelector('.sales-unit-dropdown') as HTMLSelectElement)?.value || 'display';

    if (item) {
      (tr.querySelector('.sales-category') as HTMLInputElement).value = item.category || '';
      (tr.querySelector('.sales-type') as HTMLInputElement).value = item.type || '';
      (tr.querySelector('.sales-batch') as HTMLInputElement).value = item.batchNumber;
      (tr.querySelector('.sales-expiry') as HTMLInputElement).value = item.expiryDate;

      let price = item.sellingPricePerDisplay;
      if (unitType === 'register') {
        price = item.sellingPricePerDisplay * (item.registeredToBaseFactor / item.displayToBaseFactor);
      } else if (unitType === 'base') {
        price = item.sellingPricePerDisplay / item.displayToBaseFactor;
      }
      (tr.querySelector('.sales-price') as HTMLInputElement).value = (Math.round(price * 100) / 100).toFixed(2);
      (tr.querySelector('.sales-markup') as HTMLInputElement).value = item.markup.toString();
    }
    this.calcSalesRow(rowId);
  }

  public calcSalesRow(rowId: string) {
    const tr = document.querySelector(`tr[data-id="${rowId}"]`);
    if (!tr) return;

    const itemQuery = (tr.querySelector('.sales-item') as HTMLInputElement)?.value.trim();
    const item = this.findStockItemByQuery(itemQuery);

    const qty = parseFloat((tr.querySelector('.sales-quantity') as HTMLInputElement)?.value) || 0;
    const unitType = (tr.querySelector('.sales-unit-dropdown') as HTMLSelectElement)?.value || 'display';
    let price = parseFloat((tr.querySelector('.sales-price') as HTMLInputElement)?.value) || 0;
    const discount = parseFloat((tr.querySelector('.sales-discount') as HTMLInputElement)?.value) || 0;
    const vat = parseFloat((tr.querySelector('.sales-vat') as HTMLInputElement)?.value) || 0;

    let subtotal = qty * price;
    if (discount > 0) subtotal *= (1 - discount / 100);
    const total = subtotal * (1 + vat / 100);

    (tr.querySelector('.sales-total') as HTMLInputElement).value = total.toFixed(2);
    this.updateSalesTotals();
  }

  public updateSalesTotals() {
    let subtotal = 0;
    let totalDiscount = 0;
    let totalVAT = 0;
    let totalCOGS = 0;

    const rows = document.querySelectorAll('#salesItemsBody tr');
    rows.forEach(tr => {
      const itemQuery = (tr.querySelector('.sales-item') as HTMLInputElement)?.value.trim();
      const item = this.findStockItemByQuery(itemQuery);

      const qty = parseFloat((tr.querySelector('.sales-quantity') as HTMLInputElement)?.value) || 0;
      const unitType = (tr.querySelector('.sales-unit-dropdown') as HTMLSelectElement)?.value || 'display';
      const price = parseFloat((tr.querySelector('.sales-price') as HTMLInputElement)?.value) || 0;
      const discount = parseFloat((tr.querySelector('.sales-discount') as HTMLInputElement)?.value) || 0;
      const vat = parseFloat((tr.querySelector('.sales-vat') as HTMLInputElement)?.value) || 0;

      const lineGross = qty * price;
      const discAmt = lineGross * (discount / 100);
      const afterDisc = lineGross - discAmt;
      const vatAmt = afterDisc * (vat / 100);

      subtotal += afterDisc;
      totalDiscount += discAmt;
      totalVAT += vatAmt;

      if (item) {
        // Calculate COGS in display unit equivalent
        let displayQty = qty;
        if (unitType === 'base') displayQty = qty / item.displayToBaseFactor;
        else if (unitType === 'register') displayQty = (qty * item.registeredToBaseFactor) / item.displayToBaseFactor;
        totalCOGS += displayQty * (item.purchasePricePerDisplay || 0);
      }
    });

    const grandTotal = subtotal + totalVAT;
    const grossProfit = grandTotal - totalCOGS;
    const margin = grandTotal > 0 ? (grossProfit / grandTotal) * 100 : 0;

    const subEl = document.getElementById('salesSubtotal');
    const discEl = document.getElementById('salesTotalDiscount');
    const vatEl = document.getElementById('salesTotalVAT');
    const grandEl = document.getElementById('salesGrandTotal');
    const cogsEl = document.getElementById('salesCOGS');
    const profitEl = document.getElementById('salesGrossProfit');
    const marginEl = document.getElementById('salesProfitMargin');

    if (subEl) subEl.textContent = `ETB ${subtotal.toFixed(2)}`;
    if (discEl) discEl.textContent = `ETB ${totalDiscount.toFixed(2)}`;
    if (vatEl) vatEl.textContent = `ETB ${totalVAT.toFixed(2)}`;
    if (grandEl) grandEl.textContent = `ETB ${grandTotal.toFixed(2)}`;
    if (cogsEl) cogsEl.textContent = `ETB ${totalCOGS.toFixed(2)}`;
    if (profitEl) profitEl.textContent = `ETB ${grossProfit.toFixed(2)}`;
    if (marginEl) marginEl.textContent = `${margin.toFixed(1)}%`;
  }

  public processSale() {
    if (this.isProcessingTransaction) return;
    this.isProcessingTransaction = true;

    try {
      const rows = document.querySelectorAll('#salesItemsBody tr');
      if (rows.length === 0) {
        this.showToast('Please add items to sell', 'warning');
        return;
      }

      const saleItems: any[] = [];
      let hasError = false;

      // Validate all items & stock availability first
      for (const row of Array.from(rows)) {
        const itemVal = (row.querySelector('.sales-item') as HTMLInputElement)?.value.trim();
        const item = this.findStockItemByQuery(itemVal);
        if (!item) {
          this.showToast(`Item "${itemVal}" not found`, 'warning');
          hasError = true;
          break;
        }

        const inputQty = parseFloat((row.querySelector('.sales-quantity') as HTMLInputElement)?.value) || 0;
        const unitType = (row.querySelector('.sales-unit-dropdown') as HTMLSelectElement)?.value || 'display';
        const price = parseFloat((row.querySelector('.sales-price') as HTMLInputElement)?.value) || 0;
        const total = parseFloat((row.querySelector('.sales-total') as HTMLInputElement)?.value) || 0;

        // Convert to display units for stock deduction
        let displayQtyToDeduct = inputQty;
        if (unitType === 'base') displayQtyToDeduct = inputQty / item.displayToBaseFactor;
        else if (unitType === 'register') displayQtyToDeduct = (inputQty * item.registeredToBaseFactor) / item.displayToBaseFactor;

        if (item.quantityDisplay < displayQtyToDeduct) {
          this.showToast(`Insufficient stock for ${item.name}. Available: ${item.quantityDisplay.toFixed(2)} ${item.displayUnit}`, 'danger');
          hasError = true;
          break;
        }

        saleItems.push({
          item,
          inputQty,
          unitType,
          displayQtyToDeduct,
          price,
          total,
          markup: parseFloat((row.querySelector('.sales-markup') as HTMLInputElement)?.value) || 0,
          discount: parseFloat((row.querySelector('.sales-discount') as HTMLInputElement)?.value) || 0,
          vat: parseFloat((row.querySelector('.sales-vat') as HTMLInputElement)?.value) || 0,
        });
      }

      if (hasError || saleItems.length === 0) return;

      // Commit stock deductions and update ledger
      const committedItems = saleItems.map(si => {
        const item = si.item as StockItem;
        const baseQtyToDeduct = si.displayQtyToDeduct * item.displayToBaseFactor;

        item.quantityBase = Math.max(0, item.quantityBase - baseQtyToDeduct);
        item.quantityDisplay = Math.max(0, item.quantityBase / item.displayToBaseFactor);
        item.quantityRegistered = Math.max(0, item.quantityBase / item.registeredToBaseFactor);
        item.quantityIssued = (item.quantityIssued || 0) + si.displayQtyToDeduct;
        item.endingBalance = item.quantityDisplay;
        item.physicalCount = item.endingBalance;

        // Fast moving check
        if (!item.movementHistory) item.movementHistory = [];
        item.movementHistory.push({ date: new Date().toISOString(), qty: si.displayQtyToDeduct });

        // Record individual audit for stock out
        this.recordAudit('sale', item.id, item.name, si.displayQtyToDeduct, 'stock_out', this.currentBranch, (document.getElementById('salesperson') as HTMLInputElement)?.value || 'Salesperson', {
          price: si.price,
          total: si.total,
          unit: item.displayUnit
        });

        // Trigger immediate low stock or stock out alert
        if (item.quantityDisplay <= 0) {
          this.notificationsEngine.notify({
            id: `sale-out-${item.id}`,
            type: 'critical',
            title: 'Depleted Stockout During Sale',
            message: `${item.name} is now completely out of stock.`,
            targetRole: 'all',
          });
        } else if (item.quantityDisplay <= item.reorderLevelDisplay) {
          this.notificationsEngine.notify({
            id: `sale-reord-${item.id}`,
            type: 'critical',
            title: 'Reorder Urgency',
            message: `${item.name} dropped to ${item.quantityDisplay.toFixed(2)} ${item.displayUnit} (reorder point: ${item.reorderLevelDisplay}).`,
            targetRole: 'all',
          });
        }

        return {
          id: item.id,
          name: item.name,
          category: item.category,
          type: item.type,
          quantity: si.displayQtyToDeduct,
          unit: item.displayUnit,
          unitPrice: si.price,
          netAmount: si.total,
          inputQuantity: si.inputQty,
          inputUnitType: si.unitType,
          markup: si.markup,
          discount: si.discount,
          vat: si.vat,
          batch: item.batchNumber,
          expiry: item.expiryDate
        };
      });

      const grandTotal = parseFloat((document.getElementById('salesGrandTotal')?.textContent || '0').replace('ETB ', '')) || 0;
      const cogs = parseFloat((document.getElementById('salesCOGS')?.textContent || '0').replace('ETB ', '')) || 0;
      const profit = parseFloat((document.getElementById('salesGrossProfit')?.textContent || '0').replace('ETB ', '')) || 0;
      const margin = parseFloat((document.getElementById('salesProfitMargin')?.textContent || '0').replace('%', '')) || 0;

      const invoiceNum = (document.getElementById('salesInvoiceNumber') as HTMLInputElement)?.value.trim() || `INV-${Date.now()}`;
      const saleRecord: SaleRecord = {
        id: this.salesCounter++,
        date: (document.getElementById('salesDate') as HTMLInputElement)?.value || new Date().toISOString().split('T')[0],
        branch: (document.getElementById('salesBranch') as HTMLSelectElement)?.value || this.currentBranch,
        paymentMethod: (document.getElementById('salesPaymentMethod') as HTMLSelectElement)?.value || 'cash',
        customerName: (document.getElementById('customerName') as HTMLInputElement)?.value.trim() || 'Walk-in Customer',
        customerType: (document.getElementById('customerType') as HTMLSelectElement)?.value || 'Individual',
        salesperson: (document.getElementById('salesperson') as HTMLInputElement)?.value.trim() || 'Pharmacist',
        invoiceNumber: invoiceNum,
        items: committedItems,
        subtotal: parseFloat((document.getElementById('salesSubtotal')?.textContent || '0').replace('ETB ', '')) || 0,
        totalDiscount: parseFloat((document.getElementById('salesTotalDiscount')?.textContent || '0').replace('ETB ', '')) || 0,
        vat: parseFloat((document.getElementById('salesTotalVAT')?.textContent || '0').replace('ETB ', '')) || 0,
        grandTotal,
        cogs,
        profit,
        margin,
        timestamp: new Date().toISOString(),
      };

      this.salesData.unshift(saleRecord);

      // Warning if low margin sale
      if (margin < this.settings.profitMarginAlert) {
        this.notificationsEngine.notify({
          id: `low-margin-${invoiceNum}`,
          type: 'warning',
          title: 'Low Profit Margin Sale',
          message: `Invoice ${invoiceNum} achieved only ${margin.toFixed(1)}% margin (Alert threshold: ${this.settings.profitMarginAlert}%).`,
          targetRole: 'admin',
        });
      }

      this.showToast(`Sale recorded successfully! Total: ETB ${grandTotal.toFixed(2)}`, 'success');
      this.clearSalesForm();
      this.syncAllPages();
    } finally {
      this.isProcessingTransaction = false;
    }
  }

  public clearSalesForm() {
    const tbody = document.getElementById('salesItemsBody');
    if (tbody) tbody.innerHTML = '';
    this.addSalesRow();
    const invInput = document.getElementById('salesInvoiceNumber') as HTMLInputElement;
    if (invInput) invInput.value = `INV-${Date.now()}`;
    const custInput = document.getElementById('customerName') as HTMLInputElement;
    if (custInput) custInput.value = '';
    this.updateSalesTotals();
  }

  // ==========================================
  // PAGE 3: INVENTORY TABLE & ACTIONS
  // ==========================================
  public renderInventoryTable() {
    const tbody = document.getElementById('stockTableBody');
    const footer = document.getElementById('inventoryFooter');
    if (!tbody) return;

    let items = this.stockItems.filter(i => i.branch === this.currentBranch);

    const search = (document.getElementById('searchInput') as HTMLInputElement)?.value.toLowerCase() || '';
    if (search) {
      items = items.filter(i => i.name.toLowerCase().includes(search) || (i.brandName && i.brandName.toLowerCase().includes(search)) || i.batchNumber.toLowerCase().includes(search));
    }

    const cat = (document.getElementById('categoryFilter') as HTMLSelectElement)?.value;
    if (cat) items = items.filter(i => i.category === cat);

    const status = (document.getElementById('statusFilter') as HTMLSelectElement)?.value;
    if (status) {
      const now = new Date();
      items = items.filter(i => {
        const diff = Math.ceil((new Date(i.expiryDate).getTime() - now.getTime()) / (86400000));
        if (status === 'low') return i.quantityDisplay > 0 && i.quantityDisplay < i.minStockDisplay;
        if (status === 'over') return i.quantityDisplay > i.maxStockDisplay;
        if (status === 'expiry') return diff > 0 && diff <= 90;
        if (status === 'expired') return diff < 0;
        if (status === 'stockout') return i.quantityDisplay <= 0;
        if (status === 'reorder') return i.quantityDisplay <= i.reorderLevelDisplay;
        return true;
      });
    }

    // Sort mode
    if (this.currentSort.inventory === 'name-asc') {
      items.sort((a, b) => a.name.localeCompare(b.name));
    } else if (this.currentSort.inventory === 'name-desc') {
      items.sort((a, b) => b.name.localeCompare(a.name));
    } else {
      // FEFO (Earliest expiry first)
      items.sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime());
    }

    if (items.length === 0) {
      tbody.innerHTML = '<tr><td colspan="24" style="text-align:center; padding:1.5rem; color:var(--gray);">No inventory items matching current filter</td></tr>';
      if (footer) footer.innerHTML = '';
      return;
    }

    let sumQty = 0;
    let sumValue = 0;
    let sumCost = 0;

    tbody.innerHTML = items.map(item => {
      const totalVal = item.quantityDisplay * item.sellingPricePerDisplay;
      const totalCost = item.quantityDisplay * item.purchasePricePerDisplay;
      sumQty += item.quantityDisplay;
      sumValue += totalVal;
      sumCost += totalCost;

      const expDate = new Date(item.expiryDate);
      const daysLeft = Math.ceil((expDate.getTime() - Date.now()) / (86400000));
      const expStatus = daysLeft < 0 ? 'status-expired' : daysLeft <= 30 ? 'status-critical' : daysLeft <= 90 ? 'status-warning' : 'status-ok';

      const variance = (item.physicalCount || item.quantityDisplay) - (item.endingBalance || item.quantityDisplay);
      const varClass = variance >= 0 ? 'variance-positive' : 'variance-negative';

      return `
        <tr data-id="${item.id}">
          <td><strong>${item.name}</strong></td>
          <td>${item.category}</td>
          <td>${item.type || '-'}</td>
          <td>${item.baseUnit}</td>
          <td>${item.registeredUnit}</td>
          <td>${item.displayUnit}</td>
          <td>${item.quantityBase.toFixed(2)}</td>
          <td>${(item.quantityRegistered || 0).toFixed(2)}</td>
          <td style="font-weight:bold; color:var(--accent);">${item.quantityDisplay.toFixed(2)}</td>
          <td>${(item.beginningBalance || item.quantityDisplay).toFixed(2)}</td>
          <td>${(item.quantityReceived || item.quantityDisplay).toFixed(2)}</td>
          <td>${(item.quantityIssued || 0).toFixed(2)}</td>
          <td>${(item.endingBalance || item.quantityDisplay).toFixed(2)}</td>
          <td>
            <input type="number" class="physical-count-input" data-id="${item.id}" value="${(item.physicalCount || item.quantityDisplay).toFixed(2)}" style="width:75px; padding:3px; background:rgba(255,255,255,0.08); border:1px solid rgba(255,215,0,0.3); border-radius:4px; color:white;">
          </td>
          <td class="${varClass}">${variance >= 0 ? '+' : ''}${variance.toFixed(2)}</td>
          <td>${item.minStockDisplay}/${item.reorderLevelDisplay}/${item.maxStockDisplay}</td>
          <td>ETB ${item.purchasePricePerDisplay.toFixed(2)}</td>
          <td>ETB ${item.sellingPricePerDisplay.toFixed(2)}</td>
          <td>${item.markup}%</td>
          <td style="font-weight:bold;">ETB ${totalVal.toFixed(2)}</td>
          <td>${item.batchNumber}</td>
          <td><span class="status-indicator ${expStatus}"></span>${item.expiryDate}</td>
          <td>${daysLeft < 0 ? 'EXPIRED' : `${daysLeft}d left`}</td>
          <td>
            <div class="action-buttons">
              <button class="action-btn edit-item" data-id="${item.id}" title="Edit"><i class="fas fa-edit"></i></button>
              <button class="action-btn reduce-item" data-id="${item.id}" title="Deduct"><i class="fas fa-minus"></i></button>
              <button class="action-btn verify-item" data-id="${item.id}" title="Verify Balance"><i class="fas fa-check-double"></i></button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    if (footer) {
      footer.innerHTML = `
        <tr class="total-row">
          <td colspan="8" style="text-align:right;">TOTAL ACCUMULATED:</td>
          <td>${sumQty.toFixed(2)}</td>
          <td colspan="10">ETB ${sumValue.toFixed(2)} (Total Cost: ETB ${sumCost.toFixed(2)})</td>
          <td colspan="5"></td>
        </tr>
      `;
    }

    // Attach row events
    tbody.querySelectorAll('.physical-count-input').forEach(inp => {
      inp.addEventListener('change', (e) => {
        const id = parseInt((e.target as HTMLElement).dataset.id || '0');
        const val = parseFloat((e.target as HTMLInputElement).value) || 0;
        this.updatePhysicalCount(id, val);
      });
    });

    tbody.querySelectorAll('.edit-item').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = parseInt((e.currentTarget as HTMLElement).dataset.id || '0');
        this.editItem(id);
      });
    });

    tbody.querySelectorAll('.reduce-item').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = parseInt((e.currentTarget as HTMLElement).dataset.id || '0');
        this.openPage('reduceStockPage');
        setTimeout(() => {
          const sel = document.getElementById('reduceItemSelect') as HTMLSelectElement;
          if (sel) {
            sel.value = id.toString();
            this.updateReduceDetails();
          }
        }, 80);
      });
    });

    tbody.querySelectorAll('.verify-item').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = parseInt((e.currentTarget as HTMLElement).dataset.id || '0');
        this.verifyStockBalance(id);
      });
    });
  }

  public updatePhysicalCount(itemId: number, newCount: number) {
    const item = this.stockItems.find(i => i.id === itemId);
    if (!item) return;

    item.physicalCount = newCount;
    item.variance = Math.round((newCount - (item.endingBalance || item.quantityDisplay)) * 10000) / 10000;

    this.recordAudit('verification', item.id, item.name, Math.abs(item.variance), 'stock_verify', item.branch, this.currentUserType || 'Pharmacist', {
      expected: item.endingBalance,
      physical: newCount,
      variance: item.variance
    });

    if (item.variance < 0) {
      this.notificationsEngine.notify({
        id: `var-neg-${item.id}`,
        type: 'critical',
        title: 'Inventory Shortage Variance',
        message: `${item.name} has a shortage of ${Math.abs(item.variance)} ${item.displayUnit}.`,
        targetRole: 'admin',
      });
    } else if (item.variance > 0) {
      this.notificationsEngine.notify({
        id: `var-pos-${item.id}`,
        type: 'info',
        title: 'Inventory Surplus Found',
        message: `${item.name} has an excess count of +${item.variance} ${item.displayUnit}.`,
        targetRole: 'admin',
      });
    }

    this.syncAllPages();
    this.showToast(`${item.name} verified: variance ${item.variance >= 0 ? '+' : ''}${item.variance.toFixed(2)}`, item.variance === 0 ? 'success' : 'warning');
  }

  public verifyStockBalance(itemId: number) {
    const item = this.stockItems.find(i => i.id === itemId);
    if (!item) return;

    const countStr = prompt(`Verify physical balance for ${item.name}:\nExpected System Balance: ${item.endingBalance} ${item.displayUnit}\nEnter actual physical count:`, (item.physicalCount || item.endingBalance || 0).toString());
    if (countStr !== null) {
      const val = parseFloat(countStr);
      if (!isNaN(val)) this.updatePhysicalCount(itemId, val);
    }
  }

  public verifyAllBalances() {
    let perfect = 0;
    let discrepancies = 0;

    this.stockItems.forEach(item => {
      const expected = item.endingBalance || item.quantityDisplay;
      const physical = item.physicalCount !== undefined ? item.physicalCount : expected;
      if (Math.abs(physical - expected) <= 0.001) perfect++;
      else discrepancies++;
    });

    this.showToast(`Verification result: ${perfect} accurate, ${discrepancies} variance discrepancies found.`, discrepancies > 0 ? 'warning' : 'success');
    this.renderInventoryTable();
    this.updateAuditSummary();
  }

  public editItem(id: number) {
    const item = this.stockItems.find(i => i.id === id);
    if (!item) return;

    this.openPage('registerStockPage');
    this.isEditing = true;
    this.editingId = id;

    setTimeout(() => {
      (document.getElementById('itemIdInput') as HTMLInputElement).value = item.customId || '';
      (document.getElementById('itemName') as HTMLInputElement).value = item.name;
      (document.getElementById('brandName') as HTMLInputElement).value = item.brandName || '';
      (document.getElementById('category') as HTMLInputElement).value = item.category;
      (document.getElementById('itemType') as HTMLInputElement).value = item.type || '';
      (document.getElementById('baseUnit') as HTMLInputElement).value = item.baseUnit;
      (document.getElementById('registeredUnit') as HTMLInputElement).value = item.registeredUnit;
      (document.getElementById('displayUnit') as HTMLInputElement).value = item.displayUnit;
      (document.getElementById('registeredToBaseFactor') as HTMLInputElement).value = item.registeredToBaseFactor.toString();
      (document.getElementById('displayToBaseFactor') as HTMLInputElement).value = item.displayToBaseFactor.toString();
      (document.getElementById('qtyDisplay') as HTMLInputElement).value = item.quantityDisplay.toString();
      (document.getElementById('purchasePricePerDisplay') as HTMLInputElement).value = item.purchasePricePerDisplay.toString();
      (document.getElementById('markup') as HTMLInputElement).value = item.markup.toString();
      (document.getElementById('sellingPricePerDisplay') as HTMLInputElement).value = item.sellingPricePerDisplay.toString();
      (document.getElementById('batchNumber') as HTMLInputElement).value = item.batchNumber;
      (document.getElementById('expiryDate') as HTMLInputElement).value = item.expiryDate;

      const btn = document.getElementById('saveBtn');
      if (btn) btn.innerHTML = '<i class="fas fa-sync-alt"></i> Update Item';
    }, 80);
  }

  // ==========================================
  // PAGE 4: DEDUCT STOCK (LOSSES, DAMAGE, EXPIRED)
  // ==========================================
  public reduceStock() {
    if (this.isProcessingTransaction) return;
    this.isProcessingTransaction = true;

    try {
      const select = document.getElementById('reduceItemSelect') as HTMLSelectElement;
      const itemId = parseInt(select?.value || '0');
      const item = this.stockItems.find(i => i.id === itemId);

      if (!item) {
        this.showToast('Please select a valid item to deduct', 'warning');
        return;
      }

      const inputQty = parseFloat((document.getElementById('reduceQtyDisplay') as HTMLInputElement)?.value) || 0;
      if (inputQty <= 0) {
        this.showToast('Please enter a positive deduction quantity', 'warning');
        return;
      }

      const unitType = (document.getElementById('reduceUnitSelector') as HTMLSelectElement)?.value || 'displayUnit';
      let displayQtyToDeduct = inputQty;
      if (unitType === 'baseUnit') displayQtyToDeduct = inputQty / item.displayToBaseFactor;
      else if (unitType === 'registeredUnit') displayQtyToDeduct = (inputQty * item.registeredToBaseFactor) / item.displayToBaseFactor;

      if (item.quantityDisplay < displayQtyToDeduct) {
        this.showToast(`Insufficient stock! Available: ${item.quantityDisplay.toFixed(2)} ${item.displayUnit}`, 'danger');
        return;
      }

      const reason = (document.getElementById('reduceReason') as HTMLSelectElement)?.value || 'damaged';
      const responsible = (document.getElementById('whom') as HTMLInputElement)?.value.trim() || 'Officer';
      const notes = (document.getElementById('reduceNotes') as HTMLTextAreaElement)?.value.trim() || '';
      const valueLost = Math.round(displayQtyToDeduct * item.purchasePricePerDisplay * 100) / 100;

      // Commit deduction
      const baseQtyToDeduct = displayQtyToDeduct * item.displayToBaseFactor;
      item.quantityBase = Math.max(0, item.quantityBase - baseQtyToDeduct);
      item.quantityDisplay = Math.max(0, item.quantityBase / item.displayToBaseFactor);
      item.quantityRegistered = Math.max(0, item.quantityBase / item.registeredToBaseFactor);
      item.quantityIssued = (item.quantityIssued || 0) + displayQtyToDeduct;
      item.endingBalance = item.quantityDisplay;
      item.physicalCount = item.endingBalance;

      const deductionRecord: DeductionRecord = {
        id: Date.now(),
        date: new Date().toISOString().split('T')[0],
        itemId: item.id,
        itemName: item.name,
        category: item.category,
        type: item.type,
        quantity: displayQtyToDeduct,
        unit: item.displayUnit,
        batch: item.batchNumber,
        expiry: item.expiryDate,
        reason,
        branch: (document.getElementById('reduceBranch') as HTMLSelectElement)?.value || this.currentBranch,
        responsible,
        notes,
        valueLost,
      };

      this.transactions.unshift(deductionRecord);
      this.recordAudit('deduct', item.id, item.name, displayQtyToDeduct, reason, deductionRecord.branch, responsible, { valueLost, notes });

      // Immediate notification if significant loss
      if (valueLost > 200 || reason === 'theft' || reason === 'expired') {
        this.notificationsEngine.notify({
          id: `deduct-loss-${deductionRecord.id}`,
          type: valueLost > 500 ? 'critical' : 'warning',
          title: `Stock Loss: ${reason.toUpperCase()}`,
          message: `${displayQtyToDeduct.toFixed(2)} ${item.displayUnit} of ${item.name} written off (Loss: ETB ${valueLost.toFixed(2)}).`,
          targetRole: 'admin',
        });
      }

      this.showToast(`Deducted ${displayQtyToDeduct.toFixed(2)} ${item.displayUnit} (${reason}). Value lost: ETB ${valueLost.toFixed(2)}`, 'warning');
      this.clearReduceForm();
      this.syncAllPages();
    } finally {
      this.isProcessingTransaction = false;
    }
  }

  public clearReduceForm() {
    (document.getElementById('reduceStockForm') as HTMLFormElement)?.reset();
    (document.getElementById('reduceAvailable') as HTMLInputElement).value = '';
    (document.getElementById('reduceQtyDisplay') as HTMLInputElement).value = '0';
  }

  public updateReduceDetails() {
    const select = document.getElementById('reduceItemSelect') as HTMLSelectElement;
    const itemId = parseInt(select?.value || '0');
    const item = this.stockItems.find(i => i.id === itemId);
    const unitSelector = (document.getElementById('reduceUnitSelector') as HTMLSelectElement)?.value || 'displayUnit';

    if (item) {
      let availStr = `${item.quantityDisplay.toFixed(2)} ${item.displayUnit}`;
      if (unitSelector === 'registeredUnit') {
        availStr = `${(item.quantityRegistered || 0).toFixed(2)} ${item.registeredUnit}`;
      } else if (unitSelector === 'baseUnit') {
        availStr = `${item.quantityBase.toFixed(2)} ${item.baseUnit}`;
      }

      (document.getElementById('reduceAvailable') as HTMLInputElement).value = availStr;
      (document.getElementById('reduceCategory') as HTMLInputElement).value = item.category || '';
      (document.getElementById('reduceType') as HTMLInputElement).value = item.type || '';
      (document.getElementById('reduceBatchNumber') as HTMLInputElement).value = item.batchNumber;
      (document.getElementById('reduceExpiryDate') as HTMLInputElement).value = item.expiryDate;
      (document.getElementById('reduceShelfBin') as HTMLInputElement).value = item.shelfBin || '';
      (document.getElementById('reduceBaseUnit') as HTMLInputElement).value = item.baseUnit;
      (document.getElementById('reduceRegUnit') as HTMLInputElement).value = item.registeredUnit;
      (document.getElementById('reduceDisplayUnit') as HTMLInputElement).value = item.displayUnit;
    } else {
      (document.getElementById('reduceAvailable') as HTMLInputElement).value = '';
    }
  }

  public updateReducePageSelect() {
    const select = document.getElementById('reduceItemSelect') as HTMLSelectElement;
    if (!select) return;
    const currentVal = select.value;

    select.innerHTML = '<option value="">Choose an item...</option>' +
      this.stockItems
        .filter(i => i.branch === this.currentBranch)
        .map(i => `<option value="${i.id}">${i.name} (${i.quantityDisplay.toFixed(2)} ${i.displayUnit}) &bull; Exp: ${i.expiryDate}</option>`)
        .join('');

    if (currentVal) select.value = currentVal;
  }

  // ==========================================
  // PAGE 5: REVIEW DASHBOARD & ANALYTICS
  // ==========================================
  public updateReviewDashboard() {
    const items = this.stockItems.filter(i => i.branch === this.currentBranch);
    const totalItems = items.length;

    const totalSalesRev = this.salesData
      .filter(s => s.branch === this.currentBranch)
      .reduce((sum, s) => sum + s.grandTotal, 0);

    const lowStockCount = items.filter(i => i.quantityDisplay > 0 && i.quantityDisplay < i.minStockDisplay).length;
    const reorderCount = items.filter(i => i.quantityDisplay > 0 && i.quantityDisplay <= i.reorderLevelDisplay).length;

    const now = new Date();
    const nearExpiryCount = items.filter(i => {
      const d = Math.ceil((new Date(i.expiryDate).getTime() - now.getTime()) / 86400000);
      return d > 0 && d <= 90;
    }).length;
    const expiredCount = items.filter(i => new Date(i.expiryDate).getTime() < now.getTime()).length;

    const inventoryValue = items.reduce((sum, i) => sum + (i.quantityDisplay * i.sellingPricePerDisplay), 0);
    const fastMoving = items.filter(i => i.movement === 'fast').length;
    const slowMoving = items.filter(i => i.movement === 'slow').length;

    const totalCOGS = this.salesData.filter(s => s.branch === this.currentBranch).reduce((sum, s) => sum + (s.cogs || 0), 0);
    const grossProfit = totalSalesRev - totalCOGS;

    const totalDeductionLoss = this.transactions
      .filter(t => t.branch === this.currentBranch && ['damaged', 'expired', 'theft', 'internal'].includes(t.reason))
      .reduce((sum, t) => sum + (t.valueLost || 0), 0);

    const netProfit = grossProfit - totalDeductionLoss;

    let accurateCount = 0;
    items.forEach(i => {
      if (Math.abs((i.physicalCount || i.endingBalance || 0) - (i.endingBalance || 0)) <= 0.001) accurateCount++;
    });
    const accuracy = items.length > 0 ? (accurateCount / items.length) * 100 : 100;

    // Update KPI card DOM
    const setElem = (id: string, text: string) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };

    setElem('totalStockItems', totalItems.toString());
    setElem('totalSales', `ETB ${totalSalesRev.toFixed(2)}`);
    setElem('lowStockItems', lowStockCount.toString());
    setElem('reorderItems', reorderCount.toString());
    setElem('nearExpiryItems', nearExpiryCount.toString());
    setElem('expiredItems', expiredCount.toString());
    setElem('totalInventoryValue', `ETB ${inventoryValue.toFixed(2)}`);
    setElem('fastMovingItems', fastMoving.toString());
    setElem('slowMovingItems', slowMoving.toString());
    setElem('grossProfit', `ETB ${grossProfit.toFixed(2)}`);
    setElem('netProfit', `ETB ${netProfit.toFixed(2)}`);
    setElem('stockAccuracy', `${accuracy.toFixed(1)}%`);
    setElem('stockAccuracyDuplicate', `${accuracy.toFixed(1)}%`);

    this.renderLossReasonsTable();
    this.renderCostSellingComparison();
    this.renderVarianceTracking();
    this.renderExpiryWastageReport();
    this.renderTopItems();
    this.renderActivityLog();
    this.renderDemandForecastDetail();
    this.renderReorderDetail();
  }

  private setupEndingBalanceButton() {
    const btn = document.getElementById('endingBalanceBtn');
    const panel = document.getElementById('endingBalancePanel');
    const content = document.getElementById('endingBalanceContent');
    if (!btn || !panel || !content) return;

    btn.addEventListener('click', () => {
      const items = this.stockItems.filter(i => i.branch === this.currentBranch);
      if (items.length === 0) {
        content.innerHTML = '<p style="color:var(--gray);">No stock items found for current branch.</p>';
        panel.style.display = 'block';
        return;
      }

      let totalBeginning = 0;
      let totalReceived = 0;
      let totalIssued = 0;
      let totalEnding = 0;
      let totalValue = 0;

      let html = `
        <div style="overflow-x:auto;">
          <table style="width:100%; border-collapse:collapse; font-size:12px;">
            <thead>
              <tr style="background:rgba(255,215,0,0.15); color:var(--accent);">
                <th style="padding:6px; text-align:left;">Item Name</th>
                <th style="padding:6px;">Display Unit</th>
                <th style="padding:6px;">Beginning</th>
                <th style="padding:6px;">Received</th>
                <th style="padding:6px;">Issued/Sold</th>
                <th style="padding:6px; font-weight:bold; color:var(--success);">Ending Balance</th>
                <th style="padding:6px;">Total Value (ETB)</th>
              </tr>
            </thead>
            <tbody>
      `;

      items.forEach(i => {
        const beg = i.beginningBalance || 0;
        const rec = i.quantityReceived || 0;
        const iss = i.quantityIssued || 0;
        const end = i.endingBalance || 0;
        const val = end * i.sellingPricePerDisplay;

        totalBeginning += beg;
        totalReceived += rec;
        totalIssued += iss;
        totalEnding += end;
        totalValue += val;

        html += `
          <tr style="border-bottom:1px solid rgba(255,215,0,0.1);">
            <td style="padding:6px;"><strong>${i.name}</strong></td>
            <td style="padding:6px; text-align:center;">${i.displayUnit}</td>
            <td style="padding:6px; text-align:center;">${beg.toFixed(2)}</td>
            <td style="padding:6px; text-align:center;">${rec.toFixed(2)}</td>
            <td style="padding:6px; text-align:center;">${iss.toFixed(2)}</td>
            <td style="padding:6px; text-align:center; font-weight:bold; color:var(--success);">${end.toFixed(2)}</td>
            <td style="padding:6px; text-align:right;">ETB ${val.toFixed(2)}</td>
          </tr>
        `;
      });

      html += `
            </tbody>
            <tfoot>
              <tr style="background:rgba(0,255,136,0.15); font-weight:bold;">
                <td colspan="2" style="padding:8px; text-align:right;">BRANCH ACCUMULATION:</td>
                <td style="padding:8px; text-align:center;">${totalBeginning.toFixed(2)}</td>
                <td style="padding:8px; text-align:center;">${totalReceived.toFixed(2)}</td>
                <td style="padding:8px; text-align:center;">${totalIssued.toFixed(2)}</td>
                <td style="padding:8px; text-align:center; color:var(--success);">${totalEnding.toFixed(2)}</td>
                <td style="padding:8px; text-align:right; color:var(--accent);">ETB ${totalValue.toFixed(2)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p style="font-size:11px; color:var(--gray); margin-top:8px;">
          Formula: Ending Balance = Beginning Balance + Quantity Received &minus; Quantity Issued. All values calculated from live synchronized stock ledger.
        </p>
      `;

      content.innerHTML = html;
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
      if (panel.style.display === 'block') {
        panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
  }

  // ==========================================
  // PAGE 6: AUDIT TRAIL & SUMMARY
  // ==========================================
  public updateAuditSummary() {
    const items = this.stockItems.filter(i => i.branch === this.currentBranch);
    let beginningValue = 0;
    let endingValue = 0;
    let posCount = 0;
    let negCount = 0;
    let posCost = 0;
    let negCost = 0;

    items.forEach(i => {
      const beg = (i.beginningBalance || i.quantityDisplay) * i.sellingPricePerDisplay;
      const end = (i.endingBalance || i.quantityDisplay) * i.sellingPricePerDisplay;
      beginningValue += beg;
      endingValue += end;

      const variance = (i.physicalCount || i.endingBalance || 0) - (i.endingBalance || 0);
      const varVal = variance * i.sellingPricePerDisplay;

      if (variance > 0.001) {
        posCount++;
        posCost += varVal;
      } else if (variance < -0.001) {
        negCount++;
        negCost += Math.abs(varVal);
      }
    });

    const netVariance = posCost - negCost;
    const totalDeductionsLoss = this.transactions
      .filter(t => t.branch === this.currentBranch)
      .reduce((sum, t) => sum + (t.valueLost || 0), 0);

    const totalSalesRev = this.salesData.filter(s => s.branch === this.currentBranch).reduce((sum, s) => sum + s.grandTotal, 0);
    const totalCOGS = this.salesData.filter(s => s.branch === this.currentBranch).reduce((sum, s) => sum + (s.cogs || 0), 0);
    const grossProfit = totalSalesRev - totalCOGS;
    const netProfit = grossProfit - totalDeductionsLoss;

    const setAudit = (id: string, text: string) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };

    setAudit('auditBeginningBalance', `ETB ${beginningValue.toFixed(2)}`);
    setAudit('auditStockOnHandValue', `ETB ${endingValue.toFixed(2)}`);
    setAudit('auditEndingBalance', `ETB ${endingValue.toFixed(2)}`);
    setAudit('auditPosVarItems', posCount.toString());
    setAudit('auditNegVarItems', negCount.toString());
    setAudit('auditPosVarCost', `ETB ${posCost.toFixed(2)}`);
    setAudit('auditNegVarCost', `ETB ${negCost.toFixed(2)}`);
    setAudit('auditNetVariance', `ETB ${netVariance.toFixed(2)}`);
    setAudit('auditTotalLoss', `ETB ${(totalDeductionsLoss + negCost).toFixed(2)}`);
    setAudit('auditTotalGain', `ETB ${posCost.toFixed(2)}`);
    setAudit('auditNetProfit', `ETB ${netProfit.toFixed(2)}`);
    setAudit('auditGrossPL', `ETB ${grossProfit.toFixed(2)}`);
    setAudit('auditItemDiff', (posCount + negCount).toString());
    setAudit('auditFinancialImpact', `ETB ${Math.abs(netVariance).toFixed(2)}`);
    setAudit('auditAccuracy', `${items.length > 0 ? (((items.length - (posCount + negCount)) / items.length) * 100).toFixed(1) : '100'}%`);
    setAudit('auditStatus', (posCount + negCount) === 0 ? 'Verified Perfect' : 'Audit Variance Flagged');
    setAudit('auditRecommendation', negCost > 0 ? 'Investigate shortages' : posCost > 0 ? 'Reconcile stock surpluses' : 'Balances 100% reconciled');
  }

  public recordAudit(action: string, itemId: number, itemName: string, quantity: number, eventType: string, branch: string, user: string, details: any = {}) {
    const auditRecord: AuditRecord = {
      id: this.auditCounter++,
      action,
      itemId,
      itemName,
      quantity,
      eventType,
      branch: branch || this.currentBranch,
      user: user || this.currentUserType || 'User',
      details,
      timestamp: new Date().toISOString(),
    };

    this.auditTrail.unshift(auditRecord);
    if (this.auditTrail.length > 1000) this.auditTrail.pop();
    this.saveState();
  }

  // ==========================================
  // EXPORT BUTTON & DROPDOWN HANDLING
  // ==========================================
  private setupExportDropdown() {
    const btn = document.getElementById('exportDataBtn');
    const dropdown = document.getElementById('exportDropdown');
    if (!btn || !dropdown) return;

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
    });

    document.addEventListener('click', (e) => {
      if (!dropdown.contains(e.target as Node) && e.target !== btn) {
        dropdown.style.display = 'none';
      }
    });

    document.getElementById('exportExcelBtn')?.addEventListener('click', () => this.handleExportAction('excel'));
    document.getElementById('exportWordBtn')?.addEventListener('click', () => this.handleExportAction('word'));
    document.getElementById('exportCsvBtn')?.addEventListener('click', () => this.handleExportAction('csv'));
    document.getElementById('exportPdfBtn')?.addEventListener('click', () => this.handleExportAction('pdf'));

    // Time filter pills inside export panel
    document.querySelectorAll('.export-time-filter').forEach(pill => {
      pill.addEventListener('click', (e) => {
        document.querySelectorAll('.export-time-filter').forEach(p => p.classList.remove('active'));
        (e.currentTarget as HTMLElement).classList.add('active');
        const period = (e.currentTarget as HTMLElement).dataset.period || 'all';
        this.exportTimeFilter = period;

        const customRange = document.getElementById('exportCustomDateRange');
        if (customRange) customRange.style.display = period === 'custom' ? 'block' : 'none';
      });
    });
  }

  public handleExportAction(format: 'excel' | 'word' | 'csv' | 'pdf') {
    const exportTypeSelect = (document.getElementById('exportTypeSelect') as HTMLSelectElement)?.value as any || 'inventory';
    const itemFilter = (document.getElementById('exportItemFilter') as HTMLInputElement)?.value.trim() || '';
    const categoryFilter = (document.getElementById('exportCategoryFilter') as HTMLInputElement)?.value.trim() || '';
    const startDate = (document.getElementById('exportStartDate') as HTMLInputElement)?.value;
    const endDate = (document.getElementById('exportEndDate') as HTMLInputElement)?.value;

    const result = ExportEngine.exportData({
      format,
      exportType: exportTypeSelect,
      itemFilter,
      categoryFilter,
      timeFilter: this.exportTimeFilter,
      startDate,
      endDate,
      currentBranch: this.currentBranch,
      stockItems: this.stockItems,
      salesData: this.salesData,
      deductions: this.transactions,
      auditTrail: this.auditTrail,
      pharmacyName: this.settings.pharmacyName,
      brandName: this.settings.brandName,
    });

    this.showToast(`Exported ${result.count} records as ${format.toUpperCase()}`, 'success');
    const dropdown = document.getElementById('exportDropdown');
    if (dropdown) dropdown.style.display = 'none';
  }

  // ==========================================
  // HELPERS, FILTERS, SEARCH & RENDERING
  // ==========================================
  public findStockItemByQuery(query: string): StockItem | undefined {
    if (!query) return undefined;
    const q = query.trim().toLowerCase();

    // 1. Direct ID match
    const byId = this.stockItems.find(i => (i.customId?.toLowerCase() === q || `item-${i.id}`.toLowerCase() === q) && i.branch === this.currentBranch);
    if (byId) return byId;

    // 2. Bracket match [EBP-0001]
    const bracketMatch = query.match(/^\[(.*?)\]/);
    if (bracketMatch) {
      const matchId = bracketMatch[1].toLowerCase();
      const byBracket = this.stockItems.find(i => (i.customId?.toLowerCase() === matchId || `item-${i.id}`.toLowerCase() === matchId) && i.branch === this.currentBranch);
      if (byBracket) return byBracket;
    }

    // 3. Name match
    return this.stockItems.find(i => i.name.toLowerCase() === q && i.branch === this.currentBranch) ||
      this.stockItems.find(i => query.toLowerCase().includes(i.name.toLowerCase()) && i.branch === this.currentBranch);
  }

  public updateSalesItemsList() {
    let datalist = document.getElementById('salesItemsList') as HTMLDataListElement;
    if (!datalist) {
      datalist = document.createElement('datalist');
      datalist.id = 'salesItemsList';
      document.body.appendChild(datalist);
    }

    datalist.innerHTML = this.stockItems
      .filter(i => i.branch === this.currentBranch && i.quantityDisplay > 0)
      .sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime())
      .map(i => {
        const id = i.customId || `ITEM-${i.id}`;
        return `<option value="[${id}] ${i.name} (${i.brandName || '-'}) - Available: ${i.quantityDisplay.toFixed(2)} ${i.displayUnit}">`;
      })
      .join('');
  }

  public updateItemNameList() {
    let datalist = document.getElementById('itemNameList') as HTMLDataListElement;
    if (datalist) {
      const names = Array.from(new Set(this.stockItems.map(i => i.name)));
      datalist.innerHTML = names.map(n => `<option value="${n}">`).join('');
    }
  }

  public updateDatalists() {
    const cats = Array.from(new Set(this.stockItems.map(i => i.category).filter(Boolean)));
    const catList = document.getElementById('categoryList');
    if (catList) catList.innerHTML = cats.map(c => `<option value="${c}">`).join('');
  }

  public updateCategoryFilter() {
    const sel = document.getElementById('categoryFilter') as HTMLSelectElement;
    if (!sel) return;
    const currentVal = sel.value;
    const cats = Array.from(new Set(this.stockItems.map(i => i.category).filter(Boolean)));
    sel.innerHTML = '<option value="">All Categories</option>' + cats.map(c => `<option value="${c}">${c}</option>`).join('');
    if (currentVal) sel.value = currentVal;
  }

  public renderRecentRegistrations() {
    const tbody = document.getElementById('recentRegistrationsBody');
    if (!tbody) return;

    const recent = this.stockItems
      .filter(i => i.branch === this.currentBranch)
      .slice(-15)
      .reverse();

    tbody.innerHTML = recent.map(i => `
      <tr>
        <td>${i.createdAt ? new Date(i.createdAt).toLocaleDateString() : '-'}</td>
        <td><strong>${i.name}</strong></td>
        <td>${i.baseUnit}</td>
        <td>${i.registeredUnit}</td>
        <td>${i.displayUnit}</td>
        <td>${i.quantityBase.toFixed(2)}</td>
        <td>${(i.quantityRegistered || 0).toFixed(2)}</td>
        <td>${i.quantityDisplay.toFixed(2)}</td>
        <td>${i.batchNumber}</td>
        <td>${i.expiryDate}</td>
      </tr>
    `).join('') || '<tr><td colspan="10" style="text-align:center;">No recent registrations</td></tr>';
  }

  public renderSalesHistory() {
    const tbody = document.getElementById('salesHistoryBody');
    if (!tbody) return;

    const filtered = this.salesData.filter(s => s.branch === this.currentBranch);
    const paginated = filtered.slice((this.salesHistoryPage - 1) * this.salesHistoryRowsPerPage, this.salesHistoryPage * this.salesHistoryRowsPerPage);

    tbody.innerHTML = paginated.map(s => {
      return s.items.map(it => `
        <tr>
          <td>${s.date}</td>
          <td>${s.invoiceNumber}</td>
          <td><strong>${it.name}</strong></td>
          <td>${it.category || '-'}</td>
          <td>${it.type || '-'}</td>
          <td>${it.inputQuantity || it.quantity}</td>
          <td>${it.unit}</td>
          <td>ETB ${it.unitPrice.toFixed(2)}</td>
          <td>ETB ${it.netAmount.toFixed(2)}</td>
          <td>${it.markup || 0}%</td>
          <td>ETB ${(s.totalDiscount || 0).toFixed(2)}</td>
          <td>ETB ${(s.vat || 0).toFixed(2)}</td>
          <td><strong>ETB ${s.grandTotal.toFixed(2)}</strong></td>
          <td>ETB ${(s.profit || 0).toFixed(2)}</td>
          <td>${(s.margin || 0).toFixed(1)}%</td>
          <td>${s.customerName || 'Walk-in'}</td>
          <td>${s.paymentMethod}</td>
          <td>${s.salesperson}</td>
        </tr>
      `).join('');
    }).join('') || '<tr><td colspan="18" style="text-align:center;">No sales records found</td></tr>';
  }

  public renderDeductionHistory() {
    const tbody = document.getElementById('deductionHistoryBody');
    if (!tbody) return;

    const filtered = this.transactions.filter(t => t.branch === this.currentBranch);
    tbody.innerHTML = filtered.slice(0, 50).map(t => `
      <tr>
        <td>${t.date}</td>
        <td><strong>${t.itemName}</strong></td>
        <td>${t.category || '-'}</td>
        <td>${t.type || '-'}</td>
        <td>${t.quantity.toFixed(2)}</td>
        <td>${t.unit}</td>
        <td>${t.batch || '-'}</td>
        <td>${t.expiry || '-'}</td>
        <td><span style="color:var(--danger); font-weight:bold;">${t.reason.toUpperCase()}</span></td>
        <td>${t.branch}</td>
        <td>${t.warehouse || 'main'}</td>
        <td>${t.storageCondition || 'ambient'}</td>
        <td>${t.shelfBin || '-'}</td>
        <td>${t.responsible}</td>
        <td style="color:var(--danger); font-weight:bold;">ETB ${(t.valueLost || 0).toFixed(2)}</td>
      </tr>
    `).join('') || '<tr><td colspan="15" style="text-align:center;">No deduction records</td></tr>';
  }

  public renderAuditTable() {
    const tbody = document.getElementById('auditTableBody');
    if (!tbody) return;

    const filtered = this.auditTrail.filter(a => !this.currentBranch || a.branch === this.currentBranch);
    tbody.innerHTML = filtered.slice(0, 100).map(a => `
      <tr>
        <td>${a.timestamp ? new Date(a.timestamp).toLocaleString() : '-'}</td>
        <td><strong>${a.eventType || a.action}</strong></td>
        <td>${a.itemName || '-'}</td>
        <td>${a.details?.category || '-'}</td>
        <td>${a.details?.type || '-'}</td>
        <td>${a.details?.baseUnit || '-'}</td>
        <td>${a.details?.regUnit || '-'}</td>
        <td>${a.details?.displayUnit || '-'}</td>
        <td>${a.user}</td>
        <td>${a.quantity || 0}</td>
        <td>ETB ${(a.details?.value || a.details?.valueLost || a.details?.total || 0).toFixed(2)}</td>
        <td>${a.details?.batch || '-'}</td>
        <td>${a.details?.expiry || '-'}</td>
        <td>${a.details?.invoice || '-'}</td>
        <td>${a.branch}</td>
        <td>${typeof a.details === 'object' ? JSON.stringify(a.details).slice(0, 45) : a.details || '-'}</td>
      </tr>
    `).join('') || '<tr><td colspan="16" style="text-align:center;">No audit records</td></tr>';
  }

  private renderLossReasonsTable() {
    const tbody = document.getElementById('lossReasonsBody');
    if (!tbody) return;

    const losses: Record<string, { qty: number; val: number }> = {};
    let totalVal = 0;

    this.transactions.forEach(t => {
      if (!losses[t.reason]) losses[t.reason] = { qty: 0, val: 0 };
      losses[t.reason].qty += t.quantity;
      losses[t.reason].val += t.valueLost || 0;
      totalVal += t.valueLost || 0;
    });

    const entries = Object.entries(losses);
    tbody.innerHTML = entries.map(([r, d]) => {
      const pct = totalVal > 0 ? (d.val / totalVal) * 100 : 0;
      return `
        <tr>
          <td><strong>${r.toUpperCase()}</strong></td>
          <td>${d.qty.toFixed(2)}</td>
          <td style="color:var(--danger); font-weight:bold;">ETB ${d.val.toFixed(2)}</td>
          <td>${pct.toFixed(1)}%</td>
        </tr>
      `;
    }).join('') || '<tr><td colspan="4" style="text-align:center;">No recorded losses</td></tr>';
  }

  private renderCostSellingComparison() {
    const tbody = document.getElementById('costSellingBody');
    if (!tbody) return;

    const items = this.stockItems.filter(i => i.branch === this.currentBranch);
    tbody.innerHTML = items.slice(0, 30).map(i => {
      const profitPerUnit = i.sellingPricePerDisplay - i.purchasePricePerDisplay;
      const margin = i.sellingPricePerDisplay > 0 ? (profitPerUnit / i.sellingPricePerDisplay) * 100 : 0;
      return `
        <tr>
          <td><strong>${i.name}</strong></td>
          <td>ETB ${i.purchasePricePerDisplay.toFixed(2)}</td>
          <td>ETB ${i.sellingPricePerDisplay.toFixed(2)}</td>
          <td>${i.markup}%</td>
          <td style="color:${profitPerUnit >= 0 ? 'var(--success)' : 'var(--danger)'};">ETB ${profitPerUnit.toFixed(2)}</td>
          <td>${margin.toFixed(1)}%</td>
        </tr>
      `;
    }).join('');
  }

  private renderVarianceTracking() {
    const tbody = document.getElementById('varianceTrackingBody');
    if (!tbody) return;

    const discrepancies = this.stockItems
      .filter(i => i.branch === this.currentBranch && Math.abs((i.physicalCount || i.endingBalance || 0) - (i.endingBalance || 0)) > 0.001);

    tbody.innerHTML = discrepancies.map(i => {
      const exp = i.endingBalance || 0;
      const phy = i.physicalCount || 0;
      const varVal = (phy - exp) * i.sellingPricePerDisplay;
      return `
        <tr>
          <td><strong>${i.name}</strong></td>
          <td>${exp.toFixed(2)} ${i.displayUnit}</td>
          <td>${phy.toFixed(2)} ${i.displayUnit}</td>
          <td class="${phy >= exp ? 'variance-positive' : 'variance-negative'}">${(phy - exp).toFixed(2)}</td>
          <td class="${phy >= exp ? 'variance-positive' : 'variance-negative'}">ETB ${varVal.toFixed(2)}</td>
          <td>${phy >= exp ? 'Surplus' : 'Shortage'}</td>
        </tr>
      `;
    }).join('') || '<tr><td colspan="6" style="text-align:center; color:var(--success);"><i class="fas fa-check-circle"></i> Perfect variance reconciliation (0 discrepancies)</td></tr>';
  }

  private renderExpiryWastageReport() {
    const tbody = document.getElementById('expiryWastageBody');
    if (!tbody) return;

    const now = new Date();
    const near = this.stockItems
      .filter(i => i.branch === this.currentBranch)
      .map(i => {
        const diff = Math.ceil((new Date(i.expiryDate).getTime() - now.getTime()) / 86400000);
        return { item: i, diff };
      })
      .filter(x => x.diff <= 90)
      .sort((a, b) => a.diff - b.diff);

    tbody.innerHTML = near.map(({ item, diff }) => `
      <tr>
        <td><strong>${item.name}</strong></td>
        <td>${item.batchNumber}</td>
        <td>${item.expiryDate}</td>
        <td>${diff < 0 ? 'EXPIRED' : `${diff} days`}</td>
        <td>${item.quantityDisplay.toFixed(2)}</td>
        <td style="color:var(--danger);">ETB ${(item.quantityDisplay * item.purchasePricePerDisplay).toFixed(2)}</td>
        <td><span class="status-indicator ${diff < 0 ? 'status-expired' : 'status-critical'}"></span>${diff < 0 ? 'EXPIRED' : 'URGENT'}</td>
      </tr>
    `).join('') || '<tr><td colspan="7" style="text-align:center;">No items near expiry</td></tr>';
  }

  private renderTopItems() {
    const tbody = document.getElementById('topItemsBody');
    if (!tbody) return;

    const map: Record<string, { name: string; cat: string; type: string; qty: number; rev: number; profit: number }> = {};
    this.salesData.forEach(s => {
      s.items.forEach(it => {
        if (!map[it.name]) map[it.name] = { name: it.name, cat: it.category || '-', type: it.type || '-', qty: 0, rev: 0, profit: 0 };
        map[it.name].qty += it.quantity;
        map[it.name].rev += it.netAmount;
        map[it.name].profit += it.netAmount * 0.33; // estimated profit share
      });
    });

    const top = Object.values(map).sort((a, b) => b.rev - a.rev).slice(0, 10);
    tbody.innerHTML = top.map(t => `
      <tr>
        <td><strong>${t.name}</strong></td>
        <td>${t.cat}</td>
        <td>${t.type}</td>
        <td>${t.qty.toFixed(2)}</td>
        <td>ETB ${t.rev.toFixed(2)}</td>
        <td>ETB ${t.profit.toFixed(2)}</td>
        <td>${t.rev > 0 ? ((t.profit / t.rev) * 100).toFixed(1) : 0}%</td>
      </tr>
    `).join('') || '<tr><td colspan="7" style="text-align:center;">No sales recorded yet</td></tr>';
  }

  private renderActivityLog() {
    const tbody = document.getElementById('activityLogBody');
    if (!tbody) return;
    tbody.innerHTML = this.auditTrail.slice(0, 40).map(a => `
      <tr>
        <td>${new Date(a.timestamp).toLocaleString()}</td>
        <td><strong>${a.action}</strong></td>
        <td>${a.user}</td>
        <td>${a.itemName || '-'}</td>
        <td>${typeof a.details === 'object' ? JSON.stringify(a.details).slice(0, 40) : a.details || '-'}</td>
        <td>${a.branch}</td>
      </tr>
    `).join('') || '<tr><td colspan="6" style="text-align:center;">No activity logged</td></tr>';
  }

  private renderDemandForecastDetail() {
    const tbody = document.getElementById('demandForecastTableBody');
    if (!tbody) return;
    const items = this.stockItems.filter(i => i.branch === this.currentBranch);

    tbody.innerHTML = items.slice(0, 15).map(i => {
      const dailyEst = Math.max(0.2, (i.quantityDisplay / 60));
      const forecast30 = dailyEst * 30;
      const coverage = dailyEst > 0 ? i.quantityDisplay / dailyEst : 999;
      const order = Math.max(0, i.reorderLevelDisplay * 2 - i.quantityDisplay);
      return `
        <tr>
          <td><strong>${i.name}</strong></td>
          <td>${dailyEst.toFixed(1)} ${i.displayUnit}/day</td>
          <td>${forecast30.toFixed(1)} ${i.displayUnit}</td>
          <td>${i.quantityDisplay.toFixed(1)}</td>
          <td>${coverage.toFixed(0)} days</td>
          <td>${order > 0 ? order.toFixed(1) : 'None'}</td>
        </tr>
      `;
    }).join('');
  }

  private renderReorderDetail() {
    const tbody = document.getElementById('reorderDetailTableBody');
    if (!tbody) return;
    const reorder = this.stockItems.filter(i => i.branch === this.currentBranch && i.quantityDisplay <= i.reorderLevelDisplay);

    tbody.innerHTML = reorder.map(i => {
      const order = Math.max(0, i.reorderLevelDisplay * 2 - i.quantityDisplay);
      return `
        <tr>
          <td><strong>${i.name}</strong></td>
          <td style="color:var(--danger); font-weight:bold;">${i.quantityDisplay.toFixed(2)} ${i.displayUnit}</td>
          <td>${i.reorderLevelDisplay} ${i.displayUnit}</td>
          <td style="color:var(--success); font-weight:bold;">${order.toFixed(2)} ${i.displayUnit}</td>
          <td><span class="status-indicator status-critical"></span>CRITICAL</td>
        </tr>
      `;
    }).join('') || '<tr><td colspan="5" style="text-align:center; color:var(--success);">All stock levels above reorder threshold</td></tr>';
  }

  // ==========================================
  // NAVIGATION & UI CONTROLS
  // ==========================================
  public openPage(pageId: string, filter?: string) {
    if (!this.isLoggedIn) {
      this.showToast('Please login first', 'warning');
      return;
    }

    if ((pageId === 'reviewPage' || pageId === 'auditPage') && this.currentUserType !== 'admin') {
      this.showToast('Administrator access required', 'warning');
      return;
    }

    document.querySelectorAll('.full-screen-mode').forEach(p => p.classList.remove('active'));
    const target = document.getElementById(pageId);
    if (target) target.classList.add('active');

    if (pageId === 'stockInventoryPage' && filter) {
      const sel = document.getElementById('statusFilter') as HTMLSelectElement;
      if (sel) {
        sel.value = filter;
        this.renderInventoryTable();
      }
    }

    this.syncAllPages();
  }

  private setupEventListeners() {
    // Login handler
    document.getElementById('loginBtn')?.addEventListener('click', () => this.handleLogin());

    // Navigation buttons
    document.getElementById('navRegisterStock')?.addEventListener('click', () => this.openPage('registerStockPage'));
    document.getElementById('navSales')?.addEventListener('click', () => this.openPage('salesPage'));
    document.getElementById('navCurrentStock')?.addEventListener('click', () => this.openPage('stockInventoryPage'));
    document.getElementById('navReduceStock')?.addEventListener('click', () => this.openPage('reduceStockPage'));
    document.getElementById('navReview')?.addEventListener('click', () => this.openPage('reviewPage'));
    document.getElementById('navAudit')?.addEventListener('click', () => this.openPage('auditPage'));

    // Modal close buttons
    document.querySelectorAll('.close-full-screen').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const page = (e.currentTarget as HTMLElement).closest('.full-screen-mode');
        if (page) page.classList.remove('active');
      });
    });

    // Forms
    document.getElementById('stockForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.saveItem();
    });

    document.getElementById('salesForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.processSale();
    });

    document.getElementById('reduceStockForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.reduceStock();
    });

    document.getElementById('addSalesRow')?.addEventListener('click', () => this.addSalesRow());
    document.getElementById('clearForm')?.addEventListener('click', () => this.clearRegisterForm());
    document.getElementById('clearSalesForm')?.addEventListener('click', () => this.clearSalesForm());
    document.getElementById('clearReduceForm')?.addEventListener('click', () => this.clearReduceForm());

    // Reduce item selection detail autofill
    document.getElementById('reduceItemSelect')?.addEventListener('change', () => this.updateReduceDetails());

    // Search & filters in inventory
    document.getElementById('searchInput')?.addEventListener('input', () => this.renderInventoryTable());
    document.getElementById('categoryFilter')?.addEventListener('change', () => this.renderInventoryTable());
    document.getElementById('statusFilter')?.addEventListener('change', () => this.renderInventoryTable());

    // Sort control in inventory
    document.getElementById('inventorySortSelect')?.addEventListener('change', (e) => {
      this.currentSort.inventory = (e.target as HTMLSelectElement).value;
      this.renderInventoryTable();
    });

    // Verification button
    document.getElementById('balanceVerificationBtn')?.addEventListener('click', () => this.verifyAllBalances());

    // Notification counter clicks (delivered to user)
    document.getElementById('criticalCounter')?.addEventListener('click', () => this.notificationsEngine.openPanel('critical'));
    document.getElementById('warningCounter')?.addEventListener('click', () => this.notificationsEngine.openPanel('warning'));
    document.getElementById('infoCounter')?.addEventListener('click', () => this.notificationsEngine.openPanel('info'));

    // Notification panel close button
    document.getElementById('closeNotificationPanelBtn')?.addEventListener('click', () => this.notificationsEngine.closePanel());

    // Login Page: Functional Export and Import Button Listeners
    document.getElementById('loginExportBtn')?.addEventListener('click', () => this.handleLoginExport());
    document.getElementById('loginImportBtn')?.addEventListener('click', () => this.handleLoginImport());
    document.getElementById('loginImportFileInput')?.addEventListener('change', (e) => this.handleLoginImportFile(e));

    // Register Stock: Generic Item Name Selection & Autofill
    const itemNameInput = document.getElementById('itemName') as HTMLInputElement;
    const autofillMatchedItem = () => {
      const q = itemNameInput?.value.trim();
      if (!q) return;
      const matched = this.stockItems.find(i => i.name.toLowerCase() === q.toLowerCase());
      if (matched && !this.isEditing) {
        (document.getElementById('brandName') as HTMLInputElement).value = matched.brandName || '';
        (document.getElementById('category') as HTMLInputElement).value = matched.category || '';
        (document.getElementById('itemType') as HTMLInputElement).value = matched.type || '';
        (document.getElementById('baseUnit') as HTMLInputElement).value = matched.baseUnit;
        (document.getElementById('registeredUnit') as HTMLInputElement).value = matched.registeredUnit;
        (document.getElementById('displayUnit') as HTMLInputElement).value = matched.displayUnit;
        (document.getElementById('registeredToBaseFactor') as HTMLInputElement).value = matched.registeredToBaseFactor.toString();
        (document.getElementById('displayToBaseFactor') as HTMLInputElement).value = matched.displayToBaseFactor.toString();
        (document.getElementById('purchasePricePerDisplay') as HTMLInputElement).value = matched.purchasePricePerDisplay.toString();
        (document.getElementById('markup') as HTMLInputElement).value = matched.markup.toString();
        (document.getElementById('discountPercent') as HTMLInputElement).value = (matched.discountPercent || 0).toString();
        (document.getElementById('sellingPricePerDisplay') as HTMLInputElement).value = matched.sellingPricePerDisplay.toString();
        (document.getElementById('supplier') as HTMLInputElement).value = matched.supplier || '';
        (document.getElementById('minStockDisplay') as HTMLInputElement).value = matched.minStockDisplay.toString();
        (document.getElementById('maxStockDisplay') as HTMLInputElement).value = matched.maxStockDisplay.toString();
        (document.getElementById('reorderLevelDisplay') as HTMLInputElement).value = matched.reorderLevelDisplay.toString();
        recalcQuantitiesFromDisplay();
        recalcSelling();
        this.showToast(`Autofilled units, pricing, and factors for: ${matched.name}`, 'info');
      }
    };
    itemNameInput?.addEventListener('input', autofillMatchedItem);
    itemNameInput?.addEventListener('change', autofillMatchedItem);

    // Register Stock: Bidirectional Unit & Quantity Conversion
    const dispQtyInput = document.getElementById('qtyDisplay') as HTMLInputElement;
    const baseQtyInput = document.getElementById('qtyBase') as HTMLInputElement;
    const regQtyInput = document.getElementById('qtyRegister') as HTMLInputElement;
    const dispFactorInput = document.getElementById('displayToBaseFactor') as HTMLInputElement;
    const regFactorInput = document.getElementById('registeredToBaseFactor') as HTMLInputElement;

    const recalcQuantitiesFromDisplay = () => {
      const disp = parseFloat(dispQtyInput?.value) || 0;
      const dFactor = Math.max(0.000001, parseFloat(dispFactorInput?.value) || 1);
      const rFactor = Math.max(0.000001, parseFloat(regFactorInput?.value) || 1);
      const base = disp * dFactor;
      if (baseQtyInput) baseQtyInput.value = (Math.round(base * 100) / 100).toFixed(2);
      if (regQtyInput) regQtyInput.value = (Math.round((base / rFactor) * 100) / 100).toFixed(2);
    };

    const recalcQuantitiesFromBase = () => {
      const base = parseFloat(baseQtyInput?.value) || 0;
      const dFactor = Math.max(0.000001, parseFloat(dispFactorInput?.value) || 1);
      const rFactor = Math.max(0.000001, parseFloat(regFactorInput?.value) || 1);
      if (dispQtyInput) dispQtyInput.value = (Math.round((base / dFactor) * 100) / 100).toFixed(2);
      if (regQtyInput) regQtyInput.value = (Math.round((base / rFactor) * 100) / 100).toFixed(2);
    };

    const recalcQuantitiesFromRegister = () => {
      const reg = parseFloat(regQtyInput?.value) || 0;
      const dFactor = Math.max(0.000001, parseFloat(dispFactorInput?.value) || 1);
      const rFactor = Math.max(0.000001, parseFloat(regFactorInput?.value) || 1);
      const base = reg * rFactor;
      if (baseQtyInput) baseQtyInput.value = (Math.round(base * 100) / 100).toFixed(2);
      if (dispQtyInput) dispQtyInput.value = (Math.round((base / dFactor) * 100) / 100).toFixed(2);
    };

    dispQtyInput?.addEventListener('input', recalcQuantitiesFromDisplay);
    baseQtyInput?.addEventListener('input', recalcQuantitiesFromBase);
    regQtyInput?.addEventListener('input', recalcQuantitiesFromRegister);
    dispFactorInput?.addEventListener('input', recalcQuantitiesFromDisplay);
    regFactorInput?.addEventListener('input', recalcQuantitiesFromDisplay);

    // Register Stock: Bidirectional Price, Markup %, and Discount Conversion
    const buyPrice = document.getElementById('purchasePricePerDisplay') as HTMLInputElement;
    const markupInput = document.getElementById('markup') as HTMLInputElement;
    const discountInput = document.getElementById('discountPercent') as HTMLInputElement;
    const sellPrice = document.getElementById('sellingPricePerDisplay') as HTMLInputElement;

    const recalcSelling = () => {
      const b = parseFloat(buyPrice?.value) || 0;
      const m = parseFloat(markupInput?.value) || 0;
      const d = parseFloat(discountInput?.value) || 0;
      let s = b * (1 + m / 100);
      if (d > 0) s = s * (1 - d / 100);
      if (sellPrice) sellPrice.value = (Math.round(s * 100) / 100).toFixed(2);
    };

    const recalcMarkupFromSelling = () => {
      const b = parseFloat(buyPrice?.value) || 0;
      const s = parseFloat(sellPrice?.value) || 0;
      const d = parseFloat(discountInput?.value) || 0;
      if (b > 0) {
        const grossTarget = d > 0 && d < 100 ? s / (1 - d / 100) : s;
        const calculatedMarkup = ((grossTarget - b) / b) * 100;
        if (markupInput) markupInput.value = (Math.round(calculatedMarkup * 10) / 10).toFixed(1);
      }
    };

    buyPrice?.addEventListener('input', recalcSelling);
    markupInput?.addEventListener('input', recalcSelling);
    discountInput?.addEventListener('input', recalcSelling);
    sellPrice?.addEventListener('input', recalcMarkupFromSelling);

    // Deduct Stock: Recalculate available and live value lost on unit change or quantity change
    document.getElementById('reduceUnitSelector')?.addEventListener('change', () => this.updateReduceDetails());
    document.getElementById('reduceQtyDisplay')?.addEventListener('input', () => {
      const select = document.getElementById('reduceItemSelect') as HTMLSelectElement;
      const itemId = parseInt(select?.value || '0');
      const item = this.stockItems.find(i => i.id === itemId);
      const unitSelector = (document.getElementById('reduceUnitSelector') as HTMLSelectElement)?.value || 'displayUnit';
      const inputQty = parseFloat((document.getElementById('reduceQtyDisplay') as HTMLInputElement)?.value) || 0;

      if (item && inputQty > 0) {
        let dispQty = inputQty;
        if (unitSelector === 'baseUnit') dispQty = inputQty / item.displayToBaseFactor;
        else if (unitSelector === 'registeredUnit') dispQty = (inputQty * item.registeredToBaseFactor) / item.displayToBaseFactor;

        const valLost = dispQty * item.purchasePricePerDisplay;
        const noteArea = document.getElementById('reduceNotes') as HTMLTextAreaElement;
        if (noteArea && !noteArea.value.includes('Calculated Loss:')) {
          noteArea.placeholder = `Estimated loss value: ETB ${valLost.toFixed(2)}`;
        }
      }
    });
  }

  // ==========================================
  // LOGIN PAGE: AUTHORIZED EXPORT & IMPORT
  // ==========================================
  public handleLoginExport() {
    const pwd = prompt('Authorized Data Export\nEnter User or Administrator Password to confirm:');
    if (!pwd) return;

    const isAuthorized = pwd === this.settings.adminPassword || 
                         pwd === this.settings.userPassword || 
                         pwd === this.settings.masterPassword || 
                         pwd === localStorage.getItem('ebp-sms-user-pwd');

    if (!isAuthorized) {
      this.showToast('Authorization denied: Incorrect password for export', 'danger');
      return;
    }

    const result = ExportEngine.exportData({
      format: 'excel',
      exportType: 'all',
      itemFilter: '',
      categoryFilter: '',
      timeFilter: 'all',
      currentBranch: 'all',
      stockItems: this.stockItems,
      salesData: this.salesData,
      deductions: this.transactions,
      auditTrail: this.auditTrail,
      pharmacyName: this.settings.pharmacyName,
      brandName: this.settings.brandName,
    });

    this.showToast(`Exported ${result.count} records securely from the Login Page!`, 'success');
  }

  public handleLoginImport() {
    const pwd = prompt('Authorized Data Import\nEnter Administrator Password to authorize data import:');
    if (!pwd) return;

    const isAuthorized = pwd === this.settings.adminPassword || pwd === this.settings.masterPassword;
    if (!isAuthorized) {
      this.showToast('Authorization denied: Administrator credentials required for import', 'danger');
      return;
    }

    const fileInput = document.getElementById('loginImportFileInput') as HTMLInputElement;
    if (fileInput) fileInput.click();
  }

  public async handleLoginImportFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    try {
      this.showToast('Importing and validating data securely...', 'info');

      if (file.name.endsWith('.json')) {
        const text = await file.text();
        const data = JSON.parse(text);

        if (data.stockItems && Array.isArray(data.stockItems)) {
          const existingIds = new Set(this.stockItems.map(i => i.id));
          let added = 0;
          let updated = 0;

          data.stockItems.forEach((newItem: StockItem) => {
            if (existingIds.has(newItem.id)) {
              const idx = this.stockItems.findIndex(i => i.id === newItem.id);
              if (idx >= 0) {
                this.stockItems[idx] = newItem;
                updated++;
              }
            } else {
              this.stockItems.push(newItem);
              added++;
            }
          });

          if (data.salesData && Array.isArray(data.salesData)) {
            const existingSalesIds = new Set(this.salesData.map(s => s.id));
            data.salesData.forEach((s: SaleRecord) => {
              if (!existingSalesIds.has(s.id)) this.salesData.push(s);
            });
          }

          if (data.transactions && Array.isArray(data.transactions)) {
            const existingTxIds = new Set(this.transactions.map(t => t.id));
            data.transactions.forEach((t: DeductionRecord) => {
              if (!existingTxIds.has(t.id)) this.transactions.push(t);
            });
          }

          this.saveState();
          this.syncAllPages();
          this.showToast(`Import successful! ${added} new items added, ${updated} items updated without data loss.`, 'success');
        } else {
          this.showToast('Invalid JSON file format: Missing stockItems array', 'danger');
        }
      } else if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
        const XLSX = (window as any).XLSX;
        if (!XLSX) {
          this.showToast('Excel parser library not loaded. Please try again.', 'danger');
          return;
        }

        const buffer = await file.arrayBuffer();
        const wb = XLSX.read(buffer);
        const firstSheetName = wb.SheetNames[0];
        const sheet = wb.Sheets[firstSheetName];
        const rows: any[] = XLSX.utils.sheet_to_json(sheet);

        let imported = 0;
        rows.forEach(row => {
          const name = row['Generic Name'] || row['Item Name'] || row['Item'] || row['Name'];
          if (name) {
            const existing = this.stockItems.find(i => i.name.toLowerCase() === String(name).toLowerCase());
            const dispFactor = parseFloat(row['Display to Base Factor'] || row['Disp Factor']) || 10;
            const regFactor = parseFloat(row['Register to Base Factor'] || row['Reg Factor']) || 100;
            const qtyDisp = parseFloat(row['Qty (Display)'] || row['Quantity'] || row['Qty']) || 0;
            const purchase = parseFloat(row['Purchase Price (ETB)'] || row['Purchase Price'] || row['Buy Price']) || 0;
            const selling = parseFloat(row['Selling Price (ETB)'] || row['Selling Price'] || row['Price']) || purchase * 1.5;

            if (existing) {
              existing.quantityDisplay += qtyDisp;
              existing.quantityBase = existing.quantityDisplay * (existing.displayToBaseFactor || dispFactor);
              existing.quantityRegistered = existing.quantityBase / (existing.registeredToBaseFactor || regFactor);
              existing.endingBalance = existing.quantityDisplay;
              existing.physicalCount = existing.endingBalance;
            } else {
              const item: StockItem = {
                id: this.currentId++,
                customId: row['Item ID'] || `EBP-${this.currentId}`,
                name: String(name),
                brandName: row['Brand Name'] || row['Brand'] || '',
                category: row['Category'] || 'General',
                type: row['Type'] || 'Medicine',
                baseUnit: row['Base Unit'] || 'piece',
                registeredUnit: row['Register Unit'] || 'box',
                displayUnit: row['Display Unit'] || 'piece',
                registeredToBaseFactor: regFactor,
                displayToBaseFactor: dispFactor,
                quantityBase: qtyDisp * dispFactor,
                quantityRegistered: (qtyDisp * dispFactor) / regFactor,
                quantityDisplay: qtyDisp,
                beginningBalance: qtyDisp,
                quantityReceived: qtyDisp,
                quantityIssued: 0,
                endingBalance: qtyDisp,
                physicalCount: qtyDisp,
                variance: 0,
                purchasePricePerDisplay: purchase,
                markup: parseFloat(row['Markup %'] || row['Markup']) || 50,
                sellingPricePerDisplay: selling,
                batchNumber: row['Batch Number'] || row['Batch'] || `IMP-${Date.now()}`,
                expiryDate: row['Expiry Date'] || row['Expiry'] || new Date(Date.now() + 365 * 86400000).toISOString().split('T')[0],
                minStockDisplay: parseFloat(row['Min Stock'] || row['Min Stock (Display)']) || 10,
                maxStockDisplay: parseFloat(row['Max Stock'] || row['Max Stock (Display)']) || 100,
                reorderLevelDisplay: parseFloat(row['Reorder Level'] || row['Reorder Level (Display)']) || 20,
                branch: this.currentBranch,
                createdAt: new Date().toISOString(),
              };
              this.stockItems.push(item);
            }
            imported++;
          }
        });

        this.saveState();
        this.syncAllPages();
        this.showToast(`Imported ${imported} items successfully from Excel!`, 'success');
      } else {
        this.showToast('Unsupported file format. Please upload .xlsx, .xls, or .json file', 'warning');
      }
    } catch (err: any) {
      console.error('Import failure:', err);
      this.showToast(`Import failed: ${err.message || 'File parsing error'}`, 'danger');
    } finally {
      input.value = '';
    }
  }

  public handleLogin() {
    const typeSelect = document.getElementById('loginType') as HTMLSelectElement;
    const pwdInput = document.getElementById('password') as HTMLInputElement;

    const type = typeSelect?.value as 'admin' | 'user';
    const pwd = pwdInput?.value.trim();

    if (!type) {
      this.showToast('Please select login type', 'warning');
      return;
    }

    const expected = type === 'admin' ? this.settings.adminPassword : (localStorage.getItem('ebp-sms-user-pwd') || this.settings.userPassword);
    if (type === 'user' && !localStorage.getItem('ebp-sms-user-pwd')) {
      // First time user sets password
      localStorage.setItem('ebp-sms-user-pwd', pwd);
    }

    if (pwd === expected || (type === 'user' && pwd.length >= 4)) {
      this.isLoggedIn = true;
      this.currentUserType = type;

      document.querySelectorAll('.admin-only').forEach(el => {
        (el as HTMLElement).style.display = type === 'admin' ? 'flex' : 'none';
      });

      const welcome = document.getElementById('welcomePage');
      if (welcome) {
        welcome.style.opacity = '0';
        setTimeout(() => {
          welcome.style.display = 'none';
          const main = document.getElementById('mainContainer');
          if (main) main.style.display = 'block';
        }, 300);
      }

      this.recordAudit('login', 0, 'User Authentication', 0, 'auth_login', this.currentBranch, type, { role: type });
      this.showToast(`Logged in successfully as ${type.toUpperCase()}`, 'success');
      this.syncAllPages();
    } else {
      this.showToast('Incorrect password', 'warning');
    }
  }

  private setupUnitLists() {
    const populate = (id: string, listStr: string) => {
      const dl = document.getElementById(id);
      if (dl) dl.innerHTML = listStr.split(',').map(u => `<option value="${u.trim()}">`).join('');
    };
    populate('baseUnitList', this.settings.baseUnitsList);
    populate('displayUnitList', this.settings.displayUnitsList);
    populate('registeredUnitList', this.settings.registeredUnitsList);
  }

  private setupFullscreen() {
    document.getElementById('fullscreenToggle')?.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      } else if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    });
  }

  private setupOnlineListeners() {
    window.addEventListener('online', () => {
      this.isOnline = true;
      const dot = document.getElementById('syncStatusDot');
      const text = document.getElementById('syncStatusText');
      if (dot) dot.className = 'sync-status sync-online';
      if (text) text.textContent = 'Online';
      this.showToast('Connected back online', 'success');
    });

    window.addEventListener('offline', () => {
      this.isOnline = false;
      const dot = document.getElementById('syncStatusDot');
      const text = document.getElementById('syncStatusText');
      if (dot) dot.className = 'sync-status sync-offline';
      if (text) text.textContent = 'Offline (Local Safe Mode)';
      this.showToast('Working offline - all changes saved locally', 'warning');
    });
  }

  public showToast(msg: string, type: 'success' | 'warning' | 'danger' | 'info' = 'info') {
    const tType = type === 'danger' ? 'critical' : type;
    this.notificationsEngine.displayToast({
      id: `toast-${Date.now()}`,
      type: tType as any,
      title: type.toUpperCase(),
      message: msg,
      timestamp: new Date().toISOString(),
      targetRole: 'all',
      reviewed: false,
    });
  }
}
