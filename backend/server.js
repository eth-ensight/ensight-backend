const app = require('./app');
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 ENS Demo Backend running on http://localhost:${PORT}`);
  console.log(`📚 API docs available at http://localhost:${PORT}/`);
  console.log(`💚 Health check: http://localhost:${PORT}/health`);
});
