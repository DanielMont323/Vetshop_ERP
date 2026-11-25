module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.js'],
  // Arranca un Mongo en memoria con réplica (para transacciones) una vez por corrida
  globalSetup: '<rootDir>/tests/setup/globalSetup.js',
  globalTeardown: '<rootDir>/tests/setup/globalTeardown.js',
  // Se ejecuta antes de cargar cualquier módulo de la app: fija y valida el entorno de pruebas
  setupFiles: ['<rootDir>/tests/setup/env.js'],
  testTimeout: 30000,
  // Todas las pruebas comparten la misma instancia de Mongo: nunca en paralelo
  maxWorkers: 1
};
