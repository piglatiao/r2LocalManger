/**
 * 应用密码锁渲染层
 * 负责锁屏 / 首次设置密码 / 找回密码三个界面的交互。
 */

(function () {
  const ipcRenderer = require('electron').ipcRenderer;

  const api = {
    getStatus: async () => {
      const result = await ipcRenderer.invoke('appLock:getStatus');
      return result.success ? result.data : { enabled: false, hasPassword: false, locked: false, needsSetup: false };
    },
    setup: async (password) => unwrap(await ipcRenderer.invoke('appLock:setup', password)),
    unlock: async (password) => unwrap(await ipcRenderer.invoke('appLock:unlock', password)),
    change: async (payload) => unwrap(await ipcRenderer.invoke('appLock:change', payload)),
    setEnabled: async (payload) => unwrap(await ipcRenderer.invoke('appLock:setEnabled', payload)),
    dismissSetup: async () => unwrap(await ipcRenderer.invoke('appLock:dismissSetup')),
    reset: async (payload) => unwrap(await ipcRenderer.invoke('appLock:reset', payload))
  };

  /**
   * 统一处理 IPC 返回，失败时抛带 userMessage 的错误。
   * @param {Object} result - IPC 返回
   * @returns {*} data
   */
  function unwrap(result) {
    if (!result.success) {
      const error = new Error(result.error?.message || 'Operation failed');
      error.userMessage = result.error?.userMessage || '操作失败';
      throw error;
    }
    return result.data;
  }

  let status = { enabled: false, hasPassword: false, locked: false, needsSetup: false };
  let startApp = () => Promise.resolve();
  // 按需验证（如打开设置前）：解锁成功后要执行的回调
  let pendingAction = null;

  const dom = {};

  /**
   * 缓存 DOM 引用。
   */
  function resolveElements() {
    dom.overlay = document.getElementById('app-lock-overlay');
    dom.unlockView = document.getElementById('app-lock-unlock-view');
    dom.resetView = document.getElementById('app-lock-reset-view');
    dom.setupView = document.getElementById('app-lock-setup-view');
    dom.title = document.querySelector('.app-lock-title');
    dom.subtitle = document.querySelector('.app-lock-subtitle');
    dom.password = document.getElementById('app-lock-password');
    dom.error = document.getElementById('app-lock-error');
    dom.btnUnlock = document.getElementById('btn-app-lock-unlock');
    dom.btnForgot = document.getElementById('btn-app-lock-forgot');
    dom.accountId = document.getElementById('app-lock-account-id');
    dom.apiToken = document.getElementById('app-lock-api-token');
    dom.newPassword = document.getElementById('app-lock-new-password');
    dom.confirmPassword = document.getElementById('app-lock-confirm-password');
    dom.resetError = document.getElementById('app-lock-reset-error');
    dom.btnReset = document.getElementById('btn-app-lock-reset');
    dom.btnBack = document.getElementById('btn-app-lock-back');
    dom.setupPassword = document.getElementById('app-lock-setup-password');
    dom.setupConfirm = document.getElementById('app-lock-setup-confirm');
    dom.setupError = document.getElementById('app-lock-setup-error');
    dom.btnSetup = document.getElementById('btn-app-lock-setup');
    dom.btnSkip = document.getElementById('btn-app-lock-skip');
  }

  /**
   * 只显示指定的视图。
   * @param {'unlock'|'reset'|'setup'} view - 目标视图
   */
  function showView(view) {
    if (dom.unlockView) dom.unlockView.style.display = view === 'unlock' ? 'block' : 'none';
    if (dom.resetView) dom.resetView.style.display = view === 'reset' ? 'block' : 'none';
    if (dom.setupView) dom.setupView.style.display = view === 'setup' ? 'block' : 'none';

    if (dom.title) {
      dom.title.textContent = view === 'setup' ? '设置应用密码' : (view === 'reset' ? '找回密码' : '应用已锁定');
    }
    if (dom.subtitle) {
      dom.subtitle.textContent = view === 'setup'
        ? '设置后下次启动需要输入密码'
        : (view === 'reset' ? '验证 Cloudflare 凭据以重设密码' : '请输入密码以继续使用');
    }

    hideError(dom.error);
    hideError(dom.resetError);
    hideError(dom.setupError);

    const firstInput = view === 'unlock'
      ? dom.password
      : (view === 'reset' ? dom.accountId : dom.setupPassword);
    if (firstInput) {
      setTimeout(() => firstInput.focus(), 30);
    }
  }

  /**
   * 显示遮罩。
   * @param {'unlock'|'reset'|'setup'} view - 视图
   */
  function show(view) {
    if (!dom.overlay) return;
    dom.overlay.style.display = 'flex';
    showView(view);
  }

  /**
   * 隐藏遮罩。
   */
  function hide() {
    if (dom.overlay) {
      dom.overlay.style.display = 'none';
    }
  }

  /**
   * @param {HTMLElement|null} element - 错误提示元素
   * @param {string} message - 文案
   */
  function showError(element, message) {
    if (!element) return;
    element.textContent = message;
    element.style.display = 'block';
  }

  /**
   * @param {HTMLElement|null} element - 错误提示元素
   */
  function hideError(element) {
    if (!element) return;
    element.textContent = '';
    element.style.display = 'none';
  }

  /**
   * 校验两次输入的新密码。
   * @param {HTMLInputElement|null} passwordInput - 密码输入
   * @param {HTMLInputElement|null} confirmInput - 确认输入
   * @param {HTMLElement|null} errorElement - 错误提示元素
   * @returns {string} 校验通过的密码，失败返回空字符串
   */
  function readNewPassword(passwordInput, confirmInput, errorElement) {
    const password = String(passwordInput?.value || '');
    const confirm = String(confirmInput?.value || '');

    if (password.length < 4) {
      showError(errorElement, '密码至少需要 4 个字符');
      return '';
    }
    if (password !== confirm) {
      showError(errorElement, '两次输入的密码不一致');
      return '';
    }

    return password;
  }

  /**
   * 解锁成功后的统一出口：有按需回调就执行回调，否则进入应用。
   */
  async function afterUnlocked() {
    const action = pendingAction;
    pendingAction = null;
    if (action) {
      await action();
    } else {
      await startApp();
    }
  }

  /**
   * 解锁。
   */
  async function handleUnlock() {
    if (!dom.btnUnlock) return;
    hideError(dom.error);

    const password = String(dom.password?.value || '');
    if (!password) {
      showError(dom.error, '请输入密码');
      return;
    }

    dom.btnUnlock.disabled = true;
    try {
      status = await api.unlock(password);
      if (dom.password) dom.password.value = '';
      hide();
      await afterUnlocked();
    } catch (error) {
      showError(dom.error, error.userMessage || '解锁失败');
      if (dom.password) {
        dom.password.value = '';
        dom.password.focus();
      }
    } finally {
      dom.btnUnlock.disabled = false;
    }
  }

  /**
   * 找回密码。
   */
  async function handleReset() {
    if (!dom.btnReset) return;
    hideError(dom.resetError);

    const accountId = String(dom.accountId?.value || '').trim();
    const apiToken = String(dom.apiToken?.value || '').trim();
    if (!accountId || !apiToken) {
      showError(dom.resetError, '请填写 Cloudflare Account ID 与 API Token');
      return;
    }

    const newPassword = readNewPassword(dom.newPassword, dom.confirmPassword, dom.resetError);
    if (!newPassword) return;

    dom.btnReset.disabled = true;
    dom.btnReset.textContent = '正在验证...';

    try {
      status = await api.reset({ accountId, apiToken, newPassword });
      clearInputs([dom.accountId, dom.apiToken, dom.newPassword, dom.confirmPassword]);
      hide();
      await afterUnlocked();
    } catch (error) {
      showError(dom.resetError, error.userMessage || '重置密码失败');
    } finally {
      dom.btnReset.disabled = false;
      dom.btnReset.textContent = '验证并重设密码';
    }
  }

  /**
   * 首次设置密码。
   */
  async function handleSetup() {
    if (!dom.btnSetup) return;
    hideError(dom.setupError);

    const password = readNewPassword(dom.setupPassword, dom.setupConfirm, dom.setupError);
    if (!password) return;

    dom.btnSetup.disabled = true;
    try {
      status = await api.setup(password);
      clearInputs([dom.setupPassword, dom.setupConfirm]);
      hide();
      await startApp();
    } catch (error) {
      showError(dom.setupError, error.userMessage || '设置密码失败');
    } finally {
      dom.btnSetup.disabled = false;
    }
  }

  /**
   * 暂不设置密码。
   */
  async function handleSkipSetup() {
    try {
      status = await api.dismissSetup();
    } catch (error) {
      // 忽略失败，直接关闭即可
    }
    hide();
    await startApp();
  }

  /**
   * @param {Array<HTMLInputElement|null>} inputs - 需要清空的输入框
   */
  function clearInputs(inputs) {
    inputs.forEach((input) => {
      if (input) input.value = '';
    });
  }

  /**
   * 绑定事件。
   */
  function bindEvents() {
    if (dom.btnUnlock) dom.btnUnlock.addEventListener('click', handleUnlock);
    if (dom.password) {
      dom.password.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          handleUnlock();
        }
      });
    }
    if (dom.btnForgot) dom.btnForgot.addEventListener('click', () => showView('reset'));
    if (dom.btnBack) dom.btnBack.addEventListener('click', () => showView('unlock'));
    if (dom.btnReset) dom.btnReset.addEventListener('click', handleReset);
    if (dom.btnSetup) dom.btnSetup.addEventListener('click', handleSetup);
    if (dom.btnSkip) dom.btnSkip.addEventListener('click', handleSkipSetup);
  }

  window.appLockScreen = {
    /**
     * 启动入口：先判断锁定状态，再决定是否进入应用。
     * @param {Object} options - 选项
     * @param {Function} options.start - 进入应用的回调
     */
    async bootstrap(options = {}) {
      resolveElements();
      bindEvents();

      startApp = options.start || (() => Promise.resolve());

      status = await api.getStatus();

      // 已设置密码：先验密码
      if (status.locked) {
        show('unlock');
        return;
      }

      // 首次启动：必须先设置密码，设置完（或明确跳过）才进入应用，
      // 避免先把列表内容渲染出来再弹窗
      if (status.needsSetup) {
        show('setup');
        return;
      }

      await startApp();
    },

    /**
     * 按需验证：启用密码锁时先弹验证，成功后执行 action；
     * 未启用密码锁则直接执行。用于打开设置等敏感入口。
     * @param {Function} action - 验证通过后要执行的操作
     * @param {Object} [options] - 选项
     * @param {string} [options.title] - 遮罩标题
     * @param {string} [options.subtitle] - 遮罩副标题
     */
    async requestUnlock(action, options = {}) {
      if (typeof action !== 'function') return;

      resolveElements();
      bindEvents();

      status = await api.getStatus();

      if (!status.enabled || !status.hasPassword) {
        await action();
        return;
      }

      pendingAction = action;
      show('unlock');

      if (dom.title) dom.title.textContent = options.title || '身份验证';
      if (dom.subtitle) dom.subtitle.textContent = options.subtitle || '请输入应用密码以继续';
    },

    api
  };
})();
