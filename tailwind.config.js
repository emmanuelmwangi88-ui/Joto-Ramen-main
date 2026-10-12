/** Same theme as the old inline config in index.html */
module.exports = {
  content: ['./public/index.html', './public/script.js'],
  theme: { extend: {
    colors: { charcoal:'#1a1a1a','lantern-red':'#E84545',parchment:'#F5ECD7','muted-gold':'#C9A84C','dark-bg':'#0d0d0d','light-pink':'#FFB6C1' },
    fontFamily: { inter:['Inter','sans-serif'], noto:['Noto Serif JP','serif'] } } },
  plugins: []
};
