// Punto de entrada. En Vercel se exporta la app; en local (`npm run dev`) además escucha en PORT.
require('dotenv').config({ quiet: true });
const { crearApp } = require('./app');

const app = crearApp();

if (require.main === module) {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => console.log(`API de Vetshop en http://localhost:${PORT}`));
}

module.exports = app;
