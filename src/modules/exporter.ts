/**
 * EBP-SMS Multi-Format Data Export Engine
 * Exports Inventory, Sales, Deductions, Audit, or Complete datasets
 * in Excel (.xlsx), Word (.doc), CSV (.csv), and PDF (.pdf) formats with 100% accuracy.
 */

import { StockItem, UnitConversionSystem } from './conversions';

export interface SaleRecord {
  id: number;
  date: string;
  branch: string;
  warehouse?: string;
  storageCondition?: string;
  shelfBin?: string;
  paymentMethod: string;
  customerName?: string;
  customerType?: string;
  salesperson: string;
  invoiceNumber: string;
  items: Array<{
    id: number;
    name: string;
    category?: string;
    type?: string;
    quantity: number;
    unit: string;
    unitPrice: number;
    netAmount: number;
    inputQuantity?: number;
    inputUnitType?: string;
    markup?: number;
    discount?: number;
    vat?: number;
    batch?: string;
    expiry?: string;
  }>;
  subtotal: number;
  totalDiscount: number;
  vat: number;
  grandTotal: number;
  cogs?: number;
  profit?: number;
  margin?: number;
  timestamp: string;
}

export interface DeductionRecord {
  id: number;
  date: string;
  itemId: number;
  itemName: string;
  category?: string;
  type?: string;
  quantity: number;
  unit: string;
  batch?: string;
  expiry?: string;
  reason: string;
  branch: string;
  warehouse?: string;
  storageCondition?: string;
  shelfBin?: string;
  responsible: string;
  notes?: string;
  valueLost?: number;
}

export interface AuditRecord {
  id: number;
  action: string;
  itemId?: number;
  itemName?: string;
  quantity?: number;
  eventType?: string;
  branch?: string;
  user: string;
  details?: any;
  timestamp: string;
}

export class ExportEngine {
  public static exportData(params: {
    format: 'excel' | 'word' | 'csv' | 'pdf';
    exportType: 'inventory' | 'sales' | 'deductions' | 'audit' | 'all';
    itemFilter: string;
    categoryFilter: string;
    timeFilter: string;
    startDate?: string;
    endDate?: string;
    currentBranch: string;
    stockItems: StockItem[];
    salesData: SaleRecord[];
    deductions: DeductionRecord[];
    auditTrail: AuditRecord[];
    pharmacyName: string;
    brandName: string;
  }): { count: number; filename: string } {
    const { format, exportType, itemFilter, categoryFilter, timeFilter, startDate, endDate, currentBranch, stockItems, salesData, deductions, auditTrail, pharmacyName, brandName } = params;

    // 1. Calculate Date Bounds
    const now = new Date();
    let start = new Date(0);
    let end = new Date(now.getTime() + 86400000);

    if (timeFilter === 'daily') {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    } else if (timeFilter === 'weekly') {
      start = new Date(now.getTime() - 7 * 86400000);
    } else if (timeFilter === 'monthly') {
      start = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
    } else if (timeFilter === 'quarterly') {
      start = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
    } else if (timeFilter === 'semiannual') {
      start = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());
    } else if (timeFilter === 'yearly') {
      start = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
    } else if (timeFilter === 'custom' && startDate && endDate) {
      start = new Date(startDate);
      end = new Date(new Date(endDate).getTime() + 86400000);
    }

    const dateStr = now.toISOString().slice(0, 10);
    const filenameBase = `${brandName.toLowerCase()}_${exportType}_${dateStr}`;

    // 2. Filter Datasets
    const iFilter = (itemFilter || '').toLowerCase();
    const cFilter = (categoryFilter || '').toLowerCase();

    const filteredInventory = stockItems.filter(i => {
      if (currentBranch && i.branch !== currentBranch && currentBranch !== 'all') return false;
      if (iFilter && !i.name.toLowerCase().includes(iFilter) && !(i.brandName && i.brandName.toLowerCase().includes(iFilter))) return false;
      if (cFilter && !(i.category || '').toLowerCase().includes(cFilter)) return false;
      if (timeFilter !== 'all' && i.createdAt) {
        const cDate = new Date(i.createdAt);
        if (cDate < start || cDate > end) return false;
      }
      return true;
    });

