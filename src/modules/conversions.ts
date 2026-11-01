/**
 * EBP-SMS Unified Unit Conversion & Stock Balance Integrity System
 * Single Source of Truth for unit conversions, factor calculation, and balance math.
 */

export interface StockItem {
  id: number;
  customId?: string;
  name: string;
  brandName?: string;
  category: string;
  type?: string;
  baseUnit: string;
  registeredUnit: string;
  displayUnit: string;
  registeredToBaseFactor: number;
  displayToBaseFactor: number;
  allowFractionalDisplay?: boolean;
  quantityBase: number;
  quantityRegistered?: number;
  quantityDisplay: number;
  beginningBalance?: number;
  quantityReceived?: number;
  quantityIssued?: number;
  endingBalance?: number;
  physicalCount?: number;
  variance?: number;
  purchasePricePerDisplay: number;
  markup: number;
  discountPercent?: number;
  sellingPricePerDisplay: number;
  batchNumber: string;
  expiryDate: string;
  supplier?: string;
  invoiceNumber?: string;
  registrant?: string;
  branch: string;
  warehouse?: string;
  storageCondition?: string;
  shelfBin?: string;
  minStockDisplay: number;
  maxStockDisplay: number;
  reorderLevelDisplay: number;
  minStockBase?: number;
  maxStockBase?: number;
  reorderLevelBase?: number;
  movement?: 'fast' | 'slow' | 'normal';
  movementHistory?: Array<{ date: string; qty: number }>;
  createdAt?: string;
}

export const UnitConversionSystem = {
  getItemFactors(item: Partial<StockItem>) {
    if (!item) return { regToBase: 1, dispToBase: 1 };
    const regToBase = Math.max(0.000001, parseFloat(String(item.registeredToBaseFactor)) || 1);
    const dispToBase = Math.max(0.000001, parseFloat(String(item.displayToBaseFactor)) || 1);
    return { regToBase, dispToBase };
  },

  baseToDisplay(baseQty: number, item: Partial<StockItem>): number {
    const f = this.getItemFactors(item);
    return baseQty / f.dispToBase;
  },

  baseToRegister(baseQty: number, item: Partial<StockItem>): number {
    const f = this.getItemFactors(item);
    return baseQty / f.regToBase;
  },

  displayToBase(dispQty: number, item: Partial<StockItem>): number {
    const f = this.getItemFactors(item);
    return dispQty * f.dispToBase;
  },

  displayToRegister(dispQty: number, item: Partial<StockItem>): number {
    return this.baseToRegister(this.displayToBase(dispQty, item), item);
  },

  registerToBase(regQty: number, item: Partial<StockItem>): number {
    const f = this.getItemFactors(item);
    return regQty * f.regToBase;
  },

  registerToDisplay(regQty: number, item: Partial<StockItem>): number {
    return this.baseToDisplay(this.registerToBase(regQty, item), item);
  },

  toBase(qty: number, unitType: 'base' | 'register' | 'display' | string, item: Partial<StockItem>): number {
    if (unitType === 'base' || unitType === 'baseUnit') return qty;
    if (unitType === 'register' || unitType === 'registeredUnit') return this.registerToBase(qty, item);
    if (unitType === 'display' || unitType === 'displayUnit') return this.displayToBase(qty, item);
    return qty;
  },

  fromBase(baseQty: number, item: Partial<StockItem>) {
    return {
      base: baseQty,
      register: this.baseToRegister(baseQty, item),
      display: this.baseToDisplay(baseQty, item),
    };
  },

  /**
   * Recalculates and enforces canonical balances on an item:
   * endingBalance = beginningBalance + received - issued
   * variance = physicalCount - endingBalance
   */
  synchronizeItemBalances(item: StockItem): StockItem {
    const f = this.getItemFactors(item);
    // Ensure display and registered quantities strictly align with quantityBase
    if (item.quantityBase === undefined || isNaN(item.quantityBase)) {
      item.quantityBase = (parseFloat(String(item.quantityDisplay)) || 0) * f.dispToBase;
    }
    item.quantityDisplay = Math.round((item.quantityBase / f.dispToBase) * 10000) / 10000;
    item.quantityRegistered = Math.round((item.quantityBase / f.regToBase) * 10000) / 10000;

    const beginning = parseFloat(String(item.beginningBalance)) || 0;
    const received = parseFloat(String(item.quantityReceived)) || 0;
    const issued = parseFloat(String(item.quantityIssued)) || 0;

    item.endingBalance = Math.round((beginning + received - issued) * 10000) / 10000;
    if (item.physicalCount === undefined || isNaN(item.physicalCount)) {
      item.physicalCount = item.endingBalance;
    }
    item.variance = Math.round((item.physicalCount - item.endingBalance) * 10000) / 10000;
    return item;
  },

  formatQty(qty: number): string {
    if (Math.abs(qty) < 0.0001) return '0';
    return parseFloat(qty.toFixed(4)).toString();
  },

  formatCurrency(amount: number): string {
    return `ETB ${(amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
};
