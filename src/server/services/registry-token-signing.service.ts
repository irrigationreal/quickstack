import crypto from "crypto";
import paramService, { ParamService } from "./param.service";
import { CryptoUtils } from "../utils/crypto.utils";

function keyIdFromPublicJwk(jwk: JsonWebKey) {
    const canonical = JSON.stringify({ e: jwk.e, kty: jwk.kty, n: jwk.n });
    return crypto.createHash('sha256').update(canonical).digest('base64url');
}

function base64UrlJson(value: unknown) {
    return Buffer.from(JSON.stringify(value)).toString('base64url');
}

class RegistryTokenSigningService {
    private cachedMaterial?: { privateKeyPem: string; jwks: { keys: JsonWebKey[] } };
    private loadingMaterial?: Promise<{ privateKeyPem: string; jwks: { keys: JsonWebKey[] } }>;

    async ensureSigningMaterial() {
        if (this.cachedMaterial) return this.cachedMaterial;
        if (this.loadingMaterial) return await this.loadingMaterial;
        this.loadingMaterial = this.loadSigningMaterial();
        try {
            this.cachedMaterial = await this.loadingMaterial;
            return this.cachedMaterial;
        } finally {
            this.loadingMaterial = undefined;
        }
    }

    private async loadSigningMaterial() {
        const existingPrivateKey = await paramService.getString(ParamService.REGISTRY_TOKEN_PRIVATE_KEY);
        const existingJwks = await paramService.getString(ParamService.REGISTRY_TOKEN_PUBLIC_JWK);
        if (existingPrivateKey && existingJwks) {
            return {
                privateKeyPem: CryptoUtils.decrypt(existingPrivateKey),
                jwks: JSON.parse(existingJwks) as { keys: JsonWebKey[] },
            };
        }

        const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
        const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
        const publicJwk = publicKey.export({ format: 'jwk' }) as JsonWebKey & { use?: string; alg?: string; kid?: string };
        publicJwk.use = 'sig';
        publicJwk.alg = 'RS256';
        publicJwk.kid = keyIdFromPublicJwk(publicJwk);
        const jwks = { keys: [publicJwk] };
        await Promise.all([
            paramService.save({ name: ParamService.REGISTRY_TOKEN_PRIVATE_KEY, value: CryptoUtils.encrypt(privateKeyPem) }),
            paramService.save({ name: ParamService.REGISTRY_TOKEN_PUBLIC_JWK, value: JSON.stringify(jwks) }),
        ]);
        return { privateKeyPem, jwks };
    }

    async publicJwksJson() {
        const material = await this.ensureSigningMaterial();
        return JSON.stringify(material.jwks);
    }

    async signRs256(payload: Record<string, unknown>) {
        const material = await this.ensureSigningMaterial();
        const key = material.jwks.keys[0] as JsonWebKey & { kid?: string };
        const header = { typ: 'JWT', alg: 'RS256', kid: key.kid };
        const signingInput = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
        const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), material.privateKeyPem).toString('base64url');
        return `${signingInput}.${signature}`;
    }
}

const registryTokenSigningService = new RegistryTokenSigningService();
export default registryTokenSigningService;
