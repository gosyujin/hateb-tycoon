/**
 * ライト/ダークの切り替え。<html data-theme="light|dark"> を設定する。
 *
 * モード(localStorage):
 *   auto  : 時間帯で切り替える(デフォルト)。darkStart時〜darkEnd時の間がダーク
 *   light / dark : 固定
 *
 * 初回描画のちらつきを避けるため<head>で同期的に読み込む。設定画面のUI配線は
 * DOMContentLoaded後に行う。
 */
(function () {
  const MODE_KEY = 'hateb-tycoon:themeMode';
  const START_KEY = 'hateb-tycoon:themeDarkStart';
  const END_KEY = 'hateb-tycoon:themeDarkEnd';
  const DEFAULT_START = 18;
  const DEFAULT_END = 6;
  const META_COLOR = { light: '#ffffff', dark: '#1b1d21' };

  function read(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, String(value));
    } catch (e) {
      // localStorageが使えない環境では記憶をあきらめる
    }
  }

  function loadHour(key, fallback) {
    const v = Number(read(key));
    return Number.isInteger(v) && v >= 0 && v <= 23 ? v : fallback;
  }

  function loadMode() {
    const m = read(MODE_KEY);
    return m === 'light' || m === 'dark' ? m : 'auto';
  }

  // start === end は「常にライト」ではなく設定ミスなので、ライト扱いにする
  function isDarkAt(hour, start, end) {
    if (start === end) return false;
    return start < end ? hour >= start && hour < end : hour >= start || hour < end;
  }

  function resolveTheme() {
    const mode = loadMode();
    if (mode !== 'auto') return mode;
    const hour = new Date().getHours();
    return isDarkAt(hour, loadHour(START_KEY, DEFAULT_START), loadHour(END_KEY, DEFAULT_END)) ? 'dark' : 'light';
  }

  function applyTheme() {
    const theme = resolveTheme();
    document.documentElement.dataset.theme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', META_COLOR[theme]);
  }

  applyTheme();
  // 時間帯の境目をまたいだら切り替える(前面に戻った時と、1分おき)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) applyTheme();
  });
  setInterval(applyTheme, 60 * 1000);

  document.addEventListener('DOMContentLoaded', () => {
    const modeSelect = document.getElementById('theme-mode');
    const startInput = document.getElementById('theme-dark-start');
    const endInput = document.getElementById('theme-dark-end');
    const hoursRow = document.getElementById('theme-hours-row');
    if (!modeSelect || !startInput || !endInput) return;

    function refresh() {
      modeSelect.value = loadMode();
      startInput.value = loadHour(START_KEY, DEFAULT_START);
      endInput.value = loadHour(END_KEY, DEFAULT_END);
      if (hoursRow) hoursRow.hidden = modeSelect.value !== 'auto';
    }

    modeSelect.addEventListener('change', () => {
      write(MODE_KEY, modeSelect.value);
      refresh();
      applyTheme();
    });
    [[startInput, START_KEY, DEFAULT_START], [endInput, END_KEY, DEFAULT_END]].forEach(([input, key, fallback]) => {
      input.addEventListener('change', () => {
        const v = Number(input.value);
        write(key, Number.isInteger(v) && v >= 0 && v <= 23 ? v : fallback);
        refresh();
        applyTheme();
      });
    });
    refresh();
  });
})();
