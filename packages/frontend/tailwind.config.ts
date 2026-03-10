import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        spotify: {
          black: '#191414',
          green: '#1DB954',
          'green-hover': '#1ed760',
          white: '#FFFFFF',
          'gray-light': '#B3B3B3',
          'gray-dark': '#282828',
          'card-bg': '#181818',
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