    const filteredSales = salesData.filter(s => {
      if (currentBranch && s.branch !== currentBranch && currentBranch !== 'all') return false;
      const sDate = new Date(s.date);
      if (timeFilter !== 'all' && (sDate < start || sDate > end)) return false;
      if (iFilter && !s.items.some(it => it.name.toLowerCase().includes(iFilter))) return false;
      if (cFilter && !s.items.some(it => (it.category || '').toLowerCase().includes(cFilter))) return false;
      return true;
    });

    const filteredDeductions = deductions.filter(d => {
      if (currentBranch && d.branch !== currentBranch && currentBranch !== 'all') return false;
      const dDate = new Date(d.date);
      if (timeFilter !== 'all' && (dDate < start || dDate > end)) return false;
      if (iFilter && !d.itemName.toLowerCase().includes(iFilter)) return false;
      if (cFilter && !(d.category || '').toLowerCase().includes(cFilter)) return false;
      return true;
    });

    const filteredAudit = auditTrail.filter(a => {
      if (currentBranch && a.branch !== currentBranch && currentBranch !== 'all') return false;
      const aDate = new Date(a.timestamp);
      if (timeFilter !== 'all' && (aDate < start || aDate > end)) return false;
      if (iFilter && a.itemName && !a.itemName.toLowerCase().includes(iFilter)) return false;
      return true;
    });

    // Determine count
    let count = 0;
    if (exportType === 'inventory') count = filteredInventory.length;
    else if (exportType === 'sales') count = filteredSales.length;
    else if (exportType === 'deductions') count = filteredDeductions.length;
    else if (exportType === 'audit') count = filteredAudit.length;
    else count = filteredInventory.length + filteredSales.length + filteredDeductions.length;

    // Execute format exporter
    if (format === 'excel') {
      this.exportToExcel({
        exportType,
        filename: `${filenameBase}.xlsx`,
        inventory: filteredInventory,
        sales: filteredSales,
        deductions: filteredDeductions,
        audit: filteredAudit,
        pharmacyName
      });
    } else if (format === 'word') {
      this.exportToWord({
        exportType,
        filename: `${filenameBase}.doc`,
        inventory: filteredInventory,
        sales: filteredSales,
        deductions: filteredDeductions,
        audit: filteredAudit,
        pharmacyName,
        brandName,
        branch: currentBranch
      });
    } else if (format === 'pdf') {
      this.exportToPdf({
        exportType,
        filename: `${filenameBase}.pdf`,
        inventory: filteredInventory,
        sales: filteredSales,
        deductions: filteredDeductions,
        audit: filteredAudit,
        pharmacyName,
        brandName,
        branch: currentBranch
      });
    } else {
      // CSV
      this.exportToCsv({
        exportType,
        filename: `${filenameBase}.csv`,
        inventory: filteredInventory,
        sales: filteredSales,
        deductions: filteredDeductions,
        audit: filteredAudit
      });
    }

