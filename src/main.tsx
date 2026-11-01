import { UltraStockSystem } from './modules/system';
import './app.css';

// Initialize EBP-SMS Enterprise System on DOM Ready
document.addEventListener('DOMContentLoaded', () => {
  const system = new UltraStockSystem();
  (window as any).ultraStock = system;
});

// Also immediately attempt init in case DOM is already parsed
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  if (!(window as any).ultraStock) {
    const system = new UltraStockSystem();
    (window as any).ultraStock = system;
  }
}
