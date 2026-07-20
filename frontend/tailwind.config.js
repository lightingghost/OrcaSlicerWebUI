/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        orca: {
          teal: '#00a896',
          amber: '#f4a261',
          purple: '#9178f0',
          dark: '#1a1a2e',
        },
      },
    },
  },
  plugins: [],
}
