module.exports = {
  content: ['./index.html', './js/**/*.js'],
  theme: {
    extend: {
      colors: {
        navy: { 50: '#f0f4f8', 100: '#d9e2ec', 700: '#102a43', 800: '#081c2e', 900: '#030e18' },
        gold: { 400: '#fbbf24', 500: '#f59e0b', 600: '#d97706' }
      },
      fontFamily: { sans: ['system-ui', 'sans-serif'] }
    }
  }
};