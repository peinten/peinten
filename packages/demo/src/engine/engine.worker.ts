import { exposeRuntime } from 'peinten/worker';
import { createTools } from './tools';

exposeRuntime({ tools: createTools() });
