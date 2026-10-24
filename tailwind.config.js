/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: '#0F4C81', dark: '#0A3459', light: '#E7F0F9' },
        ok: '#15803D',
        warn: '#B45309',
        danger: '#B91C1C',
      },
    },
  },
  plugins: [],
};
