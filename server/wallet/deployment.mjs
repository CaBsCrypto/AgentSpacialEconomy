import { Address, xdr, hash } from '@stellar/stellar-sdk';
import { SHARED_DEPLOYER } from './config.mjs';
import { WalletApiError } from './http.mjs';

const refuse = message => { throw new WalletApiError(403, 'deployment_not_allowed', message); };
const equal = (a,b) => Buffer.from(a).equals(Buffer.from(b));

/** This pilot sponsors one-passkey deployments only, never arbitrary calls/XDR. */
export function validateDeployment(body, config) {
  if (Object.keys(body).some(key => key !== 'func' && key !== 'auth') || typeof body.func !== 'string' || !Array.isArray(body.auth) || body.auth.length !== 1 || typeof body.auth[0] !== 'string') refuse('Solo se admite el despliegue de una wallet de prueba.');
  let func, auth;
  try { func = xdr.HostFunction.fromXDR(body.func, 'base64'); auth = xdr.SorobanAuthorizationEntry.fromXDR(body.auth[0], 'base64'); }
  catch { throw new WalletApiError(400, 'invalid_xdr', 'El despliegue contiene XDR inválido.'); }
  try {
    if (func.switch().name !== 'hostFunctionTypeCreateContractV2') refuse('La operación no es un despliegue de wallet.');
    const deploy = func.createContractV2();
    if (deploy.executable().switch().name !== 'contractExecutableWasm' || deploy.executable().wasmHash().toString('hex') !== config.accountWasmHash) refuse('El código de wallet no está autorizado.');
    const preimage = deploy.contractIdPreimage();
    if (preimage.switch().name !== 'contractIdPreimageFromAddress') refuse('El origen del despliegue no está autorizado.');
    const from = preimage.fromAddress();
    if (Address.fromScAddress(from.address()).toString() !== SHARED_DEPLOYER) refuse('El desplegador no está autorizado.');
    const args = deploy.constructorArgs();
    if (args.length !== 2 || args[0].switch().name !== 'scvVec' || args[1].switch().name !== 'scvMap' || args[1].map().length !== 0) refuse('La wallet debe usar una passkey y ninguna política adicional.');
    const signers = args[0].vec();
    if (signers.length !== 1 || signers[0].switch().name !== 'scvVec') refuse('Se requiere una única passkey inicial.');
    const signer = signers[0].vec();
    if (signer.length !== 3 || signer[0].switch().name !== 'scvSymbol' || signer[0].sym().toString() !== 'External' || signer[1].switch().name !== 'scvAddress' || signer[2].switch().name !== 'scvBytes') refuse('La passkey inicial no es válida.');
    if (Address.fromScAddress(signer[1].address()).toString() !== config.webauthnVerifierAddress) refuse('El verificador de passkey no está autorizado.');
    const key = signer[2].bytes();
    if (key.length <= 65 || key.length > 256 || key[0] !== 4 || !equal(hash(key.subarray(65)), from.salt())) refuse('La identidad de la passkey no corresponde al despliegue.');
    const credentials = auth.credentials();
    if (credentials.switch().name !== 'sorobanCredentialsAddress' || Address.fromScAddress(credentials.address().address()).toString() !== SHARED_DEPLOYER) refuse('La autorización del desplegador no es válida.');
    const root = auth.rootInvocation();
    if (root.subInvocations().length !== 0 || root.function().switch().name !== 'sorobanAuthorizedFunctionTypeCreateContractV2HostFn' || !equal(root.function().createContractV2HostFn().toXDR(), deploy.toXDR())) refuse('La autorización contiene operaciones adicionales.');
    return { func, auth: [auth] };
  } catch (error) {
    if (error instanceof WalletApiError) throw error;
    refuse('El despliegue no tiene el formato autorizado.');
  }
}
