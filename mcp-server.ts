import { main } from './src/mcp-server';

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
