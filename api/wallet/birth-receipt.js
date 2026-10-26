import { createBirthReceiptHandler } from '../../server/wallet/birth-receipt.mjs';
import { nodeHandler } from '../../server/wallet/http.mjs';
export default function handler(request, response) { return nodeHandler(request, response, createBirthReceiptHandler()); }
