/**
 * NCD-App 共通ローディング機能
 * データ取得中のオーバーレイとスピナーを提供
 */

class LoadingManager {
  constructor() {
    this.loadingOverlay = null;
    this.init();
  }

  init() {
    this.loadingOverlay = document.createElement('div');
    this.loadingOverlay.id = 'ncd-loading-overlay';
    this.loadingOverlay.className = 'ncd-loading-overlay';
    this.loadingOverlay.innerHTML = `
      <div class="ncd-loading-content">
        <div class="ncd-spinner"></div>
        <div class="ncd-loading-text">データ取得中...</div>
      </div>
    `;

    if (!document.getElementById('ncd-loading-styles')) {
      const style = document.createElement('style');
      style.id = 'ncd-loading-styles';
      style.textContent = `
        .ncd-loading-overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background-color: rgba(0, 0, 0, 0.5);
          display: flex;
          justify-content: center;
          align-items: center;
          z-index: 9999;
          opacity: 0;
          visibility: hidden;
          transition: opacity 0.3s ease, visibility 0.3s ease;
        }

        .ncd-loading-overlay.show {
          opacity: 1;
          visibility: visible;
        }

        .ncd-loading-content {
          background: white;
          padding: 2rem;
          border-radius: 0.5rem;
          box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
          text-align: center;
          min-width: 200px;
        }

        .ncd-spinner {
          width: 40px;
          height: 40px;
          margin: 0 auto 1rem;
          border: 3px solid #e5e7eb;
          border-top: 3px solid #3b82f6;
          border-radius: 50%;
          animation: ncd-spin 1s linear infinite;
        }

        .ncd-loading-text {
          color: #374151;
          font-size: 0.875rem;
          font-weight: 500;
        }

        @keyframes ncd-spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        .ncd-tab-loading {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background-color: rgba(255, 255, 255, 0.8);
          display: flex;
          justify-content: center;
          align-items: center;
          z-index: 10;
          opacity: 0;
          visibility: hidden;
          transition: opacity 0.2s ease, visibility 0.2s ease;
        }

        .ncd-tab-loading.show {
          opacity: 1;
          visibility: visible;
        }

        .ncd-tab-loading .ncd-spinner {
          width: 24px;
          height: 24px;
          margin: 0;
          border-width: 2px;
        }

        .ncd-tab-loading .ncd-loading-text {
          margin-left: 0.5rem;
          font-size: 0.75rem;
        }
      `;
      document.head.appendChild(style);
    }

    if (document.body) {
      document.body.appendChild(this.loadingOverlay);
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        document.body.appendChild(this.loadingOverlay);
      });
    }
  }

  show(message = 'データ取得中...') {
    const textEl = this.loadingOverlay.querySelector('.ncd-loading-text');
    if (textEl) {
      textEl.textContent = message;
    }
    this.loadingOverlay.classList.add('show');
  }

  hide() {
    this.loadingOverlay.classList.remove('show');
  }

  showInElement(targetElement, message = 'データ取得中...') {
    if (!targetElement) return;
    this.hideInElement(targetElement);

    const originalPosition = getComputedStyle(targetElement).position;
    if (originalPosition === 'static') {
      targetElement.style.position = 'relative';
      targetElement.dataset.originalPosition = 'static';
    }

    const loading = document.createElement('div');
    loading.className = 'ncd-tab-loading';
    loading.innerHTML = `
      <div style="display: flex; align-items: center;">
        <div class="ncd-spinner"></div>
        <div class="ncd-loading-text">${message}</div>
      </div>
    `;

    targetElement.appendChild(loading);
    requestAnimationFrame(() => {
      loading.classList.add('show');
    });
    return loading;
  }

  hideInElement(targetElement) {
    if (!targetElement) return;
    const loading = targetElement.querySelector('.ncd-tab-loading');
    if (loading) {
      loading.classList.remove('show');
      setTimeout(() => {
        loading.remove();
        if (targetElement.dataset.originalPosition === 'static') {
          targetElement.style.position = '';
          delete targetElement.dataset.originalPosition;
        }
      }, 200);
    }
  }

  async wrap(asyncFunction, message = 'データ取得中...', targetElement = null) {
    try {
      if (targetElement) {
        this.showInElement(targetElement, message);
      } else {
        this.show(message);
      }
      return await asyncFunction();
    } finally {
      if (targetElement) {
        this.hideInElement(targetElement);
      } else {
        this.hide();
      }
    }
  }
}

const NCDLoading = new LoadingManager();
window.showLoading = (message) => NCDLoading.show(message);
window.hideLoading = () => NCDLoading.hide();
window.showLoadingInElement = (element, message) => NCDLoading.showInElement(element, message);
window.hideLoadingInElement = (element) => NCDLoading.hideInElement(element);
window.wrapWithLoading = (asyncFn, message, element) => NCDLoading.wrap(asyncFn, message, element);
