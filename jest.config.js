module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/*.test.js'],
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/**/*.test.js',
    '!src/main/main.js',
    '!src/renderer/**'
  ],
  coverageDirectory: 'coverage',
  verbose: true
};
