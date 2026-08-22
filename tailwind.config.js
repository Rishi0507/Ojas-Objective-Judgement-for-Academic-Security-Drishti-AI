/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        border: "hsl(0 0% 89%)",
        input: "hsl(0 0% 89%)",
        ring: "hsl(215 25% 27%)",
        background: "hsl(0 0% 97%)",
        foreground: "hsl(215 25% 27%)",
        primary: {
          DEFAULT: "hsl(215 25% 27%)",
          foreground: "hsl(0 0% 100%)",
        },
        secondary: {
          DEFAULT: "hsl(0 0% 96%)",
          foreground: "hsl(215 25% 27%)",
        },
        muted: {
          DEFAULT: "hsl(0 0% 96%)",
          foreground: "hsl(215 16% 47%)",
        },
        accent: {
          DEFAULT: "hsl(210 40% 96%)",
          foreground: "hsl(215 25% 27%)",
        },
        card: {
          DEFAULT: "hsl(0 0% 100%)",
          foreground: "hsl(215 25% 27%)",
        },
      },
      fontFamily: {
        sans: ['Figtree', 'Inter', 'system-ui', 'sans-serif'],
        serif: ['EB Garamond', 'Georgia', 'serif'],
        mono: ['JetBrains Mono', 'Courier New', 'monospace'],
      },
    },
  },
  plugins: [],
}
