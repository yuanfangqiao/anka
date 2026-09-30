/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{vue,ts}',
    // 应用插件（plugins/）的 Vue/TS 源码同样参与类名扫描
    '../plugins/**/*.{vue,ts,js}',
  ],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        bg: {
          0: 'var(--bg-0)',
          1: 'var(--bg-1)',
          2: 'var(--bg-2)',
        },
        ink: {
          0: 'var(--text-0)',
          1: 'var(--text-1)',
          2: 'var(--text-2)',
        },
        brand: {
          DEFAULT: 'var(--primary)',
          soft: 'var(--primary-2)',
          cyan: 'var(--cyan)',
        },
        ok: 'var(--ok)',
        warn: 'var(--warn)',
        err: 'var(--err)',
        line: 'var(--line)',
        glass: 'var(--glass)',
      },
      fontFamily: {
        sans: ['"PingFang SC"', '-apple-system', '"Segoe UI"', '"Microsoft YaHei"', 'sans-serif'],
      },
      borderRadius: {
        card: '18px',
        shell: '28px',
      },
      boxShadow: {
        card: '0 1px 2px rgb(0 0 0 / 0.25), 0 12px 32px -12px rgb(0 0 0 / 0.45)',
        glow: '0 0 24px -6px var(--primary)',
      },
      transitionDuration: {
        micro: '200ms',
      },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(10px) scale(0.98)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'pulse-dot': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.35' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.32s cubic-bezier(0.22, 1, 0.36, 1) both',
        'pulse-dot': 'pulse-dot 1.6s ease-in-out infinite',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}
