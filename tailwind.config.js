/** @type {import('tailwindcss').Config} */

/*
 * AI for Business Design System — Tailwind Mapping.
 * Warm Canvas #e5e5e5 page background, Paper White #ffffff cards (32px radius, zero shadow),
 * Carbon Black #000000 primary text & inverted blocks, Mint Chip #d1ffca tag pills (64px radius),
 * Voltage Yellow #fff100 micro-accents, and massive uppercase condensed display headlines at 0.9 line-height.
 */
module.exports = {
  darkMode: ['class'],
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        'carbon-black': '#000000',
        'paper-white': '#ffffff',
        'warm-canvas': '#e5e5e5',
        'mist-gray': '#f3f3f3',
        ash: '#c6c6c6',
        smoke: '#979797',
        slate: '#444444',
        graphite: '#2f2f2f',
        'mint-chip': '#d1ffca',
        'voltage-yellow': '#fff100',

        border: '#c6c6c6',
        input: 'var(--color-mist-gray)',
        ring: 'var(--color-carbon-black)',
        background: 'var(--color-warm-canvas)',
        foreground: 'var(--color-carbon-black)',

        primary: {
          DEFAULT: 'var(--color-carbon-black)',
          foreground: 'var(--color-paper-white)',
        },
        secondary: {
          DEFAULT: 'var(--color-mist-gray)',
          foreground: 'var(--color-carbon-black)',
        },
        muted: {
          DEFAULT: 'var(--color-mist-gray)',
          foreground: '#979797',
        },
        accent: {
          DEFAULT: 'var(--color-mint-chip)',
          foreground: '#000000',
        },
        card: {
          DEFAULT: 'var(--color-paper-white)',
          foreground: 'var(--color-carbon-black)',
        },

        red: {
          50: '#e5e5e5', 200: '#000000', 500: '#000000', 600: '#000000', 700: '#000000',
        },
        green: {
          50: '#e5e5e5', 200: '#d1ffca', 500: '#d1ffca', 600: '#d1ffca', 700: '#000000',
        },
        amber: {
          50: '#e5e5e5', 200: '#fff100', 500: '#fff100', 600: '#fff100', 700: '#000000',
        },
        blue: {
          50: '#e5e5e5', 200: '#000000', 500: '#000000', 600: '#000000', 700: '#000000',
        },
        orange: {
          50: '#e5e5e5', 200: '#000000', 500: '#000000', 700: '#000000',
        },
        purple: { 50: '#e5e5e5', 200: '#000000', 700: '#000000' },
        rose: { 50: '#e5e5e5', 200: '#000000', 700: '#000000' },
        teal: { 50: '#e5e5e5', 200: '#d1ffca', 700: '#d1ffca' },
        indigo: { 50: '#e5e5e5', 200: '#000000', 700: '#000000' },
        yellow: { 400: '#fff100' },
      },

      fontFamily: {
        condensed: ['Bebas Neue', 'Anton', 'Barlow Condensed', 'sans-serif'],
        sans: ['var(--font-inter)', 'Inter', 'Söhne', 'ui-sans-serif', 'sans-serif'],
        mono: ['var(--font-mono)', 'Roboto Mono', 'JetBrains Mono', 'ui-monospace', 'monospace'],
      },

      fontSize: {
        caption: ['12px', { lineHeight: '1.6', letterSpacing: '-0.36px' }],
        'body-sm': ['14px', { lineHeight: '1.3', letterSpacing: '-0.154px' }],
        body: ['16px', { lineHeight: '1.25' }],
        subheading: ['18px', { lineHeight: '1.33' }],
        'subheading-lg': ['20px', { lineHeight: '1.2' }],
        'heading-sm': ['28px', { lineHeight: '1.3', letterSpacing: '-0.84px' }],
        heading: ['40px', { lineHeight: '1.1', letterSpacing: '-0.8px' }],
        'heading-lg': ['48px', { lineHeight: '0.9', letterSpacing: '-1.44px' }],
        display: ['80px', { lineHeight: '0.9', letterSpacing: '-2.4px' }],
        'display-xl': ['130px', { lineHeight: '0.9', letterSpacing: '-3.9px' }],
      },

      borderRadius: {
        DEFAULT: '32px',
        sm: '4px',
        md: '8px',
        lg: '24px',
        xl: '32px',
        '2xl': '48px',
        card: '32px',
        pill: '48px',
        tag: '64px',
        full: '9999px',
        none: '0px',
      },

      boxShadow: {
        none: 'none',
      },

      maxWidth: {
        page: '1200px',
      },
    },
  },
  plugins: [],
}
