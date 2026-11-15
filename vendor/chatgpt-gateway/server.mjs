import { createGateway } from './gateway-server.mjs';
import { fileURLToPath } from 'node:url';
const port = Number(process.env.PORT || 18790);
const { server } = createGateway({
  bindingPath: fileURLToPath(new URL('../../data/gateway-conversations.json', import.meta.url)),
  logger: (event, details) => console.log(new Date().toISOString(), event, details || ''),
});
server.on('error', error => {
  console.error(`Gateway failed: ${error.code || error.message}`);
  if (error.code === 'EADDRINUSE') console.error(`Port ${port} is in use. Stop the previous gateway before restarting.`);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => {
  console.log(`ChatGPT Gateway: http://127.0.0.1:${port}/v1/chat/completions`);
  console.log('Streaming enabled. Waiting for the browser extension.');
});
