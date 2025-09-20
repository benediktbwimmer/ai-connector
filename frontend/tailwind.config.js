/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx,js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Inter"', '"SF Pro Display"', 'system-ui', 'sans-serif'],
      },
      colors: {
        surface: {
          DEFAULT: 'rgba(15,23,42,0.8)',
        },
      },
      boxShadow: {
        glow: '0 40px 120px rgba(15, 23, 42, 0.45)',
      },
    },
  },
  plugins: [],
};
