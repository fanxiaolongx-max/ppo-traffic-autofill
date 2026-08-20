(() => {
  const storedTheme = localStorage.getItem('ppo-theme');
  const theme = storedTheme === 'light' || storedTheme === 'dark'
    ? storedTheme
    : (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  const language = localStorage.getItem('ppo-language') === 'en' ? 'en' : 'zh';
  document.documentElement.dataset.theme = theme;
  document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN';
})();
