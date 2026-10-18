/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          red: '#E50914',
          'red-dark': '#B80710',
          'red-light': '#FF3B47',
          'red-glow': '#E5091440',
          yellow: '#FFB800',
          green: '#10B981',
          'green-light': '#34D399',
          orange: '#F59E0B',
          dark: '#121212',
          'dark-card': '#1C1C1E',
          'dark-card2': '#242426',
          'dark-border': '#2C2C2E',
          'dark-input': '#18181A',
          muted: '#8E8E93',
          subtle: '#636366',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      boxShadow: {
        'phone': '0 25px 60px -15px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.1)',
        'phone-glow': '0 0 40px rgba(229, 9, 20, 0.25)',
        'card-glow': '0 4px 20px -2px rgba(229, 9, 20, 0.15)',
        'btn-red': '0 8px 25px -4px rgba(229, 9, 20, 0.5)',
      },
      animation: {
        'pulse-subtle': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      }
    },
  },
  plugins: [],
}
