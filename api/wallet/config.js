import { createWalletHandlers } from '../../server/wallet/service.mjs';
import { nodeHandler } from '../../server/wallet/http.mjs';
export default function handler(request, response) { return nodeHandler(request, response, createWalletHandlers().config); }