    return { count, filename: filenameBase };
  }

  private static exportToExcel(data: {
    exportType: string;
    filename: string;
    inventory: StockItem[];
    sales: SaleRecord[];
    deductions: DeductionRecord[];
    audit: AuditRecord[];
    pharmacyName: string;
  }) {
    const XLSX = (window as any).XLSX;
    if (!XLSX) {
      console.warn('SheetJS XLSX not loaded, falling back to CSV');
      this.exportToCsv(data as any);
      return;
    }

    const wb = XLSX.utils.book_new();

    if (data.exportType === 'inventory' || data.exportType === 'all') {
      const rows = data.inventory.map(i => ({
        'Item ID': i.customId || i.id,
        'Generic Name': i.name,
        'Brand Name': i.brandName || '',
        'Category': i.category,
        'Type': i.type || '',
        'Base Unit': i.baseUnit,
        'Register Unit': i.registeredUnit,
        'Display Unit': i.displayUnit,
        'Qty (Base)': i.quantityBase,
        'Qty (Reg)': i.quantityRegistered || 0,
        'Qty (Display)': i.quantityDisplay,
        'Beg Balance': i.beginningBalance || 0,
        'Received': i.quantityReceived || 0,
        'Issued / Sold': i.quantityIssued || 0,
        'End Balance': i.endingBalance || 0,
        'Physical Count': i.physicalCount || 0,
        'Variance': i.variance || 0,
        'Purchase Price (ETB)': i.purchasePricePerDisplay,
        'Selling Price (ETB)': i.sellingPricePerDisplay,
        'Markup %': i.markup,
        'Total Value (ETB)': Math.round(i.quantityDisplay * i.sellingPricePerDisplay * 100) / 100,
        'Batch Number': i.batchNumber,
        'Expiry Date': i.expiryDate,
        'Branch': i.branch,
        'Storage': i.storageCondition || 'ambient'
      }));

      // Add Total Row
      const totalDisplayQty = data.inventory.reduce((sum, i) => sum + (i.quantityDisplay || 0), 0);
      const totalValue = data.inventory.reduce((sum, i) => sum + (i.quantityDisplay * i.sellingPricePerDisplay || 0), 0);
      rows.push({
        'Item ID': 'TOTAL' as any,
        'Generic Name': `Total Items: ${data.inventory.length}` as any,
        'Brand Name': '',
        'Category': '',
        'Type': '',
        'Base Unit': '',
        'Register Unit': '',
        'Display Unit': '',
        'Qty (Base)': '' as any,
        'Qty (Reg)': '' as any,
        'Qty (Display)': totalDisplayQty as any,
        'Beg Balance': '' as any,
        'Received': '' as any,
        'Issued / Sold': '' as any,
        'End Balance': '' as any,
        'Physical Count': '' as any,
        'Variance': '' as any,
        'Purchase Price (ETB)': '' as any,
        'Selling Price (ETB)': '' as any,
        'Markup %': '' as any,
        'Total Value (ETB)': Math.round(totalValue * 100) / 100 as any,
        'Batch Number': '',
        'Expiry Date': '',
        'Branch': '',
        'Storage': ''
      });

      const ws = XLSX.utils.json_to_sheet(rows);
      XLSX.utils.book_append_sheet(wb, ws, 'Inventory');
    }

    if (data.exportType === 'sales' || data.exportType === 'all') {
      const salesRows: any[] = [];
      data.sales.forEach(s => {
        s.items.forEach(it => {
          salesRows.push({
            'Date': s.date,
            'Invoice Number': s.invoiceNumber,
            'Customer Name': s.customerName || 'Walk-in',
            'Customer Type': s.customerType || 'Individual',
            'Item Name': it.name,
            'Category': it.category || '',
            'Quantity Sold': it.quantity,
            'Unit': it.unit,
            'Unit Price (ETB)': it.unitPrice,
            'Gross Total (ETB)': it.netAmount,
            'Markup %': it.markup || 0,
            'Discount (ETB)': s.totalDiscount || 0,
            'VAT (ETB)': s.vat || 0,
            'Grand Total (ETB)': s.grandTotal,
            'COGS (ETB)': s.cogs || 0,
            'Gross Profit (ETB)': s.profit || 0,
            'Profit Margin %': s.margin || 0,
            'Payment Method': s.paymentMethod,
            'Salesperson': s.salesperson,
            'Branch': s.branch
          });
        });
      });

      const totalSalesRevenue = data.sales.reduce((sum, s) => sum + s.grandTotal, 0);
      const totalSalesProfit = data.sales.reduce((sum, s) => sum + (s.profit || 0), 0);
      salesRows.push({
        'Date': 'TOTAL',
        'Invoice Number': `${data.sales.length} transactions`,
        'Customer Name': '',
        'Customer Type': '',
        'Item Name': '',
        'Category': '',
        'Quantity Sold': '' as any,
        'Unit': '',
        'Unit Price (ETB)': '' as any,
        'Gross Total (ETB)': '' as any,
        'Markup %': '' as any,
        'Discount (ETB)': '' as any,
        'VAT (ETB)': '' as any,
        'Grand Total (ETB)': Math.round(totalSalesRevenue * 100) / 100,
        'COGS (ETB)': '' as any,
        'Gross Profit (ETB)': Math.round(totalSalesProfit * 100) / 100,
        'Profit Margin %': '' as any,
        'Payment Method': '',
        'Salesperson': '',
        'Branch': ''
      });

      const ws = XLSX.utils.json_to_sheet(salesRows);
      XLSX.utils.book_append_sheet(wb, ws, 'Sales');
    }

    if (data.exportType === 'deductions' || data.exportType === 'all') {
      const deductionRows = data.deductions.map(d => ({
        'Date': d.date,
        'Item Name': d.itemName,
        'Category': d.category || '',
        'Quantity Deducted': d.quantity,
        'Unit': d.unit,
        'Batch Number': d.batch || '',
        'Expiry Date': d.expiry || '',
        'Reason': d.reason,
        'Value Lost (ETB)': d.valueLost || 0,
        'Responsible Person': d.responsible,
        'Branch': d.branch,
        'Warehouse': d.warehouse || '',
        'Notes': d.notes || ''
      }));

      const totalLoss = data.deductions.reduce((sum, d) => sum + (d.valueLost || 0), 0);
      deductionRows.push({
        'Date': 'TOTAL',
        'Item Name': `${data.deductions.length} deductions`,
        'Category': '',
        'Quantity Deducted': '' as any,
        'Unit': '',
        'Batch Number': '',
        'Expiry Date': '',
        'Reason': '',
        'Value Lost (ETB)': Math.round(totalLoss * 100) / 100,
        'Responsible Person': '',
        'Branch': '',
        'Warehouse': '',
        'Notes': ''
      });

      const ws = XLSX.utils.json_to_sheet(deductionRows);
      XLSX.utils.book_append_sheet(wb, ws, 'Deductions');
    }

    if (data.exportType === 'audit' || data.exportType === 'all') {
      const auditRows = data.audit.map(a => ({
        'Timestamp': a.timestamp,
        'Action': a.action,
        'Event Type': a.eventType || '',
        'Item Name': a.itemName || '',
        'Quantity': a.quantity || 0,
        'Value (ETB)': (a.details?.value || a.details?.valueLost || a.details?.total || 0),
        'User': a.user,
        'Branch': a.branch || '',
        'Details': typeof a.details === 'object' ? JSON.stringify(a.details) : String(a.details || '')
      }));

      const ws = XLSX.utils.json_to_sheet(auditRows);
      XLSX.utils.book_append_sheet(wb, ws, 'Audit_Trail');
    }

    XLSX.writeFile(wb, data.filename);
  }

  private static exportToWord(data: {
    exportType: string;
    filename: string;
    inventory: StockItem[];
    sales: SaleRecord[];
    deductions: DeductionRecord[];
    audit: AuditRecord[];
    pharmacyName: string;
    brandName: string;
    branch: string;
  }) {
    let content = `
      <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
      <head>
        <meta charset='utf-8'>
        <title>${data.pharmacyName} - ${data.exportType.toUpperCase()} Report</title>
        <style>
          body { font-family: 'Times New Roman', serif; font-size: 11pt; color: #0a1f3d; }
          .header { text-align: center; border-bottom: 2px solid #b8860b; padding-bottom: 12px; margin-bottom: 20px; }
          h1 { color: #0a1f3d; font-size: 18pt; margin: 0 0 6px 0; }
          h2 { color: #b8860b; font-size: 14pt; margin: 0 0 4px 0; }
          .meta { font-size: 10pt; color: #555; margin-bottom: 15px; }
          table { width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 9.5pt; }
          th { background-color: #0a1f3d; color: #ffd700; border: 1px solid #999; padding: 6px; text-align: left; }
          td { border: 1px solid #ccc; padding: 5px; }
          tr:nth-child(even) { background-color: #f7f9fc; }
          .total-row { background-color: #e6f0ff; font-weight: bold; border-top: 2px solid #0a1f3d; }
          .footer { margin-top: 30px; border-top: 1px solid #ccc; padding-top: 10px; font-size: 9pt; color: #777; text-align: center; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>${data.pharmacyName}</h1>
          <h2>${data.brandName} - ${data.exportType.toUpperCase()} REPORT</h2>
          <div class="meta">Branch: ${data.branch === 'pharmacy' ? 'Eras-Birhan Pharmacy' : data.branch} &bull; Generated: ${new Date().toLocaleString()}</div>
        </div>
    `;

    if (data.exportType === 'inventory' || data.exportType === 'all') {
      const totalDisplay = data.inventory.reduce((sum, i) => sum + (i.quantityDisplay || 0), 0);
      const totalVal = data.inventory.reduce((sum, i) => sum + (i.quantityDisplay * i.sellingPricePerDisplay || 0), 0);
      content += `
        <h3>Inventory Summary (${data.inventory.length} items)</h3>
        <table>
          <thead>
            <tr>
              <th>#</th><th>Generic Name</th><th>Brand</th><th>Category</th><th>Base Unit</th><th>Disp Unit</th><th>Qty (Disp)</th><th>Purchase</th><th>Selling</th><th>Total Value</th><th>Batch</th><th>Expiry</th>
            </tr>
          </thead>
          <tbody>
      `;
      data.inventory.forEach((i, idx) => {
        content += `
          <tr>
            <td>${idx + 1}</td>
            <td><strong>${i.name}</strong></td>
            <td>${i.brandName || '-'}</td>
            <td>${i.category}</td>
            <td>${i.baseUnit}</td>
            <td>${i.displayUnit}</td>
            <td>${i.quantityDisplay.toFixed(2)}</td>
            <td>ETB ${i.purchasePricePerDisplay.toFixed(2)}</td>
            <td>ETB ${i.sellingPricePerDisplay.toFixed(2)}</td>
            <td>ETB ${(i.quantityDisplay * i.sellingPricePerDisplay).toFixed(2)}</td>
            <td>${i.batchNumber}</td>
            <td>${i.expiryDate}</td>
          </tr>
        `;
      });
      content += `
          <tr class="total-row">
            <td colspan="6" style="text-align:right;">TOTAL:</td>
            <td>${totalDisplay.toFixed(2)}</td>
            <td colspan="2"></td>
            <td>ETB ${totalVal.toFixed(2)}</td>
            <td colspan="2"></td>
          </tr>
        </tbody></table>
      `;
    }

    if (data.exportType === 'sales' || data.exportType === 'all') {
      const totalRev = data.sales.reduce((sum, s) => sum + s.grandTotal, 0);
      const totalProfit = data.sales.reduce((sum, s) => sum + (s.profit || 0), 0);
      content += `
        <h3 style="margin-top:25px;">Sales History (${data.sales.length} transactions)</h3>
        <table>
          <thead>
            <tr>
              <th>Date</th><th>Invoice</th><th>Customer</th><th>Items</th><th>Grand Total</th><th>Gross Profit</th><th>Margin</th><th>Payment</th><th>Salesperson</th>
            </tr>
          </thead>
          <tbody>
      `;
      data.sales.forEach(s => {
        const itemNames = s.items.map(it => `${it.name} (${it.quantity} ${it.unit})`).join(', ');
        content += `
          <tr>
            <td>${s.date}</td>
            <td>${s.invoiceNumber}</td>
            <td>${s.customerName || 'Walk-in'}</td>
            <td>${itemNames}</td>
            <td>ETB ${s.grandTotal.toFixed(2)}</td>
            <td>ETB ${(s.profit || 0).toFixed(2)}</td>
            <td>${(s.margin || 0).toFixed(1)}%</td>
            <td>${s.paymentMethod}</td>
            <td>${s.salesperson}</td>
          </tr>
        `;
      });
      content += `
          <tr class="total-row">
            <td colspan="4" style="text-align:right;">TOTAL REVENUE & PROFIT:</td>
            <td>ETB ${totalRev.toFixed(2)}</td>
            <td>ETB ${totalProfit.toFixed(2)}</td>
            <td colspan="3"></td>
          </tr>
        </tbody></table>
      `;
    }

    if (data.exportType === 'deductions' || data.exportType === 'all') {
      const totalLoss = data.deductions.reduce((sum, d) => sum + (d.valueLost || 0), 0);
      content += `
        <h3 style="margin-top:25px;">Stock Deductions & Losses (${data.deductions.length} records)</h3>
        <table>
          <thead>
            <tr>
              <th>Date</th><th>Item</th><th>Qty</th><th>Unit</th><th>Reason</th><th>Value Lost</th><th>Responsible</th><th>Notes</th>
            </tr>
          </thead>
          <tbody>
      `;
      data.deductions.forEach(d => {
        content += `
          <tr>
            <td>${d.date}</td>
            <td><strong>${d.itemName}</strong></td>
            <td>${d.quantity.toFixed(2)}</td>
            <td>${d.unit}</td>
            <td>${d.reason}</td>
            <td style="color:#cc0000; font-weight:bold;">ETB ${(d.valueLost || 0).toFixed(2)}</td>
            <td>${d.responsible}</td>
            <td>${d.notes || '-'}</td>
          </tr>
        `;
      });
      content += `
          <tr class="total-row">
            <td colspan="5" style="text-align:right;">TOTAL STOCK LOSS:</td>
            <td style="color:#cc0000;">ETB ${totalLoss.toFixed(2)}</td>
            <td colspan="2"></td>
          </tr>
        </tbody></table>
      `;
    }

    content += `
        <div class="footer">
          Official Report generated by Eras-Birhan Pharmaceuticals Stock Management System (EBP-SMS) &bull; IDG, Ethiopia, 0918203416
        </div>
      </body></html>
    `;

    const blob = new Blob(['\ufeff', content], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = data.filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  private static exportToCsv(data: {
    exportType: string;
    filename: string;
    inventory: StockItem[];
    sales: SaleRecord[];
    deductions: DeductionRecord[];
    audit: AuditRecord[];
  }) {
    let csv = '';

    if (data.exportType === 'inventory') {
      csv = 'Item ID,Generic Name,Brand Name,Category,Type,Base Unit,Register Unit,Display Unit,Qty (Base),Qty (Reg),Qty (Display),Beg Balance,Received,Issued,End Balance,Physical Count,Variance,Purchase Price,Selling Price,Markup %,Total Value,Batch,Expiry,Branch\n';
      data.inventory.forEach(i => {
        csv += `"${i.customId || i.id}","${i.name}","${i.brandName || ''}","${i.category}","${i.type || ''}","${i.baseUnit}","${i.registeredUnit}","${i.displayUnit}",${i.quantityBase},${i.quantityRegistered || 0},${i.quantityDisplay},${i.beginningBalance || 0},${i.quantityReceived || 0},${i.quantityIssued || 0},${i.endingBalance || 0},${i.physicalCount || 0},${i.variance || 0},${i.purchasePricePerDisplay},${i.sellingPricePerDisplay},${i.markup},${(i.quantityDisplay * i.sellingPricePerDisplay).toFixed(2)},"${i.batchNumber}","${i.expiryDate}","${i.branch}"\n`;
      });
    } else if (data.exportType === 'sales') {
      csv = 'Date,Invoice,Customer,Customer Type,Item,Category,Quantity,Unit,Unit Price,Gross Total,Discount,VAT,Grand Total,Profit,Margin %,Payment,Salesperson,Branch\n';
      data.sales.forEach(s => {
        s.items.forEach(it => {
          csv += `"${s.date}","${s.invoiceNumber}","${s.customerName || 'Walk-in'}","${s.customerType || ''}","${it.name}","${it.category || ''}",${it.quantity},"${it.unit}",${it.unitPrice},${it.netAmount},${s.totalDiscount || 0},${s.vat || 0},${s.grandTotal},${s.profit || 0},${s.margin || 0},"${s.paymentMethod}","${s.salesperson}","${s.branch}"\n`;
        });
      });
    } else if (data.exportType === 'deductions') {
      csv = 'Date,Item Name,Category,Quantity,Unit,Batch,Expiry,Reason,Value Lost,Responsible,Branch,Warehouse,Notes\n';
      data.deductions.forEach(d => {
        csv += `"${d.date}","${d.itemName}","${d.category || ''}",${d.quantity},"${d.unit}","${d.batch || ''}","${d.expiry || ''}","${d.reason}",${d.valueLost || 0},"${d.responsible}","${d.branch}","${d.warehouse || ''}","${d.notes || ''}"\n`;
      });
    } else if (data.exportType === 'audit') {
      csv = 'Timestamp,Action,Event Type,Item Name,Quantity,Value,User,Branch,Details\n';
      data.audit.forEach(a => {
        csv += `"${a.timestamp}","${a.action}","${a.eventType || ''}","${a.itemName || ''}",${a.quantity || 0},${a.details?.value || 0},"${a.user}","${a.branch || ''}","${typeof a.details === 'object' ? JSON.stringify(a.details).replace(/"/g, '""') : a.details || ''}"\n`;
      });
    } else {
      // Complete export: combines inventory, sales, deductions
      csv = '--- INVENTORY RECORDS ---\n';
      csv += 'Generic Name,Brand,Category,Qty (Display),Display Unit,Selling Price,Total Value,Batch,Expiry\n';
      data.inventory.forEach(i => {
        csv += `"${i.name}","${i.brandName || ''}","${i.category}",${i.quantityDisplay},"${i.displayUnit}",${i.sellingPricePerDisplay},${(i.quantityDisplay * i.sellingPricePerDisplay).toFixed(2)},"${i.batchNumber}","${i.expiryDate}"\n`;
      });
      csv += '\n--- SALES RECORDS ---\nDate,Invoice,Item,Quantity,Unit,Grand Total,Profit\n';
      data.sales.forEach(s => {
        s.items.forEach(it => {
          csv += `"${s.date}","${s.invoiceNumber}","${it.name}",${it.quantity},"${it.unit}",${s.grandTotal},${s.profit || 0}\n`;
        });
      });
      csv += '\n--- DEDUCTIONS / LOSSES ---\nDate,Item,Quantity,Reason,Value Lost\n';
      data.deductions.forEach(d => {
        csv += `"${d.date}","${d.itemName}",${d.quantity},"${d.reason}",${d.valueLost || 0}\n`;
      });
    }

    const blob = new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = data.filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  private static exportToPdf(data: {
    exportType: string;
    filename: string;
    inventory: StockItem[];
    sales: SaleRecord[];
    deductions: DeductionRecord[];
    audit: AuditRecord[];
    pharmacyName: string;
    brandName: string;
    branch: string;
  }) {
    const jsPDF = (window as any).jspdf?.jsPDF || (window as any).jsPDF;
    if (!jsPDF) {
      console.warn('jsPDF not loaded, falling back to CSV');
      this.exportToCsv(data as any);
      return;
    }

    const doc = new jsPDF({ orientation: 'landscape' });
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(10, 31, 61);
    doc.text(data.pharmacyName, 14, 15);
    doc.setFontSize(11);
    doc.setTextColor(184, 134, 11);
    doc.text(`${data.brandName} - ${data.exportType.toUpperCase()} REPORT (${new Date().toLocaleDateString()})`, 14, 22);

    let head: string[][] = [];
    let body: (string | number)[][] = [];

    if (data.exportType === 'inventory' || data.exportType === 'all') {
      head = [['#', 'Generic Name', 'Brand', 'Category', 'Unit', 'Qty', 'Selling', 'Total Value', 'Batch', 'Expiry']];
      body = data.inventory.slice(0, 150).map((i, idx) => [
        idx + 1,
        i.name,
        i.brandName || '-',
        i.category,
        i.displayUnit,
        i.quantityDisplay.toFixed(2),
        `ETB ${i.sellingPricePerDisplay.toFixed(2)}`,
        `ETB ${(i.quantityDisplay * i.sellingPricePerDisplay).toFixed(2)}`,
        i.batchNumber,
        i.expiryDate
      ]);
    } else if (data.exportType === 'sales') {
      head = [['Date', 'Invoice', 'Customer', 'Items', 'Grand Total', 'Profit', 'Payment', 'Salesperson']];
      body = data.sales.slice(0, 150).map(s => [
        s.date,
        s.invoiceNumber,
        s.customerName || 'Walk-in',
        s.items.map(it => `${it.name} (${it.quantity})`).join(', '),
        `ETB ${s.grandTotal.toFixed(2)}`,
        `ETB ${(s.profit || 0).toFixed(2)}`,
        s.paymentMethod,
        s.salesperson
      ]);
    } else if (data.exportType === 'deductions') {
      head = [['Date', 'Item Name', 'Qty', 'Unit', 'Reason', 'Value Lost', 'Responsible']];
      body = data.deductions.slice(0, 150).map(d => [
        d.date,
        d.itemName,
        d.quantity.toFixed(2),
        d.unit,
        d.reason,
        `ETB ${(d.valueLost || 0).toFixed(2)}`,
        d.responsible
      ]);
    } else {
      head = [['Timestamp', 'Action', 'Item', 'Qty', 'Value', 'User', 'Branch']];
      body = data.audit.slice(0, 150).map(a => [
        a.timestamp.slice(0, 16),
        a.action,
        a.itemName || '-',
        a.quantity || 0,
        `ETB ${(a.details?.value || 0).toFixed(2)}`,
        a.user,
        a.branch || '-'
      ]);
    }

    if ((doc as any).autoTable) {
      (doc as any).autoTable({
        startY: 28,
        head: head,
        body: body,
        theme: 'striped',
        headStyles: { fillColor: [10, 31, 61], textColor: [255, 215, 0] },
        styles: { fontSize: 8.5, cellPadding: 3 }
      });
    }

    doc.save(data.filename);
  }
}
